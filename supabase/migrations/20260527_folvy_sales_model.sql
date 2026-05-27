-- ============================================================================
-- 20260527_folvy_sales_model.sql
-- Folvy — Modelo de ventas (genérico, cualquier tipo de cliente)
-- sale = ticket; sale_line = producto vendido. menu_item_id NULLABLE:
-- se importa ya y se mapea al catálogo después (manual/IA). FK históricas
-- con SET NULL (una venta pasada no se borra al borrar marca/canal/local).
-- delivery_cost real (cierra el raíl delivery_fee de Capa 2).
-- ============================================================================

BEGIN;

CREATE TABLE public.sale (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL,

  brand_id               uuid,
  channel_id             uuid,
  location_id            uuid,

  source                 text NOT NULL DEFAULT 'manual',
  external_ref           text,
  external_brand_text    text,
  external_location_text text,
  external_channel_text  text,

  sold_at                timestamptz NOT NULL,
  total                  numeric NOT NULL DEFAULT 0,
  paid                   numeric,
  delivery_cost          numeric,
  refund_amount          numeric,
  discount_amount        numeric,
  payment_method         text,

  raw_products           text,

  is_active              boolean NOT NULL DEFAULT true,
  archived_at            timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  created_by_name        text,

  CONSTRAINT sale_brand_fk    FOREIGN KEY (brand_id)    REFERENCES public.brand (id)         ON DELETE SET NULL,
  CONSTRAINT sale_channel_fk  FOREIGN KEY (channel_id)  REFERENCES public.sales_channel (id) ON DELETE SET NULL,
  CONSTRAINT sale_location_fk FOREIGN KEY (location_id) REFERENCES public.locations (id)     ON DELETE SET NULL,
  CONSTRAINT sale_source_valid CHECK (source IN ('manual','lastapp','import')),
  CONSTRAINT sale_external_unique UNIQUE (account_id, source, external_ref)
);

CREATE TABLE public.sale_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  sale_id          uuid NOT NULL,

  raw_text         text NOT NULL,
  product_name     text NOT NULL,
  quantity         numeric NOT NULL DEFAULT 1,
  unit_price       numeric,

  menu_item_id     uuid,
  map_source       text NOT NULL DEFAULT 'unmapped',
  map_confidence   numeric,
  map_needs_review boolean NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sale_line_sale_fk      FOREIGN KEY (sale_id)      REFERENCES public.sale (id)      ON DELETE CASCADE,
  CONSTRAINT sale_line_menu_item_fk FOREIGN KEY (menu_item_id) REFERENCES public.menu_item (id) ON DELETE SET NULL,
  CONSTRAINT sale_line_map_source_valid CHECK (map_source IN ('unmapped','manual','ai','fuzzy')),
  CONSTRAINT sale_line_qty_positive CHECK (quantity > 0),
  CONSTRAINT sale_line_map_confidence_range
    CHECK (map_confidence IS NULL OR (map_confidence >= 0 AND map_confidence <= 1))
);

CREATE INDEX idx_sale_account   ON public.sale (account_id);
CREATE INDEX idx_sale_brand     ON public.sale (brand_id);
CREATE INDEX idx_sale_channel   ON public.sale (channel_id);
CREATE INDEX idx_sale_location  ON public.sale (location_id);
CREATE INDEX idx_sale_sold_at   ON public.sale (sold_at);
CREATE INDEX idx_sale_active    ON public.sale (account_id) WHERE archived_at IS NULL;

CREATE INDEX idx_sale_line_sale      ON public.sale_line (sale_id);
CREATE INDEX idx_sale_line_account   ON public.sale_line (account_id);
CREATE INDEX idx_sale_line_menu_item ON public.sale_line (menu_item_id);
CREATE INDEX idx_sale_line_unmapped  ON public.sale_line (account_id)
  WHERE menu_item_id IS NULL;

CREATE TRIGGER set_sale_updated_at
  BEFORE UPDATE ON public.sale
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_sale_line_updated_at
  BEFORE UPDATE ON public.sale_line
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sale ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_read ON public.sale
  FOR SELECT TO authenticated
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY sale_write ON public.sale
  FOR ALL TO authenticated
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

ALTER TABLE public.sale_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_line_read ON public.sale_line
  FOR SELECT TO authenticated
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY sale_line_write ON public.sale_line
  FOR ALL TO authenticated
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

COMMIT;
