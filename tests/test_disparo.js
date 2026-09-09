// Disparo por conteo (V, W, X): firma de estado, arranque del inventario y
// deduplicación entre el gatillo de la Terminal (onChange) y el de la hoja (onEdit).
const { hojaFalsa, fila, cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

// Las propiedades del script se guardan con el ID del archivo, para que un mismo
// proyecto pueda atender varios inventarios sin pisarse.
const K = (base, id) => base + ':' + (id || 'ID-ABC-123');

function montar(filas, filasRegistro, id) {
  const planilla = hojaFalsa('PLANILLA DE CONTEO FISICO', filas);
  const registro = hojaFalsa('REGISTRO', Array.from({ length: filasRegistro || 0 }, () => ['x']));
  const props = {};
  const llamadas = [];
  ctx.PropertiesService.getScriptProperties = () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }
  });
  ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getName: () => 'INV-01',
    getId: () => id || 'ID-ABC-123',
    setSpreadsheetTimeZone: () => {},
    getSheetByName: n => (n === 'PLANILLA DE CONTEO FISICO' ? planilla : (n === 'REGISTRO' ? registro : null))
  });
  // Espías: lo que se prueba aquí es la orquestación, no cada función interna.
  ctx.verificarConfiguracionInicial = () => llamadas.push('config');
  ctx.verificarYActualizarColumnaB = () => llamadas.push('colB');
  ctx.actualizarAnalisis = () => llamadas.push('analisis');
  ctx.respaldarProtegidas = () => llamadas.push('respaldo');
  ctx.consolidarDatos = (s, forzar) => { llamadas.push('abc:' + !!forzar); return { ok: true, origen: 'FUENTES' }; };
  return { planilla, registro, props, llamadas };
}

// --- firmaConteos_ ---
let m = montar([fila({ codigo: 'A1' }), fila({ codigo: 'B2' })], 3);
eq(ctx.firmaConteos_(m.planilla, m.registro).firma, '0|0|4', 'firma sin conteos');
m = montar([fila({ codigo: 'A1', v: 5 }), fila({ codigo: 'B2', v: 2, w: 2 })], 3);
let f = ctx.firmaConteos_(m.planilla, m.registro);
eq([f.conteos, f.ultimaFila, f.filasRegistro], [3, 3, 4], 'cuenta conteos en V, W y X');

// --- Sin conteos: NO se sella la fecha de inicio (antes se sellaba al activar) ---
m = montar([fila({ codigo: 'A1' })], 1);
let r = ctx.ejecutarPipeline_({ motivo: 'TEST' });
eq(r.ejecutado, true, 'primera corrida sincroniza');
eq(r.primerConteo, false, 'sin conteos no hay arranque de inventario');
eq(m.planilla.getRange('A2').getValue(), '', 'la columna A sigue vacia sin conteos');
eq(m.props[K('WMS_INVENTARIO_INICIADO')], undefined, 'no marca el inventario como iniciado');

// --- Sin cambios: la firma corta el recálculo (y con ello el bucle de onChange) ---
m.llamadas.length = 0;
r = ctx.ejecutarPipeline_({ motivo: 'TEST' });
eq(r.ejecutado, false, 'sin conteos nuevos no recalcula');
eq(m.llamadas, [], 'no llama a ninguna actualizacion');

// --- PRIMER conteo: sella A (fecha), C (ID), D (secuencia) y fuerza el ABC ---
m.planilla.getRange(2, 22).setValue(7);           // conteo en V2
m.planilla.escrituras.length = 0; m.llamadas.length = 0;
r = ctx.ejecutarPipeline_({ motivo: 'TEST' });
eq(r.primerConteo, true, 'el primer conteo arranca el inventario');
const esFecha = v => Object.prototype.toString.call(v) === '[object Date]';
eq(esFecha(m.planilla.getRange('A2').getValue()), true, 'columna A: fecha de inicio del primer conteo');
eq(m.planilla.getRange('C2').getValue(), 'INV-01', 'columna C: ID del inventario');
eq(m.planilla.getRange('D2').getValue(), 1, 'columna D: secuencia generada');
eq(m.llamadas.filter(l => l.indexOf('abc:') === 0).length, 1, 'el ABC se recalcula al arrancar');
eq(m.props[K('WMS_INVENTARIO_INICIADO')], 'true', 'queda marcado como iniciado');
const fechaInicio = m.planilla.getRange('A2').getValue();

