-- 20260602T0000_brand_channel_rate.sql
-- Capa A (EP1) — tarifas de comisión por marca×canal×tipo de reparto.
-- Aplicada: 2026-06-02 en Supabase (proyecto xzmpnchlguibclvxyynt) vía SQL Editor.
-- RLS calcada de brand_channel (bc_read/bc_write -> bcr_read/bcr_write).
-- NOTA: este fichero es el registro versionado del esquema YA APLICADO. NO re-ejecutar
-- en el SQL Editor (la tabla ya existe; daría 42P07 relation already exists).

BEGIN;

CREATE TABLE public.brand_channel_rate (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL,
  brand_channel_id  uuid NOT NULL REFERENCES public.brand_channel(id) ON DELETE CASCADE,
  service_type      text NOT NULL
                       CHECK (service_type IN ('platform_delivery','own_delivery','pickup')),
  commission_pct    numeric,
  commission_fixed  numeric,
  commission_base   text NOT NULL DEFAULT 'pvp_con_iva'
                       CHECK (commission_base IN ('pvp_con_iva','pvp_sin_iva')),
  own_customer_fee  numeric,
  own_courier_cost  numeric,
  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  created_by_name   text,
  UNIQUE (brand_channel_id, service_type)
);

ALTER TABLE public.brand_channel_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY bcr_read ON public.brand_channel_rate
  FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));

CREATE POLICY bcr_write ON public.brand_channel_rate
  FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

COMMIT;
