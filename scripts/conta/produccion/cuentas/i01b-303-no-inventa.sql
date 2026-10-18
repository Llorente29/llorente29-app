-- scripts/conta/produccion/cuentas/i01b-303-no-inventa.sql
--
-- I01b · LO QUE CUENTA LA TANDA DEL 303 QUE NO INVENTA (0240), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones; ningún
-- nombre, NIF, CSV ni importe.
--
-- Lo que tiene que pasar: las tres huellas (calcular, fichero, fuera), otra;
-- conta_impuesto_casillas_poner, de «no existe» a «existe». Y lo de Foodint,
-- IGUAL antes y después: sus declaraciones por estado y resultado, sus
-- casillas (calculadas / a mano) y sus comprobaciones por resultado. La tanda
-- no recalcula nada.
select clave, valor from (
  select 1 o, 'huella de conta_impuesto_303_calcular' clave,
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_impuesto_303_calcular(uuid, integer, text)')), 'no existe') valor union all
  select 2, 'huella de conta_impuesto_303_fichero',
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_impuesto_303_fichero(uuid)')), 'no existe') union all
  select 3, 'huella de conta_impuesto_fuera',
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_impuesto_fuera(uuid, uuid, text, boolean, text, timestamp with time zone, uuid)')), 'no existe') union all
  select 4, 'conta_impuesto_casillas_poner',
    case when to_regprocedure('public.conta_impuesto_casillas_poner(uuid, jsonb, text)') is null then 'no existe' else 'existe' end union all
  select 5, 'declaraciones de Foodint por estado y resultado',
    (select coalesce(string_agg(status || '/' || coalesce(result_kind, 'sin resultado') || ' ' || n, ' · ' order by status, result_kind), 'ninguna')
       from (select status, result_kind, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1, 2) x) union all
  select 6, 'casillas de Foodint (calculadas / a mano)',
    (select count(*) filter (where origin = 'calculated') || ' / ' || count(*) filter (where origin = 'manual')
       from public.tax_return_box where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 7, 'comprobaciones de Foodint por resultado',
    (select coalesce(string_agg(result || ' ' || n, ' · ' order by result), 'ninguna')
       from (select result, count(*) n from public.tax_return_check where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1) x)
) t order by o;
