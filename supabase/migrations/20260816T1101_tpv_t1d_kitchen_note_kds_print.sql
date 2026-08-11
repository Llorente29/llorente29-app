-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ⚠️⚠️ NO APLICAR EN HORARIO DE SERVICIO. orders_feed_by_token consume el
-- 71% de la CPU de la base y la llaman todas las tablets del pase en
-- producción — aplicar fuera de horario, como pide el encargo.
--
-- ENCARGO TPV T1.d — Tarea B.3: que la nota de cocina (sale_line.kitchen_note,
-- ya escrita por _adapt_folvy_pos_order desde T1, NO tocada aquí) salga por
-- KDS e impresión. Sustitución QUIRÚRGICA sobre pg_get_functiondef() en vivo,
-- dentro de un DO, con guard que aborta si el fragmento no aparece
-- EXACTAMENTE una vez — mismo patrón que 0901/0905. Nunca se pega la función
-- entera: el texto nuevo se construye a partir del texto vivo + 2 sustitu-
-- ciones, y se ejecuta ese resultado. Firma, permisos (una CREATE OR REPLACE
-- conserva los GRANT existentes, no los resetea) y el resto del cuerpo
-- quedan exactamente como están — no se añade ningún join.
--
-- RECON del nombre de campo (pedido explícito del encargo, "comprueba el
-- nombre real antes de escribir nada"): el KDS NO usa 'comments' — usa
-- 'customer_note'. Confirmado en KdsTicketCard.tsx (NoteChip rojo,
-- line.customer_note/children.customer_note) y en el propio SQL de
-- orders_feed_by_token/order_for_print (CTE `notas`, alimentada hoy solo
-- por prod->>'comments' de HubRise/Last). Por eso el cambio es
-- `coalesce(<nota de HubRise/Last>, sl.kitchen_note)` bajo la MISMA clave
-- 'customer_note' — cero cambio en el cliente KDS.
--
-- Bonus confirmado sin tocar nada de cliente: native/print/ticketRenderer.ts
-- línea ~181 YA renderiza `line.customer_note` con negrita y prefijo '> '
-- ("if (line.customer_note) b.push({kind:'text', text:'> '+line.customer_note,
-- bold:true, size:2})") — exactamente el formato que pide la Tarea B.3.2
-- ("debajo de su producto, indentada y en negrita... si no, prefijo '>> '").
-- Al unificar kitchen_note bajo la misma clave customer_note, ese renderer
-- lo pinta gratis, sin tocar una línea de TypeScript.
--
-- Dos sustituciones, IDÉNTICAS en ambas funciones (verificado con MCP, solo
-- lectura, antes de escribir este fichero — sin CREATE ni EXECUTE):
--   1) padres CTE: `sl.unit_price, sl.line_total,` → añade `sl.kitchen_note,`
--      justo detrás. Ocurre 1 vez en cada función.
--   2) El customer_note del PADRE (no el de los hijos/modificadores — esos
--      nunca llevan kitchen_note, no se toca su fragmento):
--      `'customer_note', (select n.note from notas n where n.sale_id=l.sale_id
--      and n.ext_pid=l.external_product_id limit 1),` →
--      `'customer_note', coalesce((...), l.kitchen_note),`
--      Ocurre 1 vez en cada función (el de los hijos usa n2./h., no matchea).
--
-- Los patrones usan \s* entre tokens para no depender del formato exacto de
-- espacios/salto de línea (orders_feed_by_token vive con CRLF y el
-- fragmento 2 en 3 líneas; order_for_print vive compacto en una sola línea
-- con \r\n normal) — verificado que el MISMO patrón regex encuentra
-- exactamente 1 coincidencia en AMBAS funciones, con sus formatos distintos.
--
-- Validado por MCP ANTES de escribir este fichero (todo de solo lectura,
-- sin CREATE ni EXECUTE, cero riesgo para la función real):
--   · Conteo de ocurrencias de los 2 fragmentos en las 2 funciones: 1/1/1/1.
--   · Previsualización completa del texto resultante para las 2 funciones
--     (regexp_replace puro, sin aplicar) — inspeccionada línea a línea,
--     confirma que NO cambia nada más: firma, SECURITY DEFINER, search_path,
--     el resto de columnas/joins/CTEs idénticos.

