-- Vuelta atrás de 20261010T0110_c04_enlaces.sql. PARA si algún documento ya
-- apunta a su asiento, si una factura lleva su retención o una cuenta del banco
-- su local: quitar la columna lo perdería.
do $$
begin
  if exists (select 1 from public.supplier_invoice where journal_entry_id is not null or payment_entry_id is not null or withholding_rate_id is not null)
     or exists (select 1 from public.channel_settlement where journal_entry_id is not null)
     or exists (select 1 from public.licensed_settlement where journal_entry_id is not null)
     or exists (select 1 from public.treasury_account where location_id is not null) then
    raise exception 'Hay facturas, liquidaciones o cuentas del banco con lo nuevo puesto: no se quita nada.';
  end if;
end $$;

drop index if exists public.idx_supplier_invoice_asiento;
alter table public.supplier_invoice
  drop constraint if exists supplier_invoice_retencion_completa,
  drop column if exists journal_entry_id, drop column if exists payment_entry_id,
  drop column if exists withholding_rate_id, drop column if exists withholding_amount;
drop index if exists public.idx_channel_settlement_asiento;
alter table public.channel_settlement drop column if exists journal_entry_id;
drop index if exists public.idx_licensed_settlement_asiento;
alter table public.licensed_settlement drop column if exists journal_entry_id;
alter table public.treasury_account drop column if exists location_id;
