const USUARIOS_MAP = {
  "aquiroz@itsanet.com": "Quiroz Andres",
  "bespinoza@itsanet.com": "Espinosa Bryan",
  "ingresosuio4@itsanet.com": "Suquilanda Ruben",
  "ingresosuio1@itsanet.com": "Ochoa Danny",
  "ingresosuio6@itsanet.com": "Males Dennis",
  "inventarioopuio@itsanet.com": "Danilo Almachi",
  "ingresosuio2@itsanet.com": "Villegas Kevin",
  "fmorales@itsanet.com": "Morales Fabian",
  "bodegafarma@itsanet.com": "Monroy Leonardo",
  "ccarrera@itsanet.com": "Carrera Cristian",
  "dmelendez@itsanet.com": "Melendez Diego"
};

// ==========================================
// CONFIGURACIÓN DEL CATÁLOGO ABC
// Todo lo ajustable del ABC vive aquí: no hay que tocar la lógica para cambiarlo.
// ==========================================
const ABC_CFG = {
  // Archivo maestro del que se lee el catálogo ABC (hoja "CRONOGRAMA_CODIGOS")
  MASTER_ID: "1Cq2AqRVAZJYmj_zs_zg8C63FPrgRBtJHaNcHWXygaPk",
  MASTER_SHEET: "CRONOGRAMA_CODIGOS",

  // Respaldo/complemento en Drive (ABC2026.txt, JSON { "CODIGO": "A", ... }).
  // Poner el ID del archivo evita buscar por nombre en todo el Drive (más rápido
  // y sin riesgo de tomar una copia equivocada). Si queda vacío, se busca por nombre.
  TXT_FALLBACK_ID: "",
  TXT_FALLBACK_NAME: "ABC2026.txt",

  // Caché: el catálogo se comprime (gzip+Base64) y se trocea porque CacheService
  // sólo admite 100 KB por clave. Sin esto, un catálogo mediano NO se cachea.
  CACHE_KEY: "WMS_ABC_MAP_V2",
  CACHE_TTL: 3600,          // 1 h (máximo permitido por CacheService: 6 h)
  CACHE_CHUNK: 90000,       // caracteres por trozo (< 100 KB)
  CACHE_MAX_CHUNKS: 25,

  // Respaldo local persistente: si el maestro no se puede abrir (permisos, cuota,
  // archivo movido), se sigue trabajando con la última copia buena.
  SNAP_SHEET: "_ABC_SNAPSHOT",
  SNAP_CHUNK: 45000,        // caracteres por celda (límite de Sheets: 50.000)

  // Columnas de la planilla de conteo
  COL_CLIENTE: 5,           // E
  COL_ABC: 6,               // F
  COL_CODIGO: 7,            // G

  // El catálogo se resuelve primero por CLIENTE+CODIGO: en CRONOGRAMA_CODIGOS el
  // mismo código puede existir para dos clientes con clasificación distinta, y
  // buscar sólo por código devolvía el ABC del último cliente cargado.
  // Además, al filtrar el maestro por los clientes presentes en esta planilla,
  // el catálogo que se cachea baja de decenas de miles de códigos a los pocos
  // miles que este inventario realmente necesita.
  FILTRAR_POR_CLIENTE: true,

  // Clasificación por defecto cuando el producto de un cliente NO aparece en
  // ningún catálogo. HYCITE no está en la hoja maestra (sus códigos viven en
  // ABC2026.txt), así que lo que no esté clasificado se toma como "C".
  // Para agregar otro cliente: "CLIENTE": "LETRA" (el cliente va en MAYÚSCULAS).
  ABC_POR_DEFECTO: {
    "HYCITE": "C"
  },

  // Si un código NO está en el catálogo ni tiene valor por defecto: true =
  // conservar el ABC que ya tenía la celda (no destruye información);
  // false = escribir ETIQUETA_SIN_ABC.
  PRESERVAR_SIN_MATCH: true,
  ETIQUETA_SIN_ABC: "",

  // Índice alterno sin ceros a la izquierda (para códigos guardados como número en
  // un archivo y como texto en el otro). Desactivar si los códigos reales llevan
  // ceros a la izquierda significativos.
  USAR_INDICE_ALTERNO: true,

  // Cada cuántos minutos se vuelve a leer el archivo maestro MIENTRAS HAY
  // OPERARIOS TRABAJANDO. Entre relecturas el ABC se resuelve con el catálogo
  // cacheado, así que los conteos no pagan el costo de abrir el maestro.
  // Subir a 120 para refrescar cada 2 horas.
  REFRESCO_MIN: 60,

  // Si cambian más tramos que esto, sale más barato reescribir la columna completa.
  MAX_TRAMOS: 40,

  PAYLOAD_VERSION: 3
};

// Compatibilidad con el código anterior
const ABC_MASTER_ID = ABC_CFG.MASTER_ID;
const ABC_MASTER_SHEET = ABC_CFG.MASTER_SHEET;
const ABC_TXT_FALLBACK = ABC_CFG.TXT_FALLBACK_NAME;

// Hoja oculta donde se respaldan las columnas protegidas para poder restaurarlas
const RESP_SHEET = "_RESP_WMS";

// Medición de tiempos de conteo
const TIEMPOS_SHEET = "TIEMPOS";
const PAUSA_MAX_MIN = 10; // un hueco mayor a esto se considera pausa (no conteo real)

// ==========================================
// CONFIGURACIÓN DEL DISPARO POR CONTEO (columnas V, W, X)
// El inventario "arranca" con el PRIMER conteo registrado, no al activar el
// archivo: recién ahí se sellan la fecha de inicio (A), el ID (C), la
// secuencia (D) y se refresca el ABC (F) contra el archivo maestro.
// ==========================================
const CONTEO_CFG = {
  PLANILLA: "PLANILLA DE CONTEO FISICO",
  COL_INI: 22,   // V — primer conteo
  COL_FIN: 24,   // X — tercer conteo

  PROP_FIRMA: "WMS_FIRMA_CONTEOS",     // último estado ya procesado
  PROP_INICIO: "WMS_INVENTARIO_INICIADO",
  PROP_ABC_LEIDO: "WMS_ABC_ULTIMA_LECTURA", // última lectura real del maestro
  PROP_PENDIENTE: "WMS_ACTUALIZACION_PENDIENTE",

  // Cuánto espera un gatillo por su turno antes de dejar la actualización
  // pendiente. Con varios operarios en el mismo archivo las corridas se
  // encadenan: como cada una dura ~1 s, 10 s alcanzan de sobra.
  ESPERA_LOCK: 10000,

  // Qué se escribe en la columna C al arrancar el inventario:
  // 'NOMBRE' = nombre del archivo (comportamiento actual, es lo que lee Power BI)
  // 'ID'     = ID del archivo de Google Sheets
  ID_MODO: "NOMBRE"
};

// ==========================================
// CONTEXTO DE EJECUCIÓN
// El motor puede correr de dos formas:
//   · Dentro del archivo hijo (script contenedor) → usa la hoja activa.
//   · Desde OTRO proyecto, como la Terminal WMS, apuntando a un archivo por ID.
// Todo el motor pide la hoja con ssActual_() en vez de getActiveSpreadsheet(),
// así el mismo código sirve para los dos casos sin duplicar nada.
// ==========================================
var SS_CTX_ = null;

function ssActual_() {
  return SS_CTX_ || SpreadsheetApp.getActiveSpreadsheet();
}

function fijarContexto_(ss) {
  SS_CTX_ = ss || null;
}

// Las propiedades del script son POR PROYECTO. Si un mismo proyecto (el de la
// Terminal) atiende muchos inventarios, el estado de uno pisaría al del otro:
// por eso cada clave lleva el ID del archivo.
function claveProp_(base, ss) {
  try {
    return base + ":" + (ss || ssActual_()).getId();
  } catch (e) {
    return base;
  }
}

// ==========================================
// 1. MENÚ PRINCIPAL DEL ARCHIVO HIJO
// ==========================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ Inventarios WMS ')
    .addItem(' ACTIVAR ARCHIVO ', 'instalarTriggersEnCopia')
    .addSeparator()
    .addItem(' Forzar TODO (Análisis + ABC + Registro)', 'forzarInicializacionManual')
    .addSeparator()
    .addItem('Actualizar Análisis', 'menuActualizarAnalisis')
    .addItem('Actualizar ABC', 'actualizarABCManual')
    .addItem('Diagnóstico ABC', 'diagnosticoABC')
    .addItem('Actualizar Registro', 'menuActualizarRegistro')
    .addToUi();
}

function instalarTriggersEnCopia() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();

  // Limpiar para evitar duplicados
  triggers.forEach(t => ScriptApp.deleteTrigger(t));

  // 1. Instalar el "Escuchador" para cuando la WebApp envíe datos.
  // onChange es el ÚNICO evento que dispara una escritura hecha por otro script
  // (la Terminal WMS): onEdit sólo se dispara con ediciones hechas a mano.
  ScriptApp.newTrigger("manejadorCambiosExternos")
    .forSpreadsheet(sheet)
    .onChange()
    .create();

  // 2. Instalar el disparador de CONTEOS (columnas V, W, X) para las capturas
  // digitadas directamente en la hoja. Es INSTALABLE a propósito: el onEdit
  // simple corre sin autorización y no puede abrir el archivo maestro del ABC.
  ScriptApp.newTrigger("alRegistrarConteo")
    .forSpreadsheet(sheet)
    .onEdit()
    .create();

  // 3. Instalar el temporizador de fondo (Revisa cada 30 min si debe trabajar o dormir)
  ScriptApp.newTrigger("rutinaDeFondoMaestra")
    .timeBased()
    .everyMinutes(30)
    .create();

  // Despertar el sistema por primera vez
  PropertiesService.getScriptProperties().setProperty(claveProp_('WMS_LAST_INTERACTION'), Date.now().toString());
  PropertiesService.getScriptProperties().setProperty(claveProp_('WMS_SYSTEM_SLEEPING'), 'false');

  SpreadsheetApp.getUi().alert(
    "✅ ¡ARCHIVO ACTIVADO CON ÉXITO!\n\n" +
    "El sistema está escuchando a la Terminal WMS y a las capturas hechas a mano.\n\n" +
    "Con el PRIMER conteo registrado en las columnas V, W o X se sellan automáticamente:\n" +
    "  • Columna A: fecha y hora de inicio del inventario\n" +
    "  • Columna C: ID del inventario\n" +
    "  • Columna D: secuencia\n" +
    "  • Columna F: clasificación ABC (leída del archivo maestro)"
  );

  forzarInicializacionManual();
}

