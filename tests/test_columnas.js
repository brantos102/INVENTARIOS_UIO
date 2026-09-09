// Columnas administradas por el sistema: A (fecha inicio), C (ID) y D (secuencia).
// Se comprueba que se completen las filas nuevas sin reescribir ni borrar nada más.
const { hojaFalsa, fila, cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

const planilla = (filas) => hojaFalsa('PLANILLA DE CONTEO FISICO', filas);
const colA = h => h.datos.map(f => f[0]);
const colC = h => h.datos.map(f => f[2]);
const colD = h => h.datos.map(f => f[3]);

// --- actualizarColumnasAC: replica A2 y C2 sólo a las filas CON código ---
let h = planilla([
  fila({ codigo: 'A1' }),   // fila 2 (cabecera de datos: A2/C2 se llenan aparte)
  fila({ codigo: 'B2' }),   // fila 3
  fila({}),                 // fila 4 sin código
  fila({ codigo: 'C3' })    // fila 5
]);
h.getRange('A2').setValue('01/01/2026');
h.getRange('C2').setValue('INV-01');
h.escrituras.length = 0;
let celdas = ctx.actualizarColumnasAC(h);
eq(colA(h), ['01/01/2026', '01/01/2026', '', '01/01/2026'], 'A se replica solo a filas con codigo');
eq(colC(h), ['INV-01', 'INV-01', '', 'INV-01'], 'C se replica solo a filas con codigo');
eq(celdas, 4, 'cuenta las celdas escritas');

// --- Segunda corrida: no reescribe nada ---
h.escrituras.length = 0;
eq(ctx.actualizarColumnasAC(h), 0, 'sin cambios no escribe');
eq(h.escrituras.length, 0, 'ninguna llamada de escritura');

// --- Fila nueva de la Terminal: se completa sólo esa ---
h.getRange(6, 7).setValue('D4');
h.escrituras.length = 0;
ctx.actualizarColumnasAC(h);
eq(h.escrituras.map(e => [e.row, e.col, e.n]), [[6, 1, 1], [6, 3, 1]], 'solo escribe la fila nueva');
eq(h.datos[4][0], '01/01/2026', 'la fila nueva recibe la fecha de inicio');
eq(h.datos[4][2], 'INV-01', 'la fila nueva recibe el ID');

// --- Nunca borra un valor ya escrito en una fila sin código ---
h.getRange(4, 1).setValue('DATO MANUAL');
h.escrituras.length = 0;
ctx.actualizarColumnasAC(h);
eq(h.datos[2][0], 'DATO MANUAL', 'no borra lo escrito en filas sin codigo');

// --- Con A2 vacía sólo se replica C (y viceversa) ---
h = planilla([fila({ codigo: 'A1' }), fila({ codigo: 'B2' })]);
h.getRange('C2').setValue('INV-02');
ctx.actualizarColumnasAC(h);
eq(colA(h), ['', ''], 'sin fecha de inicio la columna A no se toca');
eq(colC(h), ['INV-02', 'INV-02'], 'la columna C si se replica');

// --- generarSecuenciaColumnaD ---
h = planilla([fila({ codigo: 'A1' }), fila({}), fila({ codigo: 'B2' }), fila({ codigo: 'C3' })]);
eq(ctx.generarSecuenciaColumnaD(h), 3, 'numera solo las filas con codigo');
eq(colD(h), [1, '', 2, 3], 'secuencia continua saltando las filas vacias');

h.escrituras.length = 0;
eq(ctx.generarSecuenciaColumnaD(h), 0, 'la secuencia no se reescribe en cada conteo');

h.getRange(6, 7).setValue('D4');
h.escrituras.length = 0;
ctx.generarSecuenciaColumnaD(h);
eq(h.escrituras.map(e => [e.row, e.n]), [[6, 1]], 'la fila nueva agrega solo su numero');
eq(colD(h), [1, '', 2, 3, 4], 'la secuencia continua');

t.fin();
