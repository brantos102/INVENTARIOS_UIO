// Escritura de la columna F: resolución por CLIENTE+CODIGO y escritura diferencial.
const { hojaFalsa, fila, cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

let clientesPedidos = null;
const catalogo = (mapa, global) => {
  ctx.obtenerCatalogoABC_ = (forzar, clientes) => {
    clientesPedidos = clientes;
    return { mapa: mapa || {}, global: global || {}, alt: ctx.construirIndiceAlterno_(global || {}),
             meta: {}, clientes: clientes || [], ts: Date.now(), origen: 'TEST' };
  };
};
const planilla = (filas) => hojaFalsa('PLANILLA DE CONTEO FISICO', filas);

// 1) Sin cambios -> NINGUNA escritura (antes reescribía toda la columna en cada evento)
catalogo({}, { 'A1': 'A', 'B2': 'B' });
let h = planilla([fila({ codigo: 'A1', abc: 'A' }), fila({ codigo: 'B2', abc: 'B' })]);
let st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'sin cambios no escribe nada');
eq(st.celdas, 0, 'contador de celdas en 0');

// 2) Una sola celda nueva -> una escritura de 1 celda
h = planilla([fila({ codigo: 'A1', abc: 'A' }), fila({ codigo: 'B2' })]);
ctx.consolidarDatos(h, false);
eq(h.escrituras, [{ row: 3, col: 6, n: 1, cols: 1 }], 'escribe solo la celda que cambio');
eq(h.datos[1][5], 'B', 'valor correcto en F3');

// 3) Tramos contiguos: filas 2-3 y fila 5 -> 2 escrituras
catalogo({}, { 'A1': 'A', 'B2': 'B', 'C3': 'C', 'D4': 'D' });
h = planilla([fila({ codigo: 'A1' }), fila({ codigo: 'B2' }), fila({ codigo: 'C3', abc: 'C' }), fila({ codigo: 'D4' })]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.map(e => [e.row, e.n]), [[2, 2], [5, 1]], 'agrupa tramos contiguos');
eq(st.celdas, 3, 'cuenta 3 celdas cambiadas');

// 4) CLIENTE+CODIGO: el mismo código con ABC distinto según el cliente
catalogo({ 'DEGSO|3M2091': 'A', 'HYCITE|3M2091': 'C' }, {});
h = planilla([fila({ cliente: 'DEGSO', codigo: '3M2091' }), fila({ cliente: 'HYCITE', codigo: '3M2091' })]);
ctx.consolidarDatos(h, false);
eq([h.datos[0][5], h.datos[1][5]], ['A', 'C'], 'cada cliente recibe su propia clasificacion');

// 5) El código ambiguo NO se resuelve por el índice suelto
catalogo({ 'DEGSO|3M2091': 'A' }, {});  // 3M2091 quedó fuera del global por ambiguo
h = planilla([fila({ cliente: 'OTRO', codigo: '3M2091', abc: '' })]);
st = ctx.consolidarDatos(h, false);
eq(h.datos[0][5], '', 'cliente desconocido no hereda un ABC ajeno');
eq(st.sinAbcEjemplos, ['OTRO/3M2091'], 'el ejemplo identifica cliente y codigo');

// 6) Código sin catálogo NO borra el ABC existente
catalogo({}, { 'A1': 'A' });
h = planilla([fila({ codigo: 'A1', abc: 'A' }), fila({ codigo: 'ZZZ9', abc: 'B' })]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'no borra el ABC de un codigo ausente del catalogo');
eq(st.sinAbc, 1, 'lo reporta como sinAbc');

// 7) Fila sin código -> F se limpia
h = planilla([fila({ codigo: 'A1', abc: 'A' }), fila({ abc: 'B' })]);
ctx.consolidarDatos(h, false);
eq(h.datos[1][5], '', 'limpia F cuando no hay codigo en G');

// 8) Ceros a la izquierda: catálogo en texto, planilla en número
catalogo({}, { '00123': 'A' });
h = planilla([fila({ codigo: 123 })]);
ctx.consolidarDatos(h, false);
eq(h.datos[0][5], 'A', 'indice alterno resuelve ceros a la izquierda');

// 9) Espacios y minúsculas
catalogo({ 'DEGSO|AB-100': 'C' }, {});
h = planilla([fila({ cliente: ' degso ', codigo: ' ab-100 ' })]);
ctx.consolidarDatos(h, false);
eq(h.datos[0][5], 'C', 'normaliza cliente y codigo');

// 10) Los clientes de la planilla se le piden al catálogo (filtra el maestro)
catalogo({}, { 'A1': 'A' });
h = planilla([fila({ cliente: 'DEGSO', codigo: 'A1' }), fila({ cliente: 'HYCITE', codigo: 'A1' }), fila({ cliente: 'DEGSO', codigo: 'A1' })]);
ctx.consolidarDatos(h, false);
eq(clientesPedidos.sort(), ['DEGSO', 'HYCITE'], 'pide solo los clientes presentes, sin repetir');

// 11) Catálogo no disponible -> no toca nada y avisa
ctx.obtenerCatalogoABC_ = () => ({ mapa: {}, global: {}, alt: {}, meta: {}, clientes: [], ts: 0, origen: 'NINGUNA', error: 'maestro caido' });
h = planilla([fila({ codigo: 'A1', abc: 'A' }), fila({ codigo: 'B2', abc: 'B' })]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'sin catalogo no escribe (no borra la columna F)');
eq(st.ok, false, 'reporta fallo');

// 12) Cola de filas vacías se recorta
catalogo({}, { 'A1': 'A' });
h = planilla([fila({ codigo: 'A1' }), fila({}), fila({}), fila({})]);
st = ctx.consolidarDatos(h, false);
eq(st.filas, 1, 'recorta la cola vacia de getLastRow()');

// 13) Muchos tramos dispersos -> una sola escritura de toda la columna
const muchos = {}; for (let i = 0; i < 200; i++) muchos['K' + i] = 'A';
catalogo({}, muchos);
h = planilla(Array.from({ length: 200 }, (_, i) => fila(i % 2 ? { codigo: 'K' + i, abc: 'A' } : { codigo: 'K' + i })));
ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 1, 'demasiados tramos -> escritura unica');
eq(h.escrituras[0].n, 200, 'escribe la columna completa');

t.fin();
