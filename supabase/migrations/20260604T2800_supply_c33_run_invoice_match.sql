-- ============================================================================
-- Folvy Supply C3.3 — Motor three-way match
-- ============================================================================
-- run_invoice_match(p_invoice_id): cruza cada línea de FACTURA contra la línea
-- de ALBARÁN del mismo artículo (de los albaranes enlazados a la factura) y
-- contra el motor de IVA por fecha. Escribe el veredicto por línea
-- (match_result + match_detail) y el estado de cabecera (match_status).
--
-- Veredictos (match_result):
--   ok | diferencia_precio | diferencia_cantidad | no_recibido | iva_no_cuadra | sin_casar
-- Idempotente (recalculable). SECURITY DEFINER → SE PRUEBA DESDE LA APP (auth.uid()).
-- NO toca coste ni stock (eso es C3.4 al aprobar). Solo diagnostica.
--
-- DDL sin BEGIN/COMMIT. Umbral de precio: supply_settings.price_alert_pct (def 15).
-- ============================================================================

create or replace function public.run_invoice_match(p_invoice_id uuid)
returns table (
  match_status text,
  lines_total integer,
  lines_ok integer,
  lines_diff_price integer,
  lines_diff_qty integer,
  lines_not_received integer,
  lines_vat_bad integer,
  lines_unmatched integer
)
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_account_id uuid;
  v_invoice_date date;
  v_threshold numeric;
  v_line record;
  -- agregados del albarán por artículo:
  v_alb_qty numeric;
  v_alb_cost numeric;       -- coste unitario de referencia (media ponderada del albarán)
  v_alb_line uuid;          -- una goods_receipt_line representativa (para enlazar)
  v_alb_count integer;
  v_expected_vat numeric;
  v_result text;
  v_detail jsonb;
  -- contadores:
  c_total integer := 0; c_ok integer := 0; c_dp integer := 0; c_dq integer := 0;
  c_nr integer := 0; c_vat integer := 0; c_un integer := 0;
  v_status text;
BEGIN
  SELECT account_id, invoice_date INTO v_account_id, v_invoice_date
    FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada', p_invoice_id;
  END IF;
  IF v_invoice_date IS NULL THEN v_invoice_date := current_date; END IF;

  -- Umbral de precio por cuenta (default 15%).
  SELECT COALESCE(price_alert_pct, 15) INTO v_threshold
    FROM public.supply_settings WHERE account_id = v_account_id;
  IF v_threshold IS NULL THEN v_threshold := 15; END IF;

  -- Recorre las líneas de la factura.
  FOR v_line IN
    SELECT id, recipe_item_id, qty, unit_price, vat_pct
      FROM public.supplier_invoice_line
      WHERE supplier_invoice_id = p_invoice_id
  LOOP
    c_total := c_total + 1;
    v_result := NULL; v_detail := '{}'::jsonb; v_alb_line := NULL;

    IF v_line.recipe_item_id IS NULL THEN
      v_result := 'sin_casar';
      c_un := c_un + 1;
    ELSE
      -- Agregado del albarán: todas las líneas de albarán de los albaranes
      -- enlazados a esta factura, mismo artículo. Suma cantidad, media de coste.
      SELECT
        COALESCE(SUM(grl.qty_received), 0),
        CASE WHEN COALESCE(SUM(grl.qty_received),0) > 0
             THEN SUM(grl.unit_cost * grl.qty_received) / NULLIF(SUM(grl.qty_received),0)
             ELSE AVG(grl.unit_cost) END,
        COUNT(*),
        MIN(grl.id)
      INTO v_alb_qty, v_alb_cost, v_alb_count, v_alb_line
      FROM public.goods_receipt_line grl
      WHERE grl.recipe_item_id = v_line.recipe_item_id
        AND grl.goods_receipt_id IN (
          SELECT goods_receipt_id FROM public.supplier_invoice_receipt
          WHERE supplier_invoice_id = p_invoice_id
        );

      -- Tipo de IVA esperado (motor fiscal por fecha de la factura).
      v_expected_vat := NULL;
      SELECT rate INTO v_expected_vat
      FROM public.vat_rate_for(
        (SELECT vat_category_id FROM public.recipe_item WHERE id = v_line.recipe_item_id),
        v_invoice_date
      );

      IF v_alb_count IS NULL OR v_alb_count = 0 THEN
        -- Facturado pero no recibido.
        v_result := 'no_recibido';
        v_detail := jsonb_build_object('invoiced_qty', v_line.qty, 'received_qty', 0);
        c_nr := c_nr + 1;
      ELSE
        -- Precio: factura vs coste de albarán.
        IF v_line.unit_price IS NOT NULL AND v_alb_cost IS NOT NULL AND v_alb_cost > 0
           AND abs((v_line.unit_price - v_alb_cost) / v_alb_cost) * 100 > v_threshold THEN
          v_result := 'diferencia_precio';
          v_detail := jsonb_build_object(
            'invoiced_price', v_line.unit_price, 'receipt_cost', round(v_alb_cost, 4),
            'pct', round(((v_line.unit_price - v_alb_cost) / v_alb_cost) * 100, 1));
          c_dp := c_dp + 1;
        -- Cantidad: factura vs recibido (agregado).
        ELSIF v_line.qty IS NOT NULL AND v_alb_qty IS NOT NULL
              AND abs(v_line.qty - v_alb_qty) > 0.001 THEN
          v_result := 'diferencia_cantidad';
          v_detail := jsonb_build_object('invoiced_qty', v_line.qty, 'received_qty', v_alb_qty);
          c_dq := c_dq + 1;
        -- IVA: factura vs esperado por motor fiscal.
        ELSIF v_expected_vat IS NOT NULL AND v_line.vat_pct IS NOT NULL
              AND abs(v_line.vat_pct - v_expected_vat) > 0.1 THEN
          v_result := 'iva_no_cuadra';
          v_detail := jsonb_build_object('invoiced_vat', v_line.vat_pct, 'expected_vat', v_expected_vat);
          c_vat := c_vat + 1;
        ELSE
          v_result := 'ok';
          v_detail := jsonb_build_object(
            'receipt_cost', round(COALESCE(v_alb_cost,0), 4), 'received_qty', v_alb_qty);
          c_ok := c_ok + 1;
        END IF;
      END IF;
    END IF;

    UPDATE public.supplier_invoice_line
      SET match_result = v_result,
          match_detail = v_detail,
          goods_receipt_line_id = COALESCE(v_alb_line, goods_receipt_line_id)
      WHERE id = v_line.id;
  END LOOP;

  -- Estado de cabecera.
  IF (c_dp + c_dq + c_nr + c_vat + c_un) = 0 AND c_total > 0 THEN
    v_status := 'ok';
  ELSIF c_total = 0 THEN
    v_status := 'sin_match';
  ELSE
    v_status := 'con_diferencias';
  END IF;

  UPDATE public.supplier_invoice
    SET match_status = v_status, updated_at = now()
    WHERE id = p_invoice_id;

  RETURN QUERY SELECT v_status, c_total, c_ok, c_dp, c_dq, c_nr, c_vat, c_un;
END;
$$;
