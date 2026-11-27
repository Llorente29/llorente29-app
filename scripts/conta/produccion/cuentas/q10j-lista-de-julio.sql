-- scripts/conta/produccion/cuentas/q10j-lista-de-julio.sql
--
-- Q10 · respuesta 8 (0905) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: las decisiones de «facturar» (0 → 5, las de tarjeta). Lo demás, igual: lo mandado a Cegid,
-- las otras decisiones y los pagos con tarjeta.
select clave, valor from (
  select 1 o, 'decisiones de facturar de QBO' clave,
    -- quieta: solo las escriben la 0905 y «Facturar con este concepto», que nadie pulsa durante el real
    (select count(*) from public.conta_banco_decision where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and decision = 'facturar')::text valor
  union all
  select 2, 'quietos · las otras decisiones de QBO',
    -- quieta: la 0905 solo añade decisiones de facturar
    (select count(*) || ' · ' || coalesce(md5(string_agg(clave || '=' || decision, '|' order by clave)), '-') from public.conta_banco_decision where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and decision <> 'facturar')
  union all
  select 3, 'quietos · incidencias mandadas de QBO',
    -- quieta: solo las escribe «Mandar a Cegid», que nadie pulsa durante el real
    (select count(*) || ' · ' || coalesce(md5(string_agg(id::text || '=' || estado, '|' order by id)), '-') from public.conta_cegid_incidencia where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')
  union all
  select 4, 'quietos · pagos con tarjeta de QBO',
    -- quieta: la 0905 no los toca; los escribe K, que no aplica nada durante el real
    (select count(*) || ' · ' || coalesce(sum(importe), 0)::text from public.conta_banco_cobro_tarjeta where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')
) t order by o, clave;
