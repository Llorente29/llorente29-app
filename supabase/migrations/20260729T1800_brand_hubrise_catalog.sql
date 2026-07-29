-- 20260729T1800_brand_hubrise_catalog.sql
-- HubRise Fase 2: mapping marca -> catálogo HubRise (fuente de verdad PRIMARIA
-- para el asistente "Conectar a delivery", self-service, sin bridge).
-- ============================================================================
-- POR QUÉ: hoy el catálogo de una marca en HubRise solo se conoce vía
-- external_brand_map (brand_id -> external_location_id + external_brand_id de
-- un BRIDGE) cruzado con external_integration -- exige que el bridge de
-- alguna plataforma ya esté reconectado a mano (así se montó Bendito Burrito).
-- Con el token ESCRITOR (Fase 1, hubrise_writer_connection,
-- 20260729T1500_hubrise_writer_token.sql) ya no hace falta: el asistente crea
-- el catálogo, publica y empuja 86 SIN bridge. Esta tabla es la fuente de
-- verdad marca->catálogo que puebla el asistente; el path
-- external_brand_map->external_integration queda como FALLBACK de
-- compatibilidad (Bendito Burrito y cualquier alta manual futura), no se
-- borra ni se toca.
--
-- Único por (account_id, brand_id, external_location_id): una marca puede
-- vivir en varios locales (brand_location_availability); el catálogo/86 de
-- HubRise es por catálogo x local (ver availability-dispatch,
-- patchHubriseInventory), así que cada (marca, local) tiene su propia fila.
--
-- Back-fill: Bendito Burrito (catálogo j99jm, local Foodint Alcalá =
-- external_location_id '1b6p8-0') verificado en vivo antes de escribir esta
-- migración -- ver query de recon: brand.id 95635ce3-055f-4333-b3ec-
-- 1b4e9b2a0170, account_id 51ad1792-6629-4ef7-833a-b57b09a86710,
-- brand_location_availability.location_id 38158159-cd71-4056-950b-
-- 53425afac1ce. Así el asistente la reconoce como YA CONECTADA y no duplica
-- el catálogo en HubRise (nombres de catálogo son únicos por local/cuenta).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.brand_hubrise_catalog (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES public.accounts(id),
  brand_id              uuid NOT NULL REFERENCES public.brand(id),
  location_id           uuid NOT NULL REFERENCES public.locations(id),
  external_location_id  text NOT NULL,
  external_catalog_id   text NOT NULL,
  hubrise_catalog_name  text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, brand_id, external_location_id)
);

CREATE INDEX IF NOT EXISTS brand_hubrise_catalog_account_id_idx ON public.brand_hubrise_catalog (account_id);
CREATE INDEX IF NOT EXISTS brand_hubrise_catalog_brand_id_idx ON public.brand_hubrise_catalog (brand_id);
-- Resolución inversa (por catálogo) para el leg HubRise del 86 y el publish.
CREATE INDEX IF NOT EXISTS brand_hubrise_catalog_ext_catalog_idx ON public.brand_hubrise_catalog (external_catalog_id);

-- RLS: MISMO patrón que catalog_publish_rw (admin o manager de la cuenta,
-- lectura y escritura). Los GRANT de tabla a anon/authenticated/service_role
-- los da el default ACL del esquema public (ver pg_default_acl del rol
-- postgres, igual que brand/catalog_publish/external_brand_map) -- la
-- autorización real la hace esta política, no el GRANT.
ALTER TABLE public.brand_hubrise_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_hubrise_catalog_rw ON public.brand_hubrise_catalog
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

CREATE OR REPLACE FUNCTION public.brand_hubrise_catalog_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER brand_hubrise_catalog_updated_at
  BEFORE UPDATE ON public.brand_hubrise_catalog
  FOR EACH ROW EXECUTE FUNCTION public.brand_hubrise_catalog_set_updated_at();

-- ── Back-fill: Bendito Burrito ya montada a mano, reconocida como conectada.
INSERT INTO public.brand_hubrise_catalog
  (account_id, brand_id, location_id, external_location_id, external_catalog_id, hubrise_catalog_name)
VALUES
  ('51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
   '95635ce3-055f-4333-b3ec-1b4e9b2a0170'::uuid,
   '38158159-cd71-4056-950b-53425afac1ce'::uuid,
   '1b6p8-0', 'j99jm', 'Bendito Burrito')
ON CONFLICT (account_id, brand_id, external_location_id) DO NOTHING;

notify pgrst, 'reload schema';
