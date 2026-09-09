# Disparo automático por conteo (columnas V, W, X)

Requerimiento: **el primer conteo registrado debe arrancar el inventario** —
actualizar el ABC, escribir el ID en la columna C, la secuencia en la D y la
fecha de inicio en la A — y los conteos siguientes deben mantener todo al día
sin recalcular de más.

---

## 1. Cómo estaba

```
onChange (cualquier cambio del archivo) ──► manejadorCambiosExternos()
                                              └─► TODO el recálculo, siempre
onEdit simple (V,W,X) ──► registrarAccionManual() + manejadorCambiosExternos()
```

Problemas concretos:

| # | Problema | Efecto |
|---|---|---|
| 1 | `onChange` **no dice qué cambió**. Se recalculaba todo ante *cualquier* cambio: pegar una nota, ordenar, incluso las escrituras del propio script. | Recálculo completo decenas de veces por conteo. |
| 2 | Las escrituras del script vuelven a disparar `onChange` (`changeType: 'OTHER'`). El `tryLock(2000)` no lo evita: no es concurrencia, es **reentrada** (la segunda ejecución llega cuando el lock ya se liberó). | Bucle de eventos que se realimenta. |
| 3 | La **fecha de inicio (A2)** se escribía en `verificarConfiguracionInicial()`, que corre al **activar el archivo**. | El inventario "empezaba" el día de la activación, aunque el primer conteo llegara días después. |
| 4 | El conteo digitado a mano corría por el **`onEdit` simple**, que se ejecuta **sin autorización**: no puede hacer `openById()` del archivo maestro. | La actualización del ABC fallaba justo en las capturas manuales. |
| 5 | No existía el concepto de "primer conteo": nada distinguía el arranque del inventario de un conteo cualquiera. | — |

---

## 2. Cómo queda

Los conteos llegan por dos caminos y **cada uno necesita su gatillo**:

```
Terminal WMS (otro script escribe)  ──► onChange  ──┐
                                                    ├──► procesarConteo_()  ──► ejecutarPipeline_()
Operario digitando en la hoja       ──► onEdit   ──┘        (lock)                 (el trabajo)
                                        INSTALABLE
```

* **`onChange`** es el único evento que levanta una escritura hecha por otro
  script: la Terminal WMS. No trae rango, así que el filtro es la firma (abajo).
* **`alRegistrarConteo`** es un trigger **instalable** de `onEdit`. Instalable a
  propósito: corre **con autorización**, así la captura manual sí puede leer el
  archivo maestro del ABC. Sólo reacciona a las columnas **V, W y X**.
* El `onEdit` simple conserva únicamente el blindaje de columnas y la auditoría,
  y llama al pipeline como red de seguridad por si el archivo aún no fue activado.

### La firma de estado

```js
firma = <conteos en V:X> | <última fila con conteo> | <filas de REGISTRO>
```

Se guarda en `ScriptProperties` después de cada corrida. Si al entrar la firma
es idéntica, **no se recalcula nada**. Esto resuelve tres cosas de una vez:

1. Los eventos que generan las **propias escrituras del script** se descartan
   (la firma no cambia porque el script no escribe en V:X ni en REGISTRO) → se
   corta el bucle de reentrada.
2. Los cambios **ajenos a los conteos** (formato, notas, otras hojas) ya no
   disparan recálculo.
3. `onChange` y `onEdit` disparan a la vez ante una captura manual: el primero
   que entra hace el trabajo y el segundo sale por la firma. **Deduplicación sin
   depender del orden de ejecución.**

### El arranque del inventario

Con el **primer conteo** (`conteos > 0` y `WMS_INVENTARIO_INICIADO` sin marcar),
`marcarInicioInventario_()` sella de una sola vez:

| Columna | Qué se escribe | Regla |
|---|---|---|
| **A** | Fecha y hora del **primer conteo real** | Sólo si está vacía |
| **C** | ID del inventario (`CONTEO_CFG.ID_MODO`) | Sólo si está vacía |
| **D** | Secuencia, según los códigos de la columna G | Siempre se regenera |
| **F** | ABC **releído del archivo maestro** (`forzar = true`) | Escritura diferencial |

Después se propagan A y C hacia abajo y queda marcado el arranque. En los
conteos siguientes el catálogo sale de caché y no se vuelve a tocar A ni C.

**Compatibilidad:** en los archivos que ya vienen trabajando, A2 y C2 nunca se
pisan — si ya tienen valor, se respetan tal cual.

---

## 3. Optimización del ABC contra CRONOGRAMA_CODIGOS

La hoja maestra tiene esta forma:

| A | B | C | D… |
|---|---|---|---|
| CLIENTE | CODIGO | ABC | ENERO, FEBRERO, … (X del cronograma) |
| DEGSO | 3M2091 | A | X |

Dos consecuencias que el código anterior no contemplaba:

**a) El código solo no identifica una clasificación.** El mapa se armaba con
`mapa[CODIGO] = ABC`, así que si `3M2091` existe para dos clientes con ABC
distinto, **ganaba el último leído** y el otro cliente recibía una clasificación
ajena, en silencio. Ahora el catálogo se indexa por `CLIENTE|CODIGO` y la
búsqueda es:

```
1) CLIENTE|CODIGO          (columna E de la planilla + columna G)
2) CODIGO                  (sólo si TODOS los clientes coinciden en el ABC)
3) CODIGO sin ceros a la izquierda
4) conservar lo que ya tenía la celda   → se reporta como "sin ABC"
```

Un código ambiguo entre clientes se **excluye** del índice por código suelto: es
preferible dejar la celda como está a escribir el ABC de otro cliente.

**b) Sólo hace falta la porción del maestro que este inventario usa.** El
catálogo se filtra por los clientes presentes en la columna E de la planilla, así
que lo que se comprime y se cachea son unos pocos miles de códigos en vez de todo
el maestro. Si aparece un cliente que no estaba en el catálogo guardado
(`cubreClientes_`), se relee automáticamente.

Además, `consolidarDatos()` ahora hace **una sola lectura** del rango E:G en vez
de dos lecturas separadas de F y G.

---

## 4. Qué se recalcula en cada caso

| Evento | ¿Recalcula? | ABC |
|---|---|---|
| Primer conteo en V/W/X | Sí, + sella A, C y D | Relee el maestro |
| Conteo siguiente | Sí | Desde caché |
| Escritura del propio script | **No** (firma igual) | — |
| Formato, notas, otras hojas | **No** (firma igual) | — |
| Rutina de fondo (30 min, activo) | Sí | Relee el maestro |
| Sin conteos en 3 h | Pausa | — |
| Menú "Forzar TODO" / "Actualizar ABC" | Sí, ignora la firma | Relee el maestro |

---

## 5. Para que tome efecto

El trigger instalable de `onEdit` **no existe en los archivos ya activados**. En
cada archivo hijo hay que ejecutar una vez:

**⚙️ Inventarios WMS → ACTIVAR ARCHIVO**

Esa opción borra los triggers viejos y deja los tres: `onChange`,
`alRegistrarConteo` (onEdit instalable) y la rutina de fondo cada 30 minutos.
