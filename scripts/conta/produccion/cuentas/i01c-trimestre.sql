-- scripts/conta/produccion/cuentas/i01c-trimestre.sql
--
-- I01c · LO QUE CUENTA LA TANDA DEL TRIMESTRE (0280), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: conta_impuesto_trimestre, de «no existe» a «existe»;
-- conta_impuesto_303_calcular existe antes y después (cambia por dentro, misma
-- firma: su huella cambia). Y lo de Foodint, IGUAL antes y después: sus
-- declaraciones por estado y sus casillas por origen (la tanda no escribe
-- ninguna; el borrador del 3T se pone al día cuando se abre la pantalla).
select clave, valor from (
  select 1 o, 'funciones de la 0280' clave,
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_impuesto_trimestre(uuid,integer,integer)']) n) valor union all
  select 2, 'huella del cálculo del 303 (md5 del cuerpo)',
    (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_impuesto_303_calcular(uuid,integer,text)')) union all
  select 3, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 4, 'casillas de Foodint (origen:n)',
    (select coalesce(string_agg(origin || ':' || n, ' · ' order by origin), 'ninguna')
       from (select origin, count(*) n from public.tax_return_box where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by origin) x)
) t order by o;
