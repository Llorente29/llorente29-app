-- scripts/conta/produccion/cuentas/p01-despacho.sql
--
-- P01 · LO QUE CUENTA LA TANDA DE «IMPUESTOS DE TUS CLIENTES» (0100), antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9) y existencia de objetos.
--
-- Lo que tiene que pasar: las dos columnas de accounts, la tabla
-- tax_client_assignee y las ocho funciones, de «no existen» a «existen». Y lo
-- de Foodint, IGUAL antes y después: no queda marcada como asesoría y sus
-- declaraciones por estado no cambian (la tanda no escribe ninguna fila).
select clave, valor from (
  select 1 o, 'columnas de la 0100 en accounts' clave,
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'accounts'
        and column_name in ('tax_advisor_since', 'tax_advisor_by')) valor union all
  select 2, 'tabla tax_client_assignee',
    case when to_regclass('public.tax_client_assignee') is null then 'no existe' else 'existe' end union all
  select 3, 'funciones de la 0100',
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_despacho_clientes(uuid)', 'public.conta_despacho_correo_poner(uuid,text)',
                         'public.conta_despacho_equipo(uuid)', 'public.conta_despacho_marcar(uuid,boolean)',
                         'public.conta_despacho_responsable_poner(uuid,uuid,uuid)', 'public.conta_despacho_soy(uuid)',
                         'public.conta_despacho_trimestre(uuid,integer,text,date)', 'public.conta_impuesto_nombre_de_en(uuid,uuid)']) n) union all
  select 4, 'Foodint marcada como asesoría',
    -- to_jsonb: se puede leer antes de que la columna exista (da «no»).
    (select coalesce(to_jsonb(a) ->> 'tax_advisor_since', 'no') from public.accounts a where a.id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 5, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x)
) t order by o;
