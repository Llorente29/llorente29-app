-- ════════════════════════════════════════════════════════════════════
-- Migration: 20260527T2000_folvy_ai_platform.sql
-- Plataforma de Folvy AI: memoria por cuenta + log de interacciones.
-- Genérica: sirve al chat flotante, a las AICards de cada módulo,
-- y a tools futuras de cualquier módulo (Kitchen, APPCC, Team, Sales).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE public.ai_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  scope       text NOT NULL,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  source      text NOT NULL DEFAULT 'inferred',
  confidence  numeric,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_memory_scope_valid
    CHECK (scope IN ('vocabulary','preference','fact','snapshot')),
  CONSTRAINT ai_memory_conf_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE UNIQUE INDEX ai_memory_uq
  ON public.ai_memory (account_id, scope, key);
CREATE INDEX ai_memory_account_scope_idx
  ON public.ai_memory (account_id, scope);

CREATE TABLE public.ai_interaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id       uuid,
  user_name     text,
  surface       text NOT NULL,
  module        text,
  session_id    uuid,
  request       jsonb NOT NULL,
  response      jsonb,
  tools_used    jsonb,
  model         text,
  tokens_in     integer,
  tokens_out    integer,
  duration_ms   integer,
  status        text NOT NULL DEFAULT 'ok',
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_interaction_surface_valid
    CHECK (surface IN ('chat','aicard','background')),
  CONSTRAINT ai_interaction_status_valid
    CHECK (status IN ('ok','error','cancelled'))
);

CREATE INDEX ai_interaction_account_time_idx
  ON public.ai_interaction (account_id, created_at DESC);
CREATE INDEX ai_interaction_session_idx
  ON public.ai_interaction (session_id);

CREATE TRIGGER set_ai_memory_updated_at
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ai_memory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interaction ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_memory_read  ON public.ai_memory
  FOR SELECT USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY ai_memory_write ON public.ai_memory
  FOR ALL USING (current_user_is_admin_of(account_id))
              WITH CHECK (current_user_is_admin_of(account_id));

CREATE POLICY ai_interaction_read  ON public.ai_interaction
  FOR SELECT USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY ai_interaction_write ON public.ai_interaction
  FOR ALL USING (current_user_is_admin_of(account_id))
              WITH CHECK (current_user_is_admin_of(account_id));