// ==========================================
// 2. DISPARADORES DE CONTEO
// Los conteos llegan por dos caminos distintos y cada uno necesita su gatillo:
//   · Terminal WMS (otro script escribe en la hoja) → sólo dispara onChange,
//     que NO informa qué celda cambió.
//   · Operario digitando en la hoja → dispara onEdit, que sí trae el rango.
// Ambos caminos entran al mismo pipeline y se deduplican con una FIRMA del
// estado de los conteos, así el trabajo se hace una sola vez.
// ==========================================

// Firma barata del estado: cuántos conteos hay en V:X, hasta qué fila y cuántas
// filas tiene REGISTRO. Si no cambió, no hay nada nuevo que procesar (y de paso
// se descartan los eventos que generan las propias escrituras del script, que
// antes realimentaban el onChange).
function firmaConteos_(planilla, registro) {
  const out = { conteos: 0, ultimaFila: 0, filasRegistro: 0, firma: "0|0|0" };
  const lr = planilla.getLastRow();
  if (lr >= 2) {
    const n = lr - 1;
    const cols = CONTEO_CFG.COL_FIN - CONTEO_CFG.COL_INI + 1;
    const datos = planilla.getRange(2, CONTEO_CFG.COL_INI, n, cols).getValues();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < cols; j++) {
        const v = datos[i][j];
        if (v !== "" && v !== null && v !== undefined) { out.conteos++; out.ultimaFila = i + 2; }
      }
    }
  }
  out.filasRegistro = registro ? registro.getLastRow() : 0;
  out.firma = out.conteos + "|" + out.ultimaFila + "|" + out.filasRegistro;
  return out;
}

// ARRANQUE DEL INVENTARIO: se ejecuta una sola vez, con el primer conteo.
// La fecha de la columna A pasa a ser la del PRIMER CONTEO REAL (antes era la
// de la activación del archivo, que podía ser de días antes).
// Nunca pisa un valor ya escrito: en archivos que ya vienen trabajando, A y C
// se respetan tal como están.
function marcarInicioInventario_(planilla, ss) {
  ss = ss || planilla.getParent();
  const a2 = planilla.getRange("A2").getValue();
  const c2 = planilla.getRange("C2").getValue();

  if (!a2 || String(a2).trim() === "") {
    planilla.getRange("A2").setValue(new Date());
    const lr = planilla.getLastRow();
    if (lr >= 2) planilla.getRange(2, 1, lr - 1, 1).setNumberFormat("dd/MM/yy HH:mm:ss");
  }
  if (!c2 || String(c2).trim() === "") {
    planilla.getRange("C2").setValue(CONTEO_CFG.ID_MODO === "ID" ? ss.getId() : ss.getName());
  }

  actualizarColumnasAC(planilla);    // replica A2 (fecha inicio) y C2 (ID) hacia abajo
  generarSecuenciaColumnaD(planilla); // secuencia en D según los códigos de G
}

// Pipeline de actualización. NO toma el lock: lo hace quien lo llama.
function ejecutarPipeline_(opciones) {
  opciones = opciones || {};
  const res = { ejecutado: false, primerConteo: false, conteos: 0, motivo: opciones.motivo || "", abc: null };

  const ss = ssActual_();
  const planilla = ss.getSheetByName(CONTEO_CFG.PLANILLA);
  if (!planilla) return res;

  const prop = PropertiesService.getScriptProperties();
  const kFirma  = claveProp_(CONTEO_CFG.PROP_FIRMA, ss);
  const kInicio = claveProp_(CONTEO_CFG.PROP_INICIO, ss);
  const kAbc    = claveProp_(CONTEO_CFG.PROP_ABC_LEIDO, ss);
  const kPend   = claveProp_(CONTEO_CFG.PROP_PENDIENTE, ss);
  const estado = firmaConteos_(planilla, ss.getSheetByName("REGISTRO"));
  res.conteos = estado.conteos;

  // Si una corrida anterior se quedó sin turno, ésta procesa igual aunque la
  // firma no haya cambiado: así ninguna actualización se pierde.
  const habiaPendiente = prop.getProperty(kPend) === '1';
  if (habiaPendiente) prop.deleteProperty(kPend);

  // Sin conteos nuevos (ni filas nuevas de REGISTRO) no se recalcula nada.
  if (!opciones.forzar && !habiaPendiente && prop.getProperty(kFirma) === estado.firma) return res;

  // Despertar el sistema y registrar la hora de la actividad. La rutina de fondo
  // pasa actividad:false — si se marcara a sí misma como actividad, el archivo
  // nunca cumpliría las 3 horas de inactividad y jamás entraría en pausa.
  if (opciones.actividad !== false) {
    prop.setProperty(claveProp_('WMS_LAST_INTERACTION', ss), Date.now().toString());
    prop.setProperty(claveProp_('WMS_SYSTEM_SLEEPING', ss), 'false');
  }

  verificarConfiguracionInicial(planilla); // zona horaria Ecuador (+ C si falta)

  // ¿PRIMER conteo del inventario? Se sella el arranque y se relee el ABC del
  // maestro, para empezar con el catálogo del día.
  const yaIniciado = prop.getProperty(kInicio) === 'true';
  if (estado.conteos > 0 && !yaIniciado) {
    marcarInicioInventario_(planilla, ss);
    prop.setProperty(kInicio, 'true');
    res.primerConteo = true;
  }

  // Completa A (fecha de inicio) y C (ID) en las filas que va agregando la
  // Terminal. Es diferencial: si no falta ninguna, no escribe nada.
  actualizarColumnasAC(planilla);
  verificarYActualizarColumnaB(planilla);  // última fecha/hora de REGISTRO en col B
  generarSecuenciaColumnaD(planilla);      // secuencia D en base a G
  // ABC (columna F). Se relee el archivo maestro con el primer conteo, cuando lo
  // pide el menú, y luego cada ABC_CFG.REFRESCO_MIN minutos mientras haya
  // actividad. El resto de los conteos resuelven con el catálogo cacheado.
  const ultimaLectura = parseInt(prop.getProperty(kAbc), 10) || 0;
  const tocaRefrescar = (Date.now() - ultimaLectura) >= ABC_CFG.REFRESCO_MIN * 60000;
  const forzarABC = res.primerConteo || !!opciones.forzarABC || tocaRefrescar;

  const abc = consolidarDatos(planilla, forzarABC);
  res.abc = abc;
  // La marca se guarda sólo si de verdad se leyeron las fuentes: si el maestro
  // estaba caído y se resolvió con el snapshot, se reintenta en la próxima vuelta.
  if (abc && abc.origen === "FUENTES") prop.setProperty(kAbc, String(Date.now()));
  actualizarAnalisis();
  respaldarProtegidas(planilla);           // copia de las columnas protegidas

  prop.setProperty(kFirma, estado.firma);
  res.ejecutado = true;
  return res;
}

// Pipeline con lock. Es el punto de entrada de todos los gatillos.
function procesarConteo_(opciones) {
  opciones = opciones || {};
  const lock = LockService.getScriptLock();
  // Evita ejecuciones duplicadas/concurrentes: onChange y onEdit disparan a la vez
  // ante un mismo conteo. Sin esto, todo el recálculo corría dos veces.
  // El lock es POR PROYECTO: cuando la Terminal atiende varios inventarios a la
  // vez conviene esperar más (opciones.esperaLock) en lugar de descartar la
  // actualización de un archivo porque otro se estaba procesando.
  if (!lock.tryLock(opciones.esperaLock || CONTEO_CFG.ESPERA_LOCK)) {
    // No se perdió nada: queda marcado como pendiente y la próxima corrida
    // (otro conteo, la rutina de fondo o la siguiente llamada de la Terminal)
    // lo procesa ignorando la firma. El operario no tiene que hacer nada.
    try {
      PropertiesService.getScriptProperties().setProperty(claveProp_(CONTEO_CFG.PROP_PENDIENTE), '1');
    } catch (e) {
      console.error('procesarConteo_ (pendiente): ' + e);
    }
    return { ejecutado: false, primerConteo: false, conteos: 0, motivo: 'LOCK', pendiente: true, abc: null };
  }
  try {
    return ejecutarPipeline_(opciones);
  } catch (err) {
    console.error('procesarConteo_: ' + err);
    return { ejecutado: false, primerConteo: false, conteos: 0, motivo: 'ERROR' };
  } finally {
    lock.releaseLock();
  }
}

// GATILLO 1 — Terminal WMS: la inyección de datos hecha por otro script sólo
// levanta onChange, que no dice qué cambió. La firma decide si hubo conteo nuevo.
function manejadorCambiosExternos(e) {
  try {
    // Solo actuamos si el cambio es una edición (EDIT) o inyección de un script (OTHER)
    if (e && e.changeType !== 'EDIT' && e.changeType !== 'OTHER') return;
    procesarConteo_({ motivo: 'CAMBIO_' + ((e && e.changeType) || 'DESCONOCIDO') });
  } catch (err) {
    console.error('manejadorCambiosExternos: ' + err);
  }
}

// GATILLO 2 — conteo digitado en la hoja (trigger INSTALABLE onEdit).
// Sólo reacciona a las columnas de conteo V, W y X: cualquier otra edición no
// dispara recálculo alguno.
function alRegistrarConteo(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== CONTEO_CFG.PLANILLA) return;
    if (e.range.getRow() < 2) return;
    if (e.range.getLastColumn() < CONTEO_CFG.COL_INI || e.range.getColumn() > CONTEO_CFG.COL_FIN) return;
    procesarConteo_({ motivo: 'CONTEO_DIGITADO' });
  } catch (err) {
    console.error('alRegistrarConteo: ' + err);
  }
}


