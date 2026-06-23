-- supabase/migrations/20260623T1400_ctb_notification_queue.sql
-- Aplicada: 2026-06-23
--
-- COMUNICAR RECEPCIONES A CLOUDTOWN (CTB).
-- CTB (el cedente) exige una foto del albarán de TODA recepción a su nombre
-- (propias o cedidas; el criterio es el PROVEEDOR del grupo Cloudtown, no el tipo
-- de marca). "Si hay diferencias las comunicas; si no, te haces cargo." El dolor
-- real en oficina es el OLVIDO. Solución: una COLA que no se vacía sola.
--
-- El envío sigue siendo MANUAL (compartir nativo al grupo de WhatsApp de la
-- EMPRESA — no el personal de un trabajador; por eso la cola es de OFICINA). El
-- canal automático a grupos de WhatsApp no existe de forma oficial/robusta, así
-- que aquí solo se persigue el olvido; el "Enviar" puede pasar a automático en el
-- futuro sin rehacer la cola.
--
-- (1) supplier.notify_group: marca a qué grupo de notificación pertenece un
--     proveedor. Detección ROBUSTA (no por nombre): hoy se marcan los 4 Cloudtown
--     con 'ctb'; cualquier proveedor nuevo del grupo se marca con un clic.
-- (2) ctb_notification_queue: una fila por recepción de un proveedor 'ctb' al
--     confirmarse. status pendiente/enviado; has_differences = la recepción trae
--     descuadre (alguna línea con discrepancy_reason) → roja y prioritaria.
-- (3) confirm_goods_receipt encola al confirmar si el proveedor es del grupo CTB.

-- ── (1) Flag de grupo de notificación en el proveedor ──
ALTER TABLE public.supplier
  ADD COLUMN IF NOT EXISTS notify_group text;

-- Marca los Cloudtown conocidos por ID (determinista, sin riesgo entre cuentas).
UPDATE public.supplier
  SET notify_group = 'ctb', updated_at = now()
  WHERE id IN (
    '92047dae-2dad-4f64-aa80-ff72d6e684fd',  -- CLOUDTOWN, S.L.
    '0848e744-0fdd-470a-a04b-72a27e500fda',  -- CLOUDTOWN - CHIVUOS MEDITERRANEA
    'a12b3e74-7e68-469e-87dd-296187507c16',  -- CLOUDTOWN - PACKAGING
    'e880787a-12ad-4fd2-89c1-d37e293783de'   -- CLOUDTOWN-BIDFOOD
  );

