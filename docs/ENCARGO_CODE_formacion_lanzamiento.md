# ENCARGO CODE — Formación · CIERRE DEL LANZAMIENTO

> **Diseño**: `docs/folvy_formacion_itinerario_fases_rediseno.md` §2.3 y §4 · `docs/folvy_formacion_onboarding_diseno.md` §3.5.
> **Estado verificado en pantalla hoy**: el rediseño por fases funciona (empleado ve 2 cursos, progreso "0 de 2", sin PRL, sin fechas de 2025, sin duplicados). Lo que queda son **las piezas declaradas** que impiden que el módulo funcione solo.
> **Prioridad de Julio**: "esto hay que terminarlo ya".

---

## 🔴 CRITERIO DE ACEPTACIÓN — se comprueba EN PANTALLA

1. Desde la oficina se puede **lanzar una fase a un grupo entero** (todo un local, o todo un puesto) en una sola acción, y los empleados de ese grupo la reciben.
2. Cuando un empleado **completa todos los cursos de su fase**, la siguiente aparece **sola** en su móvil, sin que nadie la libere a mano.
3. Un empleado con formación pendiente **recibe un aviso**; su responsable **recibe un resumen** de quién va tarde.
4. Nada de lo anterior genera **spam**: con 9 empleados y varias asignaciones vencidas, los avisos deben ser un resumen agregado, no uno por curso y día.

**No está entregado hasta comprobar 1 y 2 en pantalla.** Si no puedes verlos tú, dilo y deja instrucciones concretas para Julio.

---

## A. CAMPAÑA: LIBERAR UNA FASE A UN GRUPO 🎯 (lo más urgente)

**La RPC `release_next_phase_for_group` ya existe** (la construiste en el encargo anterior). **Falta la UI.**

- **Dónde**: Team → Formación. Botón visible, no escondido en un menú.
- **A quién**: seleccionar por **local** y/o **puesto** (los filtros que ya existen en esa pantalla). El caso real: *"la formación de igualdad, a todo el equipo de Alcalá"*.
- **Qué fase**: elegir cuál se libera, no solo "la siguiente" — RRHH puede querer adelantar la fase 3 a un grupo concreto.
- **Previsualización antes de confirmar**: *"Se liberará la fase X a 12 personas. 3 ya la tienen liberada y no se verán afectadas."* Nunca lanzar a ciegas: es una acción que toca a mucha gente a la vez.
- **Registrar `released_by`** (queda ya en el modelo).

⚠️ **Idempotente**: lanzar dos veces la misma campaña no debe duplicar asignaciones ni reiniciar plazos de quien ya la tenía.

---

## B. LIBERACIÓN AUTOMÁTICA AL COMPLETAR LA FASE

Hoy la fase 2 no se abre sola: hay que liberarla a mano una por una. Con 9 empleados es tedioso; con 100 es inviable.

**Dos disparos, ambos necesarios:**

1. **Al completar**: cuando el empleado firma el último curso pendiente de su fase, se marca la fase como `completada` y **se libera la siguiente** (si `training_path.auto_release = true`).
   - RECON: dónde detectar "fase completa". Lo natural es tras `sign_course_attempt`, que ya resuelve todo server-side.
   - "Completa" = todos los cursos de la fase **aprobados y firmados**. Misma regla que `training_compliance_matrix`. **No inventes un criterio nuevo** (ver §D).

2. **Cron de desfase**: si pasan los días previstos y la fase sigue sin completarse, **se libera igualmente la siguiente**. Nadie puede quedarse sin recibir nunca la formación de igualdad porque no terminó la de higiene.
   - RECON del patrón ya existente (`dispatch_watchdog`, `availability-watchdog`: `cron.schedule` → Edge Function con secreto). **Sigue ese patrón, no inventes otro.**

---

## C. RECORDATORIOS Y ESCALADO (pieza 5, declarada en su día)

Todos los líderes del sector lo señalan como imprescindible y hoy no existe.

**Al empleado**: aviso al liberársele una fase y cuando se acerca el plazo.
**Al responsable**: resumen de quién va tarde, con **escalado** si un curso **bloqueante** sigue pendiente pasada la fecha.

🔴 **ANTI-SPAM — requisito, no recomendación:**
- **Un resumen agregado por persona**, nunca un aviso por curso.
- **Frecuencia**: semanal para lo no bloqueante; más frecuente solo para bloqueantes.
- **Tabla de recordatorios enviados** para no repetir el mismo aviso cada día. (La señalaste tú como necesaria al declarar esta pieza.)
- Con la situación real de hoy —varias asignaciones vencidas—, un recordatorio diario por cada una convierte el sistema en ruido y la gente deja de leerlo. **Si eso pasa, la pieza ha fracasado aunque el código funcione.**

**Canal**: RECON de qué hay disponible (`account_email_log`, la Edge de email, avisos in-app del portal). Decide y **documenta por qué**.

---

## D. 🟠 DEUDA QUE CONVIENE SALDAR AQUÍ

La pregunta *"¿este curso está pendiente / vigente?"* se responde hoy en **cuatro sitios** con su propia implementación: `training_compliance_matrix`, `training_gaps`, `my_pending_courses` y los semáforos.

**Ya divergió una vez**: C4 corrigió la regla en `training_compliance_matrix`, `training_gaps` se quedó atrás, y un curso empezado y no terminado desaparecía del contador de pendientes (bug de hoy).

Como esta pieza añade un **quinto** consumidor (detectar "fase completa"), es el momento natural de unificar: que `training_compliance_matrix` sea la **única fuente de verdad** y el resto la consulte.

**Si unificar resulta demasiado grande, decláralo** — pero entonces **no añadas una quinta implementación**: reutiliza una de las existentes.

---

## ENTREGA

1. Rama `feature/formacion-lanzamiento`.
2. **Si no cabe todo: A y B completos, declara C.** A es lo más urgente (hoy no se puede lanzar a un grupo) y B lo que hace que el módulo funcione solo.
3. Migraciones entregadas, no aplicadas por ti. **DDL y datos en ficheros separados. Nunca COMMIT/ROLLBACK en un bloque DO. DROP FUNCTION antes de CREATE si cambia la firma o el tipo de retorno** (ya nos ha pasado dos veces).
4. `database.ts` regenerado en el mismo commit.
5. `npm run build` verde.
6. **RECON directo, sin subagentes.**
7. `git branch --show-current` antes de cada commit. Y al terminar, **verifica que la rama está en el remoto** (`git ls-remote --heads origin <rama>`): hoy hemos perdido tiempo con una rama que creíamos pusheada y no lo estaba.

## FUERA DE ALCANCE
Contenido de cursos · multiidioma · excepción "no aplica" con motivo · prerrequisitos entre cursos dentro de una fase · vista de oficina "estado por fase" de toda la plantilla.

---

_Encargo generado el 04/08/2026 tras verificar el rediseño por fases en pantalla._