// ==========================================
// 2.b API PARA LA TERMINAL WMS
// La Terminal escribe el conteo y, en la misma llamada, pide la actualización.
// Con esto el archivo hijo NO necesita triggers ni activación manual y el
// operario nunca tiene que abrir la hoja real.
//
// Uso desde el proyecto de la Terminal (como biblioteca o copiando el motor):
//
//   const r = actualizarInventario(idArchivo);
//   if (!r.exito) console.error(r.mensaje);
//
// Devuelve { exito, ejecutado, primerConteo, conteos, abc:{...}, ms, mensaje }.
// Es idempotente: si no hay conteos nuevos no hace nada y responde en ~1 s.
// ==========================================
function actualizarInventario(idArchivo, opciones) {
  opciones = opciones || {};
  const t0 = Date.now();
  const salida = { exito: false, idArchivo: idArchivo || "", ejecutado: false,
                   primerConteo: false, conteos: 0, pendiente: false, abc: null, ms: 0, mensaje: "" };
  try {
    if (!idArchivo) { salida.mensaje = "Falta el ID del archivo de inventario."; return salida; }

    fijarContexto_(SpreadsheetApp.openById(idArchivo));
    try {
      const res = procesarConteo_({
        motivo: opciones.motivo || 'TERMINAL',
        forzar: !!opciones.forzar,
        forzarABC: !!opciones.forzarABC,
        // El lock es por proyecto: con varios inventarios simultáneos hay que
        // esperar el turno, no descartar la actualización.
        esperaLock: opciones.esperaLock || 30000
      });

      salida.ejecutado = res.ejecutado;
      salida.primerConteo = res.primerConteo;
      salida.conteos = res.conteos;
      salida.pendiente = !!res.pendiente;
      // Quedar en cola NO es un fallo: el conteo está escrito y la actualización
      // quedó marcada como pendiente, así que la procesa la corrida siguiente.
      // Sólo se reporta error cuando de verdad algo salió mal.
      salida.exito = (res.motivo !== 'ERROR');

      if (res.abc) {
        salida.abc = { origen: res.abc.origen, celdas: res.abc.celdas,
                       sinAbc: res.abc.sinAbc, porDefecto: res.abc.porDefecto,
                       clientes: res.abc.clientes };
      }
      if (res.motivo === 'LOCK') {
        salida.mensaje = "Otro conteo se estaba procesando. Éste quedó en cola y se aplica en la corrida siguiente; no hay nada que hacer.";
      } else if (res.motivo === 'ERROR') {
        salida.mensaje = "No se pudo completar la actualización. Revise los registros de ejecución.";
      }
    } finally {
      fijarContexto_(null); // el contexto nunca queda colgado entre llamadas
    }
  } catch (e) {
    console.error('actualizarInventario: ' + e);
    salida.mensaje = String(e);
  }
  salida.ms = Date.now() - t0;
  return salida;
}

// Estado del catálogo ABC de un inventario, sin interfaz gráfica (para mostrarlo
// en la Terminal o para monitoreo).
function diagnosticoInventario(idArchivo) {
  try {
    fijarContexto_(SpreadsheetApp.openById(idArchivo));
    try {
      const st = consolidarDatos(null, false);
      return { exito: st.ok, origen: st.origen, filas: st.filas, celdas: st.celdas,
               sinAbc: st.sinAbc, sinAbcEjemplos: st.sinAbcEjemplos, porDefecto: st.porDefecto,
               clientes: st.clientes, mensaje: st.mensaje };
    } finally {
      fijarContexto_(null);
    }
  } catch (e) {
    console.error('diagnosticoInventario: ' + e);
    return { exito: false, mensaje: String(e) };
  }
}

// ==========================================
// 3. BLINDAJE Y PROTECCIÓN ESTRICTA (onEdit)
// ==========================================
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();
    const ui = SpreadsheetApp.getUi();

    // Extraer las dimensiones del rango que el usuario está editando/borrando
    const numRows = e.range.getNumRows();
    const numCols = e.range.getNumColumns();
    const startCol = e.range.getColumn();
    const endCol = e.range.getLastColumn();

    // ⛔ REGLA 1: PROTECCIÓN DE ENCABEZADOS EN CUALQUIER HOJA
    // (getRow() devuelve la fila superior del rango: si es 1, toca el encabezado)
    if (row === 1) {
      ui.alert("⛔ PROTECCIÓN DE ENCABEZADOS\n\nNo se pueden modificar los encabezados para no afectar la conexión con Power BI.");
      if (numRows === 1 && numCols === 1) e.range.setValue(e.oldValue || "");
      return;
    }

    // ⛔ REGLA 2: PROTECCIÓN DE LA HOJA REGISTRO
    if (name === "REGISTRO") {
       ui.alert("⛔ ALERTA DE SEGURIDAD\n\nEl registro de auditoría es INALTERABLE por el usuario.");
       if (numRows === 1 && numCols === 1 && e.oldValue !== undefined) { e.range.setValue(e.oldValue); } else { e.range.clearContent(); }
       return;
    }

    // ⛔ REGLAS PARA "PLANILLA DE CONTEO FISICO"
    if (name === "PLANILLA DE CONTEO FISICO") {

      // 🚨 INTERCEPTOR DE BORRADO/EDICIÓN MASIVA (varias celdas)
      // Ya no depende de CTRL+Z: el sistema RESTAURA automáticamente desde el respaldo.
      if (numRows > 1 || numCols > 1) {
        let tocaZonaProtegida = false;
        if (startCol <= 4 && endCol >= 1) tocaZonaProtegida = true;   // A, B, C, D (Fechas, ID, secuencia)
        if (startCol <= 21 && endCol >= 18) tocaZonaProtegida = true; // R, S, T, U (Fórmulas)
        if (startCol <= 24 && endCol >= 22) tocaZonaProtegida = true; // V, W, X (Conteos)

        if (tocaZonaProtegida) {
          const restaurado = restaurarProtegidas(sheet);
          ui.alert(restaurado
            ? "⛔ EDICIÓN MASIVA DENEGADA\n\n✅ El sistema RESTAURÓ automáticamente los datos protegidos (Conteos, Fórmulas y Fechas). No se perdió información."
            : "⛔ EDICIÓN MASIVA DENEGADA\n\nNo modifique varias celdas a la vez en áreas protegidas.\n\n⚠️ Presione 'CTRL + Z' para restaurar.");
          return; // Aborta cualquier otro proceso
        }
      }

      // Regla 3: Columna B (Fecha automática) - Evaluación de una celda
      if (col === 2 && numRows === 1 && numCols === 1) {
        ui.alert("⛔ ACCIÓN DENEGADA\n\nLa Columna B es administrada automáticamente por el sistema.");
        e.range.setValue(e.oldValue || "");
        return;
      }

      // Regla 4: Columnas A y C (Solo fila 2) - Evaluación de una celda
      if ((col === 1 || col === 3) && row >= 3 && numRows === 1 && numCols === 1) {
        ui.alert("⛔ ACCIÓN DENEGADA\n\nNo puedes editar estas columnas. El sistema las replica automáticamente desde la fila 2.");
        e.range.setValue(e.oldValue || "");
        return;
      }

      // Fila 2 de A o C: es la única edición permitida y arrastra el valor a
      // toda la columna. Se replica al momento (sólo las celdas que cambian).
      if ((col === 1 || col === 3) && row === 2 && numRows === 1 && numCols === 1) {
        actualizarColumnasAC(sheet);
        return;
      }

      // Regla 4b: Columna D (secuencia automática) - Evaluación de una celda
      if (col === 4 && numRows === 1 && numCols === 1) {
        ui.alert("⛔ ACCIÓN DENEGADA\n\nLa Columna D (secuencia) es administrada automáticamente por el sistema.");
        e.range.setValue(e.oldValue || "");
        return;
      }

      // Regla 5: Columnas de Fórmulas R, S, T, U - Evaluación de una celda
      if (col >= 18 && col <= 21 && numRows === 1 && numCols === 1) {
        ui.alert("⛔ ACCIÓN DENEGADA\n\nEstas columnas contienen fórmulas y están bloqueadas para evitar daños en los cálculos.");
        e.range.setValue(e.oldValue || "");
        return;
      }

      // Regla 6: Columnas V, W, X (Conteos) - Evaluación de una celda
      if (col >= 22 && col <= 24 && numRows === 1 && numCols === 1) {

        // Evitar que borren o cambien un número ya escrito
        if (e.oldValue !== undefined && e.oldValue !== "" && e.value !== e.oldValue) {
           ui.alert(`⛔ CONTEO CERRADO\nNo se pueden borrar ni modificar conteos ya registrados.`);
           e.range.setValue(e.oldValue);
           return;
        }

        // Si ingresan un conteo por primera vez de forma manual
        if (e.value) {
          registrarAccionManual(e, sheet, row, col);
          // El pipeline también corre desde el trigger INSTALABLE alRegistrarConteo.
          // Se deja aquí como red de seguridad por si el archivo aún no fue
          // activado: la firma hace que sólo uno de los dos haga el trabajo.
          procesarConteo_({ motivo: 'CONTEO_DIGITADO_SIMPLE' });
        }
      }
    }

    // ⛔ REGLAS PARA "PLANILLA DE SERIES FISICAS"
    if (name === "PLANILLA DE SERIES FISICAS" || name === "PLANILLA SERIES") {

      // Interceptor de borrado masivo para las series
      if (numRows > 1 || numCols > 1) {
         if (startCol <= 6 && endCol >= 3) {
            ui.alert("⛔ BORRADO MASIVO DENEGADO\n\nEstás intentando borrar fórmulas masivamente.\n\n⚠️ Presiona 'CTRL + Z' (Deshacer) INMEDIATAMENTE para restaurarlas.");
            return;
         }
      }

      // Regla 7: Columnas C, D, E, F (Fórmulas) - Evaluación de una celda
      if (col >= 3 && col <= 6 && numRows === 1 && numCols === 1) {
        ui.alert("⛔ ACCIÓN DENEGADA\n\nEstas columnas contienen fórmulas y no pueden ser editadas por el operario.");
        e.range.setValue(e.oldValue || "");
        return;
      }

      // Regenerar secuencia en A si escriben en otras celdas
      generarSecuenciaSeriesFisicas(sheet);
    }

  } catch (error) {
    console.error('onEdit: ' + error);
  }
}
// ==========================================
// 4. FUNCIONES DE ACTUALIZACIÓN (A, B, C, D)
// ==========================================
function verificarConfiguracionInicial(sheet) {
  const ss = sheet.getParent();

  // 1. FORZAR LA ZONA HORARIA DEL ARCHIVO (Soluciona el desfase de +1 hora).
  // Sólo se escribe si hace falta: antes se reescribía en cada evento.
  if (ss.getSpreadsheetTimeZone() !== "America/Guayaquil") {
    ss.setSpreadsheetTimeZone("America/Guayaquil");
  }

  const lr = sheet.getLastRow();
  if (lr < 2) return;

  // OJO: la FECHA DE INICIO (A2) ya NO se escribe aquí. Antes se sellaba al
  // activar el archivo, así que el inventario "empezaba" el día de la
  // activación aunque el primer conteo llegara días después. Ahora la escribe
  // marcarInicioInventario_() con el primer conteo real en V, W o X.
  const c2 = sheet.getRange("C2").getValue();
  if (!c2 || c2.toString().trim() === "") {
    sheet.getRange("C2").setValue(CONTEO_CFG.ID_MODO === "ID" ? ss.getId() : ss.getName());
    actualizarColumnasAC(sheet); // propaga A2 y C2 hacia las filas de abajo
  }
}

// Comparación tolerante para decidir si una celda hay que reescribirla.
function mismoValor_(a, b) {
  const esFecha = v => Object.prototype.toString.call(v) === "[object Date]";
  if (esFecha(a) && esFecha(b)) return a.getTime() === b.getTime();
  return String(a === null || a === undefined ? "" : a) === String(b === null || b === undefined ? "" : b);
}