// --- Conteos siguientes: no vuelven a sellar el arranque ni fuerzan el catálogo ---
m.planilla.getRange(3, 23).setValue(4);           // conteo en W3
m.llamadas.length = 0;
r = ctx.ejecutarPipeline_({ motivo: 'TEST' });
eq([r.ejecutado, r.primerConteo], [true, false], 'conteo siguiente recalcula sin re-arrancar');
eq(m.llamadas.indexOf('abc:false') >= 0, true, 'usa el catalogo cacheado');
eq(m.planilla.getRange('A2').getValue(), fechaInicio, 'la fecha de inicio no se mueve');

// --- Archivo que ya venía trabajando: nunca se pisa lo que ya está escrito ---
m = montar([fila({ codigo: 'A1', v: 3 })], 1);
m.planilla.getRange('A2').setValue('01/01/2026');
m.planilla.getRange('C2').setValue('INVENTARIO ANTERIOR');
r = ctx.ejecutarPipeline_({ motivo: 'TEST' });
eq(r.primerConteo, true, 'detecta el arranque');
eq(m.planilla.getRange('A2').getValue(), '01/01/2026', 'respeta la fecha de inicio existente');
eq(m.planilla.getRange('C2').getValue(), 'INVENTARIO ANTERIOR', 'respeta el ID existente');

// --- forzar: ignora la firma (botón "Forzar TODO" y rutina de fondo) ---
m.llamadas.length = 0;
r = ctx.ejecutarPipeline_({ forzar: true, forzarABC: true, motivo: 'TEST' });
eq(r.ejecutado, true, 'forzar ignora la firma');
eq(m.llamadas.indexOf('abc:true') >= 0, true, 'forzarABC relee el maestro');

// --- Gatillo de edición: sólo reacciona a V, W y X ---
let disparos = [];
ctx.procesarConteo_ = (o) => { disparos.push(o.motivo); return {}; };
const evento = (col, hoja) => ({ range: {
  getSheet: () => ({ getName: () => hoja || 'PLANILLA DE CONTEO FISICO' }),
  getRow: () => 5, getColumn: () => col, getLastColumn: () => col } });
ctx.alRegistrarConteo(evento(22)); ctx.alRegistrarConteo(evento(24));
eq(disparos.length, 2, 'V y X disparan el pipeline');
disparos = [];
ctx.alRegistrarConteo(evento(21)); ctx.alRegistrarConteo(evento(25)); ctx.alRegistrarConteo(evento(7));
eq(disparos.length, 0, 'columnas fuera de V:X no disparan nada');
disparos = [];
ctx.alRegistrarConteo(evento(22, 'ANALISIS'));
eq(disparos.length, 0, 'otras hojas no disparan nada');

// --- La rutina de fondo no se cuenta a sí misma como actividad del operario ---
m = montar([fila({ codigo: 'A1', v: 3 })], 1);
ctx.ejecutarPipeline_({ forzar: true, actividad: false, motivo: 'FONDO' });
eq(m.props[K('WMS_LAST_INTERACTION')], undefined, 'el fondo no renueva la marca de actividad');
ctx.ejecutarPipeline_({ forzar: true, motivo: 'CONTEO' });
eq(typeof m.props[K('WMS_LAST_INTERACTION')], 'string', 'un conteo real si marca actividad');
eq(m.props[K('WMS_SYSTEM_SLEEPING')], 'false', 'un conteo real despierta el sistema');

// --- Refresco del ABC por tiempo: relee el maestro cada REFRESCO_MIN minutos ---
m = montar([fila({ codigo: 'A1', v: 1 })], 1);
ctx.ejecutarPipeline_({ motivo: 'C1' });                      // primer conteo: relee
eq(typeof m.props[K('WMS_ABC_ULTIMA_LECTURA')], 'string', 'anota la hora de la lectura del maestro');

