-- 20260827T2000_recast_lastapp_sales_corte_por_defecto.sql
-- APLICADA en produccion el 27-08-2026.
--
-- LA REGLA 6, EN EL ULTIMO SITIO DONDE NO SE CUMPLIA.
-- ============================================================================
-- `recast_lastapp_sales` (a la que llama seedAndRecast desde el panel de
-- integraciones) reprocesaba TODAS las ventas de la cuenta, sin ventana.
-- Medido: Foodint tiene 99 conteos aprobados y 7.233 ventas de Last por debajo
-- del ultimo. Es deliberado para el alta de un cliente -- no hay conteos que
-- proteger -- y peligroso el dia que alguien lo pulsa sobre una cuenta viva.
--
-- ── EL CORTE ES EL COMPORTAMIENTO POR DEFECTO, NO UNA OPCION ─────────────
--   sin conteos aprobados -> reprocesa todo (alta de cliente, su caso de uso)
--   con conteos           -> corta en max(closed_at). No pregunta, no falla:
--                            hace lo correcto y devuelve cuantas protegio.
--
-- ── PARA BAJAR DEL CORTE HACEN FALTA DOS COSAS, NO UNA ───────────────────
--   p_incluir_bajo_conteo => true
--   p_ventas_esperadas    => el numero EXACTO de ventas que quedan por debajo
--
-- Si no coincide, aborta ANTES de tocar nada. Confirmar con un booleano es
-- demasiado facil: se pulsa sin leer. Confirmar una cifra que has tenido que ir
-- a mirar, no. Y si entre que la miras y ejecutas entran ventas nuevas, tampoco
-- cuela -- el numero ya no cuadra y vuelve a parar.
--
-- Probado con una copia desechable de la logica (sin el guard de tenencia, que
-- salta antes), y borrada despues:
--   incluir=true, sin cifra ....... ABORTA, y dice cuantas son (7.233)
--   incluir=true, cifra 9999 ...... ABORTA
--   incluir=true, cifra 7.450 ..... ABORTA  <- era MI numero, y estaba mal:
--                                            7.450 son todas las ventas bajo
--                                            el corte; esta funcion solo toca
--                                            lastapp con raw_products, que son
--                                            7.233. La puerta caza al que se
--                                            fia de una cifra de memoria.
--   por defecto, Foodint .......... sigue, corte 26/08 18:28, protege 7.233
--   por defecto, cuenta sin conteos . sigue, sin corte, protege 0
--
-- ── DROP + CREATE, NO REPLACE ────────────────────────────────────────────
-- Se anaden parametros Y cambia el tipo de retorno. Replace crearia una
-- SOBRECARGA y las llamadas de 1 argumento quedarian ambiguas (ERROR 42725).
-- Es la regla 2, y costo que los siete vigias se quedaran sin poder encolar.
--
-- El cliente (lastappIntegrationService.seedAndRecast) llama con solo
-- p_account_id: sigue compilando y funcionando, y ahora recibe el corte por
-- defecto sin tocar una linea de TypeScript.
-- ============================================================================

DROP FUNCTION IF EXISTS public.recast_lastapp_sales(uuid);

CREATE FUNCTION public.recast_lastapp_sales(
  p_account_id          uuid,
  p_incluir_bajo_conteo boolean DEFAULT false,
  p_ventas_esperadas    integer DEFAULT NULL)
 RETURNS TABLE(ventas_procesadas integer, ventas_protegidas integer,
               corte_en timestamptz,
               lineas_total integer, lineas_casadas integer,
               lineas_no_brand integer, lineas_no_recipe integer,
               lineas_no_menu_item integer, lineas_ambiguous integer,
               lineas_respetadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id  uuid;
  v_corte    timestamptz;
  v_bajo     integer := 0;
  v_ventas   integer := 0;
  v_prot     integer := 0;
  v_total    integer := 0;
  v_ok       integer := 0;
  v_nb       integer := 0;
  v_nr       integer := 0;
  v_nm       integer := 0;
  v_amb      integer := 0;
  v_resp     integer := 0;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'recast_lastapp_sales: sin acceso a la cuenta %', p_account_id;
  END IF;

  SELECT max(ic.closed_at) INTO v_corte
    FROM public.inventory_count ic
   WHERE ic.account_id = p_account_id
     AND ic.status IN ('aprobado','en_revision');

  IF v_corte IS NOT NULL THEN
    SELECT count(*) INTO v_bajo
      FROM public.sale s
     WHERE s.account_id = p_account_id AND s.source = 'lastapp'
       AND s.raw_products IS NOT NULL AND s.sold_at <= v_corte;
  END IF;

  IF p_incluir_bajo_conteo AND v_corte IS NOT NULL THEN
    IF p_ventas_esperadas IS NULL THEN
      RAISE EXCEPTION
        'recast_lastapp_sales: para reprocesar por debajo del ultimo conteo (%) hay que pasar '
        'p_ventas_esperadas con el numero exacto de ventas afectadas. Ahora mismo son %.',
        v_corte, v_bajo;
    END IF;
    IF p_ventas_esperadas <> v_bajo THEN
      RAISE EXCEPTION
        'recast_lastapp_sales: p_ventas_esperadas=% no coincide con las % ventas que hay por '
        'debajo del corte (%). Vuelve a mirarlo: o el numero esta mal, o han entrado ventas '
        'desde que lo miraste.',
        p_ventas_esperadas, v_bajo, v_corte;
    END IF;
  END IF;

  FOR v_sale_id IN
    SELECT id FROM public.sale
     WHERE account_id = p_account_id AND source = 'lastapp' AND raw_products IS NOT NULL
       AND (v_corte IS NULL OR p_incluir_bajo_conteo OR sold_at > v_corte)
     ORDER BY sold_at
  LOOP
    PERFORM public.reprocess_sale(v_sale_id);
  END LOOP;

  v_prot := CASE WHEN v_corte IS NULL OR p_incluir_bajo_conteo THEN 0 ELSE v_bajo END;

  -- Metricas leidas del canonico ya reescrito (no del JSON). Se miden sobre
  -- TODA la cuenta a proposito: son el estado del casado, no el de esta pasada.
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
  FROM public.sale_line sl
  JOIN public.sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND COALESCE(sl.line_type, 'product') = 'product';

  ventas_procesadas   := v_ventas;
  ventas_protegidas   := v_prot;
  corte_en            := v_corte;
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

REVOKE ALL ON FUNCTION public.recast_lastapp_sales(uuid, boolean, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recast_lastapp_sales(uuid, boolean, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
