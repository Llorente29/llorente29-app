-- ════════════════════════════════════════════════════════════════════
-- Migration: 20260527T1400_confirm_mapping_rpc.sql
-- RPC atómica: confirmar/corregir/rechazar una propuesta de mapeo.
-- Una transacción: registra decisión + actualiza proposal + propaga
-- menu_item_id a todas las sale_line de ese texto+marca.
-- Identidad desde auth.uid() (no se fía del cliente).
-- Normalización idéntica al normalize() de la Edge Function:
--   unaccent + lower + btrim + quitar punto final + colapsar espacios.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirm_mapping(
  p_proposal_id    uuid,
  p_action         text,
  p_chosen_target  uuid    DEFAULT NULL,
  p_note           text    DEFAULT NULL,
  p_actor_name     text    DEFAULT NULL
)
RETURNS TABLE (propagated_lines integer)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_proposal    public.mapping_proposal%ROWTYPE;
  v_brand       uuid;
  v_norm        text;
  v_account     uuid;
  v_target      uuid;
  v_new_status  text;
  v_count       integer := 0;
BEGIN
  SELECT * INTO v_proposal
  FROM public.mapping_proposal
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta % no encontrada', p_proposal_id;
  END IF;

  v_account := v_proposal.account_id;
  v_brand   := v_proposal.context_brand_id;
  v_norm    := v_proposal.source_normalized;

  IF NOT public.current_user_is_admin_of(v_account) THEN
    RAISE EXCEPTION 'Sin permiso para confirmar mapeos en esta cuenta';
  END IF;

  IF p_action = 'reject' THEN
    v_new_status := 'rejected';
    v_target := NULL;
  ELSIF p_action IN ('confirm', 'correct') THEN
    v_new_status := 'human_confirmed';
    v_target := COALESCE(p_chosen_target, v_proposal.chosen_target_id);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'Confirmar/corregir requiere un menu_item destino';
    END IF;
  ELSE
    RAISE EXCEPTION 'Accion invalida: %', p_action;
  END IF;

  INSERT INTO public.mapping_decision
    (proposal_id, account_id, action, chosen_target_id, note, decided_by, decided_by_name)
  VALUES
    (p_proposal_id, v_account, p_action, v_target, p_note, v_actor, p_actor_name);

  UPDATE public.mapping_proposal
  SET status = v_new_status,
      chosen_target_id = v_target,
      method = 'human'
  WHERE id = p_proposal_id;

  IF v_new_status = 'human_confirmed' THEN
    UPDATE public.sale_line sl
    SET menu_item_id     = v_target,
        map_source       = 'human',
        map_confidence   = 1.0,
        map_needs_review = false
    FROM public.sale fact
    WHERE sl.sale_id = fact.id
      AND sl.account_id = v_account
      AND sl.menu_item_id IS NULL
      AND regexp_replace(
            regexp_replace(btrim(lower(unaccent(sl.product_name))), '\.$', ''),
            '\s+', ' ', 'g'
          ) = v_norm
      AND ( v_brand IS NULL OR fact.brand_id = v_brand );
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_count;
END;
$$;
