-- scripts/conta/produccion/cuentas/b02-espera.sql
--
-- B02 · LO QUE CUENTA LA TANDA «ESPERA EL EXTRACTO» (T4, 0220), antes y
-- después. SOLO LEE. Los movimientos de Foodint por estado (no puede cambiar
-- ninguno: la tanda no escribe filas) y, por cada banco de su empresa, lo que
-- dice el cierre de octubre: después, contabilidad parte del saldo del
-- extracto a 30/09 y dice cuántos esperan. La vuelta atrás tiene que devolver
-- lo mismo que antes.
select clave, valor from (
  select 1 o, 'movimientos ' || m.status clave, count(*)::text valor
    from public.bank_movement m where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by m.status union all
  select 2, 'octubre ···' || right(coalesce(t.iban, t.id::text), 4),
         'banco ' || coalesce(e->>'saldo_banco', '—') || ' · contabilidad ' || (e->>'saldo_libro') || ' · sueltos ' || (e->>'sueltos')
         || coalesce(' · esperan ' || (e->>'esperan'), '') || coalesce(' · apertura ' || (e->'apertura')::text, '')
    from public.treasury_account t, lateral (select public._bank_mes_estado(t.id, date '2026-10-01') e) x
   where t.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and t.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and t.kind = 'bank' and t.is_active
) t order by o, clave;
