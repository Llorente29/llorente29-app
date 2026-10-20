-- scripts/conta/produccion/cuentas/i01c-deducida.sql
--
-- I01c · LO QUE CUENTA LA TANDA DE «DEDUCIDA EN» (0290), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: conta_libro_iva_deducir_en y las tres columnas, de
-- «no existe» a «existe»; conta_impuesto_303_calcular existe antes y después
-- (cambia por dentro, misma firma: su huella cambia). Y lo de Foodint, IGUAL
-- antes y después: su libro de IVA por libro, ninguna con «deducida en» (la
-- tanda no marca ninguna), y sus declaraciones y casillas.
select clave, valor from (
  select 1 o, 'funciones de la 0290' clave,
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)']) n) valor union all
  select 2, 'columnas «deducida en»',
    (select coalesce(string_agg(column_name, ' · ' order by column_name), 'ninguna') from information_schema.columns
      where table_schema = 'public' and table_name = 'vat_book_entry' and column_name like 'deduction_%') union all
  select 3, 'huella del cálculo del 303 (md5 del cuerpo)',
    (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_impuesto_303_calcular(uuid,integer,text)')) union all
  select 4, 'libro de IVA de Foodint (libro:n)',
    (select coalesce(string_agg(book || ':' || n, ' · ' order by book), 'ninguna')
       from (select book, count(*) n from public.vat_book_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by book) x) union all
  select 5, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 6, 'casillas de Foodint (origen:n)',
    (select coalesce(string_agg(origin || ':' || n, ' · ' order by origin), 'ninguna')
       from (select origin, count(*) n from public.tax_return_box where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by origin) x)
) t order by o;
