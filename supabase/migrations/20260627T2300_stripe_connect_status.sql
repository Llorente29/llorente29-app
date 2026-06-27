-- 20260627T2300_stripe_connect_status.sql
-- Aplicada: (pendiente)
--
-- Estado del onboarding de Stripe Connect por cuenta (restaurante).
--   stripe_charges_enabled  : la cuenta conectada ya puede cobrar (onboarding ok).
--   stripe_details_submitted: el restaurante envió todos sus datos (puede faltar
--                             aún verificación de Stripe, pero ya completó el form).
-- stripe_account_id y shop_fee_bps ya existen (migración T2100).
--
-- Lo escribe la Edge Function stripe-connect-onboard (acción refresh_status),
-- leyendo charges_enabled/details_submitted de la cuenta en Stripe.

alter table public.accounts
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;
