-- scripts/conta/produccion/cuentas/i01c-csv.sql
--
-- I01c · LO QUE CUENTA LA TANDA DEL JUSTIFICANTE POR CSV (0270), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: las cuatro columnas de tax_return, de «no existen» a
-- «existen»; las dos funciones, existen antes y después (cambian por dentro,
-- misma firma). Y lo de Foodint, IGUAL antes y después: sus declaraciones por
-- estado y sus casillas por origen (la tanda no escribe ninguna).
select clave, valor from (
  select 1 o, 'columnas de la 0270 en tax_return' clave,
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'tax_return'
        and column_name in ('aeat_expediente', 'presenter_tax_id', 'presenter_name', 'receipt_source')) valor union all
  select 2, 'funciones de la 0270',
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_impuesto_justificante_apuntar(uuid,jsonb)', 'public.conta_impuesto_presentados(uuid)']) n) union all
  select 3, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 4, 'casillas de Foodint (origen:n)',
    (select coalesce(string_agg(origin || ':' || n, ' · ' order by origin), 'ninguna')
       from (select origin, count(*) n from public.tax_return_box where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by origin) x)
) t order by o;
