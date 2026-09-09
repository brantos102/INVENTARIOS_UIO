// Lectura de CRONOGRAMA_CODIGOS: detección de encabezados, filtro por cliente y
// la red de seguridad del índice por código suelto.
const { cargarScript, comprobador } = require('./_hoja_falsa.js');
const ctx = cargarScript();
const t = comprobador(), eq = t.eq;

// Hoja maestra simulada: la fila 1 son los encabezados.
function maestra(filas) {
  const get = (r, c) => { const f = filas[r - 1]; return (f && f[c - 1] !== undefined) ? f[c - 1] : ""; };
  const hoja = {
    getName: () => 'CRONOGRAMA_CODIGOS',
    getLastRow: () => filas.length,
    getLastColumn: () => Math.max.apply(null, filas.map(f => f.length)),
    getRange: (row, col, nR, nC) => ({
      getValues: () => { const o = []; for (let i = 0; i < nR; i++) { const f = []; for (let j = 0; j < nC; j++) f.push(get(row + i, col + j)); o.push(f); } return o; }
    })
  };
  ctx.SpreadsheetApp.openById = () => ({
    getSheetByName: n => (n === 'CRONOGRAMA_CODIGOS' ? hoja : null),
    getSheets: () => [hoja]
  });
  return hoja;
}

// Layout real del archivo CONTEOS CICLICOS ITSANET
maestra([
  ['CLIENTE', 'CODIGO', 'ABC', 'ENERO', 'FEBRERO'],
  ['DEGSO', '3M2091', 'A', 'X', ''],
  ['DEGSO', '3M2096', 'B', 'X', ''],
  ['OTROCLI', '3M2091', 'C', '', 'X'],   // mismo código, otra clasificación
  ['OTROCLI', 'ZZ-500', 'A', 'X', '']
]);

// --- Filtrando por DEGSO ---
let r = ctx.leerMapaDesdeHoja_(['DEGSO']);
eq(Object.keys(r.mapa).sort(), ['DEGSO|3M2091', 'DEGSO|3M2096'], 'el mapa por cliente se acota a DEGSO');
eq(r.mapa['DEGSO|3M2091'], 'A', 'DEGSO conserva su propia clasificacion');

// El índice por código NO se filtra: es la red de seguridad si el CLIENTE de la
// planilla no coincide con el del maestro. Sin esto el catálogo quedaría vacío
// y el ABC dejaría de actualizarse.
eq(r.global['3M2096'], 'B', 'el indice por codigo incluye codigos de la porcion filtrada');
eq(r.global['ZZ-500'], 'A', 'y tambien los de clientes que no se pidieron');
eq(r.global['3M2091'], undefined, 'el codigo ambiguo entre clientes se excluye del indice suelto');
eq(r.ambiguos, 1, 'reporta el codigo ambiguo');

// --- Cliente que no existe en el maestro: se avisa, no se falla en silencio ---
r = ctx.leerMapaDesdeHoja_(['HYCITE']);
eq(r.clientesSinDatos, ['HYCITE'], 'reporta el cliente ausente del maestro');
eq(r.mapa, null, 'no hay entradas por cliente para HYCITE');
eq(r.global['ZZ-500'], 'A', 'pero el indice por codigo sigue completo');

// --- Sin filtro: se carga todo ---
r = ctx.leerMapaDesdeHoja_([]);
eq(Object.keys(r.mapa).length, 4, 'sin filtro entran los cuatro pares cliente+codigo');

// --- Encabezados desplazados: se detectan por nombre, no por posición fija ---
maestra([
  ['NOTA', 'Cliente', 'Ítem', 'Clasificación'],
  ['x', 'DEGSO', 'AB-1', 'A']
]);
r = ctx.leerMapaDesdeHoja_([]);
eq([r.colCliente, r.colCodigo, r.colAbc], [2, 3, 4], 'ubica CLIENTE, ITEM y CLASIFICACION corridos una columna');
eq(r.mapa['DEGSO|AB-1'], 'A', 'lee bien con las columnas movidas');

// --- Duplicado exacto del mismo cliente con ABC distinto ---
maestra([
  ['CLIENTE', 'CODIGO', 'ABC'],
  ['DEGSO', 'AB-1', 'A'],
  ['DEGSO', 'AB-1', 'B']
]);
r = ctx.leerMapaDesdeHoja_(['DEGSO']);
eq(r.duplicados, 1, 'detecta el duplicado conflictivo del mismo cliente');

t.fin();
