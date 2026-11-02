-- scripts/conta/produccion/cuentas/s01o3-comun.sql
--
-- S01o·3 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres de personas.
-- Lo que tiene que pasar: la ficha de Anthropic, de «no» a «común a todos los
-- locales»; ninguna otra ficha de Foodint cambia (0 antes y 0 después de las demás).
select clave, valor from (
  select 1 o, 'Anthropic común a todos los locales' clave,
    (select coalesce(string_agg(coalesce(to_jsonb(s)->>'default_common', 'sin columna'), ','), 'sin ficha') from public.supplier s
      -- quieta: la ficha de Anthropic solo la cambia una persona desde su ficha
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.id = 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8') valor union all
  select 2, 'Otras fichas de Foodint comunes a todos los locales',
    (select count(*)::text from public.supplier s
      -- quieta: «común» solo lo pone una persona desde la ficha, y hasta esta tanda no existe
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.id <> 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8'
        and coalesce((to_jsonb(s)->>'default_common')::boolean, false))
) q order by o;
