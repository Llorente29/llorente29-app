# ENCARGO CODE — Formación · CORRECCIONES DE LA AUDITORÍA EXTERNA

> **Origen**: auditoría externa del módulo (`docs/claude/folvy_formacion_auditoria_externa.md` o el informe entregado). La fuga multi-tenant ya está cerrada y verificada (`anon_puede = false` en las 6 funciones). Esto es el resto, por orden de gravedad.
> **Todo lo que sigue está verificado contra la BBDD de producción**, no es teoría.

---

## 🔴 A. Vigencia: `my_pending_courses` miente en dos cosas

Es el mismo mecanismo del bug que ya reventó una vez (dos implementaciones, una se corrige y la otra no). La Pieza D unificó dos consumidores; quedan tres.

### A.1 No filtra `status = 'published'`
**Verificado en producción: hay 12 asignaciones a cursos que NO están publicados.** Esos empleados ven el curso y pueden hacerlo en el móvil, pero **es invisible en el informe de inspección** (que sí filtra `published`). Su trabajo no computa ante Sanidad.

**Arreglo**: filtrar por `published` en `my_pending_courses`. Y decidir qué pasa con las 12 asignaciones existentes — probablemente basta con que dejen de mostrarse hasta que su curso se publique. **No borres nada sin comprobar `course_attempt`.**

### A.2 Trata `firmado` como estado terminal
No mira `reeval_months`. **Un manipulador caducado sale `caducado` en el informe de oficina y verde en el móvil del empleado, para siempre.**

**Arreglo**: que respete la caducidad, con la misma regla que `course_state_for_employee`.

### A.3 Unificar de verdad
`my_pending_courses`, `training_gaps` y `training_course_summary` deben **llamar a `course_state_for_employee`** en vez de reimplementar la lógica. Ya existe como fuente canónica desde el encargo anterior.

⚠️ **`training_course_summary`** calcula cumplimiento por "existió alguna vez un intento aprobado", sin caducidad ni práctica → **puede dar 100% con todo caducado**, y alimenta la ficha por curso del PDF de inspección.

**Criterio de aceptación**: para un mismo empleado y curso, las cuatro funciones responden lo mismo. Compruébalo con datos reales.

---

## 🔴 B. El PDF de inspección cuenta celdas y las llama "trabajadores"

`trainingCompliancePdfService.ts` (~línea 179-181) imprime *"{vigente} de {applicable} trabajadores con la formación obligatoria vigente"*, pero `computeMandatoryCompliancePct` cuenta **celdas empleado × curso**, no personas.

Con 20 empleados y 5 obligatorias puede imprimir **"83 de 100 trabajadores"** en la portada del documento que se enseña al inspector.

**No es cosmético: es un dato falso en un documento legal**, y es tu mejor pieza comercial.

**Arreglo**: o cuenta personas de verdad, o cambia el texto para que diga lo que mide. Preferible lo primero.

---

## 🟠 C. El cron encadena fases el día siguiente al alta

**Verificado**: los ítems de la fase `dia_1` tienen `days_from_hire = 0` → el `due_at` de la fase 1 **vence en el mismo segundo en que se libera** → el cron de las 6:00 libera la fase `dias_30` (3 cursos más) a la mañana siguiente, haya hecho el empleado algo o no.

Resultado: **vuelve el problema de "un montón de cursos encima de golpe"**, que es justo lo que el rediseño por fases venía a evitar.

**Arreglo**: el cron de desfase debe dar un margen real a la fase 1. Opciones: un mínimo de días para `dia_1` (p. ej. 7), o que el cron use un umbral propio en vez de `due_at`. **Decide y documenta por qué.**

---

## 🟠 D. Los tests son adivinables

Verificado sobre las migraciones de contenido:

- **Plantilla fija de posición** de la respuesta correcta. Distribución global de 180 preguntas: **A=40, B=54, C=50, D=36**. Marcar siempre "B" o "C" bate al azar de forma sistemática.
- **Tres cursos con la clave idéntica**: `igualdad_acoso`, `primeros_auxilios`, `embolsado_delivery`. Quien memorice uno aprueba los otros dos sin leer.
- **La correcta suele ser la opción más larga y matizada.** Sesgo clásico de examen.

Para un módulo cuyo argumento es *"evidencia de que el empleado sabe"*, esto es una grieta en la propuesta de valor.

**Arreglo recomendado (elige y justifica)**:
- **Barajar las opciones en el render**, por usuario e intento. Es la solución de fondo: hace irrelevante la posición en la BBDD y no exige reescribir contenido. **Ojo**: la corrección es server-side, así que el barajado debe mantener la trazabilidad de qué opción eligió el alumno.
- Y/o aleatorizar la posición en los datos, rompiendo las 3 claves idénticas.

*(El contenido de las preguntas lo revisa Julio; esto es mecánica de examen.)*

---

## 🟠 E. Higiene de producto (rápidas, alto impacto en demo)

**E.1 — `show_formacion` no existe.** El ítem de menú "Formación" exige un permiso que no está registrado en `managerPermissionsService.ts` ni en migraciones, y `hasPermission` es fail-closed → **ningún manager ve el módulo**, solo admins. En una demo con perfil de encargado, Formación **desaparece**.

**E.2 — SVG muertos**: `embolsado.svg`, `estacion_kds.svg`, `igualdad.svg`, `temperatura_ruta.svg` en `public/formacion/portadas/` ya no los referencia nadie (fueron sustituidos por las fotos). Bórralos.

**E.3 — Excel con `undefined`**: `trainingComplianceExcelService.ts` no etiqueta el estado `pendiente_practica`.

**E.4 — Estado vacío**: una cuenta sin datos muestra **"0·0·0·0 · 100%"** en verde en la matriz de cumplimiento. Un "100% verde" sin datos es peor que no mostrar nada. Añade un estado "sin datos aún".

---

## ENTREGA

1. Rama `feature/formacion-auditoria-fixes`.
2. **Orden de prioridad: A → B → C → D → E.** Si no cabe todo, entrega A y B completos y declara el resto — son los que afectan a la verdad del dato y al documento legal.
3. Migraciones entregadas, no aplicadas por ti. DDL y datos separados. **Sin COMMIT/ROLLBACK en bloques DO. DROP FUNCTION antes de CREATE si cambia firma o tipo de retorno. Y ningún SELECT de diagnóstico dentro de la migración** (el SQL Editor solo muestra el resultado de la última sentencia con filas y confunde el diagnóstico).
4. `database.ts` regenerado en el mismo commit si cambia el esquema.
5. `npm run build` verde.
6. **RECON directo, sin subagentes.** Verifica la rama en el remoto al terminar.

**Criterio de aceptación en pantalla**: un empleado con un curso caducado lo ve como **caducado en el móvil**, no verde. Y el PDF de inspección imprime un número de trabajadores creíble.

## FUERA DE ALCANCE
Contenido de los cursos · fotos de portada (las cambia Julio) · precio y empaquetado · multiidioma · recordatorios (encargo propio pendiente).

---

_Encargo generado el 04/08/2026 a partir de la auditoría externa, con los hallazgos verificados en producción._
