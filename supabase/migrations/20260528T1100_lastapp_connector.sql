-- 20260528T1100_lastapp_connector.sql
-- Tablas del conector Last.app -> Folvy. Creadas previamente por SQL directo
-- en BBDD; esta migration las documenta en el repo (idempotente con IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.lastapp_integration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lastapp_organization_id uuid NOT NULL,
  organization_name text,
  token_secret_name text NOT NULL,
  ownership_type text NOT NULL DEFAULT 'own',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, lastapp_organization_id)
);

CREATE TABLE IF NOT EXISTS public.lastapp_location_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lastapp_location_id uuid NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  lastapp_location_name text,
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, lastapp_location_id)
);

CREATE TABLE IF NOT EXISTS public.lastapp_product_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  organization_product_id uuid NOT NULL,
  menu_item_id uuid REFERENCES public.menu_item(id) ON DELETE SET NULL,
  lastapp_product_name text,
  needs_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, organization_product_id)
);

CREATE TABLE IF NOT EXISTS public.lastapp_catalog_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lastapp_organization_id uuid NOT NULL,
  catalog_product_id uuid NOT NULL,
  organization_product_id uuid,
  lastapp_catalog_id uuid,
  lastapp_brand_name text,
  product_name text,
  price_cents integer,
  product_type text,
  is_enabled boolean,
  seen_in_catalog_at timestamptz,
  seen_in_sale_at timestamptz,
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, catalog_product_id)
);

-- RLS (idempotente: ENABLE no falla si ya está activo)
ALTER TABLE public.lastapp_integration       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lastapp_location_map       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lastapp_product_map        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lastapp_catalog_product    ENABLE ROW LEVEL SECURITY;

-- Políticas (DROP IF EXISTS + CREATE para idempotencia)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lastapp_integration','lastapp_location_map','lastapp_product_map','lastapp_catalog_product']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (account_id = ANY (current_user_account_ids()))', t, t);
    EXECUTE format('CREATE POLICY %I_write ON public.%I FOR ALL USING (current_user_is_admin_of(account_id)) WITH CHECK (current_user_is_admin_of(account_id))', t, t);
  END LOOP;
END $$;
