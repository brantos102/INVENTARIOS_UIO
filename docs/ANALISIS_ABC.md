# Análisis minucioso de la actualización ABC (columna F)

Documento de diagnóstico del flujo `obtenerMapaABC()` → `consolidarDatos()` y de los
cambios aplicados en `Codigo.gs`.

---

## 1. Cómo funciona hoy (flujo real)

```
onChange / onEdit  ──► manejadorCambiosExternos()
                          └─► consolidarDatos(sheet)
                                ├─► obtenerMapaABC(false)
                                │     ├─ cache.get('WMS_ABC_MAP')
                                │     ├─ leerMapaDesdeHoja()  → openById(MAESTRO) + getRange(B:C)
                                │     └─ leerMapaDesdeTxt()   → DriveApp.getFilesByName('ABC2026.txt')
                                └─► setValues() de TODA la columna F (fila 2 → última)
```

`rutinaDeFondoMaestra()` (cada 30 min) llama a `consolidarDatos()` sin hoja y sin forzar.

---

## 2. Hallazgos, por orden de impacto

### 🔴 A. La caché nunca funciona con catálogos grandes → se relee el maestro en CADA conteo

`CacheService` tiene un **límite duro de 100 KB por clave**. El catálogo se guarda como
JSON plano:

```js
cache.put('WMS_ABC_MAP', JSON.stringify(mapa), 1800);
```

Con ~4.000 códigos ya se superan los 100 KB (`"1234567890":"A",` ≈ 20-25 bytes por código).
`put()` lanza excepción, pero está dentro de un `try{}catch(e){}` **vacío**: falla en
silencio. Consecuencia real:

* En cada evento (`onChange`, cada conteo enviado por la Terminal) se ejecuta
  `SpreadsheetApp.openById()` del archivo maestro **+** un `DriveApp.getFilesByName()`.
* Eso son ~2-5 segundos extra por conteo, y consumo de cuota de Drive/Sheets.
* Es la causa más probable de "el ABC tarda en aparecer" y de ejecuciones que se cruzan.

**Corregido:** compresión gzip + Base64 y **troceado en varias claves de caché**
(`WMS_ABC_MAP_V2:0..n`). Un catálogo de 20.000 códigos baja a unos pocos KB comprimido.

### 🔴 B. No hay respaldo local: si el maestro no se puede abrir, el ABC deja de actualizarse

`leerMapaDesdeHoja()` devuelve `null` ante cualquier error (permisos, cuota, archivo
movido) y `consolidarDatos()` hace `return` silencioso. El operario no ve nada y la
columna F se queda como esté.

**Corregido:** hoja oculta `_ABC_SNAPSHOT` con el último catálogo bueno (comprimido).
Si el maestro y el TXT fallan, se trabaja con el snapshot y se informa la fuente y su
antigüedad. El sistema deja de depender de la red en cada conteo.

### 🔴 C. Se reescribe la columna F completa en cada evento (y eso re-dispara `onChange`)

```js
sheet.getRange(2, 6, vals.length, 1).setValues(vals);
```

Con 5.000 filas son 5.000 celdas escritas por cada conteo, aunque no cambie nada.
Además, **una escritura de script vuelve a disparar el `onChange` instalable**
(`changeType: 'OTHER'`) → `manejadorCambiosExternos` se ejecuta otra vez → vuelve a
escribir. El `LockService.tryLock(2000)` **no** evita esto porque la segunda ejecución
llega *después* de que la primera liberó el lock: no es concurrencia, es reentrada.

**Corregido:** escritura **diferencial**. Se compara F actual contra F calculada y solo
se escriben los tramos contiguos que cambiaron (y si no cambió nada, no se escribe →
la cadena de eventos se corta sola en la segunda pasada).

### 🟠 D. Un código que no está en el catálogo **borra** el ABC que ya existía

```js
.map(r => [mapa[String(r[0]).trim()] || ""])
```

Cualquier código sin match escribe `""` sobre la celda. Si el maestro se leyó a medias,
si un código nuevo aún no está cargado, o si el TXT complementario no se pudo abrir,
se pierde el ABC previo de esas filas de forma irreversible.

**Corregido:** `ABC_CFG.PRESERVAR_SIN_MATCH = true` conserva el valor existente cuando no
hay match y lo cuenta como `sinAbc` para el diagnóstico. Solo se limpian las filas cuyo
código (columna G) esté vacío.

### 🟠 E. Normalización de códigos inconsistente → falsos "sin ABC"

`String(fila[0]).trim()` no cubre los casos reales de Sheets:

| Caso | Maestro | Planilla | Resultado hoy |
|---|---|---|---|
| Código numérico | número `12345` | texto `"12345"` | coincide por casualidad |
| Ceros a la izquierda | texto `"00123"` | número `123` | **no coincide** |
| Número largo/decimal | `12345.0` | `"12345"` | **no coincide** |
| Minúsculas | `"ab-100"` | `"AB-100"` | **no coincide** |
| Espacio duro (NBSP) al pegar desde el WMS | `"1234 "` | `"1234"` | **no coincide** |

