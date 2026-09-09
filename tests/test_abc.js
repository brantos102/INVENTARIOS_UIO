const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('' + __dirname + '/../Codigo.gs', 'utf8');
const ctx = { console, Utilities: {}, SpreadsheetApp: {}, CacheService: {}, DriveApp: {},
              PropertiesService: {}, LockService: {}, Session: {}, ScriptApp: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);

let fallos = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fallos++; console.log('FALLO:', msg, '→', JSON.stringify(a), '!=', JSON.stringify(b)); }
  else console.log('ok  ', msg); };

// --- normalizarCodigo_ ---
eq(ctx.normalizarCodigo_('  ab-100 '), 'AB-100', 'trim + mayusculas');
eq(ctx.normalizarCodigo_(12345), '12345', 'numero -> texto');
eq(ctx.normalizarCodigo_('12345.0'), '12345', 'quita .0 de Sheets');
eq(ctx.normalizarCodigo_('1234 '), '1234', 'NBSP al final');
eq(ctx.normalizarCodigo_('﻿1234'), '1234', 'BOM al inicio');
eq(ctx.normalizarCodigo_(''), '', 'vacio');
eq(ctx.normalizarCodigo_(null), '', 'null');
eq(ctx.normalizarCodigo_(0), '0', 'cero no se pierde');
eq(ctx.normalizarCodigo_('00123'), '00123', 'conserva ceros a la izquierda');

// --- claveAlterna_ ---
eq(ctx.claveAlterna_('00123'), '123', 'clave alterna sin ceros');
eq(ctx.claveAlterna_('AB-100'), 'AB-100', 'alfanumerico intacto');
eq(ctx.claveAlterna_('0'), '0', 'un solo cero intacto');

// --- normalizarABC_ / encabezados ---
eq(ctx.normalizarABC_(' a '), 'A', 'abc normalizado');
eq(ctx.normalizarEncabezado_('Clasificación'), 'CLASIFICACION', 'encabezado sin acentos');
eq(ctx.normalizarEncabezado_(' CÓDIGO '), 'CODIGO', 'encabezado codigo');

// --- indice alterno con colision ---
eq(ctx.construirIndiceAlterno_({'00123':'A','000123':'A','0055':'B'}),
   {'123':'A','55':'B'}, 'alterno consistente se conserva');
eq(ctx.construirIndiceAlterno_({'00123':'A','000123':'C'}), {}, 'colision descartada');

// --- troceo / compresion base64 (sin gzip real) ---
eq(ctx.trocear_('abcdefg', 3), ['abc','def','g'], 'troceo');
eq(ctx.trocear_('', 3), [], 'troceo vacio');

console.log(fallos ? '\n' + fallos + ' FALLOS' : '\nTODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);
