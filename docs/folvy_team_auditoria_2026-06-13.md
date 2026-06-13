# Folvy — Auditoría a fondo del módulo Team (Personal)

> Fecha: 2026-06-13. Fuente: RECON contra BBDD (información_schema, pg_stat, pg_policies)
> + lectura de repo. Cuenta de producción: Llorente29 (51ad1792…) + sandbox Folvy
> Interno (0000…0001). Estado marcado: ✅ vivo · 🟡 a medias · ⚪ construido sin uso · 🔴 roto/deuda.

## Resumen ejecutivo (lo que duele)

1. 🔴 **DOBLE MODELO DE HORARIO.** Conviven dos sistemas: el VIVO (`schedules.cells`
   JSONB, vía `schedulerService` + `scheduleGenerator` + `types/scheduler.ts`, leído por
   `CalendarioPage`) y un ESQUELETO MUERTO (`weekly_plans` + `shift_assignments` +
   `shift_types`, vía `calendarService.ts`). Las tablas del muerto están a 0. Riesgo real:
   cualquier servicio que lea el modelo muerto devuelve vacío (ver Bolsa de horas y Gestoría).
2. 🔴 **FICHAJE SIN USO.** `clock_entries` = 0 filas. Control horario / Kiosko fichaje no se
   usan en producción. Toda la cascada de "local operativo de sesión" sigue sin verificar con datos reales.
3. 🟡 **VACACIONES CUENTAN LUNES-VIERNES.** `workingDaysBetween` asume semana Mon-Fri.
   Un cocinero/camarero trabaja fines de semana → el cómputo de días es incorrecto para
   hostelería. La ley fija 30 días naturales (≈22 laborables); habría que contar contra el
   patrón real de turnos o pasar a días naturales.
4. ⚪ **MODELO RICO DE TURNO SIN USAR.** `shift_types` (turno partido, descanso, color) = 0.
   El horario vivo usa `shift_templates` (solo `start_time`/`end_time` + cobertura por día),
   así que no hay partidos ni breaks reales en el cálculo.

## Estado por área

### Empleados — ✅ vivo
`employees` = 6. Alta, acceso (usuario/contraseña + QR), permisos por persona
(`manager_permissions`). Base sólida.

### Control horario / Kiosko fichaje — 🔴 sin uso
`clock_entries` = 0. El fichaje está construido (cascada de local operativo cableada) pero
nunca verificado con fichajes reales. Deuda declarada de antes; confirmada con dato duro.

### Solicitudes (ausencias/vacaciones) — 🟡 funcional, con flanco
`vacations` = 0 (aún sin solicitudes reales). `vacation_settings`: hoy se sembró 1 fila
global POR CUENTA y se reescribió la RLS (estaba rota: escondía la fila global a todos).
Tipos de solicitud configurables por cuenta (vacaciones siempre on). Flanco: cómputo
Mon-Fri (punto 3 del resumen). Deuda nueva: cuentas nuevas necesitan su fila global al
darse de alta (onboarding) o crearla al primer acceso.

### Turnos abiertos — ⚪ construido sin uso
`open_shifts` = 0, `open_shift_requests` = 0. Flujo "hueco que alguien cubre" cableado,
sin uso real.

### Cambios de turno — ⚪ construido sin uso
`shift_swap_requests` = 0. `SolicitarCambioModal` + `shiftSwapService` existen. Sin uso real.

### Calendario / Plantilla turnos — ✅ vivo (modelo simple) + 🔴 deuda (modelo doble)
`schedules` = 2 (incluye la semana actual de Llorente29: Foodint Alcalá, `week_start`
2026-06-08, published). `shift_templates` = 8 (tramos con cobertura por día). El motor vivo
(`schedulerService`/`scheduleGenerator`) funciona: generar, editar, validar, publicar, vista
"Horario por empleado" plegable. El modelo muerto paralelo (`calendarService` +
`weekly_plans`/`shift_assignments`/`shift_types`) es la deuda a retirar o terminar.

Estructura de `schedules.cells`:
`{ shiftTemplateId: { díaSemana(0-6): [employeeId, ...] } }` — organizado por tramo→día→empleados.
Para "el horario de UN trabajador" hay que invertirlo. Para "copiar semana" basta clonar
`cells` a otro `week_start`.

### Informes Gestoría — 🟡 verificar fuente
`account_gestoria_config` = 2. `exportGestoriaService` existe. **PENDIENTE verificar**: ¿lee
del modelo vivo (`schedules.cells`) o del muerto (`shift_assignments`)? Si lee el muerto, el
export sale vacío. Riesgo del doble modelo.

### Bolsa de horas — 🟡 verificar fuente
`hoursBalanceService` existe. **PENDIENTE verificar** la misma duda que Gestoría: de qué
modelo lee las horas trabajadas. Si lee `shift_assignments` (vacío), la bolsa está rota.

## Tablas y volúmenes (RECON pg_stat)

Vivas con datos: `employees` (6), `shift_templates` (8), `schedules` (2),
`account_gestoria_config` (2), `vacation_settings` (2). A cero (construido sin uso):
`clock_entries`, `shift_assignments`, `shift_types`, `shift_minimums`, `open_shifts`,
`open_shift_requests`, `shift_swap_requests`, `employee_availability`, `employee_formations`,
`vacations`.

## Acciones recomendadas (orden por impacto)

1. **Decidir el modelo de horario único**: retirar `calendarService`/`weekly_plans`/
   `shift_assignments`/`shift_types` (muerto) o terminar la migración. Hasta entonces,
   verificar que Gestoría y Bolsa de horas leen `schedules.cells`, no el muerto. (Riesgo de
   datos vacíos en nómina.)
2. **Vacaciones en días naturales o contra patrón real** (hostelería trabaja findes).
3. **Fichaje**: validar `clock_entries` con un fichaje real antes de venderlo.
4. **Calendario del trabajador** (MiHorario) más claro + **copiar horario** (semana/mes) —
   features pedidas, diseño aparte.

## Notas de verificación pendientes (no asumidas)
- Confirmar que en `cells` el día 0 = lunes (coherente con `week_start` = lunes; a validar).
- Confirmar fuente de datos de `exportGestoriaService` y `hoursBalanceService`.