**Corregido:** `normalizarCodigo_()` — quita NBSP y caracteres invisibles, recorta,
pasa a mayúsculas y elimina el `.0` que Sheets agrega a los numéricos. Además se
construye un **índice alterno** sin ceros a la izquierda, usado solo como respaldo y
solo cuando la clave alterna es única (evita colisiones).

### 🟠 F. `DriveApp.getFilesByName('ABC2026.txt')` es frágil y caro

Busca por nombre en **todo el Drive** del usuario: puede haber duplicados (papelera,
copias compartidas) y toma el primero que aparezca, sin criterio. Además exige alcance
amplio de Drive.

**Corregido:** se usa `ABC_TXT_FALLBACK_ID` (ID directo) si está configurado; la
búsqueda por nombre queda como último recurso, ignorando archivos en la papelera y
avisando si hay más de uno.

### 🟡 G. Columnas del maestro fijadas a mano (B y C)

`getRange(2, 2, lr-1, 2)` asume para siempre CODIGO=B y ABC=C. Si alguien inserta una
columna en `CRONOGRAMA_CODIGOS`, el ABC se llena con datos equivocados **sin ningún
error**: el peor tipo de falla, porque es silenciosa.

**Corregido:** se detectan los encabezados por nombre (`CODIGO`/`ITEM`/`SKU` y
`ABC`/`CLASIFICACION`, sin acentos ni mayúsculas) y se cae a B/C solo si no se encuentran.
También se tolera que la hoja se llame distinto si contiene "CRONOGRAMA".

### 🟡 H. Duplicados en el maestro: gana el último, en silencio

`mapa[cod] = abc` sobrescribe. Si un código aparece dos veces con ABC distinto, nadie se
entera.

**Corregido:** se cuentan los conflictos y se guardan ejemplos, visibles en
`Diagnóstico ABC`.

### 🟡 I. El botón "Actualizar ABC" siempre dice que funcionó

```js
function actualizarABCManual() {
  consolidarDatos(null, true);
  ...toast("ABC actualizado ...");   // aunque no se haya leído nada
}
```

**Corregido:** `consolidarDatos()` devuelve estadísticas y el toast informa fuente,
códigos del catálogo, celdas actualizadas y filas sin ABC. Se agregó el menú
**Diagnóstico ABC** con el detalle completo (fuente, antigüedad, duplicados, ejemplos
de códigos sin clasificar).

### 🟡 J. Sin caché negativa ni control de versión de caché

Al cambiar el formato del payload, una caché vieja podría deserializarse mal. Ahora el
payload lleva `v` (versión) y la clave incluye `_V2`; un payload de versión distinta se
descarta.

### ⚪ K. Detalles menores

* `obtenerMapaABC(forzar)` con `forzar=true` borraba una sola clave; con troceado hay que
  borrar todas (`:n` + `:0..n-1`). Resuelto en `abcCacheBorrar_()`.
* `getLastRow()` de la hoja puede exceder las filas con datos reales en G; ahora se
  recorta la cola vacía antes de escribir.
* `consolidarDatos()` no distinguía "catálogo vacío" de "catálogo no disponible";
  ahora `stats.ok` y `stats.mensaje` lo separan.

---

## 3. Resumen del efecto esperado

| | Antes | Después |
|---|---|---|
| Lecturas del maestro por conteo | 1 `openById` + 1 búsqueda en Drive | 0 (caché/snapshot); 1 cada 30 min |
| Celdas escritas en F por conteo | todas las filas | solo las que cambian (normalmente 1) |
| Maestro inaccesible | ABC deja de actualizarse, sin aviso | usa snapshot local + avisa |
| Código sin catálogo | borra el ABC previo | lo conserva y lo reporta |
| Columna movida en el maestro | ABC incorrecto silencioso | detección por encabezado |
| Visibilidad para el operario | "ABC actualizado" siempre | estadísticas reales + diagnóstico |

---

## 4. Resuelto después de este análisis

* **Reentrada de `onChange`** (punto 1 de los pendientes): resuelto con la firma de
  estado en `ScriptProperties`. Ver `DISPARO_POR_CONTEO.md`.
* **Colisión de códigos entre clientes**: el catálogo se indexa por `CLIENTE|CODIGO`.
  El maestro `CRONOGRAMA_CODIGOS` tiene la columna CLIENTE y el mismo código puede
  repetirse con otra clasificación; buscar sólo por código devolvía el ABC del último
  cliente cargado. Ver `DISPARO_POR_CONTEO.md`, sección 3.

## 5. Pendiente de decisión (no aplicado)
1. **`PRESERVAR_SIN_MATCH`.** Está en `true`. Si se prefiere que un código retirado del
   catálogo quede en blanco o marcado (`"SIN ABC"`), se cambia la constante en
   `ABC_CFG` — está aislada a propósito.
2. **Alcance del índice alterno** (ceros a la izquierda). Si los códigos del negocio
   nunca llevan ceros a la izquierda, conviene desactivarlo (`USAR_INDICE_ALTERNO`).
