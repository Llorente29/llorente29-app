-- scripts/conta/produccion/cuentas/l1a-cerrar.sql
--
-- L1a · PR 2b (29/10) · LO QUE CUENTA LA TANDA (0730 a 0733), antes y después.
-- SOLO LEE. Las cuentas de clock_entries son de la TABLA ENTERA, todas las
-- cuentas a propósito (la corrección de origen no filtra por cuenta; medido el
-- 29/10, las 1.434 son de Foodint).
select clave, valor from (
  select 1 o, 'políticas de clock_entries (antes 4: read, insert, modify, delete; después 1: read)' clave,
    (select string_agg(polname, ', ' order by polname) from pg_policy where polrelid = 'public.clock_entries'::regclass) valor union all
  select 2, 'la sesión inserta en clock_entries (antes sí, después no)',
    has_table_privilege('authenticated', 'public.clock_entries', 'insert')::text union all
  select 3, 'export_gestoria_mensual: huella y de servidor',
    (select left(md5(pg_get_functiondef(p.oid)), 8) || case when p.prosecdef then ' · definer' else ' · invoker' end
       from pg_proc p where p.oid = to_regprocedure('public.export_gestoria_mensual(uuid,date,date)')) union all
  select 4, 'la sesión lee employees.dni (antes sí, después no) · y employees.name (sí y sí)',
    has_column_privilege('authenticated', 'public.employees', 'dni', 'select')::text || ' · ' ||
    has_column_privilege('authenticated', 'public.employees', 'name', 'select')::text union all
  select 5, '«kiosko» con GPS (antes 1434, después 0) · sin GPS (716 y 716)',
    -- quieta: desde el 28/10 nadie escribe «kiosko» (fichar() guarda «movil» o «tablet»); solo la mueve la 0732
    (select count(*) filter (where lat is not null or ubicacion_borrada_at is not null) || ' · ' ||
            count(*) filter (where lat is null and ubicacion_borrada_at is null)
       from public.clock_entries where source = 'kiosko') union all
  select 6, 'rastro de la corrección de origen (antes 0, después 1434)',
    -- quieta: ese motivo solo lo escribe la 0732 (y su vuelta atrás lo deja igual)
    (select count(*) from public.clock_entry_audit where action = 'edit' and reason like 'Origen corregido:%(20261029T0732_l1a_origen_movil)%')::text union all
  select 7, '_informe_registro_jornada: huella · _solo_cambia_origen existe',
    (select left(md5(pg_get_functiondef(to_regprocedure('public._informe_registro_jornada(uuid,date,date,boolean,boolean)'))), 8))
      || ' · ' || (to_regprocedure('public._solo_cambia_origen(jsonb,jsonb)') is not null)::text
) t order by o;
