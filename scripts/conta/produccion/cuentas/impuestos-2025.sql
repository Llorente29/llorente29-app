-- scripts/conta/produccion/cuentas/impuestos-2025.sql
--
-- I01d · LO QUE CUENTA LA TANDA DE LOS IMPUESTOS DE 2025 (20261130T0420),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). La 0420 solo cambia una función
-- que lee: las declaraciones de Foodint, sus casillas y sus obligaciones
-- tienen que salir iguales.
select clave, valor from (
  select 1 o, 'la función del trimestre (md5 del cuerpo)' clave,
      (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_impuesto_trimestre(uuid,integer,integer)')) valor union all
  select 2, 'declaraciones de Foodint por año y estado (no se tocan)', (select coalesce(string_agg(y || ' ' || status || ' ' || n, ' · ' order by y, status), 'ninguna')
      from (select fiscal_year y, status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1, 2) x) union all
  select 3, 'huella de las casillas de Foodint (no se tocan)', (select md5(coalesce(string_agg(b.tax_return_id::text || ':' || b.box || ':' || coalesce(b.value::text, ''), ',' order by b.tax_return_id, b.box), ''))
      from public.tax_return_box b join public.tax_return r on r.id = b.tax_return_id where r.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 4, 'obligaciones vigentes de Foodint (no se tocan)', (select count(*)::text from public.tax_obligation
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and valid_to is null and active)
) t order by o;
