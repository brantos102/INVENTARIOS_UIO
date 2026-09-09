# Integración con la Terminal WMS (sin activación manual)

Objetivo: **el operario nunca abre el archivo real**. La Terminal escribe el
conteo y, en la misma llamada, pide la actualización. El archivo hijo deja de
necesitar triggers y deja de necesitar el "ACTIVAR ARCHIVO".

---

## 1. Por qué hacía falta activar a mano

| Hecho | Consecuencia |
|---|---|
| Los triggers **no se copian** con el archivo. Duplicar la plantilla copia el script, pero no sus disparadores. | Cada archivo nuevo nace sin gatillos. |
| Un trigger se crea siempre **en el proyecto que ejecuta el código**, y quien lo ejecuta debe estar autorizado. | Alguien tenía que abrir el archivo y dar permisos. |
| El `onEdit` **simple** corre sin autorización: no puede abrir el archivo maestro. | La captura manual no podía leer el ABC. |

Nada de eso aplica si **la Terminal llama al motor directamente**: la Terminal ya
está autorizada (ya escribe en las hojas) y ya sabe sobre qué archivo trabaja.

---

## 2. Cómo queda

```
Operario ──► Terminal WMS ──┬──► escribe el conteo en la hoja   (como hoy)
                            └──► actualizarInventario(idArchivo)
                                    └─► ABC + columnas A, B, C, D + análisis + respaldo
```

* **Cero triggers.** No hay `onChange`, no hay `onEdit` instalable, no hay
  rutina de fondo, no hay límite de 20 disparadores por usuario.
* **Cero activación.** Un archivo recién generado funciona con el primer conteo.
* **Inmediato.** El ABC aparece en el mismo momento del conteo, no en la
  siguiente vuelta del temporizador.

---

## 3. Qué hay que hacer en el proyecto de la Terminal

### Paso 1 — Llevar el motor al proyecto de la Terminal

Copiar `Codigo.gs` como un archivo más del proyecto de la Terminal (por ejemplo
`MotorInventarios.gs`). Es la vía más simple y evita el versionado de las
bibliotecas de Apps Script.

> Alternativa: publicarlo como **biblioteca** y llamarlo con
> `MotorWMS.actualizarInventario(id)`. Funciona igual — las claves de estado
> llevan el ID del archivo, así que no se mezclan los inventarios entre sí ni
> entre proyectos.

Las funciones de menú (`onOpen`, `instalarTriggersEnCopia`, …) sobran en la
Terminal, pero no estorban: sólo se ejecutan si alguien las llama.

### Paso 2 — Llamar al motor después de escribir el conteo

```js
// ... aquí la Terminal escribe el conteo en V, W o X como ya lo hace ...

const r = actualizarInventario(idArchivoInventario);

if (!r.exito) {
  console.error('WMS: ' + r.mensaje);   // el conteo YA quedó escrito
}
```

Eso es todo. La respuesta trae el detalle por si se quiere mostrar en pantalla:

```js
{
  exito: true,
  ejecutado: true,        // false = no había nada nuevo que procesar
  primerConteo: true,     // true sólo en el conteo que arranca el inventario
  conteos: 1,             // conteos registrados en V, W y X
  abc: { origen: 'FUENTES', celdas: 128, sinAbc: 0, porDefecto: 4, clientes: ['DEGSO'] },
  ms: 1840,
  mensaje: ''
}
```

### Paso 3 — Autorizar una sola vez

La primera ejecución pide permisos de Hojas de cálculo y Drive (el motor abre el
archivo maestro del ABC y, como respaldo, `ABC2026.txt`).

* Si la Terminal está desplegada como **"Ejecutar como: yo (propietario)"**, el
  operario **no ve ninguna pantalla de permisos**: autoriza el propietario una
  vez, al desplegar.
* Si está desplegada como **"Ejecutar como: el usuario"**, cada operario acepta
  una sola vez, desde la propia Terminal. Nunca tiene que abrir la hoja.

---

## 4. Detalles que ya están resueltos en el motor

**Un proyecto, muchos inventarios.** Las propiedades del script son por
proyecto, así que el estado de cada archivo (firma de conteos, arranque del
inventario, última lectura del maestro) se guarda con el ID del archivo. El
catálogo ABC en caché se indexa por el conjunto de clientes: dos inventarios del
mismo cliente comparten catálogo, y los de clientes distintos no se pisan.

**Concurrencia.** El lock de Apps Script es por proyecto: si dos operarios
cuentan a la vez en archivos distintos, uno espera al otro. Por eso la llamada
desde la Terminal espera hasta 30 s (`opciones.esperaLock`) en vez de descartar
la actualización. Si aun así no alcanza el turno, `exito` viene en `false` con
un mensaje claro — **el conteo ya quedó escrito** y se procesa en la llamada
siguiente.

**Idempotencia.** Si no hay conteos nuevos, `actualizarInventario` no escribe
nada y responde en aproximadamente un segundo. Se puede llamar de más sin costo.

**Relectura del maestro.** El archivo maestro se lee con el primer conteo y
luego cada `ABC_CFG.REFRESCO_MIN` minutos (60 por defecto, 120 para dos horas).
Entre medio el ABC se resuelve con el catálogo en caché.

---

## 5. ¿Y los triggers del archivo hijo?

Quedan **opcionales**. Vale la pena conservarlos como red de seguridad para lo
que no pasa por la Terminal:

* un supervisor que digita un conteo directamente en la hoja;
* una carga hecha por otro medio.

Si se conservan, no hay trabajo duplicado: la firma de estado hace que el
segundo camino en llegar no recalcule nada. Y si no se instalan, el archivo
funciona igual mientras todos los conteos entren por la Terminal.

---

## 6. Orden de implantación sugerido

1. Copiar el motor al proyecto de la Terminal y agregar la llamada.
2. Probarlo contra **un** inventario de prueba: verificar que con el primer
   conteo aparecen la fecha en A, el ID en C, la secuencia en D y el ABC en F.
3. Revisar el resultado con `diagnosticoInventario(idArchivo)`, que devuelve el
   mismo detalle del menú **Diagnóstico ABC** pero sin interfaz.
4. Recién entonces dejar de ejecutar `ACTIVAR ARCHIVO` en los archivos nuevos.

Los archivos que ya están activados y trabajando **no requieren ningún cambio**:
siguen funcionando con sus triggers, y si además les llega la llamada de la
Terminal, tampoco hay conflicto.
