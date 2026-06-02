-- 20260602T0200_integraciones_modulo_i1.sql
-- Módulo de Integraciones (I1): catálogo de conectores + conexión por cuenta.
-- Aplicada: 2026-06-02 en Supabase (proyecto xzmpnchlguibclvxyynt) vía SQL Editor.
--
-- connector          = catálogo global (sin account_id), estilo submodules.
-- account_connector  = conexión por cuenta, RLS calcada de brand_channel.
-- Seed: lastapp (POS, inbound) + catcher (logistics, bidirectional).
--
-- NOTA: registro del esquema YA APLICADO. NO re-ejecutar (las tablas ya existen).

BEGIN;

-- ── Catálogo global de conectores ──
CREATE TABLE public.connector (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,
  category          text NOT NULL
                       CHECK (category IN ('pos','delivery_platform','logistics',
                                           'payments','reservations','loyalty','reports','other')),
  connection_type   text NOT NULL
                       CHECK (connection_type IN ('oauth','credentials','request')),
  managed_by        text NOT NULL
                       CHECK (managed_by IN ('client','superadmin','either')),
  direction         text NOT NULL DEFAULT 'inbound'
                       CHECK (direction IN ('inbound','outbound','bidirectional')),
  description       text,
  logo_url          text,
  config_schema     jsonb,
  features          jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_available      boolean NOT NULL DEFAULT true,
  status            text NOT NULL DEFAULT 'active',
  sort_order        integer DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connector ENABLE ROW LEVEL SECURITY;

CREATE POLICY connector_read ON public.connector
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY connector_write ON public.connector
  FOR ALL
  USING (current_user_is_admin())
  WITH CHECK (current_user_is_admin());

-- ── Conexión por cuenta ──
CREATE TABLE public.account_connector (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL,
  connector_id        uuid NOT NULL REFERENCES public.connector(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available','requested','connecting',
                                           'connected','paused','error')),
  scope               text NOT NULL DEFAULT 'account'
                         CHECK (scope IN ('account','brand','location')),
  brand_id            uuid REFERENCES public.brand(id) ON DELETE CASCADE,
  location_id         uuid,
  credentials_ref     text,
  external_account_id text,
  last_sync_at        timestamptz,
  last_error          text,
  requested_by        uuid,
  requested_at        timestamptz,
  connected_by        uuid,
  connected_at        timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  created_by_name     text,
  UNIQUE (account_id, connector_id, scope, brand_id, location_id)
);

ALTER TABLE public.account_connector ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_connector_read ON public.account_connector
  FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));

CREATE POLICY account_connector_write ON public.account_connector
  FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- ── Seed del catálogo: conectores reales conocidos ──
INSERT INTO public.connector
  (code, name, category, connection_type, managed_by, direction,
   description, config_schema, is_available, sort_order)
VALUES
  ('lastapp', 'Last.app', 'pos', 'credentials', 'superadmin', 'inbound',
   'POS de Last.app. Ingiere ventas (tab:closed) por webhook: total, descuentos, reparto y líneas de producto.',
   '{"fields":[{"key":"webhook_token","label":"Token de webhook","type":"secret","required":true}]}'::jsonb,
   true, 10),
  ('catcher', 'Catcher', 'logistics', 'credentials', 'either', 'bidirectional',
   'Marketplace de última milla. Recibe el coste real de cada reparto (transportPrice) por webhook y permite publicar pedidos. Cruce por externalId.',
   '{"fields":[{"key":"app_id","label":"App ID","type":"secret","required":true},{"key":"app_secret","label":"App Secret","type":"secret","required":true},{"key":"location_id","label":"Location ID (Catcher)","type":"text","required":true}]}'::jsonb,
   true, 20);

COMMIT;
