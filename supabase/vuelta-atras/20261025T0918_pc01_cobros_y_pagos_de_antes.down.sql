-- supabase/vuelta-atras/20261025T0918_pc01_cobros_y_pagos_de_antes.down.sql
--
-- Vuelta atrás de 20261025T0918_pc01_cobros_y_pagos_de_antes: deja los datos
-- EXACTAMENTE como estaban, desde su copia previa, sin now() ni reglas:
--   · borra, fila a fila, lo que la tanda creó (_pc01_creados): los cobros,
--     los pagos, el registro de pagos y el historial de las facturas;
--   · devuelve las recibidas que pasó a pagadas, con su updated_at de antes;
--   · devuelve el vencimiento de las emitidas, con su updated_at de antes;
--   · devuelve la marca de las tiendas, lo de las liquidaciones y el plazo de
--     las plataformas.
-- Mientras restaura, apaga los disparadores que reescribirían lo restaurado
-- (el updated_at de la factura emitida, los de la recibida al cambiar de
-- estado, el de la tienda que vuelve a mirar sus liquidaciones) y los vuelve a
-- encender al acabar. Sin copia, para sin tocar nada. Va ANTES de las vueltas
-- atrás de la 0917 y la 0916.

do $$ begin
  if to_regclass('public._pc01_creados') is null then
    raise exception 'PC01 0918 · vuelta atrás: no está la copia previa (_pc01_creados). No toco nada.';
  end if;
end $$;

-- 1 · Lo creado, fila a fila.
delete from public.customer_invoice_event where id in (select id from public._pc01_creados where tabla = 'customer_invoice_event');
delete from public.customer_invoice_payment where id in (select id from public._pc01_creados where tabla = 'customer_invoice_payment');
delete from public.supplier_invoice_payment where id in (select id from public._pc01_creados where tabla = 'supplier_invoice_payment');
delete from public.supplier_invoice_payment_log where id in (select id from public._pc01_creados where tabla = 'supplier_invoice_payment_log');

-- 2 · Las recibidas que pasó a pagadas.
alter table public.supplier_invoice disable trigger supplier_invoice_iban_guard;
alter table public.supplier_invoice disable trigger trg_supplier_invoice_aprobacion;
alter table public.supplier_invoice disable trigger trg_supplier_invoice_no_repetida;
alter table public.supplier_invoice disable trigger bank_factura_aprobada_con_pago;
alter table public.supplier_invoice disable trigger pc01_recibida_vence;
update public.supplier_invoice si set status = c.status, paid_at = c.paid_at, paid_method = c.paid_method, paid_by = c.paid_by,
       paid_by_name = c.paid_by_name, updated_at = c.updated_at
  from public._copia_pc01_recibida c where c.invoice_id = si.id;
alter table public.supplier_invoice enable trigger supplier_invoice_iban_guard;
alter table public.supplier_invoice enable trigger trg_supplier_invoice_aprobacion;
alter table public.supplier_invoice enable trigger trg_supplier_invoice_no_repetida;
alter table public.supplier_invoice enable trigger bank_factura_aprobada_con_pago;
alter table public.supplier_invoice enable trigger pc01_recibida_vence;

-- 3 · El vencimiento de las emitidas.
alter table public.customer_invoice disable trigger trg_customer_invoice_inalterable;
update public.customer_invoice ci set due_date = c.due_date, updated_at = c.updated_at
  from public._copia_pc01_vence c where c.invoice_id = ci.id;
alter table public.customer_invoice enable trigger trg_customer_invoice_inalterable;

-- 4 · La marca de las tiendas (sin volver a mirar sus liquidaciones) y lo de las liquidaciones.
alter table public.platform_store disable trigger pc01_tienda_cambiada;
update public.platform_store ps set brand_id = c.brand_id, updated_at = c.updated_at, updated_by = c.updated_by, updated_by_name = c.updated_by_name
  from public._copia_pc01_tienda c where c.id = ps.id;
alter table public.platform_store enable trigger pc01_tienda_cambiada;
update public.channel_settlement cs set invoice_match_status = c.invoice_match_status, invoice_match_note = c.invoice_match_note
  from public._copia_pc01_liquidacion c where c.id = cs.id;

-- 5 · El plazo de las plataformas.
update public.party_role pr set settlement_every = c.settlement_every, payout_days_after = c.payout_days_after, payout_margin_days = c.payout_margin_days
  from public._copia_pc01_party_role c where c.id = pr.id;

-- 6 · La copia, fuera.
drop table public._pc01_creados;
drop table public._copia_pc01_liquidacion;
drop table public._copia_pc01_recibida;
drop table public._copia_pc01_vence;
drop table public._copia_pc01_tienda;
drop table public._copia_pc01_party_role;
