const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('' + __dirname + '/../Codigo.gs', 'utf8');
const ctx = { console, Utilities:{}, SpreadsheetApp:{}, CacheService:{}, DriveApp:{},
              PropertiesService:{}, LockService:{}, Session:{}, ScriptApp:{} };
vm.createContext(ctx); vm.runInContext(src, ctx);

// Hoja falsa: matriz [F, G] por fila (fila 1 = encabezado, datos desde la 2)
function hojaFalsa(filas) {
  const escrituras = [];
  const datos = filas.map(f => f.slice());   // [F, G]
  return {
    escrituras, datos,
    getLastRow: () => datos.length + 1,
    getRange(row, col, n) {
      const off = row - 2;
      return {
        getValues: () => { const out=[]; for(let i=0;i<n;i++) out.push([datos[off+i] ? datos[off+i][col===6?0:1] : ""]); return out; },
        setValues: (vals) => { escrituras.push({row, col, n: vals.length});
          vals.forEach((v,i)=>{ if(!datos[off+i]) datos[off+i]=["",""]; datos[off+i][col===6?0:1]=v[0]; }); }
      };
    }
  };
}
const catalogo = (mapa) => { ctx.obtenerCatalogoABC_ = () => ({ mapa, alt: ctx.construirIndiceAlterno_(mapa), meta:{}, ts:Date.now(), origen:'TEST' }); };

let fallos=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);
  if(!ok){fallos++;console.log('FALLO:',m,'→',JSON.stringify(a),'!=',JSON.stringify(b));}else console.log('ok  ',m);};

// 1) Sin cambios -> NINGUNA escritura (antes reescribía toda la columna en cada evento)
catalogo({'A1':'A','B2':'B'});
let h = hojaFalsa([['A','A1'],['B','B2']]);
let st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'sin cambios no escribe nada');
eq(st.celdas, 0, 'contador de celdas en 0');

// 2) Una sola celda nueva -> una escritura de 1 celda
h = hojaFalsa([['A','A1'],['','B2']]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras, [{row:3,col:6,n:1}], 'escribe solo la celda que cambio');
eq(h.datos[1][0], 'B', 'valor correcto en F3');

// 3) Tramos contiguos: filas 2-3 cambian, fila 5 cambia -> 2 escrituras
catalogo({'A1':'A','B2':'B','C3':'C','D4':'D'});
h = hojaFalsa([['','A1'],['','B2'],['C','C3'],['','D4']]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras, [{row:2,col:6,n:2},{row:5,col:6,n:1}], 'agrupa tramos contiguos');
eq(st.celdas, 3, 'cuenta 3 celdas cambiadas');

// 4) Código sin catálogo NO borra el ABC existente (PRESERVAR_SIN_MATCH)
catalogo({'A1':'A'});
h = hojaFalsa([['A','A1'],['B','ZZZ9']]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'no borra el ABC de un codigo ausente del catalogo');
eq(h.datos[1][0], 'B', 'conserva la clasificacion previa');
eq(st.sinAbc, 1, 'lo reporta como sinAbc');
eq(st.sinAbcEjemplos, ['ZZZ9'], 'guarda el ejemplo para diagnostico');

// 5) Fila sin código -> F se limpia
catalogo({'A1':'A'});
h = hojaFalsa([['A','A1'],['B','']]);
st = ctx.consolidarDatos(h, false);
eq(h.datos[1][0], '', 'limpia F cuando no hay codigo en G');

// 6) Ceros a la izquierda: catálogo con texto, planilla con número
catalogo({'00123':'A'});
h = hojaFalsa([['', 123]]);
st = ctx.consolidarDatos(h, false);
eq(h.datos[0][0], 'A', 'indice alterno resuelve ceros a la izquierda');

// 7) Código numérico con .0 y minúsculas
catalogo({'AB-100':'C'});
h = hojaFalsa([['', ' ab-100 ']]);
ctx.consolidarDatos(h, false);
eq(h.datos[0][0], 'C', 'normaliza espacios y mayusculas');

// 8) Catálogo no disponible -> no toca nada y avisa
ctx.obtenerCatalogoABC_ = () => ({ mapa:null, alt:{}, meta:{}, ts:0, origen:'NINGUNA', error:'maestro caido' });
h = hojaFalsa([['A','A1'],['B','B2']]);
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 0, 'sin catalogo no escribe (no borra la columna F)');
eq(st.ok, false, 'reporta fallo');

// 9) Cola de filas vacías se recorta (no se escriben miles de celdas de relleno)
catalogo({'A1':'A'});
h = hojaFalsa([['','A1'],['',''],['',''],['','']]);
st = ctx.consolidarDatos(h, false);
eq(st.filas, 1, 'recorta la cola vacia de getLastRow()');

// 10) Muchos tramos dispersos -> una sola escritura de toda la columna
catalogo(Object.fromEntries(Array.from({length:200},(_,i)=>['K'+i, 'A'])));
h = hojaFalsa(Array.from({length:200},(_,i)=> i%2 ? ['A','K'+i] : ['','K'+i]));
st = ctx.consolidarDatos(h, false);
eq(h.escrituras.length, 1, 'demasiados tramos -> escritura unica');
eq(h.escrituras[0].n, 200, 'escribe la columna completa');

console.log(fallos ? '\n'+fallos+' FALLOS' : '\nTODAS LAS PRUEBAS OK');
process.exit(fallos?1:0);
