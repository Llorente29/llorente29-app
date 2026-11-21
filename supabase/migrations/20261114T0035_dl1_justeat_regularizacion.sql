-- supabase/migrations/20261114T0035_dl1_justeat_regularizacion.sql
--
-- DL1·30 · Just Eat: la 43000003 a 31/10 con lo que Just Eat debe según sus
-- estados de cuenta (Julio, 14/11, 00:25). Va después de la 1905 (#666), y para
-- si no está aplicada. Nada en el camino del pedido.
--
-- Lo que Just Eat debe a 31/10, según sus 43 estados de cuenta de 2026: 320,17
--   = 323,92 (lo que pagó el 03/11 por el 16–31/10)
--   + 24,86 (Bendito Burrito · Florencio Llorente, liquidación 4061287, sin pagar)
--   − 28,61 (lo que le debemos en 4 tiendas paradas: 4019492 18,44 · 3985628 3,03 ·
--            4040922 4,36 · 4060895 2,78).
-- Con la 1905 la 43000003 queda en 256,66: faltan 63,51, sin documento, que van
-- en un único asiento de regularización a 01/10 contra la 778 (ingreso), con
-- el desglose en el concepto:
--   +186,75 · saldo de antes del 16/06 (la 43000003 decía 321,25; lo que Just
--             Eat debía ese día, según los estados y los pagos del 18/06, 508,00);
--    −65,76 · Bendito Burrito · Florencio Llorente: «pagos» de Just Eat del
--             02/07 (9,94), 17/07 (3,97) y 18/08 (51,85) que no llegaron al banco;
--    −57,48 · lo demás: Meraki Pita · Florencio Llorente (JE Inv. 89645), sin
--             ningún estado de cuenta, y las ventas del día de Diez frente a
--             Just Eat.
-- Las devoluciones al cliente (103,83) no van: Diez ya las restó en las ventas
-- del día, a la 708 con su IVA (66,22 · 23,47 · 11,64 · 2,50).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_je constant uuid := '1fc25ef9-67d7-4b7d-b331-71f6379d131f';   -- Just Eat, su tercero
  v_saldo numeric; v_reg numeric; v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Just Eat regularización: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261113T1905_dl1_justeat_restos') then
    raise exception 'DL1 Just Eat regularización: va después de la 1905 (#666), que no está aplicada: no se apunta nada.';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_saldo
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = v_e and e.account_id = v_acc and a.code = '43000003'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     and e.entry_date between date '2026-01-01' and date '2026-10-31';
  v_reg := 320.17 - v_saldo;
  if v_reg <> 63.51 then
    raise exception 'DL1 Just Eat regularización: la 43000003 a 31/10 está en % (se midió 256,66 con la 1905): no se apunta nada.', v_saldo;
  end if;
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
    'Just Eat · regularización de la 43000003 a lo que debe según sus estados de cuenta: +186,75 saldo de antes del 16/06 · −65,76 Bendito Burrito Florencio Llorente (pagos del 02/07, 17/07 y 18/08 que no llegaron al banco) · −57,48 Meraki Pita Florencio Llorente sin estados y ventas del día de Diez',
    'DL1·30 (Julio, 14/11): la 43000003 a 31/10 tiene que decir lo que Just Eat debe según sus estados de cuenta, 320,17 (323,92 pagados el 03/11 + 24,86 de Bendito Florencio Llorente − 28,61 que le debemos en 4 tiendas paradas). La diferencia no tiene documento: a 01/10 contra la 778, porque los trimestres de antes están presentados.',
    jsonb_build_array(jsonb_build_object('cuenta', '43000003', 'debe', v_reg, 'tercero', v_je, 'concepto', 'Regularización a lo que Just Eat debe según sus estados de cuenta'),
                      jsonb_build_object('cuenta', '77800000', 'haber', v_reg, 'concepto', 'Diferencia sin documento con Just Eat (2026)')));
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', v_reg)));
  raise notice 'DL1 Just Eat regularización: % a la 778, validado como Julio (%).', v_reg, v_n;
end $$;
