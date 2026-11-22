-- supabase/migrations/20261122T1315_x27_fichas_terceros.sql
-- X27 · La ficha de proveedor y la de cliente, como ERP10 (maqueta nucleo_20, aprobada el 22/11). Lo que la maqueta
-- pide y no tenía dónde guardarse, solo lo que la factura va a usar (Julio, 22/11: «una casilla de la ficha que no
-- propone nada es una casilla muerta»).
--
--   1. supplier, «Datos por defecto en facturas» y «Datos de pago», columnas que admiten nulos y nacen vacías:
--      · vat_deductible_pct («% I.V.A. deducible»): de 0 a 100; vacío = lo de siempre (100).
--      · default_brand_id («Marca») y default_channel_id («Plataforma»).
--      · exclude_from_347 («No incluir en 347»): vacío = no.
--      · phone y email («Teléfonos» y «Correo electrónico»): en staging ya estaban; en producción, no.
--      · pay_on_post («Pago directo al contabilizar la factura»): la pantalla de la recibida propone el pago con la
--        subcuenta de pago en la fecha de la factura (sin esperar al vencimiento). Solo lo lee la pantalla.
--   2. customer_fiscal, datos de la ficha del cliente: phone, email, notes, trade_name (nombre comercial) y
--      usual_tax_rate_ids (tipos de IVA). Se ven y se guardan en su ficha.
--   3. La factura las usa: los dos disparadores van aparte, en la 1316 (cambia), para que esta, que solo añade,
--      llegue de verdad a staging desde la rama (W05) y la pantalla tenga dónde guardar.
-- Lo que no se copia de ERP10 (Julio, 22/11): «Proveedor genérico», «Criterio de caja» y «REAGP»; el tipo de operación
-- no se guarda en la ficha (lo calcula conta_proveedor_iva_clase y se cambia en la factura, K10b).
-- SOLO AÑADE: columnas que admiten nulos y nacen vacías; no escribe en ninguna fila. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261122T1315_x27_fichas_terceros.down.sql

-- 1 · La ficha del proveedor ----------------------------------------------------------------------------------------
alter table public.supplier add column if not exists vat_deductible_pct numeric(5,2)
  constraint supplier_vat_deductible_pct_check check (vat_deductible_pct between 0 and 100);
alter table public.supplier add column if not exists default_brand_id uuid references public.brand(id) on delete set null;
alter table public.supplier add column if not exists default_channel_id uuid references public.sales_channel(id) on delete set null;
alter table public.supplier add column if not exists exclude_from_347 boolean;
alter table public.supplier add column if not exists pay_on_post boolean;
-- El teléfono y el correo de la ficha («Teléfonos», «Correo electrónico»): staging los tiene, producción no (el ensayo
-- de 5e548b1: «column s.phone does not exist»). Con «if not exists», en staging no hacen nada.
alter table public.supplier add column if not exists phone text;
alter table public.supplier add column if not exists email text;
comment on column public.supplier.vat_deductible_pct is 'X27 · «% I.V.A. deducible» de su ficha: la recibida nace con él (disparador x27_recibida_nace). Vacío = 100.';
comment on column public.supplier.default_brand_id is 'X27 · «Marca» de su ficha: la recibida nace con ella (su brand_id, que va a los apuntes del asiento).';
comment on column public.supplier.default_channel_id is 'X27 · «Plataforma» de su ficha: cada línea de gasto nace con ella (supplier_invoice_expense_dato.channel_id).';
comment on column public.supplier.exclude_from_347 is 'X27 · «No incluir en 347» de su ficha: la recibida nace con él (exclude_from_347). Vacío = no.';
comment on column public.supplier.pay_on_post is 'X27 · «Pago directo al contabilizar la factura»: la ficha de la recibida propone el pago con la subcuenta de pago en la fecha de la factura. Vacío = no (la del vencimiento).';

-- 2 · La ficha del cliente ------------------------------------------------------------------------------------------
alter table public.customer_fiscal add column if not exists phone text;
alter table public.customer_fiscal add column if not exists email text;
alter table public.customer_fiscal add column if not exists notes text;
alter table public.customer_fiscal add column if not exists trade_name text;
alter table public.customer_fiscal add column if not exists usual_tax_rate_ids uuid[];
comment on column public.customer_fiscal.phone is 'X27 · Teléfono de la ficha del cliente.';
comment on column public.customer_fiscal.email is 'X27 · Correo electrónico de la ficha del cliente.';
comment on column public.customer_fiscal.notes is 'X27 · Observaciones de la ficha del cliente.';
comment on column public.customer_fiscal.trade_name is 'X27 · Nombre comercial del cliente.';
comment on column public.customer_fiscal.usual_tax_rate_ids is 'X27 · Tipos de IVA habituales del cliente (ids de tax_rate), como supplier.usual_tax_rate_ids.';