// ESCRITURA DIFERENCIAL de una columna: sólo se escriben los tramos contiguos
// que cambian. Es lo que evita reescribir columnas enteras en cada conteo (con
// el gasto de cuota y la cadena de eventos que eso provocaba).
// Devuelve cuántas celdas se modificaron.
function escribirColumnaDiferencial_(hoja, columna, filaInicio, nuevos, actuales) {
  const tramos = [];
  let celdas = 0;
  for (let i = 0; i < nuevos.length; i++) {
    if (!mismoValor_(nuevos[i], actuales[i])) {
      celdas++;
      const ult = tramos[tramos.length - 1];
      if (ult && i === ult.fin + 1) ult.fin = i; else tramos.push({ ini: i, fin: i });
    }
  }
  if (!tramos.length) return 0;

  if (tramos.length > ABC_CFG.MAX_TRAMOS) {
    hoja.getRange(filaInicio, columna, nuevos.length, 1).setValues(nuevos.map(v => [v]));
  } else {
    tramos.forEach(t => {
      const bloque = nuevos.slice(t.ini, t.fin + 1).map(v => [v]);
      hoja.getRange(filaInicio + t.ini, columna, bloque.length, 1).setValues(bloque);
    });
  }
  return celdas;
}

// Replica A2 (fecha de inicio) y C2 (ID) hacia las filas de abajo.
// Igual que las columnas B y D, sólo se rellenan las filas que TIENEN código en
// la columna G, y nunca se borra lo que ya está escrito: las filas nuevas que
// va agregando la Terminal quedan completas sin tocar el resto.
function actualizarColumnasAC(sheet) {
  const lr = sheet.getLastRow();
  if (lr < 3) return 0;
  const cab = sheet.getRange("A2:C2").getValues()[0];
  const a2 = cab[0], c2 = cab[2];
  if ((!a2 || String(a2).trim() === "") && (!c2 || String(c2).trim() === "")) return 0;

  const n = lr - 2;
  const codigos = sheet.getRange(3, 7, n, 1).getValues();
  let celdas = 0;

  if (a2 && String(a2).trim() !== "") {
    const actual = sheet.getRange(3, 1, n, 1).getValues();
    const nuevos = codigos.map((c, i) => (c[0] && String(c[0]).trim() !== "") ? a2 : actual[i][0]);
    celdas += escribirColumnaDiferencial_(sheet, 1, 3, nuevos, actual.map(f => f[0]));
  }
  if (c2 && String(c2).trim() !== "") {
    const actual = sheet.getRange(3, 3, n, 1).getValues();
    const nuevos = codigos.map((c, i) => (c[0] && String(c[0]).trim() !== "") ? c2 : actual[i][0]);
    celdas += escribirColumnaDiferencial_(sheet, 3, 3, nuevos, actual.map(f => f[0]));
  }
  return celdas;
}

// Macro (definido en appsscript.json): refresca fecha/hora (B) y datos base (A y C)
function actualizarColumnasBC() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PLANILLA DE CONTEO FISICO");
  if (!sheet) return;
  verificarConfiguracionInicial(sheet); // asegura A y C + zona horaria Ecuador
  verificarYActualizarColumnaB(sheet);  // fecha/hora del último conteo en columna B
}

function generarSecuenciaColumnaD(sheet) {
  const lr = sheet.getLastRow();
  if (lr < 2) return 0;
  // Genera secuencia numéricamente siempre y cuando haya código en G
  const codigos = sheet.getRange(2, 7, lr - 1, 1).getValues();
  const actual = sheet.getRange(2, 4, lr - 1, 1).getValues();
  let x = 1;
  const secuencia = codigos.map(r => (r[0] && String(r[0]).trim() !== "") ? x++ : "");
  // Diferencial: una vez generada, los conteos siguientes no reescriben la columna.
  return escribirColumnaDiferencial_(sheet, 4, 2, secuencia, actual.map(f => f[0]));
}

function verificarYActualizarColumnaB(sheet) {
  const r = sheet.getParent().getSheetByName("REGISTRO");
  if (!r || r.getLastRow() < 2) return;

  // REGLA: la columna B refleja la fecha/hora del ÚLTIMO conteo registrado.
  // Se toma el último valor NO vacío de la columna A de la hoja REGISTRO
  // (donde se apilan todos los conteos), recorriendo de abajo hacia arriba.
  const data = r.getRange(2, 1, r.getLastRow() - 1, 1).getValues();
  let ultimaFecha = "";
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] !== "" && data[i][0] !== null) { ultimaFecha = data[i][0]; break; }
  }
  if (!ultimaFecha) return;

  // Propagar esa fecha/hora a la columna B, solo en filas que tengan código (col G)
  const lr = sheet.getLastRow();
  if (lr < 2) return;
  const codigos = sheet.getRange(2, 7, lr - 1, 1).getValues();
  const colB = codigos.map(c => (c[0] && String(c[0]).trim() !== "") ? [ultimaFecha] : [""]);
  const rango = sheet.getRange(2, 2, colB.length, 1);
  rango.setValues(colB);

  // Mostrar fecha Y hora en zona horaria de Ecuador (Quito, UTC-5).
  // Sólo se aplica si el formato todavía no está puesto: reponerlo en cada
  // conteo era otra escritura de la columna completa.
  if (Object.prototype.toString.call(ultimaFecha) === "[object Date]" &&
      sheet.getRange(2, 2).getNumberFormat() !== "dd/MM/yy HH:mm:ss") {
    rango.setNumberFormat("dd/MM/yy HH:mm:ss");
  }
}

// ==========================================
// 4.b CATÁLOGO ABC — NORMALIZACIÓN
// Los códigos llegan de dos archivos distintos y Sheets los devuelve como número
// o como texto según la celda. Sin normalizar, un mismo código no coincide consigo
// mismo (ceros a la izquierda, ".0", NBSP al pegar desde el WMS, minúsculas).
// ==========================================
function normalizarCodigo_(v) {
  if (v === null || v === undefined) return "";
  let s = (typeof v === "number") ? String(v) : String(v);
  s = s.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ").trim(); // NBSP e invisibles
  if (!s) return "";
  s = s.replace(/\.0+$/, "");        // 12345.0 -> 12345 (numéricos de Sheets)
  return s.toUpperCase();
}

// Clave alterna: sin ceros a la izquierda. Sólo se usa como respaldo y sólo cuando
// no genera colisiones (ver construirIndiceAlterno_).
function claveAlterna_(cod) {
  return /^0+\d+$/.test(cod) ? cod.replace(/^0+/, "") : cod;
}

function normalizarABC_(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ").trim().toUpperCase();
}

