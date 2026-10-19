-- scripts/conta/produccion/cuentas/i01c-justificantes.sql
--
-- I01c · LO QUE CUENTA LA TANDA DE LOS JUSTIFICANTES (0260), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: el CHECK de tax_return_box.origin, de dos valores a
-- tres; las tres funciones, de «no existe» a «existe». Y lo de Foodint, IGUAL
-- antes y después: sus declaraciones por estado y sus casillas por origen (la
-- tanda no escribe ninguna).
select clave, valor from (
  select 1 o, 'CHECK de tax_return_box.origin' clave,
    coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'tax_return_box_origin_check'), 'no existe') valor union all
  select 2, 'funciones de los justificantes',
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_impuesto_justificante_mirar(uuid,jsonb)', 'public.conta_impuesto_justificantes_repasar(uuid,jsonb)',
                         'public.conta_impuesto_justificante_apuntar(uuid,jsonb)']) n) union all
  select 3, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 4, 'casillas de Foodint (origen:n)',
    (select coalesce(string_agg(origin || ':' || n, ' · ' order by origin), 'ninguna')
       from (select origin, count(*) n from public.tax_return_box where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by origin) x)
) t order by o;
