
-- adapt_hubrise_order es el ÚLTIMO que escribe delivery_address (upsertSale
-- inserta y luego llama a esta función, que la pisa). Por eso el arreglo del
-- número de portal de Glovo TIENE que estar aquí, no solo en el webhook.
--
-- La sustitución se hace sobre la definición VIVA leída de pg_get_functiondef,
-- no sobre una copia transcrita a mano: el cuerpo de esta función es largo y
-- vive solo en BBDD (deuda declarada "SQL HubRise aplicado-no-versionado").
-- Reescribirlo entero a mano sería la forma más probable de romper la ingesta
-- de TODOS los pedidos en mitad del servicio. Se verifica que el fragmento
-- aparece EXACTAMENTE UNA vez antes de tocar nada; si no, aborta.
DO $do$
DECLARE
  v_def text;
  v_old text := 'nullif(btrim(coalesce(v_order->''customer''->>''address_1'','''')),'''')';
  v_new text := 'public.hubrise_street_line(v_order->''customer''->>''address_1'', v_order->''customer''->>''city'')';
  v_n   int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'adapt_hubrise_order' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'adapt_hubrise_order no encontrada';
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'se esperaba 1 aparicion del fragmento address_1, encontradas %', v_n;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'adapt_hubrise_order actualizada: address_1 -> hubrise_street_line(address_1, city)';
END
$do$;
