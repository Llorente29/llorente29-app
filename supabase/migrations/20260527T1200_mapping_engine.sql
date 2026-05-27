-- ════════════════════════════════════════════════════════════════════
-- Migration: 20260527T1200_mapping_engine.sql
-- MOTOR DE MAPEO IA — modelo de datos (3 tablas + índices + RLS + trigger)
-- Genérico: ventas→menu_item, escandallo→catálogo, almacén futuro.
-- RLS y trigger calcados del patrón existente (menu_item, Bloque S).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE public.mapping_proposal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_kind        text NOT NULL,
  source_text        text NOT NULL,
  source_normalized  text NOT NULL,
  source_ref         uuid,
  context_brand_id   uuid REFERENCES public.brand(id) ON DELETE SET NULL,
  target_kind        text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  chosen_target_id   uuid,
  confidence         numeric,
  method             text NOT NULL DEFAULT 'ai',
  rationale          text,
  engine_version     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_proposal_conf_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT mapping_proposal_status_valid
    CHECK (status IN ('pending','auto_confirmed','needs_review',
                      'human_confirmed','rejected','no_candidate')),
  CONSTRAINT mapping_proposal_method_valid
    CHECK (method IN ('exact','fuzzy','ai','human'))
);

CREATE UNIQUE INDEX mapping_proposal_uq
  ON public.mapping_proposal
     (account_id, source_kind, source_normalized, target_kind,
      COALESCE(context_brand_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX mapping_proposal_status_idx
  ON public.mapping_proposal (account_id, status);

CREATE TABLE public.mapping_candidate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   uuid NOT NULL REFERENCES public.mapping_proposal(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL,
  target_label  text NOT NULL,
  score         numeric NOT NULL,
  rank          integer NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_candidate_score_range CHECK (score >= 0 AND score <= 1)
);

CREATE INDEX mapping_candidate_proposal_idx
  ON public.mapping_candidate (proposal_id, rank);

CREATE TABLE public.mapping_decision (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      uuid NOT NULL REFERENCES public.mapping_proposal(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  action           text NOT NULL,
  chosen_target_id uuid,
  note             text,
  decided_by       uuid,
  decided_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_decision_action_valid
    CHECK (action IN ('confirm','correct','reject'))
);

CREATE INDEX mapping_decision_proposal_idx
  ON public.mapping_decision (proposal_id);

CREATE TRIGGER set_mapping_proposal_updated_at
  BEFORE UPDATE ON public.mapping_proposal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.mapping_proposal  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_decision  ENABLE ROW LEVEL SECURITY;

CREATE POLICY mapping_proposal_read  ON public.mapping_proposal
  FOR SELECT USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY mapping_proposal_write ON public.mapping_proposal
  FOR ALL USING (current_user_is_admin_of(account_id))
              WITH CHECK (current_user_is_admin_of(account_id));

CREATE POLICY mapping_decision_read  ON public.mapping_decision
  FOR SELECT USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY mapping_decision_write ON public.mapping_decision
  FOR ALL USING (current_user_is_admin_of(account_id))
              WITH CHECK (current_user_is_admin_of(account_id));

CREATE POLICY mapping_candidate_read  ON public.mapping_candidate
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.mapping_proposal p
    WHERE p.id = mapping_candidate.proposal_id
      AND p.account_id = ANY (current_user_account_ids())));
CREATE POLICY mapping_candidate_write ON public.mapping_candidate
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.mapping_proposal p
    WHERE p.id = mapping_candidate.proposal_id
      AND current_user_is_admin_of(p.account_id)))
              WITH CHECK (EXISTS (
    SELECT 1 FROM public.mapping_proposal p
    WHERE p.id = mapping_candidate.proposal_id
      AND current_user_is_admin_of(p.account_id)));
