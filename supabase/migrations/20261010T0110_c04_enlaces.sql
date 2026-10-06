-- ============================================================================
-- C04 · Libro diario — 2 · LOS DOCUMENTOS APUNTAN A SU ASIENTO
-- ----------------------------------------------------------------------------
-- Columnas nuevas, todas opcionales y sin valor por defecto que reescriba
-- filas: lo que ya hay no cambia (antes = después, medido en la prueba).
--
--   · supplier_invoice: su asiento, el de su pago, y la retención de la factura
--     (hoy solo está en la ficha del proveedor; la factura manda).
--   · channel_settlement: el asiento de la liquidación de la plataforma.
--   · licensed_settlement: el asiento de la liquidación del socio de marca.
--   · treasury_account: de qué local es cada cuenta del banco (D7).
--
-- `sale` NO se toca: está en el camino del pedido. El número de factura del
-- socio que trae Last se lee del pedido original cuando hace falta.
-- Vuelta atrás: supabase/vuelta-atras/20261010T0110_c04_enlaces.down.sql
-- ============================================================================

alter table public.supplier_invoice
  add column if not exists journal_entry_id     uuid references public.journal_entry(id) on delete set null,
  add column if not exists payment_entry_id     uuid references public.journal_entry(id) on delete set null,
  add column if not exists withholding_rate_id  uuid references public.withholding_rate(id) on delete restrict,
  add column if not exists withholding_amount   numeric(14, 2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_invoice_retencion_completa') then
    alter table public.supplier_invoice add constraint supplier_invoice_retencion_completa
      check ((withholding_rate_id is null) = (withholding_amount is null) and (withholding_amount is null or withholding_amount >= 0));
  end if;
end $$;
comment on column public.supplier_invoice.journal_entry_id is 'C04. El asiento de la factura (serie 2, recibidas).';
comment on column public.supplier_invoice.payment_entry_id is 'C04. El asiento de su pago (serie 3, tesorería).';
comment on column public.supplier_invoice.withholding_rate_id is 'C04. La retención que lleva esta factura (alquiler, profesional). Sale de la ficha del proveedor y se puede cambiar en la factura.';
create index if not exists idx_supplier_invoice_asiento on public.supplier_invoice (journal_entry_id) where journal_entry_id is not null;

alter table public.channel_settlement add column if not exists journal_entry_id uuid references public.journal_entry(id) on delete set null;
comment on column public.channel_settlement.journal_entry_id is 'C04. El asiento de la liquidación: comisión y cargos, compensación con su 430 y, si aún no lo están, las ventas.';
create index if not exists idx_channel_settlement_asiento on public.channel_settlement (journal_entry_id) where journal_entry_id is not null;

alter table public.licensed_settlement add column if not exists journal_entry_id uuid references public.journal_entry(id) on delete set null;
comment on column public.licensed_settlement.journal_entry_id is 'C04. El asiento de la liquidación mensual del socio: compensación de sus cuentas y la comisión como ingreso (705).';
create index if not exists idx_licensed_settlement_asiento on public.licensed_settlement (journal_entry_id) where journal_entry_id is not null;

alter table public.treasury_account add column if not exists location_id uuid references public.locations(id) on delete set null;
comment on column public.treasury_account.location_id is 'C04. El local de esta cuenta (cada local cobra y paga por la suya). Vacío: de la empresa.';
