-- F0.6 — Permisos por rol en el módulo Team (encargo Code, cierre de cimientos).
--
-- RECON (verificado vía information_schema + pg_get_functiondef, 2026-08-07):
-- permission_sets / permission_set_assignments existen pero están MUERTAS —
-- has_permission() y get_effective_permissions() solo leen manager_permissions
-- (ver CONTEXTO_CLAUDE.md §7.8). El modelo real es: admin de cuenta -> acceso
-- total; el resto, columna booleana por acción en manager_permissions (1 fila
-- por user_profile, fail-closed si falta la fila o la columna es NULL).
--
-- De las 6 acciones sensibles del encargo, 4 YA estaban cubiertas:
--   - alta/baja/edición de empleados -> can_manage_employees (ya existe, ya
--     gateada en StaffPage.tsx).
--   - ver/gestionar nóminas -> el acceso a NominasPage ya está gateado por
--     show_informes_personal (module.tsx) y toda la página es de gestión.
--   - configurar roles/permisos -> UsuariosAccesosPage ya exige isFullAccess
--     (solo admin) antes de renderizar nada.
--   - ver costes de personal -> se reutiliza show_salaries (el coste en vivo
--     del cuadrante se deriva de la misma nómina que "ver salarios").
--
-- Faltaban 2 acciones sin gate propio: editar/publicar cuadrante y
-- aprobar/rechazar vacaciones. Se añaden como 2 columnas nuevas.
--
-- DEFAULT true en ambas (igual que can_manage_employees): migración no
-- disruptiva — ningún encargado pierde acceso a lo que ya podía hacer hoy: el
-- flujo es "revocar desde el modal", no "conceder". Un admin puede apretar el
-- checkbox por manager desde ManagerPermissionsModal.
alter table public.manager_permissions
  add column if not exists can_edit_schedule boolean not null default true,
  add column if not exists can_approve_vacations boolean not null default true;

comment on column public.manager_permissions.can_edit_schedule is
  'Generar/editar/publicar el cuadrante de turnos (CalendarioPage). Sin este permiso, el encargado solo puede ver.';
comment on column public.manager_permissions.can_approve_vacations is
  'Aprobar/rechazar solicitudes de vacaciones (SolicitudesPendientesPage). Sin este permiso, el encargado solo puede ver la lista.';