m.planilla.getRange(2, 23).setValue(2);                       // conteo siguiente
m.llamadas.length = 0;
ctx.ejecutarPipeline_({ motivo: 'C2' });
eq(m.llamadas.indexOf('abc:false') >= 0, true, 'dentro de la ventana usa el catalogo cacheado');

// Se envejece la marca más allá de la ventana configurada
m.props[K('WMS_ABC_ULTIMA_LECTURA')] = String(Date.now() - (ctx.evaluar('ABC_CFG.REFRESCO_MIN') + 1) * 60000);
m.planilla.getRange(3, 22).setValue(9);
m.llamadas.length = 0;
ctx.ejecutarPipeline_({ motivo: 'C3' });
eq(m.llamadas.indexOf('abc:true') >= 0, true, 'pasada la ventana vuelve a leer el maestro');

// Si el maestro está caído (se resolvió por snapshot) NO se anota la lectura
m = montar([fila({ codigo: 'A1', v: 1 })], 1);
ctx.consolidarDatos = () => ({ ok: true, origen: 'SNAPSHOT' });
ctx.ejecutarPipeline_({ motivo: 'C1' });
eq(m.props[K('WMS_ABC_ULTIMA_LECTURA')], undefined, 'con el maestro caido se reintenta en la proxima vuelta');

// --- Un mismo proyecto atendiendo dos inventarios no mezcla su estado ---
// (es el caso de la Terminal WMS llamando al motor para varios archivos)
m = montar([fila({ codigo: 'A1', v: 1 })], 1, 'ARCHIVO-1');
ctx.ejecutarPipeline_({ motivo: 'T1' });
const propsCompartidas = m.props;
eq(propsCompartidas[K('WMS_INVENTARIO_INICIADO', 'ARCHIVO-1')], 'true', 'marca el arranque del archivo 1');
eq(propsCompartidas[K('WMS_INVENTARIO_INICIADO', 'ARCHIVO-2')], undefined, 'el archivo 2 no hereda el arranque del 1');

// --- Una actualización que se quedó sin turno se recupera en la corrida siguiente ---
m = montar([fila({ codigo: 'A1', v: 1 })], 1);
ctx.ejecutarPipeline_({ motivo: 'C1' });          // deja la firma al día
m.llamadas.length = 0;
eq(ctx.ejecutarPipeline_({ motivo: 'C2' }).ejecutado, false, 'sin novedades no recalcula');

m.props[K('WMS_ACTUALIZACION_PENDIENTE')] = '1';  // otra corrida se quedó sin turno
m.llamadas.length = 0;
eq(ctx.ejecutarPipeline_({ motivo: 'C3' }).ejecutado, true, 'con marca pendiente recalcula igual');
eq(m.props[K('WMS_ACTUALIZACION_PENDIENTE')], undefined, 'y consume la marca');

// --- El primer conteo no repite la lectura que acaba de hacer ACTIVAR ARCHIVO ---
m = montar([fila({ codigo: 'A1' })], 1);
ctx.ejecutarPipeline_({ forzar: true, forzarABC: true, motivo: 'ACTIVACION' }); // lee el maestro
m.planilla.getRange(2, 22).setValue(4);   // primer conteo, minutos después
m.llamadas.length = 0;
r = ctx.ejecutarPipeline_({ motivo: 'PRIMER_CONTEO' });
eq(r.primerConteo, true, 'sigue siendo el arranque del inventario');
eq(m.llamadas.indexOf('abc:false') >= 0, true, 'pero no repite la lectura del maestro');

// En un archivo recién creado, sin ninguna lectura previa, sí lee
m = montar([fila({ codigo: 'A1', v: 1 })], 1);
r = ctx.ejecutarPipeline_({ motivo: 'PRIMER_CONTEO' });
eq(m.llamadas.indexOf('abc:true') >= 0, true, 'archivo nuevo: lee el maestro en el primer conteo');

t.fin();
