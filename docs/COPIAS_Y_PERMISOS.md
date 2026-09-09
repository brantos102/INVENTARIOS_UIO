# Copias hechas por el operario: qué pasa con permisos y triggers

Escenario real: **cada operario saca su propia copia del archivo base**. Esta nota
responde qué funciona, qué hay que preparar una sola vez y qué fricción queda.

---

## 1. Sí, el operario puede activar su copia

Quien copia un archivo de Google **es el propietario de la copia**, y el script
contenedor se copia con ella. El operario no necesita permisos especiales sobre
nada: es dueño de su archivo y de su script, así que puede ejecutar
**⚙️ Inventarios WMS → ACTIVAR ARCHIVO** sin problema.

Al activar verá **una pantalla de autorización de Google**. Es normal: está
autorizando su propio script.

---

## 2. La consecuencia importante: los triggers corren con SU cuenta

Los triggers instalables corren siempre como **el usuario que los instaló**. Si
el archivo lo activa el operario, todo el motor —incluida la lectura del
catálogo ABC— corre con la cuenta de ese operario.

De ahí salen dos requisitos que hay que cumplir **una sola vez por operario**:

| Recurso | Qué necesita el operario | Si falta |
|---|---|---|
| **CONTEOS CICLICOS ITSANET** (hoja `CRONOGRAMA_CODIGOS`) | Permiso de **Lector** | El ABC no se puede leer |
| **ABC2026.txt** (respaldo, opcional) | Que esté compartido con él | Se pierden los códigos que sólo están ahí (ej. HYCITE) |

Con que tenga **una** de las dos fuentes, el ABC ya funciona.

> **Recomendación:** compartir el archivo maestro con el grupo de operarios como
> **Lector**, una sola vez. Y configurar `ABC_CFG.TXT_FALLBACK_ID` con el ID del
> `ABC2026.txt` compartido: la búsqueda por nombre sólo mira el Drive de cada
> operario, así que sin el ID no lo encuentran.

### Esto ya no falla en silencio

* **Al activar**, se comprueban los accesos y el aviso lo dice de frente: o bien
  «Accesos verificados», o bien qué falta y a qué archivo pedir permiso.
* **Menú → Verificar accesos**: el operario lo comprueba cuando quiera, sin
  esperar a que falle un conteo.
* **Durante la operación**, si el catálogo no se puede leer aparece un aviso en
  pantalla (máximo uno por hora) en vez de dejar la columna F vacía sin
  explicación.

---

## 3. La fricción que queda: una autorización POR COPIA

La autorización de Apps Script es **por proyecto de script**, y cada copia es un
proyecto nuevo. Es decir:

> El operario autoriza **una vez por cada archivo de inventario que crea**, no
> una vez y para siempre.

Si saca tres inventarios al mes, son tres pantallas de autorización. Es la única
fricción real que queda en este esquema, y **no se puede evitar** mientras los
triggers vivan dentro de cada copia: es cómo funciona la plataforma.

---

## 4. Cómo eliminarla del todo

Con el esquema que ya está implementado —**la Terminal WMS llama al motor**
(`docs/INTEGRACION_TERMINAL_WMS.md`)— la fricción desaparece:

| | Triggers en cada copia | Terminal llama al motor |
|---|---|---|
| Autorizaciones del operario | **Una por cada copia** | **Una sola vez**, en la Terminal (o ninguna) |
| Activar cada archivo nuevo | Sí | No |
| Acceso al maestro | Cada operario | Sólo la cuenta que ejecuta la Terminal |
| Si la Terminal se despliega como "ejecutar como el propietario" | — | El operario **no autoriza nada** |

El proyecto de la Terminal es **uno solo**: se autoriza una vez y sirve para
todos los inventarios presentes y futuros. Y si además está desplegada como
*"Ejecutar como: yo (propietario)"*, sólo el propietario necesita acceso al
archivo maestro; los operarios no autorizan ni ven nada.

---

## 5. Recomendación práctica

1. **Ahora:** compartir el archivo maestro como Lector con los operarios y
   configurar `TXT_FALLBACK_ID`. Con eso, activar la copia funciona bien y el
   operario sabe de inmediato si algo le falta.
2. **Después:** mover el disparo a la Terminal WMS. Ahí desaparecen la
   activación por archivo y la autorización por copia, y basta con que la cuenta
   de la Terminal tenga acceso al maestro.

Los dos esquemas conviven sin conflicto: si una copia tiene triggers y además le
llega la llamada de la Terminal, la firma de estado hace que el trabajo se haga
una sola vez.
