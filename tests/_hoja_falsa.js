// Hoja de cálculo simulada: suficiente para ejercitar la lógica del script sin
// conectarse a Google. Las filas de datos empiezan en la 2 (la 1 es encabezado).
function hojaFalsa(nombre, matriz) {
  const escrituras = [];
  const datos = (matriz || []).map(r => r.slice());
  const get = (r, c) => { const f = datos[r - 2]; return (f && f[c - 1] !== undefined) ? f[c - 1] : ""; };
  const set = (r, c, v) => {
    while (datos.length < r - 1) datos.push([]);
    const f = datos[r - 2];
    while (f.length < c) f.push("");
    f[c - 1] = v;
  };
  function rango(row, col, nR, nC) {
    const r = {
      getValue: () => get(row, col),
      setValue: (v) => { set(row, col, v); escrituras.push({ row, col, n: 1 }); return r; },
      getValues: () => { const o = []; for (let i = 0; i < nR; i++) { const f = []; for (let j = 0; j < nC; j++) f.push(get(row + i, col + j)); o.push(f); } return o; },
      setValues: (vals) => { vals.forEach((f, i) => f.forEach((v, j) => set(row + i, col + j, v)));
        escrituras.push({ row, col, n: vals.length, cols: vals[0] ? vals[0].length : 0 }); return r; },
      setNumberFormat: () => r,
      getSheet: () => hoja
    };
    return r;
  }
  const hoja = {
    nombre, escrituras, datos,
    getName: () => nombre,
    getLastRow: () => datos.length + 1,
    getRange: function (a, b, c, d) {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
        const r1 = parseInt(m[2], 10), c1 = m[1].charCodeAt(0) - 64;
        const r2 = m[4] ? parseInt(m[4], 10) : r1, c2 = m[3] ? m[3].charCodeAt(0) - 64 : c1;
        return rango(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
      return rango(a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
    }
  };
  return hoja;
}

// Fila de la planilla por número de columna (E=5 cliente, F=6 abc, G=7 codigo,
// V=22, W=23, X=24 conteos).
function fila(o) {
  const f = new Array(24).fill("");
  if (o.cliente !== undefined) f[4] = o.cliente;
  if (o.abc !== undefined) f[5] = o.abc;
  if (o.codigo !== undefined) f[6] = o.codigo;
  if (o.v !== undefined) f[21] = o.v;
  if (o.w !== undefined) f[22] = o.w;
  if (o.x !== undefined) f[23] = o.x;
  return f;
}

function cargarScript() {
  const fs = require('fs'), vm = require('vm');
  const src = fs.readFileSync(__dirname + '/../Codigo.gs', 'utf8');
  const ctx = { console, Utilities: {}, SpreadsheetApp: {}, CacheService: {}, DriveApp: {},
                PropertiesService: {}, LockService: {}, Session: {}, ScriptApp: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  // Las constantes declaradas con const no quedan como propiedades del global:
  // para leerlas hay que evaluar dentro del contexto.
  ctx.evaluar = expr => vm.runInContext(expr, ctx);
  return ctx;
}

function comprobador() {
  const est = { fallos: 0 };
  est.eq = (a, b, msg) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (!ok) { est.fallos++; console.log('FALLO:', msg, '→', JSON.stringify(a), '!=', JSON.stringify(b)); }
    else console.log('ok  ', msg);
  };
  est.fin = () => { console.log(est.fallos ? '\n' + est.fallos + ' FALLOS' : '\nTODAS LAS PRUEBAS OK'); process.exit(est.fallos ? 1 : 0); };
  return est;
}

module.exports = { hojaFalsa, fila, cargarScript, comprobador };
