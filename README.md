# INVENTARIOS_UIO

Archivo base para generación de inventarios (Google Apps Script del archivo hijo WMS).

## Contenido

| Archivo | Descripción |
|---|---|
| `Codigo.gs` | Script completo del archivo hijo: menú, triggers, blindaje de columnas, catálogo ABC, análisis, registro y medición de tiempos. |
| `docs/ANALISIS_ABC.md` | Análisis detallado del flujo de actualización ABC: fallas encontradas, causa y corrección aplicada. |
| `docs/DISPARO_POR_CONTEO.md` | Disparo automático con el conteo en V/W/X: gatillos, firma de estado y arranque del inventario (A, C, D, F). |
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
> **⚙️ Inventarios WMS → ACTIVAR ARCHIVO** en cada archivo hijo.

## Actualización del ABC (columna F)

El catálogo sale de `CRONOGRAMA_CODIGOS` (archivo *CONTEOS CICLICOS ITSANET*) y se
resuelve por **CLIENTE + CÓDIGO**: el mismo código puede tener distinta
clasificación según el cliente. Sólo se carga la porción del maestro
correspondiente a los clientes presentes en la columna E de la planilla.

Orden de resolución del catálogo:

```
caché comprimida (30 min)  →  hoja maestra CRONOGRAMA_CODIGOS + ABC2026.txt  →  snapshot local
```

* Los conteos usan caché o snapshot: no abren el archivo maestro en cada captura.
* Releen las fuentes sólo el **primer conteo** del inventario, la rutina de fondo (cada
  30 min) y los botones **Actualizar ABC** y **Forzar TODO**.
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
```

Cargan `Codigo.gs` en un contexto aislado con los servicios de Google simulados, por lo que
verifican la lógica pura sin necesidad de conectarse a Google.