// Quita acentos y mayúsculas para comparar encabezados del archivo maestro.
function normalizarEncabezado_(v) {
  return String(v === null || v === undefined ? "" : v)
    .normalize("NFD").replace(/[\u0300-\u036F]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function construirIndiceAlterno_(mapa) {
  const alt = {}, choque = {};
  if (!ABC_CFG.USAR_INDICE_ALTERNO) return alt;
  for (const cod in mapa) {
    const k = claveAlterna_(cod);
    if (k === cod) continue;
    if (alt[k] !== undefined && alt[k] !== mapa[cod]) { choque[k] = true; continue; }
    alt[k] = mapa[cod];
  }
  for (const k in choque) delete alt[k]; // ante duda, mejor no adivinar
  return alt;
}

// ==========================================
// 4.c CATÁLOGO ABC — LECTURA DE FUENTES
// ==========================================

// Cliente normalizado (columna A del maestro / columna E de la planilla).
function normalizarCliente_(v) {
  return normalizarABC_(v);
}

// Clave del catálogo: el mismo código puede repetirse entre clientes.
function claveCatalogo_(cliente, codigo) {
  return cliente + "|" + codigo;
}

// Lee CLIENTE + CODIGO -> ABC de la hoja maestra CRONOGRAMA_CODIGOS.
// Detecta las columnas por ENCABEZADO (antes CODIGO y ABC estaban fijas en B y
// C: si alguien insertaba una columna, el ABC se llenaba con datos equivocados
// sin ningún error visible).
// Si se reciben los clientes de la planilla, sólo se carga esa porción del
// maestro: el catálogo cacheado baja de decenas de miles de códigos a los que
// este inventario realmente usa.
// La PROTECCIÓN de la hoja NO impide la lectura: basta acceso de Lector.
function leerMapaDesdeHoja_(clientes) {
  const res = { mapa: null, global: null, filas: 0, leidas: 0, duplicados: 0, ejemplosDup: [],
                ambiguos: 0, ejemplosAmb: [], clientesVistos: {}, clientesSinDatos: [],
                colCliente: 0, colCodigo: 0, colAbc: 0, error: "" };
  try {
    const master = SpreadsheetApp.openById(ABC_CFG.MASTER_ID);
    let hoja = master.getSheetByName(ABC_CFG.MASTER_SHEET);
    if (!hoja) {
      // Tolerancia a que renombren la hoja (ej. "CRONOGRAMA CODIGOS 2026")
      hoja = master.getSheets().filter(h => normalizarEncabezado_(h.getName()).indexOf("CRONOGRAMA") >= 0)[0];
    }
    if (!hoja) { res.error = "No existe la hoja '" + ABC_CFG.MASTER_SHEET + "' en el archivo maestro."; return res; }

    const lr = hoja.getLastRow(), lc = hoja.getLastColumn();
    if (lr < 2) { res.error = "La hoja maestra no tiene datos."; return res; }

    // Ubicar columnas por encabezado; si no aparecen, se cae a A, B y C (legado).
    const enc = hoja.getRange(1, 1, 1, lc).getValues()[0].map(normalizarEncabezado_);
    let cCli = 0, cCod = 0, cAbc = 0;
    for (let i = 0; i < enc.length; i++) {
      const h = enc[i];
      if (!cCli && (h === "CLIENTE" || h === "CLIENTES" || h === "EMPRESA")) cCli = i + 1;
      if (!cCod && (h === "CODIGO" || h === "COD" || h === "ITEM" || h === "SKU" || h === "REFERENCIA")) cCod = i + 1;
      if (!cAbc && (h === "ABC" || h === "CLASIFICACION" || h === "CLASE" || h === "CATEGORIA")) cAbc = i + 1;
    }
    if (!cCli) cCli = 1; // A
    if (!cCod) cCod = 2; // B
    if (!cAbc) cAbc = 3; // C
    res.colCliente = cCli; res.colCodigo = cCod; res.colAbc = cAbc;

    // Una sola lectura que abarque las tres columnas
    const desde = Math.min(cCli, cCod, cAbc), hasta = Math.max(cCli, cCod, cAbc);
    const datos = hoja.getRange(2, desde, lr - 1, hasta - desde + 1).getValues();
    const iCli = cCli - desde, iCod = cCod - desde, iAbc = cAbc - desde;

    // Filtro por cliente (opcional): sólo se cargan las filas que sirven a esta planilla.
    let filtro = null;
    if (ABC_CFG.FILTRAR_POR_CLIENTE && clientes && clientes.length) {
      filtro = {};
      clientes.forEach(c => { if (c) filtro[c] = true; });
      if (!Object.keys(filtro).length) filtro = null;
    }

    const mapa = {}, global = {}, ambiguo = {};
    for (let i = 0; i < datos.length; i++) {
      const cod = normalizarCodigo_(datos[i][iCod]);
      const abc = normalizarABC_(datos[i][iAbc]);
      if (!cod || !abc) continue; // códigos sin ABC: los puede rellenar el TXT
      res.leidas++;

      const cli = normalizarCliente_(datos[i][iCli]);
      if (cli) res.clientesVistos[cli] = true;

      // Índice por código suelto: se arma SIEMPRE con el maestro completo, sin
      // aplicar el filtro por cliente. Es la red de seguridad para cuando el
      // CLIENTE de la planilla no coincide exactamente con el del maestro: sin
      // esto el catálogo quedaría vacío y el ABC dejaría de actualizarse.
      // Sólo vale si TODOS los clientes coinciden en la clasificación; si no,
      // se descarta para no adivinar mal.
      if (global[cod] === undefined) global[cod] = abc;
      else if (global[cod] !== abc) {
        ambiguo[cod] = true;
        if (res.ejemplosAmb.length < 5) res.ejemplosAmb.push(cod);
      }

      // El mapa CLIENTE|CODIGO sí se puede acotar a los clientes de esta planilla.
      if (filtro && cli && !filtro[cli]) continue;

      if (cli) {
        const clave = claveCatalogo_(cli, cod);
        if (mapa[clave] !== undefined && mapa[clave] !== abc) {
          res.duplicados++;
          if (res.ejemplosDup.length < 5) res.ejemplosDup.push(cli + "/" + cod + " (" + mapa[clave] + "→" + abc + ")");
        }
        mapa[clave] = abc;
      }
      res.filas++;
    }
    for (const cod in ambiguo) { delete global[cod]; res.ambiguos++; }

    // Cliente de la planilla que no aparece en el maestro: se resolverá por el
    // índice por código o por el valor por defecto. Queda registrado para el
    // Diagnóstico ABC en vez de fallar en silencio.
    if (clientes && clientes.length) {
      clientes.forEach(c => { if (c && !res.clientesVistos[c]) res.clientesSinDatos.push(c); });
    }

    res.mapa = Object.keys(mapa).length ? mapa : null;
    res.global = Object.keys(global).length ? global : null;
    if (!res.mapa && !res.global) res.error = "La hoja maestra se leyó pero no produjo códigos válidos.";
    return res;
  } catch (e) {
    console.error('leerMapaDesdeHoja_: ' + e);
    res.error = String(e);
    return res;
  }
}

// Respaldo: ABC2026.txt (JSON) de Google Drive, indexado sólo por código.
// Se prefiere el ID configurado; la búsqueda por nombre recorre TODO el Drive y
// puede tomar una copia vieja, así que queda sólo como último recurso.
function leerMapaDesdeTxt_() {
  const res = { global: null, filas: 0, duplicadosArchivo: 0, error: "" };
  try {
    let archivo = null;
    if (ABC_CFG.TXT_FALLBACK_ID) {
      try { archivo = DriveApp.getFileById(ABC_CFG.TXT_FALLBACK_ID); } catch (e) { res.error = "ID de respaldo inválido: " + e; }
    }
    if (!archivo) {
      const it = DriveApp.getFilesByName(ABC_CFG.TXT_FALLBACK_NAME);
      while (it.hasNext()) {
        const f = it.next();
        if (f.isTrashed()) continue;
        if (!archivo) archivo = f; else res.duplicadosArchivo++;
      }
    }
    if (!archivo) { res.error = res.error || "No se encontró " + ABC_CFG.TXT_FALLBACK_NAME; return res; }

    const txt = archivo.getBlob().getDataAsString("UTF-8").replace(/^\uFEFF/, "");
    const json = JSON.parse(txt);
    const global = {};
    for (const k in json) {
      const cod = normalizarCodigo_(k);
      const abc = normalizarABC_(json[k]);
      if (cod && abc) { global[cod] = abc; res.filas++; }
    }
    res.global = Object.keys(global).length ? global : null;
    return res;
  } catch (e) {
    console.error('leerMapaDesdeTxt_: ' + e);
    res.error = String(e);
    return res;
  }
}

// ==========================================
// 4.d CATÁLOGO ABC — CACHÉ COMPRIMIDA Y RESPALDO LOCAL
// CacheService admite 100 KB POR CLAVE. Guardar el catálogo como JSON plano
// hacía fallar el put() en silencio (try/catch vacío) y, en la práctica, el
// archivo maestro se releía en CADA conteo. Aquí se comprime y se trocea.
// ==========================================
function comprimirB64_(str) {
  const gz = Utilities.gzip(Utilities.newBlob(str, "application/json", "abc.json"));
  return Utilities.base64Encode(gz.getBytes());
}

function descomprimirB64_(b64) {
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip", "abc.json.gz");
  return Utilities.ungzip(blob).getDataAsString("UTF-8");
}

function trocear_(s, tam) {
  const out = [];
  for (let i = 0; i < s.length; i += tam) out.push(s.substring(i, i + tam));
  return out;
}

// La caché es POR PROYECTO. Si un mismo proyecto atiende varios inventarios, el
// catálogo de uno no debe servirle a otro con distinto conjunto de clientes:
// la clave se deriva de esos clientes, así los archivos del mismo cliente sí
// comparten el catálogo y los demás no se pisan.
function claveCacheABC_(clientes) {
  const lista = (clientes || []).slice().sort().join(",");
  if (!lista) return ABC_CFG.CACHE_KEY + ":TODOS";
  let h = 5381;
  for (let i = 0; i < lista.length; i++) h = ((h * 33) ^ lista.charCodeAt(i)) >>> 0;
  return ABC_CFG.CACHE_KEY + ":" + h.toString(36);
}

function abcCacheGuardar_(payload) {
  try {
    const base = claveCacheABC_(payload.clientes);
    const cache = CacheService.getScriptCache();
    const trozos = trocear_(comprimirB64_(JSON.stringify(payload)), ABC_CFG.CACHE_CHUNK);
    if (!trozos.length || trozos.length > ABC_CFG.CACHE_MAX_CHUNKS) return false;
    const obj = {};
    trozos.forEach((t, i) => { obj[base + ":" + i] = t; });
    obj[base + ":n"] = String(trozos.length);
    cache.putAll(obj, ABC_CFG.CACHE_TTL);
    return true;
  } catch (e) {
    console.error('abcCacheGuardar_: ' + e);
    return false;
  }
}

function abcCacheLeer_(clientes) {
  try {
    const base = claveCacheABC_(clientes);
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(base + ":n"), 10);
    if (!n || n < 1) return null;
    const claves = [];
    for (let i = 0; i < n; i++) claves.push(base + ":" + i);
    const partes = cache.getAll(claves);
    let b64 = "";
    for (let i = 0; i < n; i++) {
      const p = partes[claves[i]];
      if (p === null || p === undefined) return null; // trozo expirado: caché inválida
      b64 += p;
    }
    const payload = JSON.parse(descomprimirB64_(b64));
    if (!payload || payload.v !== ABC_CFG.PAYLOAD_VERSION || !payload.mapa) return null;
    return payload;
  } catch (e) {
    console.error('abcCacheLeer_: ' + e);
    return null;
  }
}

function abcCacheBorrar_(clientes) {
  try {
    const base = claveCacheABC_(clientes);
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(base + ":n"), 10) || 0;
    const claves = [base + ":n", "WMS_ABC_MAP"]; // incluye la clave antigua
    for (let i = 0; i < Math.max(n, ABC_CFG.CACHE_MAX_CHUNKS); i++) claves.push(base + ":" + i);
    cache.removeAll(claves);
  } catch (e) {
    console.error('abcCacheBorrar_: ' + e);
  }
}

// Snapshot persistente: sobrevive a la expiración de la caché y permite seguir
// clasificando aunque el archivo maestro quede inaccesible (permisos, cuota).
function obtenerHojaSnapshot_(ss, crear) {
  let h = ss.getSheetByName(ABC_CFG.SNAP_SHEET);
  if (!h && crear) {
    h = ss.insertSheet(ABC_CFG.SNAP_SHEET);
    h.hideSheet();
    h.getRange(1, 1).setValue("NO EDITAR — respaldo comprimido del catálogo ABC");
  }
  return h;
}

function abcSnapshotGuardar_(payload) {
  try {
    const ss = ssActual_();
    if (!ss) return false;
    const h = obtenerHojaSnapshot_(ss, true);
    const trozos = trocear_(comprimirB64_(JSON.stringify(payload)), ABC_CFG.SNAP_CHUNK);
    const filas = Math.max(h.getLastRow() - 1, 0);
    if (filas > 0) h.getRange(2, 1, filas, 1).clearContent();
    if (trozos.length) h.getRange(2, 1, trozos.length, 1).setValues(trozos.map(t => [t]));
    return true;
  } catch (e) {
    console.error('abcSnapshotGuardar_: ' + e);
    return false;
  }
}

function abcSnapshotLeer_() {
  try {
    const ss = ssActual_();
    if (!ss) return null;
    const h = obtenerHojaSnapshot_(ss, false);
    if (!h || h.getLastRow() < 2) return null;
    const trozos = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
    const b64 = trozos.map(r => String(r[0] || "")).join("");
    if (!b64) return null;
    const payload = JSON.parse(descomprimirB64_(b64));
    if (!payload || payload.v !== ABC_CFG.PAYLOAD_VERSION || !payload.mapa) return null;
    return payload;
  } catch (e) {
    console.error('abcSnapshotLeer_: ' + e);
    return null;
  }
}

