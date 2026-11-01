-- supabase/vuelta-atras/20261101T0051_s01i_comision_sin_banco.down.sql
--
-- S01i · Vuelta atrás de la 0051: fuera los dos disparadores; Pagos y Bancos
-- como estaban (del respaldo); el CHECK de la forma de
-- pago como estaba (NOT VALID si alguna factura ya la tiene: no se borra).

drop trigger if exists s01i_liquidacion_llega on public.channel_settlement;
drop trigger if exists s01i_factura_comision on public.supplier_invoice;
drop function if exists public._s01i_liquidacion_llega();
drop function if exists public._s01i_factura_comision();

do $$ begin
  alter table public.supplier_invoice drop constraint supplier_invoice_payment_method_check;
  if exists (select 1 from public.supplier_invoice where payment_method = 'compensation') then
    alter table public.supplier_invoice add constraint supplier_invoice_payment_method_check check (
      payment_method is null or payment_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid']::text[])) not valid;
  else
    alter table public.supplier_invoice add constraint supplier_invoice_payment_method_check check (
      payment_method is null or payment_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid']::text[]));
  end if;
end $$;

-- Pagos y Bancos, del respaldo que guardó la 0051.
select public._restaurar_funcion('public.bank_facturas_para_casar(uuid)', '20261101T0051_s01i_comision_sin_banco');
select public._restaurar_funcion('public.conta_pagos_lista(uuid,date)', '20261101T0051_s01i_comision_sin_banco');
