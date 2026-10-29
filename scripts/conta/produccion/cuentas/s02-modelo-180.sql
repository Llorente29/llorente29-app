-- scripts/conta/produccion/cuentas/s02-modelo-180.sql
--
-- S02 · LO QUE CUENTA LA TANDA DEL 180, antes y después. SOLO LEE. Recuentos
-- de Foodint (regla 9), sin nombres, NIF, CSV ni importes.
--
-- Lo que tiene que pasar: las funciones conta_impuesto_* suben 3 (de N a
-- N+3); las tres del 180, de false a true; la tabla del inmueble, de no estar
-- a estar vacía; las claves del CHECK de lo comprobado, de 17 a 20; las
-- declaraciones de Foodint de antes del corte, igual (la tanda no calcula
-- nada). Lo comprobado no se cuenta: se rehace en cada cálculo (#241).
select clave, valor from (
  select 1 o, 'funciones conta_impuesto_*' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_impuesto\_%')::text valor union all
  select 2, 'las tres del 180 (calcular / inmueble / fichero)',
    concat_ws(' / ', (to_regprocedure('public.conta_impuesto_180_calcular(uuid,int)') is not null)::text,
                     (to_regprocedure('public.conta_impuesto_180_inmueble_poner(uuid,uuid,jsonb)') is not null)::text,
                     (to_regprocedure('public.conta_impuesto_180_fichero(uuid,uuid)') is not null)::text) union all
  select 3, 'inmuebles arrendados de Foodint (company_lease)',
    case when to_regclass('public.company_lease') is null then 'no está'
         else (xpath('//n/text()', query_to_xml('select count(*) n from public.company_lease where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, false, '')))[1]::text end union all
  select 4, 'claves del CHECK de tax_return_check',
    (select (length(d) - length(replace(d, '''::text', ''))) / length('''::text') from (select pg_get_constraintdef(oid) d from pg_constraint where conname = 'tax_return_check_check_key_check') x)::text union all
  select 5, 'declaraciones de Foodint (todas / 180)',
    (select count(*) || ' / ' || count(*) filter (where form_code = '180') from public.tax_return
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-29 08:00:00+00')
) q order by o;
