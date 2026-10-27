-- scripts/conta/produccion/cuentas/l1a-fichar-en-el-servidor.sql
--
-- L1a · PR 1 (27/10) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Casi todo es del catálogo (pg_proc, pg_policies, cron.job). Lo único que lee
-- una tabla, los fichajes con coordenadas, va con un corte fijo (antes del
-- 27/07/2026, los que la limpieza borrará esa noche) y es de TABLA ENTERA, de
-- todas las cuentas, a propósito: la tanda no toca ninguna fila.
-- Medido en producción el 27/10 a las 19:5x UTC, antes: ver la cabecera de la
-- tanda (aplicar.txt).
select clave, valor from (
  select 1 o, 'huellas de las cuatro funciones que cambia' clave,
    (select string_agg(p.proname || ' ' || left(md5(p.prosrc), 8), ' · ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('_clock_entry_quien_y_hora', 'add_manual_clock_entry', 'employee_clock_status', '_documento_trabajador_puede')) valor union all
  select 2, 'funciones nuevas (fichar, quién ve a quién, ausencias, datos privados, conservación y vigía)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fichar', 'current_user_ve_persona', 'ausencias_visibles', 'empleados_datos_privados', 'conservar_registro_de_jornada', 'conservacion_vigia', '_distancia_metros'))::text union all
  select 3, 'columnas nuevas de clock_entries',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clock_entries'
      and column_name in ('distance_m', 'within_radius', 'declared_at', 'ubicacion_borrada_at', 'anonimizado_at'))::text union all
  select 4, 'lecturas de personal por papel (current_user_ve_persona)',
    (select count(*) from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'current_user_ve_persona')::text union all
  select 5, 'trabajos de conservación programados',
    (select count(*) from cron.job where jobname in ('registro-jornada-conservacion', 'registro-jornada-conservacion-vigia'))::text union all
  select 6, 'tabla registro_conservacion', case when to_regclass('public.registro_conservacion') is null then 'no existe' else 'existe' end union all
  select 7, 'modo del radio por defecto', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name = 'clock_geofence_mode') union all
  select 8, 'fichajes con coordenadas creados antes del 27/07/2026 (tabla entera, todas las cuentas)',
    (select count(*) from public.clock_entries where created_at < timestamptz '2026-07-27 00:00:00+00' and (lat is not null or lng is not null))::text
) t order by o;
