-- ============================================================================
-- 20260527_folvy_kitchen_capa2_licensing.sql
-- Folvy Kitchen — Capa 2: acuerdo de cesión de marca (host kitchen)
-- Tú cocinas la marca de un tercero (brand.ownership_type='licensed') y cobras
-- un % de la venta sobre PVP sin IVA. Modelo "host agreement" del sector.
-- El % es de ACUERDO (toda la marca), no de plato. El reembolso de consumos
-- VARÍA por acuerdo → flag reimburses_consumption.
-- ============================================================================

BEGIN;

CREATE TABLE public.brand_licensing_agreement (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL,
  brand_id               uuid NOT NULL,

  owner_name             text NOT NULL,
  revenue_share_pct      numeric NOT NULL,
  reimburses_consumption boolean NOT NULL DEFAULT true,

  starts_on              date,
  ends_on                date,
  notes                  text,

  is_active              boolean NOT NULL DEFAULT true,
  archived_at            timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  created_by_name        text,

  CONSTRAINT bla_brand_fk
    FOREIGN KEY (brand_id) REFERENCES public.brand (id) ON DELETE RESTRICT,
  CONSTRAINT bla_brand_unique UNIQUE (brand_id),
  CONSTRAINT bla_revenue_share_range
    CHECK (revenue_share_pct >= 0 AND revenue_share_pct <= 100),
  CONSTRAINT bla_dates_order
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX idx_blic_account ON public.brand_licensing_agreement (account_id);
CREATE INDEX idx_blic_brand   ON public.brand_licensing_agreement (brand_id);

CREATE TRIGGER set_bla_updated_at
  BEFORE UPDATE ON public.brand_licensing_agreement
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_licensing_agreement ENABLE ROW LEVEL SECURITY;

CREATE POLICY bla_read ON public.brand_licensing_agreement
  FOR SELECT TO authenticated
  USING (account_id = ANY (current_user_account_ids()));

CREATE POLICY bla_write ON public.brand_licensing_agreement
  FOR ALL TO authenticated
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

COMMIT;
