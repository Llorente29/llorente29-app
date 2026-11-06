-- scripts/conta/produccion/cuentas/b01r-cargos-anulados.sql
--
-- B01·19 · Los tres cargos del 30/10 que el BBVA anuló (2350) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale igual
-- en producción y en staging (que no tiene Foodint: ahí todo da 0 antes y después).
--   1. De los tres (por su id), los que no están ignorados con su motivo: 3 → 0.
--   2. El saldo de Sumied a 04/11 (el del extracto del 28/10 más lo no ignorado del 29/10 al 04/11), menos el
--      del banco a 04/11: ···6536 −3.308,46 → 0,00; ···4525 −798,36 → 0,00.
--   3. Lo demás de Foodint no se mueve: los ignorados sin contar los tres, y los por aclarar más los tres.
select clave, valor from (
  -- quieta: solo los tres movimientos de la lista, por su id
  select 1 o, 'De los 3 cargos anulados del 30/10, sin ignorar con su motivo' clave,
    (select count(*)::text from public.bank_movement m
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and m.id in ('9d7826af-32b0-4f45-9368-45f98a030d47', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918')
        and not (m.status = 'ignorado' and m.ignored_reason = 'Anulado por el banco: no había saldo')) valor
  union all
  -- corte: movimientos con fecha del 29/10 al 04/11 y el saldo del banco a 28/10 y a 04/11
  select 2, '···' || c.c || ' a 04/11, Sumied menos el banco',
    (select case when not exists (select 1 from public.treasury_account t where t.id = c.t) then 0
                 else c.base + coalesce(sum(m.amount), 0) - c.banco end::numeric(14,2)::text
       from public.bank_movement m
      where m.treasury_account_id = c.t and m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and m.op_date between date '2026-10-29' and date '2026-11-04' and m.status <> 'ignorado')
    from (values ('6536', '488a26b1-ec02-48b3-874d-c9628e31111b'::uuid, 175.55, 0.64),
                 ('4525', '1a8ff29b-e37a-147b-9cc6-0a939f9b0357'::uuid, 98.57, 1.89)) c(c, t, base, banco)
  union all
  -- corte: movimientos de Foodint creados antes del 07/11 (la tanda no crea ninguno)
  select 3, 'Foodint: ignorados sin contar los 3',
    (select count(*)::text from public.bank_movement m
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.created_at < timestamptz '2026-11-07 00:00:00+01' and m.status = 'ignorado'
        and m.id not in ('9d7826af-32b0-4f45-9368-45f98a030d47', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918'))
  union all
  select 4, 'Foodint: por aclarar más los 3',
    (select (count(*) filter (where m.status = 'por_aclarar')
             + count(*) filter (where m.id in ('9d7826af-32b0-4f45-9368-45f98a030d47', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918')
                                  and m.status = 'ignorado'))::text
       from public.bank_movement m
      -- corte: creados antes del 07/11
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.created_at < timestamptz '2026-11-07 00:00:00+01')
) t order by o, clave;
