# Folvy — Formación · REDISEÑO DEL ITINERARIO: LIBERACIÓN POR FASES

> **Origen**: al ver la pantalla real de un empleado, el resultado era inaceptable — 13 cursos de golpe, sin jerarquía, con fechas vencidas de 2025 (cuando Folvy no existía) y títulos duplicados. Desmotivador e ineficaz.
> **Sustituye** el modelo de asignación de `folvy_formacion_onboarding_diseno.md` §3.1 y §3.3. El resto de aquel documento (semáforo, calendario, recordatorios) sigue vigente.
> **Decisión de Julio**: soportar **liberación automática Y manual**.

---

## 0. QUÉ FALLÓ, Y POR QUÉ NO ES UN PROBLEMA DE PANTALLA

El diseño anterior recogía el hallazgo correcto del benchmark —el modelo 30-60-90, *"cargarlo todo el primer día es menos eficaz"*— y creó las fases `dia_1` / `dias_30` / `dias_90` en el modelo de datos.

**Pero luego asignó las tres fases de golpe.** Las fases quedaron como una etiqueta, no como un mecanismo. El trabajador recibe las 13 asignaciones el primer día y la fase solo sirve para ordenar la lista.

La primera reacción fue proponer un desplegable para "mostrar menos". **Eso era un parche**: el problema no es cuánto se muestra, es cuánto se asigna.

**Fallo de proceso, no solo de diseño**: se cerró el ciclo en "código mergeado" sin ejecutar el paso 4 del ritual (MEDIR: comprobar el resultado desde la perspectiva de quien lo usa). Ver §6.

---

## 1. BENCHMARK — cómo lo resuelven de verdad

El mecanismo tiene nombre propio: ***drip content* / liberación escalonada**, y es estándar en el sector.

- **El principio**: el onboarding se despliega semana a semana, los reciclajes de cumplimiento aparecen según calendario, y **los prerrequisitos garantizan que la formación básica esté terminada antes de que se abran los temas avanzados**, sin coordinación manual por alumno. El objetivo declarado: que reciba *"el material adecuado en el momento adecuado en vez de enfrentarse a todo de golpe"*.
- **La mecánica exacta** (ejemplo real de itinerario de incorporación): Semana 1: cultura y valores → políticas → seguridad laboral · Semana 2: producto → herramientas → habilidades del puesto · Semana 3: escenarios con cliente → evaluación a 30 días. **Cada módulo se desbloquea al completarse el anterior.**
- **Las fechas son relativas**: los módulos se programan por fecha **o por desfase desde la inscripción**, y se bloquean hasta cumplirse los requisitos. *(Esto resuelve el absurdo de las fechas de 2025.)*
- **El criterio es de RRHH**: se construyen itinerarios estructurados en vez de repartir cursos sueltos; los prerrequisitos indican qué va primero y qué después, lo que reduce las dudas sobre por dónde empezar. Y **se admiten excepciones**: RRHH puede ajustar la inscripción de quien trae experiencia previa, manteniendo el itinerario global intacto.
- **Campañas por grupo**: un administrador puede asignar automáticamente a individuos **o a un grupo**, y el empleado recibe aviso al asignársele.

---

## 2. EL MODELO NUEVO

### 2.1 La idea en una frase
> El itinerario completo **existe** desde el alta. Pero solo **se asigna** la fase liberada.

Pamela no debe tener 13 asignaciones y ver 2. **Debe tener 2 asignaciones.** Las otras 11 están en su itinerario, pendientes de liberación.

### 2.2 Estado por fase, no por curso

Nueva tabla **`training_path_progress`** — el progreso de una persona en su itinerario:

```
training_path_progress (
  id, employee_id, path_id, phase,
  state,            -- pendiente | liberada | completada
  released_at,      -- cuándo se liberó (NULL si aún no)
  released_by,      -- NULL = automático; uuid = liberada a mano por alguien
  due_at            -- released_at + days_from_release
)
```

**Al alta del empleado**: se crea el progreso de las 3 fases. La **fase 1 se libera inmediatamente** (`released_at = now()`); las demás quedan `pendiente`.

**Solo se crean `course_assignment` de las fases liberadas.** Eso es todo el cambio de fondo.

### 2.3 Las dos formas de liberar (decisión de Julio: ambas)

**Automática** — `training_path.auto_release = true` (por defecto):
- La fase siguiente se libera **cuando se completan todos los cursos de la anterior**.
- Un cron diario comprueba también el **desfase temporal**: si pasan los días previstos sin completarse la fase, se libera igualmente la siguiente para no bloquear a nadie indefinidamente. *(Un empleado que no termina la fase 1 no puede quedarse sin recibir nunca la formación de igualdad.)*

**Manual** — `training_path.auto_release = false`, o adelanto puntual:
- Botón **"Liberar siguiente fase"** en la ficha del empleado y en el seguimiento.
- Y **liberación por grupo** (la *campaña*): "liberar la fase 3 a todo el equipo de Alcalá". Es lo que pedía el benchmark y lo que RRHH usa de verdad.
- Queda registrado quién la liberó (`released_by`).

### 2.4 Las fechas, arregladas

🔴 **`due_at = released_at + days_from_release`**, nunca desde `start_date`.

Eso elimina de raíz el absurdo de "vencido en junio de 2025": el reloj empieza **cuando la formación está disponible**, que es lo único exigible.

Para la fase 1 de un empleado nuevo, `released_at` = su alta, así que el resultado es el mismo que antes en el caso normal — pero para la plantilla existente, el plazo cuenta desde la puesta en marcha.

