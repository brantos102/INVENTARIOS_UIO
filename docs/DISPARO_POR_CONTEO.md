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

### ¿Hay que modificar la Terminal WMS?

**No. La Terminal WMS no se toca.** Sigue siendo la interfaz del operario y sigue
escribiendo en la hoja exactamente igual que hoy.

`onChange` es un disparador del **archivo de Google Sheets**, no de la Terminal:
Google lo levanta solo cada vez que el contenido de la hoja cambia, sin importar
quién lo cambió. Cuando la Terminal escribe un conteo, Google dispara el evento y
el script reacciona. La Terminal no sabe —ni necesita saber— que el gatillo existe.

Lo único que hace falta es que el archivo hijo tenga los triggers instalados
(**⚙️ Inventarios WMS → ACTIVAR ARCHIVO**, una sola vez por archivo).

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
pisan — si ya tienen valor, se respetan tal cual. El ABC, en cambio, **sí se
actualiza siempre**: que A y C estén escritas no impide que la columna F se
recalcule.

### Columnas A y C: propagación y protección

Escribir A2 o C2 arrastra el valor a toda la columna, y el `onEdit` bloquea la
edición de esas columnas de la fila 3 hacia abajo. Eso se respetó tal cual, con
tres precisiones:

1. **Las protecciones no estorban al script.** `onEdit` sólo se dispara con
   ediciones hechas por una persona en la interfaz; lo que escribe el script no
   pasa por ahí. La propagación automática nunca choca con el bloqueo.
2. **La propagación ahora es diferencial y sólo cubre filas con código.** Antes
   `actualizarColumnasAC()` reescribía A3:A y C3:C completas de un golpe, cada
   vez. Ahora se escriben únicamente las celdas que faltan —típicamente las filas
   nuevas que va agregando la Terminal— y **nunca se borra** lo que ya está
   escrito, ni siquiera en filas sin código.
3. **Editar A2 o C2 a mano vuelve a propagar al instante.** Es la única edición
   permitida en esas columnas, y antes no arrastraba nada hasta la siguiente
   corrida completa.

Las columnas B y D siguen la misma regla de siempre: sólo se llenan las filas que
tienen código en la columna G.

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

> **El índice por código se arma con el maestro COMPLETO**, sin aplicar el filtro
> por cliente. Es deliberado: si el CLIENTE de la columna E no coincide
> exactamente con el del maestro, la búsqueda por cliente falla y el índice por
> código es lo que mantiene el ABC funcionando. Filtrar ambos habría dejado el
> catálogo vacío y la columna F sin actualizarse, en silencio. Los clientes de la
> planilla que no aparecen en el maestro se listan en **Diagnóstico ABC**.

### Valor por defecto por cliente (HYCITE = C)

HYCITE no está en la hoja maestra: sus códigos viven en `ABC2026.txt`. Para que
ningún producto suyo quede sin clasificar, se agregó un valor por defecto:

```js
ABC_POR_DEFECTO: {
  "HYCITE": "C"
}
```

Se aplica **sólo cuando el producto no aparece en ningún catálogo**. Un código de
HYCITE que sí está clasificado conserva su letra real — el valor por defecto no
degrada nada. Para sumar otro cliente basta agregar una línea (el nombre del
cliente va en MAYÚSCULAS, como está en la columna E). El Diagnóstico ABC informa
cuántas filas se resolvieron por esta vía.

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
| Conteo siguiente | Sí | Desde caché, o relee si pasó la ventana |
| Escritura del propio script | **No** (firma igual) | — |
| Formato, notas, otras hojas | **No** (firma igual) | — |
| Rutina de fondo (30 min, activo) | Sí | Relee si pasó la ventana |
| Sin conteos en 3 h | Pausa | — |
| Menú "Forzar TODO" / "Actualizar ABC" | Sí, ignora la firma | Relee el maestro |
| Edición manual de A2 o C2 | Replica la columna | — |

---

## 4.b Varios operarios en el mismo archivo

Todos los operarios son editores del archivo y cuentan al mismo tiempo. Tres
cosas lo hacen seguro:

**Permisos: se piden una sola vez, o ninguna.** Los triggers **instalables**
(`alRegistrarConteo` y `manejadorCambiosExternos`) corren siempre **como el
usuario que los instaló**, no como quien edita. Si el propietario ejecuta
`ACTIVAR ARCHIVO`, la actualización corre con sus permisos para todos: **los
operarios no ven ninguna pantalla de autorización**. Lo único que corre como el
operario es el `onEdit` simple —las protecciones de columnas— y ése no necesita
autorización alguna.

**Nada se pierde por esperar turno.** El lock serializa las corridas para que dos
no escriban las mismas columnas a la vez. Si una corrida no alcanza su turno,
**no se descarta**: deja la marca `WMS_ACTUALIZACION_PENDIENTE` y la corrida
siguiente —otro conteo, la rutina de fondo o la siguiente llamada de la
Terminal— procesa igual, aunque la firma no haya cambiado. Por eso quedar en
cola **no se reporta como error**: el conteo ya está escrito y la actualización
está garantizada.

**Los registros de auditoría ya no se pisan.** `registrarAuditoria()` calculaba
`getLastRow() + 1` y después escribía. Dos conteos simultáneos obtenían la misma
fila y uno sobrescribía al otro, perdiendo un registro. Ahora se usa
`appendRow()`, que agrega al final en una sola operación, con la fecha y la hora
ya calculadas: cada conteo cae en su propia fila sin importar cuántos lleguen a
la vez.

## 5. Cada cuánto se relee el archivo maestro

`ABC_CFG.REFRESCO_MIN` (por defecto **60 minutos**; poner `120` para dos horas).

La ventana se cuenta desde la **última lectura real** del maestro, no desde la
última corrida. Cualquier corrida del pipeline —un conteo o la rutina de fondo—
relee el maestro si la ventana ya venció; si no, resuelve con el catálogo
cacheado. Como el pipeline sólo corre cuando hay actividad, el refresco ocurre
**mientras haya operarios trabajando** y se detiene solo cuando no los hay.

Si el maestro no responde y el ABC se resolvió con el snapshot local, la marca de
lectura **no** se actualiza: se reintenta en la vuelta siguiente en vez de
esperar otra hora.

## 6. Para que tome efecto

El trigger instalable de `onEdit` **no existe en los archivos ya activados**. En
cada archivo hijo hay que ejecutar una vez:

**⚙️ Inventarios WMS → ACTIVAR ARCHIVO**

Esa opción borra los triggers viejos y deja los tres: `onChange`,
`alRegistrarConteo` (onEdit instalable) y la rutina de fondo cada 30 minutos.
