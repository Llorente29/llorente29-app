-- docs/conta/staging/04_realtime.sql
--
-- La publicación de Realtime no viaja con pg_dump --schema (las publicaciones
-- son objetos de base, no de esquema). Producción publica estas 13 tablas en
-- supabase_realtime (medido el 01/10/2026 en pg_publication_tables).
alter publication supabase_realtime add table public.app_settings, public.clock_entries, public.documents,
  public.employee_availability, public.employees, public.locations, public.monthly_balance_closures,
  public.open_shift_requests, public.open_shifts, public.schedules, public.shift_templates,
  public.vacation_settings, public.vacations;
