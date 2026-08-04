# ENCARGO CODE — Formación · Itinerario por fases

> **Diseño**: `docs/folvy_formacion_itinerario_fases_rediseno.md` — **léelo entero antes de empezar**. Sustituye el modelo de asignación del diseño anterior (§3.1 y §3.3); el resto de aquel documento sigue vigente.
> **Depende de**: el onboarding actual, ya aplicado y en producción.

---

## 🔴 CRITERIO DE ACEPTACIÓN — se comprueba EN PANTALLA, no en la BBDD

Esto va primero a propósito. **Nada de esto está terminado hasta que se vea así**:

1. **Un empleado abre "Mi formación" y ve EXACTAMENTE los cursos de su fase liberada.** Para un empleado nuevo: **2 cursos** (higiene y alérgenos), no 13.
2. **Ninguna fecha anterior a la puesta en marcha del sistema.** Hoy hay asignaciones vencidas en **junio de 2025**, cuando Folvy no existía. Eso no puede quedar.
3. **Ningún curso aparece dos veces** en la lista del trabajador.
4. **PRL no aparece** en la lista del trabajador (es `solo_archivo`: no puede hacerlo).
5. **Se ve el progreso** de la fase actual ("1 de 2").

**Este encargo se declara entregado cuando esos 5 puntos se comprueban en la pantalla real**, no cuando el build está verde. Si no puedes verlos tú, dilo explícitamente y deja las instrucciones para que Julio los verifique.

*(Contexto de por qué esto va en cabecera: el encargo anterior implementó bien las fases en el modelo de datos y luego asignó las tres de golpe. El resultado en pantalla era inaceptable y no se detectó porque nadie ejecutó el paso 4 del ritual.)*

---

## A. EL CAMBIO DE FONDO

> El itinerario completo **existe** desde el alta. Pero solo **se asigna** la fase liberada.

Hoy `assign_onboarding_training` crea `course_assignment` de **todas** las fases. Debe crear **solo las de la fase liberada**.

### Modelo nuevo
```
training_path_progress (
  id, employee_id, path_id, phase,
  state,          -- pendiente | liberada | completada
  released_at,    -- NULL mientras esté pendiente
  released_by,    -- NULL = automático; uuid = liberada a mano
  due_at          -- released_at + days_from_release
)
```

- **Al alta**: se crea el progreso de las 3 fases. La **fase 1 se libera al momento**; las demás quedan `pendiente`.
- **`course_assignment` solo de fases liberadas.**
- `training_path.auto_release boolean default true`.
- `training_path_item.days_from_hire` pasa a interpretarse como **días desde la liberación de su fase**. Renómbralo si lo ves más claro (`days_from_release`), documentando el cambio.

### 🔴 Las fechas
**`due_at = released_at + días`. NUNCA desde `employees.start_date`.**

Ese fue el error de origen: contar desde la fecha de contratación produce plazos vencidos en 2025. El reloj empieza cuando la formación está **disponible**, que es lo único exigible a nadie.

---

## B. LIBERACIÓN — las dos formas (decisión de Julio: ambas)

**Automática** (`auto_release = true`, por defecto):
- La fase siguiente se libera al **completarse todos los cursos de la anterior**.
- **Y un cron diario de desfase**: si pasan los días previstos sin completarse la fase, se libera igualmente la siguiente. *Nadie puede quedarse sin recibir nunca la formación de igualdad porque no terminó la de higiene.* RECON del patrón de cron ya existente (`dispatch_watchdog`, `availability-watchdog`) y sigue ese mismo patrón.

**Manual**:
- Botón **"Liberar siguiente fase"** en la ficha del empleado y en el seguimiento.
- **Y por grupo** (la *campaña* del benchmark): liberar una fase a todo un local o puesto de una vez. Es lo que RRHH usa de verdad.
- Registrar `released_by`.

---

## C. MIGRACIÓN DE LO EXISTENTE (delicada — hay datos reales)

Hoy hay **9 empleados** con asignaciones de onboarding, muchas vencidas en 2025.

1. Crear el `training_path_progress` de los existentes: **fase 1 liberada** con `released_at` = fecha de puesta en marcha (no su alta), fases 2 y 3 `pendiente`.
2. **Recalcular `due_at`** de las asignaciones actuales con la base nueva. **Ninguna puede quedar con fecha anterior a la puesta en marcha.**
3. **Las asignaciones de fases no liberadas**: no las borres si tienen intento o firma; para las que estén intactas, quítalas — se recrearán cuando su fase se libere. **Comprueba `course_attempt` y `course_signature` antes de borrar nada.**

⚠️ **DDL y migración de datos en ficheros separados. Nunca COMMIT/ROLLBACK en un bloque DO.**

---

## D. PANTALLA DEL EMPLEADO (`MiFormacion.tsx`)

- **Solo la fase liberada**, con encabezado claro: *"Para poder empezar a trabajar — 2 cursos · 55 min"*.
- **Progreso**: "0 de 2".
- **Una tarjeta por curso**, aunque hubiera varias asignaciones del mismo *(ver E)*.
- **Excluir `delivery_mode = 'solo_archivo'`**: PRL no se hace, se sube el certificado.
- Al completar la fase: mensaje de logro (*"Ya puedes trabajar en cocina"*) y, si la liberación es automática, aparece la siguiente.
- **Sin muros de fechas rojas.** Una vencida se marca con claridad, sin teñir la pantalla.

---

## E. BUG ABIERTO: duplicados en la asignación manual

Se puede asignar el mismo curso a la misma persona varias veces. Verificado en producción (alérgenos ×3, manipulador ×2, con intentos a medias).

- **Al asignar desde oficina**: si ya existe una asignación **activa** de ese curso para esa persona, no crear otra — avisar y ofrecer cambiar la fecha límite.
- **En el móvil**: una sola tarjeta por curso.
- `adopt_mandatory_courses` y `assign_onboarding_training` ya deduplican bien. El hueco está solo en la vía manual.

---

## F. OFICINA

- **Estado por fase** de cada empleado, no una lista plana de 13 cursos.
- **"Liberar siguiente fase"**, individual y por grupo.
- **Excepción documentada**: marcar un curso como "no aplica" a alguien (experiencia previa, certificado externo equivalente), con motivo. El benchmark lo señala expresamente y hoy no existe. **Si no cabe, decláralo.**

---

## ENTREGA

1. Rama `feature/formacion-fases`.
2. **Si no cabe todo, entrega A + C + D completos y declara el resto.** Esos tres son los que arreglan lo que hoy está mal en pantalla.
3. Migraciones entregadas, no aplicadas por ti. DDL y datos separados. Guard `DO` al final.
4. `database.ts` regenerado en el mismo commit.
5. `npm run build` verde.
6. **RECON directo, sin subagentes.**
7. `git branch --show-current` antes de cada commit; `rev-list` al final.
8. **Y lo primero de todo: repasa el criterio de aceptación de arriba y dime si lo cumples, punto por punto.**

## FUERA DE ALCANCE
Prerrequisitos entre cursos dentro de una fase (opcional, último) · contenido de cursos · multiidioma · recordatorios y escalado (pieza 5, encargo propio).

---

_Encargo generado el 04/08/2026 tras comprobar el resultado real en pantalla._
