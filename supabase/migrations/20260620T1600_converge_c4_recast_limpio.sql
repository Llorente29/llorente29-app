-- supabase/migrations/20260620T1600_converge_c4_recast_limpio.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Capa 4: recast_lastapp_sales SIN dependencias viejas.
-- ============================================================================
-- VERIFICADO (20/06):
--   · external_product_map = 0 filas; 1.019 líneas de Last casan SIN él → el casado
--     NO usa ningún product_map. Casa por menu_item.external_source+external_id (lo
--     hace adapt_lastapp_order dentro de reprocess_sale).
--   · La PIEZA B del recast viejo (auto-propagación multimarca que leía
--     lastapp_catalog_product + lastapp_product_map para crear menu_items) es
--     DOBLEMENTE innecesaria: (1) el seed canónico ya crea los menu_items mejor;
--     (2) el casado no usa product_map. Se ELIMINA entera.
--
-- RESULTADO: recast queda en su esencia — re-procesa cada venta de Last vía
-- reprocess_sale (agnóstico, despacha por sale.source) + devuelve métricas leídas
-- del canónico ya reescrito. SIN leer catálogo, SIN tocar product_map → deja de
-- depender de las vistas puente lastapp_*.
--
-- Mantiene firma y nombre de columnas de retorno (lo consume el servicio admin y
-- salesReliabilityService). SECURITY DEFINER + guard. Se entrega SOLA.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recast_lastapp_sales(p_account_id uuid)
 RETURNS TABLE(ventas_procesadas integer, lineas_total integer, lineas_casadas integer,
               lineas_no_brand integer, lineas_no_recipe integer, lineas_no_menu_item integer,
               lineas_ambiguous integer, lineas_respetadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id  uuid;
  v_ventas   integer := 0;
  v_total    integer := 0;
  v_ok       integer := 0;
  v_nb       integer := 0;
  v_nr       integer := 0;
  v_nm       integer := 0;
  v_amb      integer := 0;
  v_resp     integer := 0;
BEGIN
  -- Guard de tenancy.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'recast_lastapp_sales: sin acceso a la cuenta %', p_account_id;
  END IF;

  -- Re-procesar cada venta de Last: reprocess_sale reconstruye la identidad canónica
  -- (adapt_lastapp_order: casa por menu_item.external_source+external_id; marca por
  -- external_brand_map), recostea y re-consume. Respeta manual/ignored/delisted.
  FOR v_sale_id IN
    SELECT id FROM sale
    WHERE account_id = p_account_id AND source = 'lastapp' AND raw_products IS NOT NULL
  LOOP
    PERFORM public.reprocess_sale(v_sale_id);
  END LOOP;

  -- Métricas leídas del canónico ya reescrito (no del JSON).
  SELECT
    count(DISTINCT sl.sale_id),
    count(*),
    count(*) FILTER (WHERE sl.menu_item_id IS NOT NULL),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_brand'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_recipe'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_menu_item'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'ambiguous'),
    count(*) FILTER (WHERE sl.map_source = 'manual'
                        OR COALESCE(sl.unmapped_reason, '') IN ('ignored', 'delisted'))
  INTO v_ventas, v_total, v_ok, v_nb, v_nr, v_nm, v_amb, v_resp
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND COALESCE(sl.line_type, 'product') = 'product';

  ventas_procesadas   := v_ventas;
  lineas_total        := v_total;
  lineas_casadas      := v_ok;
  lineas_no_brand     := v_nb;
  lineas_no_recipe    := v_nr;
  lineas_no_menu_item := v_nm;
  lineas_ambiguous    := v_amb;
  lineas_respetadas   := v_resp;
  RETURN NEXT;
END;
$function$;
