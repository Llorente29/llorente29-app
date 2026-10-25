-- supabase/vuelta-atras/20261025T0916_pc01_motor_cobros_pagos.down.sql
--
-- Vuelta atrás de 20261025T0916_pc01_motor_cobros_pagos: quita lo que crea, en
-- orden inverso. Va DESPUÉS de las vueltas atrás de la 0918 y la 0917 (los
-- disparadores de la 0917 usan estas funciones). Si quedan pagos o cobros
-- escritos por el motor (supplier_invoice_payment, o cobros de un casado o de
-- una liquidación), PARA: los quita antes la vuelta atrás de la 0918.

do $$ begin
  if exists (select 1 from pg_trigger where tgname like 'pc01\_%' and not tgisinternal) then
    raise exception 'PC01 0916 · vuelta atrás: quedan los disparadores de la 0917. Antes, su vuelta atrás.';
  end if;
  if to_regclass('public.supplier_invoice_payment') is not null and exists (select 1 from public.supplier_invoice_payment) then
    raise exception 'PC01 0916 · vuelta atrás: hay pagos en supplier_invoice_payment. Antes, la vuelta atrás de la 0918 (o deshaz esos casados).';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoice_payment' and column_name = 'settlement_id')
     and exists (select 1 from public.customer_invoice_payment where settlement_id is not null or bank_match_id is not null) then
    raise exception 'PC01 0916 · vuelta atrás: hay cobros de una liquidación o de un casado. Antes, la vuelta atrás de la 0918.';
  end if;
end $$;

drop view if exists public.conta_recibida_pago;
drop view if exists public.conta_factura_cobro;
drop function if exists public.conta_hoy();
drop function if exists public._pc01_casado_deshecho();
drop function if exists public._pc01_casado_item();
drop function if exists public._pc01_recibida_pago_lote();
drop function if exists public._pc01_recibida_vence();
drop function if exists public._pc01_factura_cierre_nace();
drop function if exists public._pc01_factura_cierre_vence();
drop function if exists public._pc01_tienda_cambiada();
drop function if exists public._pc01_liquidacion_cobrada();
drop function if exists public.conta_plataforma_plazo_guardar(uuid, text, integer, integer);
drop function if exists public._conta_liquidacion_cobros(uuid);
drop function if exists public.conta_liquidacion_pedidos(uuid);
drop function if exists public.conta_vence_de_factura(uuid);
drop function if exists public.conta_factura_es_de_plataforma(uuid);
drop function if exists public.conta_canal_de_factura(uuid);
drop function if exists public.conta_vence_de_cierre(uuid);
drop function if exists public.conta_vence_por_plataforma(uuid, uuid, date);

alter table public.channel_settlement drop column if exists invoice_match_note;
alter table public.channel_settlement drop column if exists invoice_match_status;
alter table public.party_role drop column if exists payout_margin_days;
alter table public.party_role drop column if exists payout_days_after;
alter table public.bank_match_item drop column if exists customer_invoice_id;
drop index if exists public.customer_invoice_payment_liquidacion_idx;
drop index if exists public.customer_invoice_payment_casado_idx;
alter table public.customer_invoice_payment drop column if exists settlement_id;
alter table public.customer_invoice_payment drop column if exists bank_match_id;
drop table if exists public.supplier_invoice_payment;
