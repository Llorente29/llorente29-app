# ENCARGO CODE — Formación · VISTA PREVIA DEL CURSO

> **Origen**: hoy la única forma de leer un curso entero es asignárselo a uno mismo y hacerlo como empleado. Con **19 cursos en borrador pendientes de revisión**, eso bloquea la publicación del catálogo.
> **Depende de**: todo lo del módulo, ya en producción.

---

## 🔴 CRITERIO DE ACEPTACIÓN — en pantalla

1. Desde el catálogo, se abre un curso y **se lee entero de corrido**: todas las secciones con su texto e imágenes, y todas las preguntas **con su respuesta correcta marcada y sus explicaciones**.
2. **No crea ninguna asignación, ni intento, ni firma.** Es solo lectura.
3. **Funciona con cursos en `draft`** — es su uso principal: revisar antes de publicar.
4. **Se puede imprimir o exportar a PDF** con un aspecto digno.

---

## POR QUÉ, Y PARA QUÉ SIRVE

Tres necesidades distintas que esta misma pantalla resuelve:

**Revisar antes de publicar.** Hay 19 cursos en `draft`, varios con contenido legal sensible que Julio (y en algunos casos un asesor laboral) debe leer antes de que llegue a un trabajador. Hoy eso obliga a asignárselos y hacerlos uno a uno como empleado.

**Enseñar el contenido.** En una demo comercial, poder abrir un curso y mostrarlo es la diferencia entre decir *"tenemos 20 cursos"* y **enseñarlos**. Y para el catálogo público de Folvy, es de lo que más vende.

**Imprimir el temario.** Un inspector puede pedir ver el contenido impartido, no solo el acta de firmas. El informe de inspección (C2) ya lista los títulos de las secciones; esto permite entregar el temario completo si lo piden.

---

## QUÉ SE CONSTRUYE

**Botón "Vista previa"** en el detalle del curso (catálogo de oficina), junto a las acciones que ya existen.

**Una pantalla de lectura**, no un formulario:

- **Cabecera**: título, categoría, base legal, duración estimada, estado (borrador/publicado), si requiere práctica y su periodicidad de reevaluación.
- **Las secciones en orden**, con el markdown renderizado y sus imágenes — **exactamente igual que las ve el trabajador**. Reutiliza el mismo renderizado de `MiFormacion.tsx` (`react-markdown` + resolución de `media_url` con `getSignedSectionImageUrls`, que ya distingue rutas públicas de Storage). **No montes un renderizador nuevo**: si diverge, la vista previa dejaría de reflejar lo que el empleado ve, que es justo lo que se quiere comprobar.
- **El test completo**, con las 4 opciones de cada pregunta, **la correcta destacada** y **las explicaciones visibles**. Es lo que hace útil la revisión: permite detectar una respuesta mal marcada o una explicación floja.
- **Los gestos de verificación práctica**, si el curso los tiene.

**Y para imprimir**: un estilo de impresión decente (`@media print`) — sin menús ni botones, con saltos de página razonables entre secciones. No hace falta generar un PDF con jsPDF: basta con que "Imprimir → Guardar como PDF" dé un resultado presentable.

---

## REGLAS

- 🔴 **Solo lectura.** No crea `course_assignment`, ni `course_attempt`, ni `course_signature`. Nada de datos.
- **Acceso**: admin/manager de la cuenta. Un trabajador no debe poder ver las respuestas correctas — recuerda que `course_question`/`course_option` **no son legibles por el rol de empleado vía RLS** (decisión de C1, y está bien así). Si hace falta una RPC para leer el curso completo con respuestas, que tenga el mismo guard que el resto de la oficina (`is_admin_or_manager_of`).
- **Funciona con `draft`**, que es su caso de uso principal.
- **Cursos `solo_archivo`** (PRL): mostrar sus secciones informativas, sin test — no lo tienen.

---

## ENTREGA

1. Rama `feature/formacion-vista-previa`.
2. Si hace falta migración (RPC de lectura), entregada y no aplicada por ti. Guard `DO`. **Sin COMMIT/ROLLBACK en bloques DO. DROP FUNCTION antes de CREATE si cambia firma o tipo de retorno.**
3. `database.ts` regenerado en el mismo commit si cambia el esquema.
4. `npm run build` verde.
5. **RECON directo, sin subagentes.**
6. `git branch --show-current` antes de cada commit, y **verifica la rama en el remoto** (`git ls-remote --heads origin <rama>`) al terminar.

### 🟠 Nota de método (nos ha costado un rato hoy)
**No incluyas consultas de RECON ni `SELECT` de diagnóstico dentro de una migración.** El SQL Editor solo muestra el resultado de la última sentencia que devuelve filas: una migración que acaba en un `select cron.schedule(...)` parece devolver un resultado extraño y hace pensar que falló, cuando se había aplicado bien. Las verificaciones van **comentadas al final**, para ejecutarlas aparte.

## FUERA DE ALCANCE
Editor de cursos (ya existe) · contenido · multiidioma · recordatorios (encargo propio pendiente).

---

_Encargo generado el 04/08/2026 · desbloquea la revisión de los 19 cursos en borrador._
