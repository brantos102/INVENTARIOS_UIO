// Auditoría en la hoja REGISTRO con varios operarios contando a la vez.
const { hojaFalsa, fila, cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

ctx.Utilities.formatDate = (d, tz, fmt) => (fmt === 'dd/MM/yy' ? '09/09/26' : '10:30:00');
ctx.CacheService.getScriptCache = () => ({ get: () => null, put: () => {}, remove: () => {} });
ctx.Session.getActiveUser = () => ({ getEmail: () => 'ingresosuio1@itsanet.com' });

const registro = hojaFalsa('REGISTRO', []);
const planilla = hojaFalsa('PLANILLA DE CONTEO FISICO',
  [fila({ cliente: 'DEGSO', codigo: 'A1' }), fila({ cliente: 'DEGSO', codigo: 'B2' })]);
planilla.getParent = () => ({ getSheetByName: n => (n === 'REGISTRO' ? registro : null) });
ctx.ssActual_ = () => ({ getSheetByName: () => null, insertSheet: () => hojaFalsa('TIEMPOS', []) });
ctx.obtenerHojaTiempos = () => hojaFalsa('TIEMPOS', []);

// Dos operarios registran un conteo casi al mismo tiempo, en filas distintas.
ctx.registrarAuditoria(planilla, 2, 10, 22, 'Conteo Manual', 'ingresosuio1@itsanet.com');
ctx.registrarAuditoria(planilla, 3, 25, 23, 'Conteo Manual', 'fmorales@itsanet.com');

eq(registro.datos.length, 2, 'cada conteo cae en su propia fila (no se pisan)');
eq([registro.datos[0][4], registro.datos[1][4]], ['Ochoa Danny', 'Morales Fabian'], 'cada fila lleva su operario');

// La fila sale completa de una sola escritura: fecha y hora ya vienen puestas
eq(registro.datos[0][1], '09/09/26', 'columna B (fecha) se llena en el mismo append');
eq(registro.datos[0][2], '10:30:00', 'columna C (hora) se llena en el mismo append');
eq(registro.datos[0][11], 10, 'el conteo de la columna V va en su casilla');
eq(registro.datos[1][12], 25, 'el conteo de la columna W va en su casilla');
eq(registro.escrituras.filter(e => e.append).length, 2, 'una sola operacion de escritura por conteo');

t.fin();
