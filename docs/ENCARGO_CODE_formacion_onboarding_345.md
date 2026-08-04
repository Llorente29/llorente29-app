# ENCARGO CODE — Formación · Onboarding piezas 3, 4 y 5
## Semáforo en el cuadrante · Calendario de formación · Recordatorios y escalado

> **Diseño**: `docs/folvy_formacion_onboarding_diseno.md` §3.2, §3.4, §3.5 y el orden de construcción de §7.
> **Depende de**: el núcleo y el semáforo de ficha (piezas 1-2), ya aplicados y verificados.
> **Estado real hoy**: 9 empleados con formación pendiente · 83 asignaciones vencidas · **8 en rojo** (sin los dos cursos bloqueantes). O sea: esto no es hipotético, hay 8 personas que no deberían estar manipulando alimentos sin acreditar.

---

## PIEZA 3 — 🎯 SEMÁFORO EN EL CUADRANTE (la goleada, hazla primero)

### Por qué es la más valiosa de las tres
El calendario (pieza 4) es una vista que **alguien tiene que acordarse de mirar**. El aviso en el cuadrante **salta solo, en el momento exacto en que se comete el error**: al poner a alguien sin formación bloqueante en un turno de cocina.

**Ningún LMS del mercado puede hacer esto**, porque ninguno sabe quién trabaja mañana. Folvy sí. Es la ventaja estructural del módulo.

### 🔴 RECON hecho — el dato que condiciona el diseño
El cuadrante **no guarda un turno por fila**: `schedules` tiene `cells` (jsonb), `coverage_overrides`, `location_id`, `week_start`, `status`, `published_at`. Los turnos viven dentro de ese JSON.

**Consecuencia**: no puedes hacer un simple join empleado↔turno. Hay que:
- **RECON obligatorio de la estructura de `schedules.cells`** (qué forma tiene, cómo referencia al empleado) antes de escribir nada. Mira `CalendarioPage.tsx`, `scheduleGenerator.ts` y `scheduler.ts`.
- Decidir dónde se calcula el semáforo: probablemente **en el cliente**, cargando el estado de formación de los empleados del cuadrante en un lote (una sola llamada) y cruzándolo al pintar. Reutiliza `training_compliance_matrix`, **no recalcules "¿está vigente?" por cuarta vez**.

### Comportamiento
**Decisión de Julio, firme: AVISAR CON FUERZA, NO BLOQUEAR.** Un bloqueo duro en hora punta se acaba esquivando, y entonces se pierde la señal de verdad.

- **Indicador visible** junto al empleado en la celda del turno: 🔴 si le falta formación **bloqueante**, 🟡 si tiene pendientes no bloqueantes. Sin distraer: el cuadrante ya es una pantalla densa.
- **Aviso destacado al publicar el cuadrante**: *"3 personas asignadas a turnos de cocina no tienen la formación obligatoria acreditada"*, con la lista y un enlace a asignarles el curso. **Se puede publicar igualmente.**
- **Solo cuenta el rojo donde importa**: si alguien sin formación de higiene está asignado a un turno de **cocina**, es rojo. Si el itinerario o el puesto no lo requieren, no molestes. Usa `training_path_item.is_blocking` cruzado con el puesto.

### Regla de oro
**Cero falsos positivos.** Un semáforo que se pone rojo sin motivo se ignora en una semana y entonces no sirve para nada. Ante la duda, no marcar.

---

## PIEZA 4 — CALENDARIO DE FORMACIÓN

Vista temporal en Team → Formación, con tres capas (§3.4 del diseño):

1. **Qué vence** — asignaciones con `due_at` próximo, ordenadas por urgencia. Distinguir visualmente **bloqueante** de lo demás.
2. **Qué caduca** — cursos vigentes que expiran por `reeval_months`, y certificados externos de `employee_formations` con su `expiry_date`.
3. **Reevaluaciones** — periódicas y, en el futuro, las disparadas por evento APPCC.

- Filtros por **local** y por **puesto**.
- Vista de mes, con navegación.
- ⚠️ **Con 83 asignaciones ya vencidas**, la vista por defecto no puede ser un muro rojo inmanejable: agrupa por empleado o por curso, no una lista plana de 83 filas.

---

## PIEZA 5 — RECORDATORIOS Y ESCALADO

Es lo que todos los líderes del sector señalan como imprescindible, y hoy no lo tenemos.

**Al empleado** (en su portal): aviso al asignarle formación y cuando se acerca el plazo.

**Al responsable**: resumen de quién va tarde, con **escalado** — si un curso **bloqueante** sigue sin hacerse pasada la fecha, se avisa con más énfasis.

**Cron diario**, mismo patrón que los watchdogs ya vivos (`delivery_watchdog`, `dispatch_watchdog`). RECON de cómo están montados y sigue ese patrón; no inventes otro.

⚠️ **Anti-spam, importante**: con 83 vencidas, un recordatorio diario por cada una convierte el aviso en ruido y la gente deja de leerlo. **Un resumen agregado por persona y por responsable**, con frecuencia razonable (semanal para lo no bloqueante, más frecuente solo para bloqueantes). Y guarda constancia de lo enviado para no repetir.

---

## ENTREGA

1. Rama `feature/formacion-onboarding-345`.
2. **Si no caben las tres, entrega la 3 y la 4 completas y declara la 5.** La pieza 3 es la prioritaria.
3. Migraciones entregadas, **no aplicadas por ti**. **DDL y backfill en ficheros separados. Nunca COMMIT/ROLLBACK en un bloque DO.**
4. `database.ts` regenerado en el mismo commit si cambia el esquema.
5. `npm run build` verde.
6. **RECON directo, sin subagentes.**
7. `git branch --show-current` antes de cada commit; `git rev-list --count origin/main..main` al final.

**Nota sobre el incidente de rama**: ha pasado dos veces que tu rama cambiaba a `main` a mitad de tarea porque Julio commiteaba en el mismo directorio. Lo hemos corregido por nuestro lado (ya no se le indica `git checkout main` por defecto). Mantén igualmente el chequeo de rama antes de cada commit.

## FUERA DE ALCANCE
Contenido de cursos · multiidioma · rutas por puesto dentro del curso · ciclo APPCC → reevaluación por evento (C5 del diseño original, frente propio).

---

_Encargo generado el 04/08/2026 · frente de Formación, onboarding piezas 3-5._
