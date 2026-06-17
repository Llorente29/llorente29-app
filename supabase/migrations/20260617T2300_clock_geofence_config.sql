-- supabase/migrations/20260617T2300_clock_geofence_config.sql
--
-- Fichaje de raíz: radio y modo de geofence CONFIGURABLES POR LOCAL.
-- Hasta ahora el radio estaba fijo en el código (1000 m) y no llegaba al móvil.
-- Ahora vive en locations:
--   clock_radius_m      : radio en metros para considerar "en el local" (default 200).
--   clock_geofence_mode : 'block' = no deja fichar fuera del radio (default, GPS fiable);
--                         'warn'  = deja fichar fuera, pero marca la distancia para
--                                   que el manager lo revise (GPS caprichoso / sin coords).
-- Idempotente.

alter table public.locations
  add column if not exists clock_radius_m integer not null default 200,
  add column if not exists clock_geofence_mode text not null default 'block';

-- Acota el modo a los dos valores válidos.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_clock_geofence_mode_chk'
  ) then
    alter table public.locations
      add constraint locations_clock_geofence_mode_chk
      check (clock_geofence_mode in ('block', 'warn'));
  end if;
end $$;
