-- scripts/conta/produccion/cuentas/i01h-sociedades.sql
--
-- I01h · LO QUE CUENTA LA TANDA DE LA 0340 (el 202 desde el último 200),
-- antes y después. SOLO LEE. Huellas y recuentos de Foodint (regla 9), y los
-- objetos de la base de tabla entera (etiquetados).
--
-- Lo que tiene que pasar: la tabla de los 200 y las tres funciones nuevas no
-- existen antes y existen después; el CHECK de lo comprobado gana una clave;
-- el calendario cambia de huella; la clave anónima deja de poder llamar a las
-- tres funciones de la 0330. Los 200 y 202 de Foodint y sus casillas, IGUAL
-- antes y después (la tanda no calcula nada: los 200 los escribe Julio).
select clave, valor from (
  select 1 o, 'tabla de los 200 (corporate_tax_filing)' clave,
    case when to_regclass('public.corporate_tax_filing') is null then 'no existe' else 'existe' end valor union all
  select 2, 'funciones del 202 y el 200 (nombre:firmas)',
    (select coalesce(string_agg(proname || ':' || n, ' · ' order by proname), 'ninguna')
       from (select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('conta_impuesto_202_calcular', 'conta_impuesto_200_poner', 'conta_impuesto_sociedades') group by 1) x) union all
  select 3, 'CHECK de lo comprobado (md5 de su definición)',
    coalesce((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'tax_return_check_check_key_check'), 'no existe') union all
  select 4, 'calendario (md5 del cuerpo de conta_impuesto_calendario)',
    (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_calendario(uuid,date)'::regprocedure) union all
  select 5, 'la clave anónima llama a las funciones del 111 y el 115 (de tabla entera: permisos)',
    (select string_agg(proname || ':' || has_function_privilege('anon', oid, 'execute'), ' · ' order by proname)
       from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('conta_impuesto_retenciones_diario', 'conta_impuesto_retenciones_calcular', 'conta_impuesto_perceptores_poner')) union all
  select 6, '200 y 202 de Foodint (modelo/periodo/estado)',
    (select coalesce(string_agg(form_code || '/' || fiscal_year || period || '/' || status, ' · ' order by form_code, fiscal_year, period), 'ninguno')
       from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and form_code in ('200', '202')) union all
  select 7, 'casillas del 200 y el 202 de Foodint (md5)',
    (select md5(coalesce(string_agg(r.form_code || r.fiscal_year || r.period || b.box || coalesce(b.value::text, b.value_text) || b.origin, '|' order by r.form_code, r.fiscal_year, r.period, b.box), ''))
       from public.tax_return r join public.tax_return_box b on b.tax_return_id = r.id
      where r.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and r.form_code in ('200', '202'))
) x order by o;