-- ── (2) Cola de notificación ──
CREATE TABLE IF NOT EXISTS public.ctb_notification_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL REFERENCES public.goods_receipt(id) ON DELETE CASCADE,
  location_id      uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  supplier_id      uuid REFERENCES public.supplier(id) ON DELETE SET NULL,
  notify_group     text NOT NULL DEFAULT 'ctb',
  has_differences  boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'pendiente'
                     CHECK (status IN ('pendiente', 'enviado')),
  sent_by          uuid,
  sent_by_name     text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- una sola entrada por recepción (re-confirmar no duplica; idempotente)
  UNIQUE (goods_receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_ctb_queue_account_status
  ON public.ctb_notification_queue (account_id, status, has_differences);

-- RLS calcada de goods_receipt.
ALTER TABLE public.ctb_notification_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ctb_notification_queue_rw ON public.ctb_notification_queue;
CREATE POLICY ctb_notification_queue_rw ON public.ctb_notification_queue
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

-- ── (3) confirm_goods_receipt: enruta a zona (vigente) + ENCOLA aviso CTB ──
-- Misma función que la vigente (enrutado por zona) + al final, si el proveedor de
-- la recepción es del grupo 'ctb', encola la notificación marcando si hay descuadre.
CREATE OR REPLACE FUNCTION public.confirm_goods_receipt(p_receipt_id uuid)
 RETURNS TABLE(posted_lines integer, skipped_lines integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_line      goods_receipt_line%ROWTYPE;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_fmt_qib   numeric;
  v_qib       numeric;
  v_eur_base  numeric;   -- €/base canónico (precio_formato / qty_in_base_formato)
  v_area_id   uuid;      -- zona principal del artículo en el local (nullable)
  v_notify    text;      -- grupo de notificación del proveedor (p.ej. 'ctb')
  v_has_diff  boolean;   -- la recepción trae descuadre (línea con discrepancy_reason)
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;
  IF v_receipt.status <> 'borrador' THEN
    RAISE EXCEPTION 'confirm_goods_receipt: el albarán % no está en borrador (está %)',
      p_receipt_id, v_receipt.status;
  END IF;

  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id
    ORDER BY position ASC, created_at ASC
  LOOP
    -- qty_in_base SERVER-SIDE (cantidad que entra al stock) — sin cambios.
    v_qib := NULL;
    IF v_line.purchase_format_id IS NOT NULL THEN
      SELECT f.qty_in_base INTO v_fmt_qib
        FROM recipe_item_purchase_format f
        WHERE f.id = v_line.purchase_format_id AND f.is_active;
      IF v_fmt_qib IS NOT NULL AND v_fmt_qib > 0
         AND v_line.qty_received IS NOT NULL AND v_line.qty_received > 0 THEN
        v_qib := v_line.qty_received * v_fmt_qib;
      END IF;
    END IF;
    IF v_qib IS NULL THEN
      v_qib := v_line.qty_in_base;
    END IF;

    IF v_line.recipe_item_id IS NULL OR v_qib IS NULL OR v_qib <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_qib IS DISTINCT FROM v_line.qty_in_base THEN
      UPDATE goods_receipt_line
        SET qty_in_base = v_qib, updated_at = now()
        WHERE id = v_line.id;
    END IF;

    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);

    -- ZONA PRINCIPAL del artículo en el local (menor position, zona activa).
    v_area_id := NULL;
    SELECT sa.id INTO v_area_id
      FROM recipe_item_storage_area risa
      JOIN storage_area sa ON sa.id = risa.storage_area_id
      WHERE risa.recipe_item_id = v_line.recipe_item_id
        AND risa.account_id     = v_receipt.account_id
        AND sa.location_id      = v_receipt.location_id
        AND sa.active
      ORDER BY risa.position ASC, sa.position ASC
      LIMIT 1;

    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id, storage_area_id,
      movement_type, qty_base, unit_cost, cost_provisional,
      source_type, source_id, lot_code, expiry_date,
      occurred_at, created_by, created_by_name
    )
    VALUES (
      v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id, v_area_id,
      'recepcion', v_qib,
      COALESCE(
        v_eur_base,
        CASE WHEN v_line.unit_cost IS NOT NULL AND v_line.qty_received > 0
             THEN (v_line.unit_cost * v_line.qty_received) / v_qib END
      ),
      true,
      'goods_receipt_line', v_line.id,
      v_line.lot_code, v_line.expiry_date,
      COALESCE(v_receipt.received_at, now()), v_user, v_user_name
    );

    PERFORM recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

    IF v_eur_base IS NOT NULL AND v_line.purchase_format_id IS NOT NULL THEN
      UPDATE article_supplier
        SET last_price = v_eur_base, updated_at = now()
        WHERE account_id        = v_receipt.account_id
          AND recipe_item_id    = v_line.recipe_item_id
          AND purchase_format_id = v_line.purchase_format_id
          AND is_active;
    END IF;

    v_posted := v_posted + 1;
  END LOOP;

  UPDATE goods_receipt
    SET status = 'confirmado', received_at = COALESCE(received_at, now()),
        needs_review = (v_skipped > 0), updated_at = now()
    WHERE id = p_receipt_id;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  -- ── ENCOLAR AVISO A CTB si el proveedor es del grupo de notificación ──
  v_notify := NULL;
  IF v_receipt.supplier_id IS NOT NULL THEN
    SELECT notify_group INTO v_notify FROM supplier WHERE id = v_receipt.supplier_id;
  END IF;
  IF v_notify = 'ctb' THEN
    -- diferencia = alguna línea con motivo de descuadre (de más / de menos / importe)
    SELECT EXISTS (
      SELECT 1 FROM goods_receipt_line
      WHERE goods_receipt_id = p_receipt_id
        AND discrepancy_reason IS NOT NULL
        AND btrim(discrepancy_reason) <> ''
    ) INTO v_has_diff;

    INSERT INTO ctb_notification_queue (
      account_id, goods_receipt_id, location_id, supplier_id,
      notify_group, has_differences, status
    )
    VALUES (
      v_receipt.account_id, p_receipt_id, v_receipt.location_id, v_receipt.supplier_id,
      v_notify, COALESCE(v_has_diff, false), 'pendiente'
    )
    ON CONFLICT (goods_receipt_id) DO UPDATE
      SET has_differences = EXCLUDED.has_differences,
          location_id     = EXCLUDED.location_id,
          supplier_id     = EXCLUDED.supplier_id,
          updated_at      = now();
  END IF;

  posted_lines := v_posted; skipped_lines := v_skipped;
  RETURN NEXT;
END;
$function$;

-- ── Marcar una entrada como enviada (desde la app, con sesión) ──
CREATE OR REPLACE FUNCTION public.mark_ctb_notification_sent(p_queue_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc  uuid;
  v_user uuid;
  v_name text;
BEGIN
  SELECT account_id INTO v_acc FROM ctb_notification_queue WHERE id = p_queue_id;
  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'mark_ctb_notification_sent: entrada % no existe', p_queue_id;
  END IF;
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_acc)) THEN
    RAISE EXCEPTION 'mark_ctb_notification_sent: sin acceso';
  END IF;
  v_user := auth.uid();
  SELECT display_name INTO v_name FROM user_profiles WHERE id = v_user;
  UPDATE ctb_notification_queue
    SET status = 'enviado', sent_by = v_user, sent_by_name = v_name,
        sent_at = now(), updated_at = now()
    WHERE id = p_queue_id;
END;
$function$;
