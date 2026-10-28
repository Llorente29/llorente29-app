-- supabase/vuelta-atras/20261027T2031_s01_enlace_con_redsys.down.sql
--
-- Vuelta atrás de la 2031:
--   · las cuatro funciones del enlace vuelven a ser EXACTAMENTE las de antes
--     (las de la 1121, las de producción el 27/10), desde su respaldo y con la
--     huella comprobada (_restaurar_funcion). Misma firma: ninguna sobrecarga;
--   · los dos CHECK vuelven a ser los de antes (sin «customer_payment» ni
--     «pasarela»).
-- OJO: si ya hay asientos de cobro («customer_payment») o cuentas de pasarela,
-- PARA antes de tocar nada: son cobros de verdad con su asiento, y se decide
-- antes qué hacer con ellos, no se deshace a ciegas (como la de la 0917).
-- Va después de la de la 2238 y antes de la de la 2030.

do $$ begin
  if exists (select 1 from public.journal_entry where source_type = 'customer_payment') then
    raise exception 'Hay asientos de cobros por el enlace (customer_payment): deshaz antes la 2238 o decide qué hacer con ellos. No toco nada.';
  end if;
  if exists (select 1 from public.treasury_account where kind = 'pasarela') then
    raise exception 'Hay cuentas de pasarela («Stripe · por abonar», «TPV del banco · por abonar»): decide antes qué hacer con ellas. No toco nada.';
  end if;
end $$;

select public._restaurar_funcion('public.conta_enlace_pago_para(uuid)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_ver(text)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_datos(text)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_cobrado(text,text,text,numeric,text,date)', '20261027T2031_s01_enlace_con_redsys');

alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array[
  'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank',
  'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal',
  'customer_invoice'])) not valid;
alter table public.journal_entry validate constraint journal_entry_source_type_check;
alter table public.treasury_account drop constraint if exists treasury_account_kind_check;
alter table public.treasury_account add constraint treasury_account_kind_check check (kind = any (array['bank', 'card', 'cash'])) not valid;
alter table public.treasury_account validate constraint treasury_account_kind_check;
