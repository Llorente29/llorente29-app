-- Aplicada: 2026-08-12
--
-- Registra en el repo la tabla last_product_mirror: existía APLICADA en
-- producción desde el 12/08 (creada a mano por Julio durante el diseño de
-- last-catalog-sync) sin migración versionada -> drift. Este fichero solo
-- documenta el estado ya vivo (guard IF NOT EXISTS, no debe crear nada si
-- ya existe).
--
-- Espejo de disponibilidad por local en Last.app (encargo `last-catalog-sync`,
-- SOLO LECTURA sobre Last). Una fila por (account_id, external_location_id,
-- external_product_id): el mismo producto puede tener estado enabled distinto
-- en cada local (incluso compartiendo catálogo entre locales cedidos).
--
-- disabled_since / missing_since son sellos de ANTIGÜEDAD (cuándo empezó el
-- agotado / la desaparición), no de última escritura: la función que puebla
-- esta tabla debe leer el estado previo y solo sellar en la transición, nunca
-- pisar un sello ya puesto (ver supabase/functions/last-catalog-sync).
--
-- RLS activo, SIN políticas todavía: hoy solo escribe el service_role desde
-- la Edge Function (bypassa RLS). La lectura desde cliente (pantalla de
-- informe) es un tramo posterior; se añadirán políticas cuando exista.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'last_product_mirror'
  ) THEN
    CREATE TABLE public.last_product_mirror (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id            uuid NOT NULL REFERENCES public.accounts(id),
      location_id           uuid REFERENCES public.locations(id),
      external_org_id       text NOT NULL,
      external_location_id  text NOT NULL,
      external_product_id   text NOT NULL,
      last_name             text,
      last_price_cents      integer,
      enabled               boolean NOT NULL,
      menu_item_id          uuid REFERENCES public.menu_item(id),
      brand_id              uuid REFERENCES public.brand(id),
      ownership_type        text,
      in_folvy              boolean NOT NULL DEFAULT false,
      first_seen_at         timestamptz NOT NULL DEFAULT now(),
      last_seen_at          timestamptz NOT NULL DEFAULT now(),
      disabled_since        timestamptz,
      missing_since         timestamptz,
      CONSTRAINT last_product_mirror_uk
        UNIQUE (account_id, external_location_id, external_product_id)
    );

    CREATE INDEX last_product_mirror_pending_idx
      ON public.last_product_mirror (account_id, external_location_id)
      WHERE (enabled = false AND in_folvy = true);

    ALTER TABLE public.last_product_mirror ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
