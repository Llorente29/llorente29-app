-- scripts/conta/produccion/cuentas/i01g-retenciones.sql
--
-- I01g · LO QUE CUENTA LA TANDA DE LA 0330 (el 111 y el 115 desde el diario),
-- antes y después. SOLO LEE. Huellas y recuentos de Foodint (regla 9).
--
-- Lo que tiene que pasar: las tres funciones no existen antes y existen
-- después, una de cada; el CHECK de lo comprobado pasa de diez claves a trece.
-- Las declaraciones del 111 y el 115 de Foodint y sus casillas, IGUAL antes y
-- después (la tanda no calcula nada).
select clave, valor from (
  select 1 o, 'funciones del 111 y el 115 (nombre:firmas)' clave,
    (select coalesce(string_agg(proname || ':' || n, ' · ' order by proname), 'ninguna')
       from (select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('conta_impuesto_retenciones_diario', 'conta_impuesto_retenciones_calcular', 'conta_impuesto_perceptores_poner') group by 1) x) valor union all
  select 2, 'CHECK de lo comprobado (md5 de su definición)',
    coalesce((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'tax_return_check_check_key_check'), 'no existe') union all
  select 3, '111 y 115 de Foodint (modelo/periodo/estado)',
    (select coalesce(string_agg(form_code || '/' || fiscal_year || period || '/' || status, ' · ' order by form_code, fiscal_year, period), 'ninguno')
       from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and form_code in ('111', '115')) union all
  select 4, 'casillas del 111 y el 115 de Foodint (md5)',
    (select md5(coalesce(string_agg(r.form_code || r.fiscal_year || r.period || b.box || coalesce(b.value::text, b.value_text) || b.origin, '|' order by r.form_code, r.fiscal_year, r.period, b.box), ''))
       from public.tax_return r join public.tax_return_box b on b.tax_return_id = r.id
      where r.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and r.form_code in ('111', '115'))
) x order by o;
