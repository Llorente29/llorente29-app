-- scripts/conta/produccion/cuentas/v02d-avisos.sql
--
-- V02d (25/10) · LO QUE CUENTA LA TANDA DE LOS AVISOS, antes y después. SOLO
-- LEE. Recuentos de Foodint (regla 9); las funciones y la tabla son de la base
-- entera, y se dice. Lo que tiene que cambiar: las cuatro huellas, «Ya lo tengo»
-- de «no existe» a 0, las marcas de 0 a 3 columnas, y las dos funciones nuevas de «no» a «sí». Lo demás,
-- igual: la tanda no toca datos (las fuentes de Foodint siguen siendo las mismas).
-- Medido en producción el 25/10 a las 21:00 UTC (después del PC01), antes:
-- 24 / 25 · no existe · 54fff875 · bf1f2d80 · 21f5d1aa · 6bacc6fa · 0 · no / no.
select clave, valor from (
  select 1 o, 'fuentes esperadas de Foodint (activas / todas)' clave,
    (select count(*) filter (where active) || ' / ' || count(*) from public.supplier_expected_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, '«Ya lo tengo» apuntados (base entera)',
    case when to_regclass('public.conta_puerta_recibido') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_puerta_recibido', false, true, '')))[1]::text end union all
  select 3, 'huella de _conta_puerta_llegadas',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_conta_puerta_llegadas') union all
  select 4, 'huella de conta_puerta_fuentes',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_puerta_fuentes') union all
  select 5, 'huella de conta_puerta_fuentes_proponer',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_puerta_fuentes_proponer') union all
  select 6, 'huella de conta_puerta_fuente_guardar',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_puerta_fuente_guardar') union all
  select 7, 'las marcas de quién decidió qué en supplier_expected_invoice (base entera)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier_expected_invoice'
       and column_name in ('rhythm_set_by', 'active_set_by', 'location_set_by'))::text union all
  select 8, 'conta_puerta_al_dia y _conta_puerta_cubre (base entera)',
    case when to_regprocedure('public.conta_puerta_al_dia(uuid)') is null then 'no' else 'sí' end || ' / ' ||
    case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_conta_puerta_cubre') then 'sí' else 'no' end
) t order by o;
