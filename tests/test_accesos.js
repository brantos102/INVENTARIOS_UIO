// Verificación de accesos: cada copia la crea un operario, así que los triggers
// corren con SU cuenta y hay que comprobar que pueda leer el catálogo.
const { cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

ctx.Session.getActiveUser = () => ({ getEmail: () => 'ingresosuio1@itsanet.com' });

const conMaestro = (hojas) => {
  ctx.SpreadsheetApp.openById = () => ({
    getName: () => 'CONTEOS CICLICOS ITSANET',
    getSheetByName: n => (hojas.indexOf(n) >= 0 ? { getName: () => n } : null),
    getSheets: () => hojas.map(n => ({ getName: () => n }))
  });
};
const sinMaestro = () => { ctx.SpreadsheetApp.openById = () => { throw new Error('No tiene permiso'); }; };
const conTxt = (hay) => {
  ctx.DriveApp.getFilesByName = () => { let q = hay ? [{ getName: () => 'ABC2026.txt', isTrashed: () => false }] : [];
    return { hasNext: () => q.length > 0, next: () => q.shift() }; };
};

// --- Cuenta con todo en orden (el respaldo TXT viene desactivado) ---
conMaestro(['CRONOGRAMA_CODIGOS']); conTxt(true);
let a = ctx.verificarAccesos_();
eq([a.maestro, a.txt, a.ok], [true, false, true], 'con el maestro alcanza para operar');
eq(a.txtMsg.indexOf('Desactivado') >= 0, true, 'el respaldo se reporta como desactivado, no como problema');
eq(a.usuario, 'ingresosuio1@itsanet.com', 'identifica la cuenta que ejecuta');
eq(a.maestroMsg.indexOf('CONTEOS CICLICOS ITSANET') >= 0, true, 'nombra el archivo maestro');

// --- Operario SIN acceso al maestro: el caso real de una copia recien creada ---
sinMaestro(); conTxt(false);
a = ctx.verificarAccesos_();
eq([a.maestro, a.txt, a.ok], [false, false, false], 'sin ninguna fuente el ABC no puede funcionar');
eq(a.maestroMsg.indexOf('SIN ACCESO') >= 0, true, 'dice claramente que falta el acceso');
eq(a.maestroMsg.indexOf(ctx.evaluar('ABC_CFG.MASTER_ID')) >= 0, true, 'incluye el ID a solicitar');

// --- Sin maestro y sin respaldo: el ABC no puede funcionar ---
sinMaestro(); conTxt(true);
a = ctx.verificarAccesos_();
eq([a.maestro, a.ok], [false, false], 'con el respaldo apagado, el maestro es imprescindible');

// --- Si se reactiva el respaldo, vuelve a contar como fuente válida ---
ctx.evaluar('ABC_CFG.USAR_TXT_FALLBACK = true');
a = ctx.verificarAccesos_();
eq([a.maestro, a.txt, a.ok], [false, true, true], 'con el respaldo activado alcanza para operar');
ctx.evaluar('ABC_CFG.USAR_TXT_FALLBACK = false');

// --- El maestro se abre pero le cambiaron el nombre a la hoja ---
conMaestro(['OTRA_HOJA']); conTxt(false);
a = ctx.verificarAccesos_();
eq(a.maestro, false, 'detecta que la hoja del catalogo no esta');
eq(a.maestroMsg.indexOf('no tiene la hoja') >= 0, true, 'distingue falta de hoja de falta de permiso');

// --- Tolera que la hoja se haya renombrado conservando "CRONOGRAMA" ---
conMaestro(['CRONOGRAMA CODIGOS 2026']);
a = ctx.verificarAccesos_();
eq(a.maestro, true, 'acepta la hoja renombrada');

// --- El aviso al operario no se repite mas de una vez por hora ---
const props = {};
const prop = { getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } };
let avisos = [];
const ss = { getId: () => 'ID-1', toast: (msg, titulo) => avisos.push(titulo) };
sinMaestro(); conTxt(false);
ctx.avisarProblemaABC_(ss, { ok: false, mensaje: 'sin catalogo' }, prop);
ctx.avisarProblemaABC_(ss, { ok: false, mensaje: 'sin catalogo' }, prop);
eq(avisos.length, 1, 'avisa una sola vez por hora');
props['WMS_AVISO_ABC:ID-1'] = String(Date.now() - 3600001);
ctx.avisarProblemaABC_(ss, { ok: false, mensaje: 'sin catalogo' }, prop);
eq(avisos.length, 2, 'pasada la hora vuelve a avisar');

// --- El onEdit simple no debe trabajar si el archivo ya está activado ---
// (corre con la cuenta del operario y sin autorización: no puede leer el maestro)
const props2 = {};
ctx.PropertiesService.getScriptProperties = () => ({
  getProperty: k => (k in props2 ? props2[k] : null),
  setProperty: (k, v) => { props2[k] = String(v); }
});
eq(ctx.archivoActivado_(), false, 'archivo sin activar: el respaldo del onEdit simple actua');
props2['WMS_ACTIVADO_POR'] = 'brantos102@gmail.com';
eq(ctx.archivoActivado_(), true, 'archivo activado: el trabajo lo hace el trigger instalable');

// Si no se puede leer la propiedad, se asume NO activado para no dejar de actualizar
ctx.PropertiesService.getScriptProperties = () => { throw new Error('sin permiso'); };
eq(ctx.archivoActivado_(), false, 'ante la duda, actualiza igual');

t.fin();
