-- C9 · Lote 1 §2b · 04/09/2026 — order_for_print entrega los tokens a la tablet.
-- ===========================================================================
-- El renderizador corre en la app Android y solo ve lo que devuelve
-- order_for_print. Para que el QR pueda llevar un identificador, los tokens
-- tienen que viajar en ese JSON.
--
-- CIRUGIA SOBRE LA DEFINICION VIVA (regla F5): cuatro fragmentos de UNA SOLA
--   LINEA, cada uno contado antes de tocarlo. Si alguno no aparece exactamente
--   una vez, aborta y no se toca nada. Comprobado hoy contra la definicion real:
--   los cuatro aparecen 1 vez y esta funcion NO tiene CRLF.
--
-- DONDE SE ACUÑAN: justo despues de fill_line_discounts, DENTRO de su mismo
--   bloque `begin … exception when others then null; end`. O sea que ni el
--   acuñado ni un fallo suyo pueden tumbar un ticket — y ademas
--   ensure_label_tokens ya se traga sus propios errores. Doble red, a proposito:
--   esto esta en el camino de una impresion de cocina.
--
-- QUE SE AÑADE AL JSON:
--   · lineas[].unit_tokens        — un token por unidad, en orden de unit_no
--   · lineas[].children[].unit_tokens — idem para los componentes de combo, que
--     son los que llevan pegatina cuando la linea es un combo
--   · bag_token                   — el de la etiqueta de la bolsa de bebidas
--
-- Si una linea no tiene tokens (acuñado fallido, venta vieja), `unit_tokens`
-- llega null y el renderizador cae al shop_url de siempre. Nunca se deja de
-- imprimir por esto.

begin;

do $do$
declare
  v_def text; v_old text; v_new text; v_veces int; i int;
  v_pares text[][] := array[
    -- (1) acuñar los tokens antes de construir el JSON
    array[
      $q$    perform public.fill_line_discounts(p_sale_id);$q$,
      $q$    perform public.fill_line_discounts(p_sale_id);
    -- C9 L1: acuña los tokens de etiqueta si no existen. Idempotente: la
    -- reimpresion pasa por aqui otra vez y devuelve LOS MISMOS.
    perform public.ensure_label_tokens(p_sale_id);$q$
    ],
    -- (2) tokens de la linea padre
    array[
      $q$              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,$q$,
      $q$              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,
              'unit_tokens', public.label_tokens_for(l.line_id),$q$
    ],
    -- (3) tokens del componente de combo
    array[
      $q$                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,$q$,
      $q$                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,
                  'unit_tokens', public.label_tokens_for(h.line_id),$q$
    ],
    -- (4) el token de la bolsa de bebidas
    array[
      $q$           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,$q$,
      $q$           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,
           public.label_token_bolsa(v.id) as bag_token,$q$
    ]
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_for_print';

  if v_def is null then
    raise exception 'C9 L1: no se encuentra public.order_for_print';
  end if;

  for i in 1 .. array_length(v_pares, 1) loop
    v_old := v_pares[i][1];
    v_new := v_pares[i][2];
    v_veces := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_veces <> 1 then
      raise exception 'C9 L1: el fragmento % aparece % veces, se esperaba 1. No se toca nada.', i, v_veces;
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;

  execute v_def;
end
$do$;

commit;
