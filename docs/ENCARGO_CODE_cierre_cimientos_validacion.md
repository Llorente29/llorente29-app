# ENCARGO CODE — Cierre de cimientos de validación (F7.1 UX · generador · F0.6)

## Contexto
El backstop de datos de F7.1 YA está en BBDD (trigger `trg_schedule_no_vacation_conflict` en `schedules`):
ninguna vía de guardado puede persistir un cuadrante que asigne a un empleado en un día de vacación
APROBADA — lanza `CUADRANTE_CON_VACACIONES: <nombre> el DD/MM/YYYY; ...`. Este encargo es la UX encima +
dos cierres pendientes. Regla: **Deuda 0, 0 bordear**. Ficheros completos, no diffs.

## 1) F7.1 — UX de validación de vacaciones (el trigger ya es el backstop; esto lo hace usable)
Objetivo: que el encargado lo vea ANTES de guardar y que, si el trigger rechaza, el error se muestre claro.
- **Aviso pre-guardado**: al asignar/guardar el cuadrante, comprobar en cliente si algún empleado queda en
  un día de vacación aprobada y avisar (nombre + día) antes de mandar el guardado. Reusar la lógica que ya
  existe en `scheduleGenerator.ts` (el generador SÍ valida) — extraer a un helper compartido para no
  duplicar. Estructura: `cells = {shift_template_id: {day_index(0-7): [employee_id]}}`,
  `fecha(dia d) = week_start + (d-1)`. Vacación aprobada = `vacations.status='aprobada'` y fecha entre
  `start_date` y `end_date`.
- **Captura del error del trigger**: en el guardado manual (escritura directa a `schedules` vía PostgREST
  en `CalendarioPage.tsx` / servicio de Team), capturar el error `CUADRANTE_CON_VACACIONES` y mostrarlo en
  un toast/modal legible (el mensaje ya viene con nombre + fecha; parsearlo o mostrarlo tal cual).
- **Gemelo en `scheduler.ts`** si existe una segunda ruta de guardado: misma validación.

## 2) Commit del fix de vacaciones del generador (ya hecho, sin commitear)
Hay cambios ya hechos en `scheduleGenerator.ts` + `CalendarioPage.tsx` (validación de vacaciones del
generador) sin commitear. Verificar que compilan (`npm run build` / `tsc -b`) y commitear. Confirmar que la
validación del generador y el helper del punto 1 usan la MISMA lógica (una sola fuente de verdad).

## 3) F0.6 — Permisos por rol en el módulo Team
La infraestructura ya existe en BBDD: tablas `permission_sets`, `manager_permissions`; funciones
`get_effective_permissions`, `has_permission(account_id, permiso)`, `current_user_is_admin_of`,
`current_user_is_admin_or_manager_of`. **RECON primero**: listar los permisos/roles que ya define
`permission_sets` y qué comprueba `has_permission`, para no inventar un modelo nuevo.
Luego **gatear en la UI** las acciones sensibles de Team según permiso efectivo del usuario:
- editar/publicar cuadrante · aprobar/rechazar vacaciones · alta/baja/edición de empleados ·
  ver/gestionar nóminas · configurar roles/permisos · ver costes de personal.
Cada acción: si el usuario no tiene el permiso, ocultar/deshabilitar el control (no solo confiar en que el
backend lo rechace). El backend ya valida por RLS/función; esto es la capa de UI coherente.
- Decisiones de Julio que hay que recoger antes de cerrar F0.6: qué roles existen (p. ej. admin / encargado
  / empleado) y qué puede hacer cada uno. Si no están definidos, proponer un set por defecto y confirmarlo.

## Entregable
Ficheros completos modificados + confirmación de `npm run build` limpio. Al terminar, F7.1 queda redonda
(backstop BBDD + UX), el generador commiteado, y F0.6 con permisos gateados en Team.

## Verificación
- F7.1: intentar asignar a un empleado de vacaciones aprobadas → aviso antes de guardar; si se fuerza, el
  error del trigger sale legible. Asignar a alguien sin vacación → guarda normal.
- F0.6: con un usuario sin permiso, las acciones sensibles no aparecen/están deshabilitadas.
