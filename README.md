# INVENTARIOS_UIO

Archivo base para generación de inventarios (Google Apps Script del archivo hijo WMS).

## Contenido

| Archivo | Descripción |
|---|---|
| `Codigo.gs` | Script completo del archivo hijo: menú, triggers, blindaje de columnas, catálogo ABC, análisis, registro y medición de tiempos. |
| `docs/ANALISIS_ABC.md` | Análisis detallado del flujo de actualización ABC: fallas encontradas, causa y corrección aplicada. |
| `docs/DISPARO_POR_CONTEO.md` | Disparo automático con el conteo en V/W/X: gatillos, firma de estado y arranque del inventario (A, C, D, F). |
| `docs/INTEGRACION_TERMINAL_WMS.md` | Cómo llamar al motor desde la Terminal WMS para que el operario nunca abra el archivo real. |
| `docs/COPIAS_Y_PERMISOS.md` | Quién debe activar cada copia, con qué cuenta corren los disparadores y qué permisos hay que dar una sola vez. |
| `tests/` | Pruebas en Node del comportamiento puro del ABC (normalización, índice alterno, escritura diferencial). |

## Arranque del inventario

El inventario arranca con el **primer conteo registrado en las columnas V, W o X**,
no al activar el archivo. En ese momento se sellan automáticamente:

| Columna | Contenido |
|---|---|
| **A** | Fecha y hora del primer conteo |
| **C** | ID del inventario |
| **D** | Secuencia |
| **F** | Clasificación ABC, releída del archivo maestro |

Los conteos llegan por dos caminos, cada uno con su gatillo: la Terminal WMS
levanta `onChange` y la captura manual levanta el trigger **instalable**
`alRegistrarConteo` (sólo columnas V, W y X). Ambos entran al mismo pipeline y se
deduplican con una firma del estado, así el trabajo se hace una sola vez y las
escrituras del propio script no vuelven a disparar recálculos.

> Para que el trigger de conteo quede instalado hay que ejecutar una vez
> **⚙️ Inventarios WMS → ACTIVAR ARCHIVO** en cada archivo hijo, **con la cuenta
> del propietario**: los disparadores corren con la cuenta que los instala, así
> que es la única que necesita acceso al archivo maestro. Los operarios editores
> no autorizan ni piden nada.

Ese paso manual se elimina si la Terminal WMS llama al motor directamente después
de escribir el conteo (`actualizarInventario(idArchivo)`): sin triggers y sin
activación. Ver `docs/INTEGRACION_TERMINAL_WMS.md`.

## Actualización del ABC (columna F)

El catálogo sale de `CRONOGRAMA_CODIGOS` (archivo *CONTEOS CICLICOS ITSANET*), que es
la **fuente única**. Se resuelve por **CLIENTE + CÓDIGO**: el mismo código puede tener
distinta clasificación según el cliente.

Orden de resolución del catálogo:

```
caché comprimida  →  hoja maestra CRONOGRAMA_CODIGOS  →  snapshot local
```

El respaldo `ABC2026.txt` viene **desactivado** (`ABC_CFG.USAR_TXT_FALLBACK`): con el
maestro accesible no aporta nada y ahorra una búsqueda en Drive por cada relectura.
Activarlo sólo si ese archivo tiene clasificaciones que el maestro no tenga.

* Los conteos usan caché o snapshot: no abren el archivo maestro en cada captura.
* El archivo maestro se relee con el **primer conteo** y luego cada
  `ABC_CFG.REFRESCO_MIN` minutos (por defecto 60) **mientras haya actividad**; los botones
  **Actualizar ABC** y **Forzar TODO** lo releen siempre.
* En la columna F sólo se escriben las celdas que realmente cambian.
* Un código que no está en el catálogo **no borra** la clasificación previa: se reporta en
  **⚙️ Inventarios WMS → Diagnóstico ABC**.
* Los productos de **HYCITE** que no aparecen en ningún catálogo se clasifican como **C**
  (`ABC_CFG.ABC_POR_DEFECTO`); los que sí están clasificados conservan su letra real.

Todo lo ajustable está en la constante `ABC_CFG`, al inicio de `Codigo.gs`.

## Pruebas

```bash
node tests/test_abc.js         # normalización, índice alterno, cobertura por cliente
node tests/test_consolidar.js  # columna F: resolución por cliente y escritura diferencial
node tests/test_disparo.js     # firma de estado, arranque del inventario y gatillos
node tests/test_catalogo.js    # lectura de CRONOGRAMA_CODIGOS y filtro por cliente
node tests/test_columnas.js    # columnas A, C y D: replicación sin reescribir de más
node tests/test_api.js         # actualizarInventario() y aislamiento entre inventarios
node tests/test_auditoria.js   # REGISTRO con varios operarios contando a la vez
node tests/test_accesos.js     # verificación de accesos al catálogo por cuenta
```

Cargan `Codigo.gs` en un contexto aislado con los servicios de Google simulados, por lo que
verifican la lógica pura sin necesidad de conectarse a Google.
