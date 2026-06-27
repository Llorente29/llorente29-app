-- 20260627T2100_shop_stripe_columns.sql
-- Aplicada: (pendiente)
--
-- Cobro del Folvy Shop con Stripe Connect (direct charges).
--   accounts.stripe_account_id : cuenta conectada (acct_...) del restaurante que
--     cobra los pedidos del Shop. Distinta de stripe_customer_id (ese es para la
--     SUSCRIPCIÓN del restaurante a Folvy; este es para que el restaurante COBRE
--     al comensal).
--   accounts.shop_fee_bps : comisión de Folvy sobre el total del pedido, en
--     puntos básicos (100 = 1%). 0 = sin comisión. Configurable por cliente sin
--     tocar código; el application_fee se calcula desde aquí.
--   sale.stripe_payment_intent_id : el PaymentIntent creado para esa venta
--     (idempotencia / reconciliación / match desde el webhook).

alter table public.accounts
  add column if not exists stripe_account_id text,
  add column if not exists shop_fee_bps integer not null default 0;

alter table public.sale
  add column if not exists stripe_payment_intent_id text;

comment on column public.accounts.stripe_account_id is
  'Stripe Connect: cuenta conectada (acct_...) del restaurante. Cobra los pedidos del Shop por direct charge.';
comment on column public.accounts.shop_fee_bps is
  'Comisión de Folvy sobre el total del pedido del Shop, en puntos básicos (100 = 1%). 0 = sin comisión.';
comment on column public.sale.stripe_payment_intent_id is
  'PaymentIntent de Stripe asociado a esta venta del Shop.';
