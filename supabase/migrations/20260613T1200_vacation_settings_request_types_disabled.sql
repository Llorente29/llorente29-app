-- 20260613T1200_vacation_settings_request_types_disabled.sql
-- Aplicada: 2026-06-13
--
-- Añade la LISTA NEGRA de tipos de ausencia que el trabajador NO puede
-- solicitar desde el portal. Vacío = todos visibles (preserva el comportamiento
-- actual de las cuentas existentes). 'vacaciones' es núcleo y nunca se incluye
-- aquí (siempre disponible para el trabajador).
--
-- Vive en la fila scope='global' de vacation_settings (mismo modelo de tenencia
-- que el resto de ajustes globales: vacation_days_per_year, etc.).
--
-- Statement único e idempotente. No requiere BEGIN/COMMIT en el SQL Editor.

alter table public.vacation_settings
  add column if not exists request_types_disabled text[] not null default '{}'::text[];