// ==========================================
// 4.e CATÁLOGO ABC — ARMADO DEL CATÁLOGO
// FUSIÓN de fuentes: la hoja maestra manda y el ABC2026.txt rellena los códigos
// que la hoja NO tiene (ej. HYCITE). Orden de preferencia al resolver:
//   caché (30 min) → hoja maestra + TXT → snapshot local
// ==========================================
function construirCatalogoABC_(clientes) {
  const hoja = leerMapaDesdeHoja_(clientes);
  const txt  = leerMapaDesdeTxt_();

  if (!hoja.mapa && !hoja.global && !txt.global) {
    return { payload: null, error: [hoja.error, txt.error].filter(String).join(" | ") };
  }

  // El maestro manda sobre el TXT en el índice por código suelto.
  const global = Object.assign({}, txt.global || {}, hoja.global || {});
  const filtrado = !!(ABC_CFG.FILTRAR_POR_CLIENTE && clientes && clientes.length);

  const payload = {
    v: ABC_CFG.PAYLOAD_VERSION,
    ts: Date.now(),
    mapa: hoja.mapa || {},        // CLIENTE|CODIGO -> ABC
    global: global,               // CODIGO -> ABC (sólo códigos no ambiguos)
    clientes: filtrado ? clientes.slice() : [],  // [] = catálogo completo
    meta: {
      porCliente: Object.keys(hoja.mapa || {}).length,
      porCodigo: Object.keys(global).length,
      filasMaestro: hoja.leidas,
      desdeTxt: txt.filas,
      duplicadosHoja: hoja.duplicados,
      ejemplosDup: hoja.ejemplosDup,
      ambiguos: hoja.ambiguos,
      ejemplosAmb: hoja.ejemplosAmb,
      clientesSinDatos: hoja.clientesSinDatos || [],
      colCliente: hoja.colCliente,
      colCodigo: hoja.colCodigo,
      colAbc: hoja.colAbc,
      clientesFiltrados: filtrado ? clientes.slice() : [],
      errorHoja: hoja.error,
      errorTxt: txt.error,
      fuente: (hoja.mapa || hoja.global) && txt.global ? "HOJA+TXT" : ((hoja.mapa || hoja.global) ? "HOJA" : "TXT")
    }
  };
  return { payload: payload, error: "" };
}

// ¿El catálogo guardado sirve para los clientes de esta planilla? Un catálogo
// filtrado deja de servir en cuanto aparece un cliente que no estaba cargado.
function cubreClientes_(payloadClientes, clientes) {
  if (!payloadClientes || !payloadClientes.length) return true; // catálogo completo
  if (!clientes || !clientes.length) return false;
  const set = {};
  payloadClientes.forEach(c => { set[c] = true; });
  for (let i = 0; i < clientes.length; i++) if (set[clientes[i]] !== true) return false;
  return true;
}

function empaquetarCatalogo_(payload, origen, error) {
  return {
    mapa: payload.mapa || {},
    global: payload.global || {},
    alt: construirIndiceAlterno_(payload.global || {}),
    meta: payload.meta || {},
    clientes: payload.clientes || [],
    ts: payload.ts || 0,
    origen: origen,
    error: error || ""
  };
}

// Devuelve { mapa, global, alt, meta, origen }. forzar=true ignora la caché y relee.
function obtenerCatalogoABC_(forzar, clientes) {
  clientes = (clientes || []).filter(String);

  if (forzar) abcCacheBorrar_(clientes);

  if (!forzar) {
    const cacheado = abcCacheLeer_(clientes);
    if (cacheado && cubreClientes_(cacheado.clientes, clientes)) {
      return empaquetarCatalogo_(cacheado, "CACHE");
    }
  }

  const res = construirCatalogoABC_(clientes);
  if (res.payload) {
    abcCacheGuardar_(res.payload);
    abcSnapshotGuardar_(res.payload);
    return empaquetarCatalogo_(res.payload, "FUENTES");
  }

  // Ninguna fuente respondió: seguir trabajando con la última copia buena.
  const snap = abcSnapshotLeer_();
  if (snap && cubreClientes_(snap.clientes, clientes)) {
    return empaquetarCatalogo_(snap, "SNAPSHOT", res.error);
  }
  return { mapa: {}, global: {}, alt: {}, meta: {}, clientes: [], ts: 0, origen: "NINGUNA", error: res.error };
}

// Compatibilidad: devuelve solo el índice por código, como la versión anterior.
function obtenerMapaABC(forzar) {
  return obtenerCatalogoABC_(forzar, []).global || {};
}

// ==========================================
// 4.f CATÁLOGO ABC — ESCRITURA EN LA COLUMNA F
// Escritura DIFERENCIAL: antes se reescribía la columna F completa en cada evento
// (miles de celdas por conteo) y, como toda escritura del script vuelve a disparar
// onChange, el proceso se realimentaba. Ahora sólo se tocan los tramos que cambian
// y, cuando no cambia nada, no se escribe.
// La búsqueda es CLIENTE+CODIGO → CODIGO → código sin ceros a la izquierda.
// ==========================================
function consolidarDatos(sheet, forzar) {
  const stats = { ok: false, filas: 0, celdas: 0, sinAbc: 0, sinAbcEjemplos: [], porDefecto: 0,
                  origen: "", totalCodigos: 0, clientes: [], porCliente: 0, mensaje: "" };
  try {
    if (!sheet) sheet = ssActual_().getSheetByName(CONTEO_CFG.PLANILLA);
    if (!sheet) { stats.mensaje = "No existe la hoja " + CONTEO_CFG.PLANILLA + "."; return stats; }

    const lr = sheet.getLastRow();
    if (lr < 2) { stats.ok = true; stats.mensaje = "La planilla no tiene filas."; return stats; }

    // UNA sola lectura para cliente (E), ABC actual (F) y código (G).
    const desde = Math.min(ABC_CFG.COL_CLIENTE, ABC_CFG.COL_ABC, ABC_CFG.COL_CODIGO);
    const hasta = Math.max(ABC_CFG.COL_CLIENTE, ABC_CFG.COL_ABC, ABC_CFG.COL_CODIGO);
    const iCli = ABC_CFG.COL_CLIENTE - desde, iAbc = ABC_CFG.COL_ABC - desde, iCod = ABC_CFG.COL_CODIGO - desde;
    const bloque = sheet.getRange(2, desde, lr - 1, hasta - desde + 1).getValues();

    // Recortar la cola de filas sin código ni ABC (getLastRow() suele exceder los datos)
    let n = bloque.length;
    while (n > 0 && normalizarCodigo_(bloque[n - 1][iCod]) === "" && String(bloque[n - 1][iAbc]).trim() === "") n--;
    if (n < 1) { stats.ok = true; return stats; }
    stats.filas = n;

    // Clientes presentes: con ellos se carga sólo la porción útil del maestro.
    const setCli = {};
    for (let i = 0; i < n; i++) {
      const c = normalizarCliente_(bloque[i][iCli]);
      if (c) setCli[c] = true;
    }
    stats.clientes = Object.keys(setCli);

    const cat = obtenerCatalogoABC_(forzar, stats.clientes);
    stats.origen = cat.origen;
    stats.totalCodigos = Object.keys(cat.global || {}).length;
    stats.porCliente = Object.keys(cat.mapa || {}).length;
    if (!stats.totalCodigos && !stats.porCliente) {
      // Sin catálogo NO se toca F: es preferible dejar el dato viejo que borrarlo.
      stats.mensaje = "No se pudo obtener el catálogo ABC. " + (cat.error || "");
      return stats;
    }

    const nuevos = new Array(n);
    for (let i = 0; i < n; i++) {
      const cod = normalizarCodigo_(bloque[i][iCod]);
      const actual = bloque[i][iAbc];

      if (!cod) { nuevos[i] = ""; continue; }   // fila sin código: F vacía

      const cli = normalizarCliente_(bloque[i][iCli]);
      let abc;
      if (cli) abc = cat.mapa[claveCatalogo_(cli, cod)];           // 1) cliente + código
      if (abc === undefined) abc = cat.global[cod];                 // 2) código (no ambiguo)
      if (abc === undefined) abc = cat.alt[claveAlterna_(cod)];     // 3) sin ceros a la izquierda

      if (abc === undefined && cli && ABC_CFG.ABC_POR_DEFECTO[cli] !== undefined) {
        // 4) Valor por defecto del cliente (HYCITE = C): el producto existe pero
        // no está clasificado en ningún catálogo.
        abc = ABC_CFG.ABC_POR_DEFECTO[cli];
        stats.porDefecto++;
      }

      if (abc === undefined) {
        stats.sinAbc++;
        if (stats.sinAbcEjemplos.length < 10) stats.sinAbcEjemplos.push((cli ? cli + "/" : "") + cod);
        // No destruir lo que ya estaba clasificado
        abc = (ABC_CFG.PRESERVAR_SIN_MATCH && String(actual).trim() !== "")
          ? actual : ABC_CFG.ETIQUETA_SIN_ABC;
      }
      nuevos[i] = abc;
    }

    stats.celdas = escribirColumnaDiferencial_(sheet, ABC_CFG.COL_ABC, 2, nuevos,
                                               bloque.slice(0, n).map(f => f[iAbc]));
    stats.ok = true;
    return stats;
  } catch (e) {
    console.error('consolidarDatos: ' + e);
    stats.mensaje = String(e);
    return stats;
  }
}

// ==========================================
// BOTONES MANUALES DEL MENÚ (los puede usar CUALQUIER operario/usuario)
// No dependen de que el archivo esté "activado" ni restringen por usuario.
// ==========================================

// "Actualizar ABC": fuerza relectura del catálogo (ignora caché) y pinta la columna F.
// Informa el resultado REAL (antes siempre decía "actualizado", incluso si falló).
function actualizarABCManual() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const st = consolidarDatos(null, true);
  if (!st.ok) {
    ss.toast("No se pudo actualizar el ABC. " + (st.mensaje || ""), "⛔ WMS", 10);
    return;
  }
  const msg = "Fuente: " + st.origen +
              " · Catálogo: " + st.porCliente + " por cliente / " + st.totalCodigos + " por código" +
              " · Celdas actualizadas: " + st.celdas +
              (st.porDefecto ? " · Por defecto: " + st.porDefecto : "") +
              (st.sinAbc ? " · Sin ABC: " + st.sinAbc : "");
  ss.toast(msg, "✅ ABC actualizado", 8);
}

