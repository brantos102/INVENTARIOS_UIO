# Quién activa el archivo y qué permisos hace falta dar

Escenario real: **las copias se crean desde la cuenta del administrador** (Centro
de Mando IMS). El administrador queda como **propietario** y el operario recibe
rango de **Editor** sobre el archivo creado.

---

## 1. La respuesta corta

**El operario no necesita activar nada, y no necesita dar ningún permiso.**

Conviene que **active el propietario**, porque los disparadores instalables
corren siempre **con la cuenta de quien los instaló** — no con la de quien edita.
Si activa el propietario:

| | Propietario (administrador) | Operarios (editores) |
|---|---|---|
| Autoriza el script | **Una vez, por archivo** | **Nunca** |
| Necesita acceso al archivo maestro del ABC | **Sí** | **No** |
| Tiene que activar algo | Sí | No |
| Puede contar con normalidad | Sí | **Sí, desde el primer momento** |

El operario abre el archivo (o la Terminal), cuenta, y el motor hace todo el
trabajo con la cuenta del propietario. No ve pantallas de autorización, no pide
accesos y no espera a nadie.

---

## 2. ¿Y si activa el operario? También puede, pero no conviene

Un **Editor sí puede** ejecutar `ACTIVAR ARCHIVO`: el menú aparece para
cualquiera que abra el archivo y, al usarlo, Google le pide autorizar el script.
Los disparadores quedan a su nombre. Funciona, pero trae tres problemas:

1. **Su cuenta pasa a necesitar acceso de Lector al archivo maestro.** Si no lo
   tiene, la columna F no se llena.
2. **Autoriza una vez por cada archivo**, porque cada copia es un proyecto de
   script distinto.
3. **Si además activa otro operario, quedan dos juegos de disparadores** y el
   archivo hace el trabajo por duplicado. `getProjectTriggers()` sólo devuelve
   los disparadores propios, así que ninguno puede borrar los del otro.

Por eso el código ahora:

* **Guarda quién activó** (`WMS_ACTIVADO_POR`) y lo muestra en
  **⚙️ → Verificar accesos**.
* **Avisa antes de duplicar**: si alguien intenta activar un archivo que ya
  activó otra persona, sale una confirmación explicando que quedarán dos juegos
  de disparadores. Por defecto no se activa.
* **Le dice a quien activa que su cuenta es la que necesita el acceso** al
  maestro, y verifica ahí mismo si lo tiene.
* **No lanza el pipeline desde el `onEdit` simple cuando el archivo ya está
  activado.** Ese `onEdit` corre con la cuenta del operario y sin autorización,
  así que no puede abrir el archivo maestro: ejecutarlo sólo produciría errores
  en su pantalla. El trabajo lo hace el disparador instalable, que sí tiene
  permisos. El respaldo se mantiene únicamente para archivos sin activar.

---

## 3. Qué preparar, una sola vez

1. **Compartir el archivo maestro** *CONTEOS CICLICOS ITSANET* como **Lector**
   con la cuenta que va a activar los archivos (la del administrador).
2. **Configurar `ABC_CFG.TXT_FALLBACK_ID`** con el ID de `ABC2026.txt`. La
   búsqueda por nombre sólo mira el Drive de la cuenta que ejecuta; con el ID se
   encuentra siempre.
3. Al crear cada copia, abrirla una vez y ejecutar
   **⚙️ Inventarios WMS → ACTIVAR ARCHIVO**. El aviso confirma con qué cuenta
   quedaron los disparadores y si esa cuenta puede leer el catálogo.

---

## 4. Cómo eliminar el paso 3

El paso 3 es lo único manual que queda, y desaparece con el esquema ya
implementado en el que **la Terminal WMS llama al motor**
(`docs/INTEGRACION_TERMINAL_WMS.md`):

| | Activar cada copia | Terminal llama al motor |
|---|---|---|
| Activar cada archivo nuevo | Sí, una vez por archivo | **No** |
| Autorizaciones | Una por archivo (el propietario) | **Una sola vez**, en la Terminal |
| Acceso al maestro | La cuenta que activa | La cuenta de la Terminal |

El proyecto de la Terminal es **uno solo**: se autoriza una vez y sirve para
todos los inventarios, presentes y futuros. Y si el Centro de Mando IMS ya crea
las copias desde la cuenta del administrador, es el lugar natural para llamar
también a `actualizarInventario(idNuevoArchivo)`.

Los dos esquemas conviven: si un archivo tiene disparadores y además le llega la
llamada de la Terminal, la firma de estado hace que el trabajo se haga una sola
vez.
