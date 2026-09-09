# INVENTARIOS_UIO

Archivo base para generación de inventarios (Google Apps Script del archivo hijo WMS).

## Contenido

| Archivo | Descripción |
|---|---|
| `Codigo.gs` | Script completo del archivo hijo: menú, triggers, blindaje de columnas, catálogo ABC, análisis, registro y medición de tiempos. |
| `docs/ANALISIS_ABC.md` | Análisis detallado del flujo de actualización ABC: fallas encontradas, causa y corrección aplicada. |
| `tests/` | Pruebas en Node del comportamiento puro del ABC (normalización, índice alterno, escritura diferencial). |

## Actualización del ABC (columna F)

Orden de resolución del catálogo:

```
caché comprimida (30 min)  →  hoja maestra CRONOGRAMA_CODIGOS + ABC2026.txt  →  snapshot local
```

* Los eventos de conteo (`onChange`) usan **siempre** caché o snapshot: no abren el archivo maestro.
* La rutina de fondo (cada 30 min) es la única que relee las fuentes, igual que el botón
  **Actualizar ABC** y **Forzar TODO**.
* En la columna F sólo se escriben las celdas que realmente cambian.
* Un código que no está en el catálogo **no borra** la clasificación previa: se reporta en
  **⚙️ Inventarios WMS → Diagnóstico ABC**.

Todo lo ajustable está en la constante `ABC_CFG`, al inicio de `Codigo.gs`.

## Pruebas

```bash
node tests/test_abc.js
node tests/test_consolidar.js
```

Cargan `Codigo.gs` en un contexto aislado con los servicios de Google simulados, por lo que
verifican la lógica pura sin necesidad de conectarse a Google.