// "Diagnóstico ABC": muestra de dónde salió el catálogo y qué códigos no clasifican.
function diagnosticoABC() {
  const st = consolidarDatos(null, true);          // relee el maestro y pinta F
  const cat = obtenerCatalogoABC_(false, st.clientes); // el catálogo recién cacheado
  const m = cat.meta || {};
  const edadMin = cat.ts ? Math.round((Date.now() - cat.ts) / 60000) : "-";

  const lineas = [
    "📊 DIAGNÓSTICO DEL CATÁLOGO ABC",
    "",
    "Origen del catálogo: " + cat.origen + (cat.origen === "SNAPSHOT" ? "  ⚠️ (maestro no accesible)" : ""),
    "Antigüedad de los datos: " + edadMin + " min",
    "Clientes de esta planilla: " + (st.clientes.length ? st.clientes.join(", ") : "(ninguno en la columna E)"),
    (cat.clientes && cat.clientes.length) ? "Catálogo filtrado por cliente: SÍ" : "Catálogo filtrado por cliente: NO (completo)",
    "",
    "Entradas CLIENTE+CODIGO: " + (m.porCliente || 0),
    "Entradas por código suelto: " + (m.porCodigo || 0),
    "Filas leídas del maestro: " + (m.filasMaestro || 0),
    "  · desde " + ABC_CFG.TXT_FALLBACK_NAME + ": " + (m.desdeTxt || 0),
    "Columnas detectadas en el maestro: cliente=" + (m.colCliente || "?") +
      ", código=" + (m.colCodigo || "?") + ", abc=" + (m.colAbc || "?"),
    "",
    "PLANILLA",
    "Filas evaluadas: " + st.filas,
    "Celdas actualizadas en esta corrida: " + st.celdas,
    "Clasificados por valor por defecto: " + st.porDefecto +
      (Object.keys(ABC_CFG.ABC_POR_DEFECTO).length
        ? "  (" + Object.keys(ABC_CFG.ABC_POR_DEFECTO).map(c => c + "=" + ABC_CFG.ABC_POR_DEFECTO[c]).join(", ") + ")" : ""),
    "Códigos sin ABC: " + st.sinAbc,
    st.sinAbcEjemplos.length ? "  ej.: " + st.sinAbcEjemplos.join(", ") : "",
    "",
    m.duplicadosHoja ? "⚠️ Mismo CLIENTE+CODIGO con ABC distinto en el maestro: " + m.duplicadosHoja : "Sin duplicados conflictivos en el maestro.",
    (m.ejemplosDup && m.ejemplosDup.length) ? "  ej.: " + m.ejemplosDup.join(", ") : "",
    m.ambiguos ? "ℹ️ Códigos con ABC distinto entre clientes: " + m.ambiguos + " (se resuelven por cliente)" : "",
    (m.ejemplosAmb && m.ejemplosAmb.length) ? "  ej.: " + m.ejemplosAmb.join(", ") : "",
    (m.clientesSinDatos && m.clientesSinDatos.length)
      ? "⚠️ Clientes de la planilla que NO están en el maestro: " + m.clientesSinDatos.join(", ") +
        "\n   (se resuelven por código o por valor por defecto)" : "",
    m.errorHoja ? "⚠️ Hoja maestra: " + m.errorHoja : "",
    m.errorTxt ? "⚠️ Respaldo TXT: " + m.errorTxt : ""
  ].filter(l => l !== "");

  SpreadsheetApp.getUi().alert(lineas.join("\n"));
}

// "Actualizar Análisis": recalcula la hoja ANALISIS al momento.
function menuActualizarAnalisis() {
  actualizarAnalisis();
  SpreadsheetApp.getActiveSpreadsheet().toast("Análisis actualizado.", "✅ WMS", 4);
}

// "Actualizar Registro": normaliza fechas y horas de la hoja REGISTRO.
function menuActualizarRegistro() {
  actualizarRegistro();
  SpreadsheetApp.getActiveSpreadsheet().toast("Registro (fechas y horas) actualizado.", "✅ WMS", 4);
}

function forzarInicializacionManual() {
  // Mismo pipeline que usan los gatillos, pero ignorando la firma y releyendo
  // el catálogo ABC del archivo maestro.
  const res = procesarConteo_({ forzar: true, forzarABC: true, motivo: 'FORZADO_MANUAL' });
  if (res.motivo === 'LOCK') {
    SpreadsheetApp.getUi().alert(
      "⏳ Otro conteo se está procesando en este momento.\n\n" +
      "La actualización quedó en cola y se aplica sola en unos segundos. " +
      "No hace falta repetir nada.");
    return;
  }
  SpreadsheetApp.getUi().alert(
    "✅ Datos Inicializados y Sincronizados." +
    (res.primerConteo ? "\n\n🚩 Se registró el inicio del inventario (fecha en A, ID en C y secuencia en D)." : "") +
    "\n\nConteos detectados en V, W y X: " + res.conteos
  );
}

// ==========================================
// 4.g RESPALDO / RESTAURACIÓN DE COLUMNAS PROTEGIDAS
// (permite reponer datos si el usuario borra una o varias celdas)
// ==========================================
function obtenerHojaRespaldo(ss) {
  let h = ss.getSheetByName(RESP_SHEET);
  if (!h) {
    h = ss.insertSheet(RESP_SHEET);
    h.hideSheet();
    // Columnas de fórmulas (R-U → 5-8 del respaldo) como texto plano,
    // para que las fórmulas se guarden literales y no se activen en el respaldo.
    h.getRange(1, 5, h.getMaxRows(), 4).setNumberFormat("@");
  }
  return h;
}

// Copia A-D (valores), R-U (fórmulas literales) y V-X (valores) al respaldo.
// MERGE de único registro: si el valor nuevo llega vacío, NUNCA borra el ya
// respaldado. Así, aunque onChange corra sobre un estado recién borrado, el
// respaldo conserva el dato para que onEdit pueda restaurarlo.
function respaldarProtegidas(planilla) {
  try {
    const lr = planilla.getLastRow();
    if (lr < 2) return;
    const n = lr - 1;
    const ad  = planilla.getRange(2, 1, n, 4).getValues();     // A,B,C,D
    const rF  = planilla.getRange(2, 18, n, 4).getFormulas();  // R,S,T,U (fórmula)
    const rV  = planilla.getRange(2, 18, n, 4).getValues();    // R,S,T,U (valor de respaldo)
    const vwx = planilla.getRange(2, 22, n, 3).getValues();    // V,W,X
    const ru  = rF.map((row, i) => row.map((f, j) => (f !== "" ? f : String(rV[i][j]))));

    const bkp = obtenerHojaRespaldo(planilla.getParent());
    const prev = Math.max(bkp.getLastRow() - 1, 0);
    const pAD  = prev ? bkp.getRange(2, 1, prev, 4).getValues() : [];
    const pRU  = prev ? bkp.getRange(2, 5, prev, 4).getValues() : [];
    const pVWX = prev ? bkp.getRange(2, 9, prev, 3).getValues() : [];

    // conserva el valor previo cuando el nuevo viene vacío
    const keep = (nv, ov) => (String(nv == null ? "" : nv).trim() !== "" ? nv : (ov === undefined ? "" : ov));
    const mAD  = ad.map((row, i)  => row.map((v, j) => keep(v, pAD[i]  && pAD[i][j])));
    const mRU  = ru.map((row, i)  => row.map((v, j) => keep(v, pRU[i]  && pRU[i][j])));
    const mVWX = vwx.map((row, i) => row.map((v, j) => keep(v, pVWX[i] && pVWX[i][j])));

    bkp.getRange(2, 1, n, 4).setValues(mAD);
    bkp.getRange(2, 5, n, 4).setValues(mRU);  // se guardan como texto (columnas @)
    bkp.getRange(2, 9, n, 3).setValues(mVWX);
  } catch (e) {
    console.error('respaldarProtegidas: ' + e);
  }
}

// Repone en la planilla las columnas protegidas desde el respaldo (deshace borrados).
function restaurarProtegidas(planilla) {
  try {
    const bkp = obtenerHojaRespaldo(planilla.getParent());
    if (bkp.getLastRow() < 2) return false;
    const n = Math.min(bkp.getLastRow() - 1, planilla.getLastRow() - 1);
    if (n < 1) return false;

    const ad  = bkp.getRange(2, 1, n, 4).getValues();
    const ru  = bkp.getRange(2, 5, n, 4).getValues(); // fórmulas/valores como texto
    const vwx = bkp.getRange(2, 9, n, 3).getValues();

    planilla.getRange(2, 1, n, 4).setValues(ad);
    planilla.getRange(2, 18, n, 4).setValues(ru);  // al escribir en la planilla, "=" reactiva la fórmula
    planilla.getRange(2, 22, n, 3).setValues(vwx);
    return true;
  } catch (e) {
    console.error('restaurarProtegidas: ' + e);
    return false;
  }
}

