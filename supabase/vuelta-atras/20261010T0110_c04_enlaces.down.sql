-- Vuelta atrás de 20261010T0110_c04_enlaces.sql. PARA si algún documento ya
-- apunta a su asiento, si una factura lleva su retención o una cuenta del banco
-- su local: quitar la columna lo perdería.
do $$
begin
  if exists (select 1 from public.supplier_invoice where journal_entry_id is not null or payment_entry_id is not null or withholding_rate_id is not null)
     or exists (select 1 from public.channel_settlement where journal_entry_id is not null)
     or exists (select 1 from public.licensed_settlement where journal_entry_id is not null)
     or exists (select 1 from public.treasury_account where location_id is not null)
     or exists (select 1 from public.company_account_link where role = 'liquidacion') then
    raise exception 'Hay facturas, liquidaciones, cuentas del banco o cuentas de liquidación de un socio con lo nuevo puesto: no se quita nada.';
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
alter table public.company_account_link drop constraint if exists company_account_link_liquidacion_de_socio;
alter table public.company_account_link drop constraint if exists company_account_link_role_check;
alter table public.company_account_link add constraint company_account_link_role_check
  check (role in ('principal', 'soportado', 'repercutido', 'gasto', 'pago', 'suplidos'));
alter table public.company_account_link drop constraint if exists company_account_link_papel_de_tercero;
alter table public.company_account_link add constraint company_account_link_papel_de_tercero
  check (role not in ('gasto', 'pago', 'suplidos') or entity in ('supplier', 'customer'));
