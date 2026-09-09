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
  CACHE_TTL: 1800,          // 30 min
  CACHE_CHUNK: 90000,       // caracteres por trozo (< 100 KB)
  CACHE_MAX_CHUNKS: 25,

  // Respaldo local persistente: si el maestro no se puede abrir (permisos, cuota,
  // archivo movido), se sigue trabajando con la última copia buena.
  SNAP_SHEET: "_ABC_SNAPSHOT",
  SNAP_CHUNK: 45000,        // caracteres por celda (límite de Sheets: 50.000)

  // Columnas de la planilla de conteo
  COL_CODIGO: 7,            // G
  COL_ABC: 6,               // F

  // Si un código NO está en el catálogo: true = conservar el ABC que ya tenía la
  // celda (no destruye información); false = escribir ETIQUETA_SIN_ABC.
  PRESERVAR_SIN_MATCH: true,
  ETIQUETA_SIN_ABC: "",

  // Índice alterno sin ceros a la izquierda (para códigos guardados como número en
  // un archivo y como texto en el otro). Desactivar si los códigos reales llevan
  // ceros a la izquierda significativos.
  USAR_INDICE_ALTERNO: true,

  // Si cambian más tramos que esto, sale más barato reescribir la columna completa.
  MAX_TRAMOS: 40,

  PAYLOAD_VERSION: 2
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

  // 1. Instalar el "Escuchador" para cuando la WebApp envíe datos
  ScriptApp.newTrigger("manejadorCambiosExternos")
    .forSpreadsheet(sheet)
    .onChange()
    .create();

  // 2. Instalar el temporizador de fondo (Revisa cada 30 min si debe trabajar o dormir)
  ScriptApp.newTrigger("rutinaDeFondoMaestra")
    .timeBased()
    .everyMinutes(30)
    .create();

  // Despertar el sistema por primera vez
  PropertiesService.getScriptProperties().setProperty('WMS_LAST_INTERACTION', Date.now().toString());
  PropertiesService.getScriptProperties().setProperty('WMS_SYSTEM_SLEEPING', 'false');

  SpreadsheetApp.getUi().alert(
    "✅ ¡ARCHIVO ACTIVADO CON ÉXITO!\n\n" +
    "El sistema ahora está escuchando a la Terminal WMS externa. Actualizará las columnas y análisis automáticamente cuando lleguen los datos."
  );

  forzarInicializacionManual();
}

