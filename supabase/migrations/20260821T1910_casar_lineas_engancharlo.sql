-- 20260821T1910_casar_lineas_engancharlo.sql
-- ENCARGO CODE (21/08) §5(B) — enganchar el casador en los TRES sitios que
-- enlazan una recepción con un pedido, justo ANTES de recompute.
--
-- APLICADA: 21/08/2026 vía MCP, verificada con consulta independiente.
--
-- POR QUÉ NO EN auto_link_goods_receipt_to_order, que es donde lo pedía el
-- encargo: esa función hace `return null` de entrada si la recepción YA tiene
-- purchase_order_id, y confirm_goods_receipt ni siquiera la llama en ese caso.
-- El camino normal es enlazar al RECIBIR y confirmar después, así que poner el
-- casado ahí se lo saltaría justo en el caso habitual. El encargo lo contempla:
-- «o en una función hermana que se llame justo detrás».
--
-- POR QUÉ LA EDICIÓN VA CON replace() SOBRE pg_get_functiondef Y NO A MANO:
-- confirm_goods_receipt y receive_goods_receipt se tocaron esta misma mañana
-- (20260820T1700, retención por needs_review) y retranscribirlas enteras es
-- exactamente como se pierden mejoras — pasó el 26/07 con catcher-dispatch.
-- Así el único cambio posible es el que dice el replace, y se comprueba
-- contando la diferencia de longitud: si tocara dos sitios, aborta.

do $$
declare
  d_old text;
  d_new text;
  v_viejo constant text :=
    '  if v_receipt.purchase_order_id is not null then' || chr(10) ||
    '    perform recompute_purchase_order_status(v_receipt.purchase_order_id);' || chr(10) ||
    '  end if;';
  v_nuevo constant text :=
    '  if v_receipt.purchase_order_id is not null then' || chr(10) ||
    '    -- ENCARGO CODE (21/08) — casar las líneas ANTES de recalcular: si no,' || chr(10) ||
    '    -- recompute cuenta 0 recibido y el pedido se queda en ''enviado'' para' || chr(10) ||
    '    -- siempre por mucha mercancía que entre.' || chr(10) ||
    '    perform public._match_order_lines_for_order(v_receipt.purchase_order_id);' || chr(10) ||
    '    perform recompute_purchase_order_status(v_receipt.purchase_order_id);' || chr(10) ||
    '  end if;';
  f record;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('confirm_goods_receipt', 'receive_goods_receipt')
  loop
    d_old := pg_get_functiondef(f.oid);
    if position('_match_order_lines_for_order' in d_old) > 0 then
      raise notice '% ya lo llamaba, no se toca', f.proname;
      continue;
    end if;
    if position(v_viejo in d_old) = 0 then
      raise exception '% no tiene el bloque esperado; abortado sin tocar nada', f.proname;
    end if;
    d_new := replace(d_old, v_viejo, v_nuevo);
    if length(d_new) - length(d_old) <> length(v_nuevo) - length(v_viejo) then
      raise exception '% : el replace tocó más de un sitio. Abortado.', f.proname;
    end if;
    execute d_new;
  end loop;
end $$;

-- El tercer sitio: el enlace MANUAL desde la pantalla.
do $$
declare
  d_old text; d_new text; v_oid oid;
  v_viejo constant text := '  perform recompute_purchase_order_status(p_order_id);';
  v_nuevo constant text :=
    '  perform public._match_order_lines_for_order(p_order_id);' || chr(10) ||
    '  perform recompute_purchase_order_status(p_order_id);';
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='confirm_goods_receipt_order_link';
  d_old := pg_get_functiondef(v_oid);
  if position('_match_order_lines_for_order' in d_old) > 0 then
    raise notice 'confirm_goods_receipt_order_link ya lo llamaba';
  else
    if position(v_viejo in d_old) = 0 then
      raise exception 'confirm_goods_receipt_order_link no tiene el bloque esperado; abortado';
    end if;
    d_new := replace(d_old, v_viejo, v_nuevo);
    if length(d_new) - length(d_old) <> length(v_nuevo) - length(v_viejo) then
      raise exception 'confirm_goods_receipt_order_link: el replace tocó más de un sitio. Abortado.';
    end if;
    execute d_new;
  end if;
end $$;

-- Verificación: las tres llaman al casador Y siguen llamando a recompute.
do $$
declare f record; n integer := 0;
begin
  for f in
    select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname='public'
       and p.proname in ('confirm_goods_receipt','receive_goods_receipt','confirm_goods_receipt_order_link')
  loop
    if position('_match_order_lines_for_order' in f.def) = 0 then
      raise exception '% no quedó llamando al casador', f.proname;
    end if;
    if position('recompute_purchase_order_status' in f.def) = 0 then
      raise exception '% perdió la llamada a recompute', f.proname;
    end if;
    n := n + 1;
  end loop;
  if n <> 3 then
    raise exception 'se esperaban 3 funciones y se comprobaron %', n;
  end if;
end $$;
