-- TPV · la nota de cocina llega a la pantalla de cocina, a Pedidos y al ticket.
--
-- Sustituye a 20260816T1101_tpv_t1d_kitchen_note_kds_print.sql, que nunca se
-- aplicó y solo cubría dos de las cuatro funciones. La nota que el TPV escribe
-- en sale_line.kitchen_note no la leía nadie: ni kds_board (pantalla de
-- cocina), ni orders_feed / orders_feed_by_token (Pedidos, oficina y tablet),
-- ni order_for_print (ticket).
--
-- Método: sustitución quirúrgica sobre pg_get_functiondef() en vivo, con
-- guarda que aborta si un fragmento no aparece EXACTAMENTE una vez. Nunca se
-- pega una función entera. Firma, permisos y resto del cuerpo intactos.
--   1) CTE `padres`: se añade sl.kitchen_note a la lista de columnas.
--   2) 'customer_note' del padre: coalesce(nota de Last/HubRise, l.kitchen_note).
--      Misma clave que ya pintan KdsTicketCard y ticketRenderer: cero cambios
--      de cliente. La de las hijas no se toca (nunca llevan kitchen_note).
--
-- Ensayado el 08/10/2026 a las 11:2x Madrid en transacción revertida, con las
-- cuatro funciones EJECUTADAS (son plpgsql: compilar no valida el SQL):
--   antes: nota en ticket = false · después = true · resto del ticket idéntico
--   Pedidos (tablet) trae la nota · pantalla de cocina trae la nota
-- 0 pedidos en la última hora al aplicar.

do $$
declare
  f2  text := '''customer_note'',\s*\(\s*select n\.note from notas n\s*where n\.sale_id\s*=\s*l\.sale_id and n\.ext_pid\s*=\s*l\.external_product_id limit 1\s*\),';
  f2n text := E'''customer_note'', coalesce((select n.note from notas n where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1), l.kitchen_note),';
  f1 text; f1n text; r record; v_def text; c1 int; c2 int; v_n int := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('orders_feed_by_token', 'order_for_print', 'orders_feed', 'kds_board')
  loop
    if r.proname = 'kds_board' then
      f1  := 'sl\.line_type,\s*sl\.menu_item_id,\s*sl\.external_product_id,';
      f1n := 'sl.line_type, sl.menu_item_id, sl.external_product_id, sl.kitchen_note,';
    else
      f1  := 'sl\.unit_price,\s*sl\.line_total,';
      f1n := 'sl.unit_price, sl.line_total, sl.kitchen_note,';
    end if;
    v_def := pg_get_functiondef(r.oid);
    select count(*) into c1 from regexp_matches(v_def, f1, 'g');
    select count(*) into c2 from regexp_matches(v_def, f2, 'g');
    if c1 <> 1 or c2 <> 1 then
      raise exception 'tpv_nota_de_cocina: %, fragmento 1 = %, fragmento 2 = % (se esperaba 1 y 1) — parar', r.proname, c1, c2;
    end if;
    execute regexp_replace(regexp_replace(v_def, f1, f1n), f2, f2n);
    v_n := v_n + 1;
  end loop;
  if v_n <> 4 then
    raise exception 'tpv_nota_de_cocina: se esperaban 4 funciones y hay % — parar', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
