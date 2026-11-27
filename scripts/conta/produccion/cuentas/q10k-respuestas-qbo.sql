-- scripts/conta/produccion/cuentas/q10k-respuestas-qbo.sql
--
-- Q10 · respuesta 9 (1126) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: las decisiones de QBO (0 → 3). Lo demás, igual: las otras decisiones y lo mandado a Cegid.
select clave, valor from (
  select 1 o, 'decisiones de QBO vía Julio' clave,
    -- quieta: solo las escribe la 1126
    (select count(*) from public.conta_banco_decision where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and quien = 'QBO vía Julio (27/11)')::text valor
  union all
  select 2, 'quietos · las otras decisiones de QBO',
    -- quieta: la 1126 solo añade las suyas; «Facturas del mes» no se pulsa durante el real
    (select count(*) || ' · ' || coalesce(md5(string_agg(clave || '=' || decision, '|' order by clave)), '-') from public.conta_banco_decision where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and quien is distinct from 'QBO vía Julio (27/11)')
  union all
  select 3, 'quietos · incidencias mandadas de QBO',
    -- quieta: solo las escribe «Mandar a Cegid», que nadie pulsa durante el real
    (select count(*) || ' · ' || coalesce(md5(string_agg(id::text || '=' || estado, '|' order by id)), '-') from public.conta_cegid_incidencia where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')
) t order by o, clave;