// ==========================================
// 2. EL GATILLO ESCUCHADOR (Detecta inyecciones de la WebApp)
// ==========================================
function manejadorCambiosExternos(e) {
  const lock = LockService.getScriptLock();
  // Evita ejecuciones duplicadas/concurrentes: onEdit y onChange disparan a la vez
  // ante un mismo conteo. Sin esto, todo el recálculo corría dos veces.
  if (!lock.tryLock(2000)) return;
  try {
    // Solo actuamos si el cambio es una edición (EDIT) o inyección de un script (OTHER)
    if (e && e.changeType !== 'EDIT' && e.changeType !== 'OTHER') return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("PLANILLA DE CONTEO FISICO");
    if (!sheet) return;

    // Despertar el sistema y registrar la hora de la actividad
    const prop = PropertiesService.getScriptProperties();
    prop.setProperty('WMS_LAST_INTERACTION', Date.now().toString());
    prop.setProperty('WMS_SYSTEM_SLEEPING', 'false');

    // Ejecutar las automatizaciones inmediatamente tras recibir el dato
    verificarConfiguracionInicial(sheet); // Inicializa A y C + zona horaria Ecuador
    verificarYActualizarColumnaB(sheet);  // Trae última fecha/hora de REGISTRO a Col B
    generarSecuenciaColumnaD(sheet);      // Genera secuencia D en base a G

    // El ABC (F) se recalcula en CADA cambio para que aparezca al momento.
    // Es barato: el catálogo sale de caché/snapshot y sólo se escriben las celdas
    // que realmente cambian (si no cambia nada, no se escribe y el ciclo de
    // eventos que provocan las propias escrituras del script se corta solo).
    consolidarDatos(sheet);

    // Actualiza los cálculos y la hoja de Análisis
    actualizarAnalisis();

    // Guarda el estado bueno de las columnas protegidas (para poder restaurarlas)
    respaldarProtegidas(sheet);

  } catch(err) {
    console.error('manejadorCambiosExternos: ' + err);
  } finally {
    lock.releaseLock();
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
          manejadorCambiosExternos({changeType: 'EDIT'});
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

  // 1. FORZAR LA ZONA HORARIA DEL ARCHIVO (Soluciona el desfase de +1 hora)
  ss.setSpreadsheetTimeZone("America/Guayaquil");

  const lr = sheet.getLastRow();
  if (lr < 2) return;
  const a2 = sheet.getRange("A2").getValue();
  const c2 = sheet.getRange("C2").getValue();
  let modificado = false;

  // Llenar Fila 2 si está vacía
  if (!a2 || a2.toString().trim() === "") {
    sheet.getRange("A2").setValue(new Date());
    modificado = true;
  }
  if (!c2 || c2.toString().trim() === "") {
    sheet.getRange("C2").setValue(ss.getName());
    modificado = true;
  }

  // Propagar A2 y C2 hacia todas las filas de abajo
  if (modificado) {
    actualizarColumnasAC(sheet);
  }
}

function actualizarColumnasAC(sheet) {
  const lr = sheet.getLastRow();
  if (lr < 3) return;
  const vals = sheet.getRange("A2:C2").getValues()[0];
  if (vals[0]) sheet.getRange(3, 1, lr - 2, 1).setValue(vals[0]);
  if (vals[2]) sheet.getRange(3, 3, lr - 2, 1).setValue(vals[2]);
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
  if (lr < 2) return;
  // Genera secuencia numéricamente siempre y cuando haya código en G
  const codigos = sheet.getRange(2, 7, lr - 1, 1).getValues();
  let x = 1;
  const secuencia = codigos.map(r => (r[0] && String(r[0]).trim() !== "") ? [x++] : [""]);
  sheet.getRange(2, 4, secuencia.length, 1).setValues(secuencia);
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

  // Mostrar fecha Y hora en zona horaria de Ecuador (Quito, UTC-5)
  if (ultimaFecha instanceof Date) {
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

// Lee CODIGO -> ABC de la hoja maestra. Detecta las columnas por ENCABEZADO
// (antes estaban fijas en B y C: si alguien insertaba una columna, el ABC se
// llenaba con datos equivocados sin ningún error visible).
// La PROTECCIÓN de la hoja NO impide la lectura: basta acceso de Lector.
function leerMapaDesdeHoja_() {
  const res = { mapa: null, filas: 0, duplicados: 0, ejemplosDup: [], colCodigo: 0, colAbc: 0, error: "" };
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

    // Ubicar columnas por encabezado; si no aparecen, se cae a B y C (legado).
    const enc = hoja.getRange(1, 1, 1, lc).getValues()[0].map(normalizarEncabezado_);
    let cCod = 0, cAbc = 0;
    for (let i = 0; i < enc.length; i++) {
      const h = enc[i];
      if (!cCod && (h === "CODIGO" || h === "COD" || h === "ITEM" || h === "SKU" || h === "REFERENCIA")) cCod = i + 1;
      if (!cAbc && (h === "ABC" || h === "CLASIFICACION" || h === "CLASE" || h === "CATEGORIA")) cAbc = i + 1;
    }
    if (!cCod) cCod = 2; // B
    if (!cAbc) cAbc = 3; // C
    res.colCodigo = cCod; res.colAbc = cAbc;

    // Una sola lectura que abarque ambas columnas
    const ini = Math.min(cCod, cAbc), fin = Math.max(cCod, cAbc);
    const datos = hoja.getRange(2, ini, lr - 1, fin - ini + 1).getValues();
    const iCod = cCod - ini, iAbc = cAbc - ini;

    const mapa = {};
    for (let i = 0; i < datos.length; i++) {
      const cod = normalizarCodigo_(datos[i][iCod]);
      const abc = normalizarABC_(datos[i][iAbc]);
      if (!cod || !abc) continue; // códigos sin ABC: los puede rellenar el TXT
      if (mapa[cod] !== undefined && mapa[cod] !== abc) {
        res.duplicados++;
        if (res.ejemplosDup.length < 5) res.ejemplosDup.push(cod + " (" + mapa[cod] + "→" + abc + ")");
      }
      mapa[cod] = abc;
      res.filas++;
    }
    res.mapa = Object.keys(mapa).length ? mapa : null;
    if (!res.mapa) res.error = "La hoja maestra se leyó pero no produjo códigos válidos.";
    return res;
  } catch (e) {
    console.error('leerMapaDesdeHoja_: ' + e);
    res.error = String(e);
    return res;
  }
}

// Respaldo: ABC2026.txt (JSON) de Google Drive. Se prefiere el ID configurado;
// la búsqueda por nombre recorre TODO el Drive y puede tomar una copia vieja,
// así que queda sólo como último recurso.
function leerMapaDesdeTxt_() {
  const res = { mapa: null, filas: 0, duplicadosArchivo: 0, error: "" };
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
    const mapa = {};
    for (const k in json) {
      const cod = normalizarCodigo_(k);
      const abc = normalizarABC_(json[k]);
      if (cod && abc) { mapa[cod] = abc; res.filas++; }
    }
    res.mapa = Object.keys(mapa).length ? mapa : null;
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

function abcCacheGuardar_(payload) {
  try {
    const cache = CacheService.getScriptCache();
    const trozos = trocear_(comprimirB64_(JSON.stringify(payload)), ABC_CFG.CACHE_CHUNK);
    if (!trozos.length || trozos.length > ABC_CFG.CACHE_MAX_CHUNKS) return false;
    const obj = {};
    trozos.forEach((t, i) => { obj[ABC_CFG.CACHE_KEY + ":" + i] = t; });
    obj[ABC_CFG.CACHE_KEY + ":n"] = String(trozos.length);
    cache.putAll(obj, ABC_CFG.CACHE_TTL);
    return true;
  } catch (e) {
    console.error('abcCacheGuardar_: ' + e);
    return false;
  }
}

function abcCacheLeer_() {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(ABC_CFG.CACHE_KEY + ":n"), 10);
    if (!n || n < 1) return null;
    const claves = [];
    for (let i = 0; i < n; i++) claves.push(ABC_CFG.CACHE_KEY + ":" + i);
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

function abcCacheBorrar_() {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(ABC_CFG.CACHE_KEY + ":n"), 10) || 0;
    const claves = [ABC_CFG.CACHE_KEY + ":n", "WMS_ABC_MAP"]; // incluye la clave antigua
    for (let i = 0; i < Math.max(n, ABC_CFG.CACHE_MAX_CHUNKS); i++) claves.push(ABC_CFG.CACHE_KEY + ":" + i);
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
function construirCatalogoABC_() {
  const hoja = leerMapaDesdeHoja_();
  const txt  = leerMapaDesdeTxt_();

  if (!hoja.mapa && !txt.mapa) {
    return { payload: null, error: [hoja.error, txt.error].filter(String).join(" | ") };
  }

  const mapa = Object.assign({}, txt.mapa || {}, hoja.mapa || {}); // la hoja sobrescribe
  const payload = {
    v: ABC_CFG.PAYLOAD_VERSION,
    ts: Date.now(),
    mapa: mapa,
    meta: {
      totalCodigos: Object.keys(mapa).length,
      desdeHoja: hoja.mapa ? Object.keys(hoja.mapa).length : 0,
      desdeTxt: txt.mapa ? Object.keys(txt.mapa).length : 0,
      duplicadosHoja: hoja.duplicados,
      ejemplosDup: hoja.ejemplosDup,
      colCodigo: hoja.colCodigo,
      colAbc: hoja.colAbc,
      errorHoja: hoja.error,
      errorTxt: txt.error,
      fuente: hoja.mapa && txt.mapa ? "HOJA+TXT" : (hoja.mapa ? "HOJA" : "TXT")
    }
  };
  return { payload: payload, error: "" };
}

// Devuelve { mapa, alt, meta, origen }. forzar=true ignora la caché y relee.
function obtenerCatalogoABC_(forzar) {
  if (forzar) abcCacheBorrar_();

  if (!forzar) {
    const cacheado = abcCacheLeer_();
    if (cacheado) {
      return { mapa: cacheado.mapa, alt: construirIndiceAlterno_(cacheado.mapa),
               meta: cacheado.meta || {}, ts: cacheado.ts, origen: "CACHE" };
    }
  }

  const res = construirCatalogoABC_();
  if (res.payload) {
    abcCacheGuardar_(res.payload);
    abcSnapshotGuardar_(res.payload);
    return { mapa: res.payload.mapa, alt: construirIndiceAlterno_(res.payload.mapa),
             meta: res.payload.meta, ts: res.payload.ts, origen: "FUENTES" };
  }

  // Ninguna fuente respondió: seguir trabajando con la última copia buena.
  const snap = abcSnapshotLeer_();
  if (snap) {
    return { mapa: snap.mapa, alt: construirIndiceAlterno_(snap.mapa),
             meta: snap.meta || {}, ts: snap.ts, origen: "SNAPSHOT", error: res.error };
  }
  return { mapa: null, alt: {}, meta: {}, ts: 0, origen: "NINGUNA", error: res.error };
}

// Compatibilidad: devuelve solo el mapa, como la versión anterior.
function obtenerMapaABC(forzar) {
  return obtenerCatalogoABC_(forzar).mapa || {};
}

// ==========================================
// 4.f CATÁLOGO ABC — ESCRITURA EN LA COLUMNA F
// Escritura DIFERENCIAL: antes se reescribía la columna F completa en cada evento
// (miles de celdas por conteo) y, como toda escritura del script vuelve a disparar
// onChange, el proceso se realimentaba. Ahora sólo se tocan los tramos que cambian
// y, cuando no cambia nada, no se escribe: la cadena de eventos se corta sola.
// ==========================================
function consolidarDatos(sheet, forzar) {
  const stats = { ok: false, filas: 0, celdas: 0, sinAbc: 0, sinAbcEjemplos: [],
                  origen: "", totalCodigos: 0, mensaje: "" };
  try {
    if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PLANILLA DE CONTEO FISICO");
    if (!sheet) { stats.mensaje = "No existe la hoja PLANILLA DE CONTEO FISICO."; return stats; }

    const lr = sheet.getLastRow();
    if (lr < 2) { stats.ok = true; stats.mensaje = "La planilla no tiene filas."; return stats; }

    const cat = obtenerCatalogoABC_(forzar);
    stats.origen = cat.origen;
    stats.totalCodigos = cat.mapa ? Object.keys(cat.mapa).length : 0;
    if (!cat.mapa || !stats.totalCodigos) {
      // Sin catálogo NO se toca F: es preferible dejar el dato viejo que borrarlo.
      stats.mensaje = "No se pudo obtener el catálogo ABC. " + (cat.error || "");
      return stats;
    }

    let n = lr - 1;
    const codigos = sheet.getRange(2, ABC_CFG.COL_CODIGO, n, 1).getValues();
    const actuales = sheet.getRange(2, ABC_CFG.COL_ABC, n, 1).getValues();

    // Recortar la cola de filas sin código ni ABC (getLastRow() suele exceder los datos)
    while (n > 0 && normalizarCodigo_(codigos[n - 1][0]) === "" && String(actuales[n - 1][0]).trim() === "") n--;
    if (n < 1) { stats.ok = true; return stats; }
    stats.filas = n;

    const nuevos = new Array(n);
    for (let i = 0; i < n; i++) {
      const cod = normalizarCodigo_(codigos[i][0]);
      const actual = actuales[i][0];

      if (!cod) { nuevos[i] = ""; continue; }             // fila sin código: F vacía

      let abc = cat.mapa[cod];
      if (abc === undefined) abc = cat.alt[claveAlterna_(cod)]; // respaldo por ceros

      if (abc === undefined) {
        stats.sinAbc++;
        if (stats.sinAbcEjemplos.length < 10) stats.sinAbcEjemplos.push(cod);
        // No destruir lo que ya estaba clasificado
        abc = (ABC_CFG.PRESERVAR_SIN_MATCH && String(actual).trim() !== "")
          ? actual : ABC_CFG.ETIQUETA_SIN_ABC;
      }
      nuevos[i] = abc;
    }

    // Detectar tramos contiguos con cambios reales
    const tramos = [];
    for (let i = 0; i < n; i++) {
      if (String(nuevos[i]) !== String(actuales[i][0])) {
        stats.celdas++;
        const ult = tramos[tramos.length - 1];
        if (ult && i === ult.fin + 1) ult.fin = i; else tramos.push({ ini: i, fin: i });
      }
    }

    if (!tramos.length) { stats.ok = true; return stats; } // nada que escribir

    if (tramos.length > ABC_CFG.MAX_TRAMOS) {
      sheet.getRange(2, ABC_CFG.COL_ABC, n, 1).setValues(nuevos.map(v => [v]));
    } else {
      tramos.forEach(t => {
        const bloque = nuevos.slice(t.ini, t.fin + 1).map(v => [v]);
        sheet.getRange(2 + t.ini, ABC_CFG.COL_ABC, bloque.length, 1).setValues(bloque);
      });
    }

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
  const msg = "Fuente: " + st.origen + " · Catálogo: " + st.totalCodigos +
              " códigos · Celdas actualizadas: " + st.celdas +
              (st.sinAbc ? " · Sin ABC: " + st.sinAbc : "");
  ss.toast(msg, "✅ ABC actualizado", 8);
}

// "Diagnóstico ABC": muestra de dónde salió el catálogo y qué códigos no clasifican.
function diagnosticoABC() {
  const cat = obtenerCatalogoABC_(true);
  const st = consolidarDatos(null, false); // ya viene de caché recién escrita
  const m = cat.meta || {};
  const edadMin = cat.ts ? Math.round((Date.now() - cat.ts) / 60000) : "-";

  const lineas = [
    "📊 DIAGNÓSTICO DEL CATÁLOGO ABC",
    "",
    "Origen del catálogo: " + cat.origen + (cat.origen === "SNAPSHOT" ? "  ⚠️ (maestro no accesible)" : ""),
    "Antigüedad de los datos: " + edadMin + " min",
    "Códigos totales: " + (cat.mapa ? Object.keys(cat.mapa).length : 0),
    "  · desde la hoja maestra: " + (m.desdeHoja || 0),
    "  · desde " + ABC_CFG.TXT_FALLBACK_NAME + ": " + (m.desdeTxt || 0),
    "Columnas detectadas en el maestro: código=" + (m.colCodigo || "?") + ", abc=" + (m.colAbc || "?"),
    "",
    "PLANILLA",
    "Filas evaluadas: " + st.filas,
    "Celdas actualizadas en esta corrida: " + st.celdas,
    "Códigos sin ABC: " + st.sinAbc,
    st.sinAbcEjemplos.length ? "  ej.: " + st.sinAbcEjemplos.join(", ") : "",
    "",
    m.duplicadosHoja ? "⚠️ Códigos duplicados con ABC distinto en el maestro: " + m.duplicadosHoja : "Sin duplicados conflictivos en el maestro.",
    (m.ejemplosDup && m.ejemplosDup.length) ? "  ej.: " + m.ejemplosDup.join(", ") : "",
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PLANILLA DE CONTEO FISICO");
  if (sheet) {
    verificarConfiguracionInicial(sheet);
    generarSecuenciaColumnaD(sheet);
    verificarYActualizarColumnaB(sheet);
    consolidarDatos(sheet, true); // el botón "Forzar TODO" sí relee el catálogo
    actualizarAnalisis();
    respaldarProtegidas(sheet); // deja una copia base de las columnas protegidas
  }
  SpreadsheetApp.getUi().alert("✅ Datos Inicializados y Sincronizados.");
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
    const lastActivity = parseInt(prop.getProperty('WMS_LAST_INTERACTION')) || 0;
    const now = Date.now();

    // Calcular horas de inactividad
    const horasInactividad = (now - lastActivity) / (1000 * 60 * 60);
    const estaDormido = prop.getProperty('WMS_SYSTEM_SLEEPING') === 'true';

    // 1. CONDICIÓN DE PAUSA: Si no ha habido conteos en más de 3 horas
    if (horasInactividad >= 3) {
      if (!estaDormido) {
        // Hace una actualización final antes de dormirse para no consumir cuotas inútiles
        actualizarAnalisis();
        actualizarRegistro();
        prop.setProperty('WMS_SYSTEM_SLEEPING', 'true');
      }
      return; // Pausado
    }

    // 2. MIENTRAS ESTÉ ACTIVO (Hay operarios trabajando)
    actualizarAnalisis();
    // La rutina de fondo es el único punto que RELEE el catálogo del maestro
    // (cada 30 min). Los eventos de conteo trabajan siempre desde caché/snapshot.
    consolidarDatos(null, true);
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
  const nextRow = regSheet.getLastRow() + 1;
  let nombreUsuario = USUARIOS_MAP[userEmail] ? USUARIOS_MAP[userEmail] : (userEmail.split('@')[0] || "Operador");

  regSheet.getRange(nextRow, 1, 1, 15).setValues([[
    new Date(), "", "", "", nombreUsuario,
    vals[2], vals[4], vals[6], vals[14], vals[17], vals[19],
    (colIndex===22 ? cantidad : ""), (colIndex===23 ? cantidad : ""), (colIndex===24 ? cantidad : ""), obs
  ]]);

  const ts = regSheet.getRange(nextRow, 1).getValue();
  if (ts instanceof Date) {
    const tz = "America/Guayaquil";
    regSheet.getRange(nextRow, 2).setValue(Utilities.formatDate(ts, tz, "dd/MM/yy"));
    regSheet.getRange(nextRow, 3).setValue(Utilities.formatDate(ts, tz, "HH:mm:ss"));
  }

  // Registrar el tiempo del conteo en la hoja TIEMPOS (usa el inicio marcado por
  // la Terminal si existe; si es un conteo digitado sin inicio, queda VALIDO=NO).
  registrarFinConteo(String(vals[6]).trim(), String(vals[14]).trim(), String(vals[4]).trim(), cantidad, userEmail, colIndex - 21);
}

// Rellena/normaliza las columnas B (fecha) y C (hora) de REGISTRO a partir de la
// fecha real en la columna A, en zona horaria de Ecuador. Lee y escribe por lotes,
// y solo reescribe si hay algo que corregir (evita gasto de cuota).
function actualizarRegistro() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("REGISTRO");
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
function registrarFinConteo(codigo, posicion, cliente, unidades, userEmail, tipoConteo) {
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

    const hoja = obtenerHojaTiempos(SpreadsheetApp.getActiveSpreadsheet());
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