do $$
declare
  v_frag1 text := 'sl\.unit_price,\s*sl\.line_total,';
  v_frag1_new text := 'sl.unit_price, sl.line_total, sl.kitchen_note,';
  v_frag2 text := '''customer_note'',\s*\(\s*select n\.note from notas n\s*where n\.sale_id\s*=\s*l\.sale_id and n\.ext_pid\s*=\s*l\.external_product_id limit 1\s*\),';
  v_frag2_new text := E'''customer_note'', coalesce((select n.note from notas n where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1), l.kitchen_note),';
  v_def  text;
  v_new  text;
  v_cnt1 int;
  v_cnt2 int;
  v_oid  oid;
begin
  -- ── orders_feed_by_token ────────────────────────────────────────────────
  select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'orders_feed_by_token';

  if v_oid is null then
    raise exception 'tpv_t1d_kitchen_note_kds: falta orders_feed_by_token — RECON desactualizado, parar';
  end if;

  select count(*) into v_cnt1 from regexp_matches(v_def, v_frag1, 'g');
  select count(*) into v_cnt2 from regexp_matches(v_def, v_frag2, 'g');
  if v_cnt1 <> 1 then
    raise exception 'tpv_t1d_kitchen_note_kds: orders_feed_by_token, fragmento 1 aparece % veces (se esperaba 1) — parar', v_cnt1;
  end if;
  if v_cnt2 <> 1 then
    raise exception 'tpv_t1d_kitchen_note_kds: orders_feed_by_token, fragmento 2 aparece % veces (se esperaba 1) — parar', v_cnt2;
  end if;

  v_new := regexp_replace(v_def, v_frag1, v_frag1_new);
  v_new := regexp_replace(v_new, v_frag2, v_frag2_new);
  execute v_new;

  -- ── order_for_print ──────────────────────────────────────────────────────
  select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'order_for_print';

  if v_oid is null then
    raise exception 'tpv_t1d_kitchen_note_kds: falta order_for_print — RECON desactualizado, parar';
  end if;

  select count(*) into v_cnt1 from regexp_matches(v_def, v_frag1, 'g');
  select count(*) into v_cnt2 from regexp_matches(v_def, v_frag2, 'g');
  if v_cnt1 <> 1 then
    raise exception 'tpv_t1d_kitchen_note_kds: order_for_print, fragmento 1 aparece % veces (se esperaba 1) — parar', v_cnt1;
  end if;
  if v_cnt2 <> 1 then
    raise exception 'tpv_t1d_kitchen_note_kds: order_for_print, fragmento 2 aparece % veces (se esperaba 1) — parar', v_cnt2;
  end if;

  v_new := regexp_replace(v_def, v_frag1, v_frag1_new);
  v_new := regexp_replace(v_new, v_frag2, v_frag2_new);
  execute v_new;
end $$;

notify pgrst, 'reload schema';

-- ── Verificación (§6 del encargo) ────────────────────────────────────────
--
-- 5) select id, kitchen_note from sale_line where kitchen_note is not null order by created_at desc limit 5;
-- 6) KDS: probar orders_feed_by_token con un token real y comprobar que la
--    línea del TPV trae 'customer_note' relleno — visible en pantalla KDS
--    como chip rojo (NoteChip), no solo en el JSON.
-- 7) Impresión: order_for_print sobre la misma venta, la línea imprime
--    "> <nota>" en negrita bajo el producto (ticketRenderer.ts, sin tocar).
-- 8) Un pedido de HubRise con comments real: sigue mostrando su nota (la
--    coalesce prioriza la nota de HubRise/Last sobre kitchen_note, que para
--    una venta HubRise siempre es null — no hay conflicto posible).
-- 9) Nota vacía o solo espacios en el TPV → kitchen_note queda null (ya lo
--    hace _adapt_folvy_pos_order con nullif(btrim(...),''), no tocado aquí).
-- 12) select has_function_privilege('authenticated','public.orders_feed_by_token(text)','execute'); -- true
--     select has_function_privilege('anon','public.orders_feed_by_token(text)','execute'); -- false
--     (permisos intactos: CREATE OR REPLACE no los resetea, no se ha tocado
--     ningún REVOKE/GRANT en este fichero)
