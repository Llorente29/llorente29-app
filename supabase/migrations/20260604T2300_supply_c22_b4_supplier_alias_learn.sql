-- ============================================================================
-- Folvy Supply C2.2.b.4 — memoria de intermediario
-- ============================================================================
-- learn_supplier_alias(p_receipt_id) — tras confirmar una recepción OCR, si el
-- EMISOR del albarán (leído por la IA, en la sesión enlazada) difiere del
-- proveedor COMERCIAL elegido en la cabecera, graba el alias:
--   emisor_normalizado → supplier_id (comercial) + delivered_by (texto emisor).
-- Así el próximo albarán de ese emisor (p.ej. Joan/Bidfood) se resuelve solo a
-- su proveedor comercial (Cloudtown) con "entregado por" relleno.
--
-- Lee el emisor de goods_receipt_ai_session.parsed_result->'document'. Si la
-- recepción no vino de OCR (sin ai_session_id) o no hay emisor, no hace nada.
-- Idempotente por (account_id, emitter_norm) → upsert.
--
-- SECURITY DEFINER con guard idéntico a confirm_goods_receipt. Se valida desde
-- la app. Solo se crea aquí; no se ejecuta.
-- ============================================================================

create or replace function public.learn_supplier_alias(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_emitter   text;
  v_emit_nif  text;
  v_sup_name  text;
  v_emit_norm text;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'learn_supplier_alias: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'learn_supplier_alias: sin acceso al albarán %', p_receipt_id;
  END IF;

  -- Sin proveedor elegido o sin sesión OCR → nada que aprender.
  IF v_receipt.supplier_id IS NULL OR v_receipt.ai_session_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    btrim(s.parsed_result->'document'->>'supplier_name'),
    btrim(s.parsed_result->'document'->>'supplier_tax_id')
  INTO v_emitter, v_emit_nif
  FROM goods_receipt_ai_session s
  WHERE s.id = v_receipt.ai_session_id;

  IF v_emitter IS NULL OR v_emitter = '' THEN
    RETURN false;
  END IF;

  -- Nombre del proveedor comercial elegido.
  SELECT name INTO v_sup_name FROM supplier WHERE id = v_receipt.supplier_id;

  -- Normalizadores coherentes con resolveReceiptHeader (lower, sin acentos, sin
  -- signos, espacios colapsados).
  v_emit_norm := regexp_replace(
                   regexp_replace(lower(unaccent(v_emitter)), '[^a-z0-9 ]', ' ', 'g'),
                   '\s+', ' ', 'g');
  v_emit_norm := btrim(v_emit_norm);

  -- Solo es "intermediario" si el emisor difiere del proveedor comercial elegido.
  IF v_sup_name IS NOT NULL
     AND btrim(regexp_replace(regexp_replace(lower(unaccent(v_sup_name)), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) = v_emit_norm THEN
    RETURN false;   -- emisor == comercial → no hay intermediario que recordar
  END IF;

  INSERT INTO supplier_alias (account_id, emitter_norm, emitter_nif, supplier_id, delivered_by, created_by)
  VALUES (
    v_receipt.account_id,
    v_emit_norm,
    NULLIF(regexp_replace(upper(coalesce(v_emit_nif, '')), '[^A-Z0-9]', '', 'g'), ''),
    v_receipt.supplier_id,
    v_emitter,
    auth.uid()
  )
  ON CONFLICT (account_id, emitter_norm) DO UPDATE SET
    supplier_id = EXCLUDED.supplier_id,
    emitter_nif = COALESCE(EXCLUDED.emitter_nif, supplier_alias.emitter_nif),
    delivered_by = EXCLUDED.delivered_by,
    updated_at = now();

  RETURN true;
END;
$$;
