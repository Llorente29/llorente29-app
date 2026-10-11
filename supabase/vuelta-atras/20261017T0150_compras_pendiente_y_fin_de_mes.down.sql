-- ============================================================================
-- Vuelta atrás de Compras · 6 · lo que espera factura, casar y el fin de mes.
-- PARA si hay asientos con los orígenes nuevos (fin de mes y su contrario):
-- eso se descarta o anula antes en el libro. Los casados (supplier_invoice_
-- receipt y el consumo del camino) se quedan: son de la 0140 y su vuelta
-- atrás los trata.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.journal_entry where source_type in ('purchase_accrual', 'purchase_accrual_reversal')) then
    raise exception 'Hay asientos de fin de mes de compras: descártalos o anúlalos antes en el libro.';
  end if;
end $$;
drop function if exists public.compras_fin_de_mes(uuid, date);
drop function if exists public._compras_fin_de_mes(uuid, date);
drop function if exists public.compras_casar(uuid, uuid[]);
drop function if exists public._compras_casar(uuid, uuid[]);
drop function if exists public.compras_casar_candidatos(uuid);
drop function if exists public.compras_esperando_factura(uuid);
drop function if exists public._compras_base_recepcion(uuid);
drop table if exists public.purchase_accrual;
alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check
  check (source_type in ('sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement',
                         'licensed_settlement', 'payroll', 'bank', 'vat_settlement', 'manual', 'template', 'reversal',
                         'opening', 'closing', 'migrated'));
