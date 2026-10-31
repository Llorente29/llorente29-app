-- supabase/vuelta-atras/20261031T1850_s01h_pago_por_compensacion.down.sql
--
-- S01h · Vuelta atrás de la 1850: el CHECK de paid_method como estaba. Si ya
-- hay facturas pagadas por compensación, NOT VALID: no se borran pagos.

do $$ begin
  alter table public.supplier_invoice drop constraint supplier_invoice_paid_method_check;
  if exists (select 1 from public.supplier_invoice where paid_method = 'compensation') then
    alter table public.supplier_invoice add constraint supplier_invoice_paid_method_check check (
      paid_method is null or paid_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid']::text[])) not valid;
  else
    alter table public.supplier_invoice add constraint supplier_invoice_paid_method_check check (
      paid_method is null or paid_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid']::text[]));
  end if;
end $$;