**Migración de lo existente**: recalcular los `due_at` de las asignaciones de onboarding actuales con base en la fecha de liberación real. Ninguna debe quedar con fecha anterior a la puesta en marcha del sistema.

### 2.5 Prerrequisitos entre cursos (dentro de la fase)

`training_path_item.requires_item_id` (nullable): un curso puede exigir otro **de la misma fase**. Uso previsto: APPCC después de higiene alimentaria.

Es opcional y de segundo orden — la liberación por fases ya resuelve el 90% del problema. **No bloquear la entrega por esto.**

---

## 3. LO QUE VE EL EMPLEADO

**Fase 1 (día 1), un empleado nuevo:**

> **Para poder empezar a trabajar** — 2 cursos · 55 min
> · Higiene alimentaria — manipulador (30 min)
> · Alérgenos e intolerancias (25 min)
>
> *Progreso: 0 de 2*

**Y nada más.** Ni fechas rojas, ni PRL que no puede hacer, ni 11 cursos que le tocarán en octubre.

Al completar los dos: mensaje de logro (*"Ya puedes trabajar en cocina"*) y, si la liberación es automática, aparece la fase 2 con su plazo nuevo.

**Reglas de la pantalla:**
- **Un curso, una tarjeta.** Nunca el mismo título repetido *(hoy ocurre — ver §5)*.
- **Los `solo_archivo` (PRL) no aparecen** en la lista del trabajador: no puede hacerlos. Van en la ficha, como certificado a subir.
- **Progreso visible** de la fase actual.
- **Sin fechas anteriores a hoy** en el caso normal. Si una vence, se marca con claridad pero sin llenar la pantalla de rojo.

---

## 4. LO QUE VE LA OFICINA

- **Estado por fase** de cada empleado, no una lista de 13 cursos.
- **"Liberar siguiente fase"**, individual y por grupo (campaña).
- **Excepción documentada**: marcar un curso como "no aplica" a alguien con experiencia previa o certificado externo equivalente, con motivo. El benchmark lo señala expresamente y hoy no existe.
- El itinerario sigue siendo **configurable por cuenta**, con los 3 por defecto de Folvy.

---

## 5. BUG ABIERTO QUE ARRASTRA ESTO

**Se puede asignar el mismo curso a la misma persona varias veces.** Verificado en producción: una empleada con alérgenos ×3 y manipulador ×2, con intentos a medias en varias asignaciones.

`adopt_mandatory_courses` y `assign_onboarding_training` **sí deduplican** (verificado). El hueco está en la **asignación manual desde oficina**.

**Reglas**: no crear una segunda asignación activa del mismo curso para la misma persona (avisar y ofrecer cambiar la fecha); y en el móvil, una sola tarjeta por curso aunque hubiera varias. **No borrar lo existente**: hay intentos enganchados.

---

## 6. 🔴 LA LECCIÓN DE PROCESO (esto importa más que el rediseño)

Este error no es del módulo de Formación. Es un patrón: **se ha estado dando por terminado lo que estaba mergeado, sin ejecutar el paso 4 del ritual (MEDIR)**.

**Regla nueva, obligatoria en todo encargo a partir de ahora:**

> Cada encargo lleva su **criterio de aceptación desde la perspectiva de quien lo usa**, no solo técnico.
> No *"asigna los cursos del itinerario"*, sino *"un empleado nuevo abre su móvil y ve exactamente 2 cursos, sin fechas vencidas, con su progreso"*.
> Y **nada se da por hecho hasta comprobar ese criterio en pantalla**.

Corolario para quien diseña: cuando se proponga una solución rápida, **decir explícitamente que es un parche**, en vez de presentarla como diseño.

---

## 7. ORDEN DE CONSTRUCCIÓN

1. **`training_path_progress` + liberación de fase 1 al alta** — solo se asignan los cursos de la fase liberada.
2. **Recalcular los `due_at` existentes** (fin de las fechas de 2025) y regenerar las asignaciones actuales al modelo nuevo.
3. **Pantalla del empleado**: fase actual, progreso, sin `solo_archivo`, una tarjeta por curso.
4. **Liberación automática** al completar fase + cron de desfase temporal.
5. **Liberación manual**, individual y por grupo (campaña).
6. **Excepción documentada** ("no aplica" con motivo).
7. **Prerrequisitos entre cursos** — opcional, último.

---

## 8. CÓMO SE MIDE (paso 4, y esta vez se ejecuta)

- Un empleado nuevo ve **exactamente los cursos de su fase 1**, ni uno más.
- **Ninguna asignación con `due_at` anterior a la puesta en marcha** del sistema.
- **Ningún curso duplicado** en la pantalla del trabajador.
- % que completa la fase 1 **antes de su primer turno en cocina** (objetivo: 100%).
- Tiempo medio entre liberación de fase y finalización.

---

## Fuentes del benchmark

- TechClass — *What Is Drip Content?* (liberación escalonada, prerrequisitos, onboarding semana a semana)
- BrainCert — *How to Use Learning Paths in Your LMS* (desbloqueo por módulo completado, ejemplo de itinerario por semanas, revisión anual del itinerario)
- FreshLearn — *Best LMS for Employee Training 2026* (drip por fecha o desfase desde inscripción, bloqueo por prerrequisito)
- HRMorning — *LMS Software: A Strategic HR Guide* (itinerarios frente a cursos sueltos, prerrequisitos, excepciones por experiencia previa)
- Paycom Learning · Growth Engineering — asignación automática a individuos o grupos, dependencias y campañas

_Rediseño realizado el 04/08/2026 tras comprobar el resultado real en pantalla._
