// API que consume la Terminal WMS: actualizarInventario() sobre un archivo por ID.
const { hojaFalsa, fila, cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

let lockLibre = true, abierto = null;
const K = (base, id) => base + ':' + id;
function montar(id, filas) {
  const planilla = hojaFalsa('PLANILLA DE CONTEO FISICO', filas);
  const props = {};
  ctx.PropertiesService.getScriptProperties = () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }
  });
  ctx.LockService.getScriptLock = () => ({ tryLock: () => lockLibre, releaseLock: () => {} });
  ctx.SpreadsheetApp.openById = (pedido) => {
    if (pedido !== id) throw new Error('No se encontró el archivo ' + pedido);
    abierto = pedido;
    return { getName: () => 'INV-' + id, getId: () => id, setSpreadsheetTimeZone: () => {},
             getSpreadsheetTimeZone: () => 'America/Guayaquil',
             getSheetByName: n => (n === 'PLANILLA DE CONTEO FISICO' ? planilla : null) };
  };
  ctx.verificarConfiguracionInicial = () => {};
  ctx.verificarYActualizarColumnaB = () => {};
  ctx.actualizarAnalisis = () => {};
  ctx.respaldarProtegidas = () => {};
  ctx.consolidarDatos = () => ({ ok: true, origen: 'FUENTES', celdas: 3, sinAbc: 1, porDefecto: 2, clientes: ['DEGSO'] });
  return { planilla, props };
}

// --- Llamada normal desde la Terminal ---
let m = montar('ID-1', [fila({ codigo: 'A1', v: 5 })]);
let r = ctx.actualizarInventario('ID-1');
eq([r.exito, r.ejecutado, r.primerConteo, r.conteos], [true, true, true, 1], 'procesa el archivo indicado por ID');
eq(r.abc, { origen: 'FUENTES', celdas: 3, sinAbc: 1, porDefecto: 2, clientes: ['DEGSO'] }, 'devuelve el resumen del ABC');
eq(typeof r.ms, 'number', 'informa cuanto tardo');
eq(ctx.evaluar('SS_CTX_'), null, 'el contexto no queda colgado entre llamadas');

// --- Idempotente: sin conteos nuevos no hace nada ---
r = ctx.actualizarInventario('ID-1');
eq([r.exito, r.ejecutado], [true, false], 'la segunda llamada no recalcula');

// --- Conteo nuevo -> vuelve a procesar, sin re-arrancar el inventario ---
m.planilla.getRange(2, 23).setValue(3);
r = ctx.actualizarInventario('ID-1');
eq([r.ejecutado, r.primerConteo, r.conteos], [true, false, 2], 'procesa el conteo nuevo');

// --- Sin ID ---
r = ctx.actualizarInventario('');
eq([r.exito, r.mensaje], [false, 'Falta el ID del archivo de inventario.'], 'valida el ID');

// --- ID inexistente: error controlado, no excepcion ---
r = ctx.actualizarInventario('NO-EXISTE');
eq(r.exito, false, 'un ID invalido no rompe la Terminal');
eq(r.mensaje.indexOf('No se encontró') >= 0, true, 'explica el motivo');
eq(ctx.evaluar('SS_CTX_'), null, 'tampoco deja contexto colgado tras un error');

// --- Otro conteo en curso: queda en cola, NO es un fallo para el operario ---
// (varios operarios cuentan a la vez en el mismo archivo)
m = montar('ID-2', [fila({ codigo: 'B1', v: 1 })]);
lockLibre = false;
r = ctx.actualizarInventario('ID-2');
eq([r.exito, r.ejecutado, r.pendiente], [true, false, true], 'esperar turno no se reporta como error');
eq(m.props[K('WMS_ACTUALIZACION_PENDIENTE', 'ID-2')], '1', 'deja marcada la actualizacion pendiente');

// La corrida siguiente la procesa aunque la firma no haya cambiado
lockLibre = true;
r = ctx.actualizarInventario('ID-2');
eq(r.ejecutado, true, 'la corrida siguiente recupera la actualizacion pendiente');
eq(m.props[K('WMS_ACTUALIZACION_PENDIENTE', 'ID-2')], undefined, 'y limpia la marca');

// --- Clave de caché por conjunto de clientes ---
const clave = c => ctx.claveCacheABC_(c);
eq(clave([]).indexOf(':TODOS') > 0, true, 'sin clientes usa el catalogo completo');
eq(clave(['DEGSO', 'HYCITE']), clave(['HYCITE', 'DEGSO']), 'el orden de los clientes no cambia la clave');
eq(clave(['DEGSO']) !== clave(['HYCITE']), true, 'clientes distintos no comparten catalogo');

t.fin();