// ==========================================
// 5. MOTOR DE FONDO (3 HORAS PAUSA / DESPIERTO)
// ==========================================
function rutinaDeFondoMaestra() {
  const lock = LockService.getScriptLock();
  // No solaparse con onChange/onEdit ni con otra ejecución del temporizador
  if (!lock.tryLock(2000)) return;
  try {
    const prop = PropertiesService.getScriptProperties();
    const kAct = claveProp_('WMS_LAST_INTERACTION');
    const kSleep = claveProp_('WMS_SYSTEM_SLEEPING');
    const lastActivity = parseInt(prop.getProperty(kAct)) || 0;
    const now = Date.now();

    // Calcular horas de inactividad
    const horasInactividad = (now - lastActivity) / (1000 * 60 * 60);
    const estaDormido = prop.getProperty(kSleep) === 'true';

    // 1. CONDICIÓN DE PAUSA: Si no ha habido conteos en más de 3 horas
    if (horasInactividad >= 3) {
      if (!estaDormido) {
        // Hace una actualización final antes de dormirse para no consumir cuotas inútiles
        actualizarAnalisis();
        actualizarRegistro();
        prop.setProperty(kSleep, 'true');
      }
      return; // Pausado
    }

    // 2. MIENTRAS ESTÉ ACTIVO (Hay operarios trabajando)
    // Se llama a ejecutarPipeline_ (sin lock propio) porque esta rutina YA tomó
    // el lock del script. Es el único punto periódico que relee el catálogo del
    // maestro: los conteos trabajan siempre desde caché/snapshot.
    ejecutarPipeline_({ forzar: true, actividad: false, motivo: 'FONDO' });
    actualizarRegistro();
  } catch (e) {
    console.error('rutinaDeFondoMaestra: ' + e);
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 6. REGISTRO Y AUDITORÍA MANUAL (Por si alguien digita en el excel)
// ==========================================
function registrarAccionManual(e, sheet, row, col) {
  if (e.value !== "" && e.value !== undefined) {
    let userEmail = (e.user && e.user.getEmail()) ? e.user.getEmail() : Session.getActiveUser().getEmail();
    if (!userEmail || userEmail === "") userEmail = "Edicion Directa Hoja";
    registrarAuditoria(sheet, row, e.value, col, "Conteo Manual", userEmail);
  }
}

function registrarAuditoria(sheet, row, cantidad, colIndex, obs, userEmail) {
  const ss = sheet.getParent();
  const regSheet = ss.getSheetByName('REGISTRO');
  if(!regSheet) return;

  // La zona horaria de Ecuador ya se fija en verificarConfiguracionInicial (al activar
  // el archivo). Aquí solo formateamos con "America/Guayaquil" para evitar la escritura
  // repetida de setSpreadsheetTimeZone en cada conteo (cuota).
  const vals = sheet.getRange(row, 1, 1, 20).getValues()[0];
  const nombreUsuario = USUARIOS_MAP[userEmail] ? USUARIOS_MAP[userEmail] : (userEmail.split('@')[0] || "Operador");

  // CONCURRENCIA: varios operarios cuentan en el MISMO archivo al mismo tiempo.
  // Antes se calculaba getLastRow()+1 y luego se escribía: dos conteos
  // simultáneos obtenían la misma fila y uno pisaba al otro, perdiendo un
  // registro de auditoría. appendRow() agrega al final en una sola operación,
  // así cada conteo cae en su propia fila sin importar cuántos lleguen a la vez.
  // La fecha y la hora se calculan ANTES de escribir, así la fila sale completa
  // de una sola vez (ya no hay que releer la celda para rellenar B y C).
  const ts = new Date();
  const tz = "America/Guayaquil";
  regSheet.appendRow([
    ts,
    Utilities.formatDate(ts, tz, "dd/MM/yy"),
    Utilities.formatDate(ts, tz, "HH:mm:ss"),
    "", nombreUsuario,
    vals[2], vals[4], vals[6], vals[14], vals[17], vals[19],
    (colIndex===22 ? cantidad : ""), (colIndex===23 ? cantidad : ""), (colIndex===24 ? cantidad : ""), obs
  ]);

  // Registrar el tiempo del conteo en la hoja TIEMPOS (usa el inicio marcado por
  // la Terminal si existe; si es un conteo digitado sin inicio, queda VALIDO=NO).
  registrarFinConteo(String(vals[6]).trim(), String(vals[14]).trim(), String(vals[4]).trim(), cantidad, userEmail, colIndex - 21);
}

// Rellena/normaliza las columnas B (fecha) y C (hora) de REGISTRO a partir de la
// fecha real en la columna A, en zona horaria de Ecuador. Lee y escribe por lotes,
// y solo reescribe si hay algo que corregir (evita gasto de cuota).
function actualizarRegistro() {
  const s = ssActual_().getSheetByName("REGISTRO");
  if (!s || s.getLastRow() < 2) return;

  const tz = "America/Guayaquil";
  const n = s.getLastRow() - 1;
  const colA = s.getRange(2, 1, n, 1).getValues();
  const bc = s.getRange(2, 2, n, 2).getValues();
  let cambiado = false;

  for (let i = 0; i < n; i++) {
    const ts = colA[i][0];
    if (ts instanceof Date) {
      const f = Utilities.formatDate(ts, tz, "dd/MM/yy");
      const h = Utilities.formatDate(ts, tz, "HH:mm:ss");
      if (bc[i][0] !== f || bc[i][1] !== h) { bc[i][0] = f; bc[i][1] = h; cambiado = true; }
    }
  }

  if (cambiado) s.getRange(2, 2, n, 2).setValues(bc);
}

// ==========================================
// 7. MOTOR DE ANÁLISIS
// ==========================================
function actualizarAnalisis() {
  const ss = ssActual_();
  const planilla = ss.getSheetByName("PLANILLA DE CONTEO FISICO");
  const analisis = ss.getSheetByName("ANALISIS");
  if (!planilla || !analisis) return;

  const lastRow = planilla.getLastRow();
  const lastCol = planilla.getLastColumn();
  if (lastRow < 2) return;
  const values = planilla.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const codigosUnicos = new Set(), posicionesUnicas = new Set();
  const codigosEstado = {}, posicionesEstado = {};

  let sumQ = 0, unidadesCorrectas = 0, totalSobrantes = 0, totalFaltantes = 0;

  for (const row of values) {
    const codigo = row[6];
    if (!codigo || codigo === "" || codigo.toString().toUpperCase() === "UNDEFINED") continue;

    const categoria = (row[12] || "").toString().trim().toUpperCase();
    const posicion = row[14];
    const qVal = parseFloat(row[16]) || 0;
    const rVal = parseFloat(row[17]) || 0;
    const sVal = parseFloat(row[18]) || 0;
    const resultado = (row[19] || "").toString().trim().toUpperCase();

    if (categoria === "DIF_INV") continue;

    codigosUnicos.add(codigo);
    if (posicion) posicionesUnicas.add(posicion);
    sumQ += qVal;

    if (resultado === "CORRECTO") { unidadesCorrectas += rVal; }
    else if (resultado === "SOBRANTE") { unidadesCorrectas += qVal; totalSobrantes += Math.max(0, rVal - qVal); }
    else if (resultado === "FALTANTE") { unidadesCorrectas += rVal; totalFaltantes += sVal; }

    if (!codigosEstado[codigo]) codigosEstado[codigo] = new Set(); codigosEstado[codigo].add(resultado);
    if (posicion) { if (!posicionesEstado[posicion]) posicionesEstado[posicion] = new Set(); posicionesEstado[posicion].add(resultado); }
  }

  let codigosCorrectos = 0, codigosSobrantes = 0, codigosFaltantes = 0;
  for (const codigo in codigosEstado) {
    const estados = codigosEstado[codigo];
    if (estados.size === 1 && estados.has("CORRECTO")) codigosCorrectos++;
    else { if (estados.has("SOBRANTE")) codigosSobrantes++; if (estados.has("FALTANTE")) codigosFaltantes++; }
  }

  let posicionesCorrectas = 0, posicionesSobrantes = 0, posicionesFaltantes = 0;
  for (const pos in posicionesEstado) {
    const estados = posicionesEstado[pos];
    if (estados.size === 1 && estados.has("CORRECTO")) posicionesCorrectas++;
    else { if (estados.has("SOBRANTE")) posicionesSobrantes++; if (estados.has("FALTANTE")) posicionesFaltantes++; }
  }

  const totalDesfase = Math.abs(totalSobrantes) + Math.abs(totalFaltantes);

  analisis.getRange("C22").setValue(sumQ);
  analisis.getRange("C23").setValue(unidadesCorrectas);
  analisis.getRange("C24").setValue(totalDesfase);
  analisis.getRange("D24").setValue(totalFaltantes);
  analisis.getRange("E24").setValue(totalSobrantes);

  analisis.getRange("H22").setValue(codigosUnicos.size);
  analisis.getRange("H23").setValue(codigosCorrectos);
  analisis.getRange("I24").setValue(codigosFaltantes);
  analisis.getRange("J24").setValue(codigosSobrantes);
  analisis.getRange("H24").setValue(codigosSobrantes + codigosFaltantes);

  analisis.getRange("M22").setValue(posicionesUnicas.size);
  analisis.getRange("M23").setValue(posicionesCorrectas);
  analisis.getRange("N24").setValue(posicionesFaltantes);
  analisis.getRange("O24").setValue(posicionesSobrantes);
  analisis.getRange("M24").setValue(posicionesSobrantes + posicionesFaltantes);
}

// ==========================================
// 8. MEDICIÓN DE TIEMPOS DE CONTEO  (hoja TIEMPOS)
// ==========================================
// Modelo: la Terminal WMS marca el INICIO cuando el operario empieza a contar
// una referencia/posición y el FIN al enviar el conteo. La duración se calcula
// con el reloj del SERVIDOR (un solo reloj para todos, zona horaria Ecuador).

// Clave única del inicio pendiente por operario + posición + referencia.
function claveTiempo_(email, posicion, codigo) {
  return "INI:" + email + "|" + (posicion || "") + "|" + (codigo || "");
}

// La Terminal llama a esto al ABRIR/empezar el conteo de una referencia.
function marcarInicioConteo(codigo, posicion, cliente, userEmail) {
  try {
    userEmail = userEmail || Session.getActiveUser().getEmail() || "SIN_USUARIO";
    const datos = { ts: Date.now(), cliente: cliente || "" };
    CacheService.getScriptCache().put(claveTiempo_(userEmail, posicion, codigo), JSON.stringify(datos), 21600); // 6 h
    return { exito: true };
  } catch (e) {
    console.error('marcarInicioConteo: ' + e);
    return { exito: false, mensaje: String(e) };
  }
}

// Se llama al ENVIAR/registrar el conteo. Calcula la duración desde el inicio
// marcado y escribe una fila en la hoja TIEMPOS.
function registrarFinConteo(codigo, posicion, cliente, unidades, userEmail, tipoConteo, idArchivo) {
  // idArchivo es opcional: lo usa la Terminal WMS al llamar desde otro proyecto.
  // Desde el archivo hijo se omite y se trabaja sobre la hoja activa.
  const ctxPropio = !!idArchivo;
  if (ctxPropio) { try { fijarContexto_(SpreadsheetApp.openById(idArchivo)); } catch (e) { console.error('registrarFinConteo: ' + e); } }
  try {
    userEmail = userEmail || Session.getActiveUser().getEmail() || "SIN_USUARIO";
    const operario = USUARIOS_MAP[userEmail] || (String(userEmail).split('@')[0] || "Operador");
    const cache = CacheService.getScriptCache();
    const clave = claveTiempo_(userEmail, posicion, codigo);
    const tz = "America/Guayaquil";

    const fin = new Date();
    let inicio = null, durSeg = "", valido = false;
    const raw = cache.get(clave);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        inicio = new Date(d.ts);
        if (!cliente) cliente = d.cliente || "";
        durSeg = Math.round((fin.getTime() - d.ts) / 1000);
        valido = (durSeg >= 0 && durSeg <= PAUSA_MAX_MIN * 60); // descarta pausas largas
      } catch (e) {}
      cache.remove(clave); // el inicio se consume una sola vez
    }

    const uds = parseFloat(unidades) || 0;
    const undMin = (valido && durSeg > 0) ? Math.round((uds / (durSeg / 60)) * 100) / 100 : "";

    const hoja = obtenerHojaTiempos(ssActual_());
    hoja.appendRow([
      inicio ? Utilities.formatDate(inicio, tz, "dd/MM/yy") : "",
      inicio ? Utilities.formatDate(inicio, tz, "HH:mm:ss") : "",
      Utilities.formatDate(fin, tz, "dd/MM/yy"),
      Utilities.formatDate(fin, tz, "HH:mm:ss"),
      operario, cliente || "", codigo || "", posicion || "",
      durSeg, uds, undMin,
      valido ? "SI" : "NO",
      tipoConteo || ""
    ]);
    return { exito: true, duracionSeg: durSeg, valido: valido };
  } catch (e) {
    console.error('registrarFinConteo: ' + e);
    return { exito: false, mensaje: String(e) };
  } finally {
    if (ctxPropio) fijarContexto_(null);
  }
}

function obtenerHojaTiempos(ss) {
  let h = ss.getSheetByName(TIEMPOS_SHEET);
  if (!h) {
    h = ss.insertSheet(TIEMPOS_SHEET);
    h.appendRow([
      "FECHA INICIO", "HORA INICIO", "FECHA FIN", "HORA FIN", "OPERARIO", "CLIENTE",
      "REFERENCIA", "POSICION", "DURACION_SEG", "UNIDADES", "UND_POR_MIN", "VALIDO", "TIPO_CONTEO"
    ]);
    h.setFrozenRows(1);
    h.getRange("1:1").setFontWeight("bold");
  }
  return h;
}
