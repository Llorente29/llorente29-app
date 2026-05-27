-- ============================================================================
-- 20260527_folvy_brand_channel.sql
-- Folvy — economía de la relación marca × canal (brand_channel)
-- La comisión de plataforma varía por combinación marca×canal (no por canal).
-- Solo relevante en marcas 'own' (el flujo cedido va por brand_licensing_agreement).
-- Captura comisión % y comisión fija por pedido (el "14% + coste reparto").
-- Valores NULL hasta disponer de la tabla real de comisiones del cliente.
-- ============================================================================

BEGIN;

CREATE TABLE public.brand_channel (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL,
  brand_id          uuid NOT NULL,
  channel_id        uuid NOT NULL,

  commission_pct    numeric,
  commission_fixed  numeric,

  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  created_by_name   text,

  CONSTRAINT bc_brand_fk   FOREIGN KEY (brand_id)   REFERENCES public.brand (id)         ON DELETE CASCADE,
  CONSTRAINT bc_channel_fk FOREIGN KEY (channel_id) REFERENCES public.sales_channel (id) ON DELETE CASCADE,
  CONSTRAINT bc_brand_channel_unique UNIQUE (brand_id, channel_id),
  CONSTRAINT bc_commission_pct_range
    CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100)),
  CONSTRAINT bc_commission_fixed_positive
    CHECK (commission_fixed IS NULL OR commission_fixed >= 0)
);

CREATE INDEX idx_bc_account ON public.brand_channel (account_id);
CREATE INDEX idx_bc_brand   ON public.brand_channel (brand_id);
CREATE INDEX idx_bc_channel ON public.brand_channel (channel_id);

CREATE TRIGGER set_bc_updated_at
  BEFORE UPDATE ON public.brand_channel
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_channel ENABLE ROW LEVEL SECURITY;
CREATE POLICY bc_read ON public.brand_channel
  FOR SELECT TO authenticated USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY bc_write ON public.brand_channel
  FOR ALL TO authenticated
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

COMMIT;
