-- ENSAYO de 20260927T0100_el_coste_es_lo_que_se_compro.sql
--
-- CÓMO SE CORRE. Este fichero es una plantilla: la línea «--@@MIGRACION@@» se
-- sustituye por el cuerpo de la migración SIN su «begin;» y su «commit;»
-- (scripts/montar_ensayo_coste_medio.py lo hace). Todo va dentro de UN bloque
-- DO que termina en RAISE EXCEPTION: no queda nada escrito, ni la migración.
-- El resultado viaja en el mensaje del error.
--
-- CUÁNDO. Fuera de banda (después de las 00:30): el bloque instala el CHECK
-- nuevo de recipe_item, que toma ACCESS EXCLUSIVE sobre una tabla que el
-- pedido lee, durante lo que dure el ensayo.
--
-- QUÉ MIDE
--   E0/E1  la migración no mueve NINGÚN computed_cost (huella de tabla entera,
--          etiquetada como tal: incluye la plantilla y las tres cuentas)
--   E2     encender los quietos: cuántos, y diferencia máxima antes/después
--   E3     aprobar uno que se mueve (Patatas Bastón) y que la guarda
--          «solo si no cambia» NO enciende otro (Sweet Potato Fries)
--   E4     la pasada nocturna: recalcula, cambia 0, avisa los >20 %
--   E5     la ventana caduca sola: con 30 días en vez de 90, sin albarán
--          ninguno, el coste cambia en la pasada (así se simula el paso del
--          tiempo: una compra que «sale» de la ventana)
--   Los cuatro caminos de la regla 10, con los quietos ya encendidos:
--   P1     RECIBIR un albarán de Carne de Birria (un 50 % más caro) → el coste
--          sube a la media esperada; confirmar; ANULAR → vuelve al de antes
--   P2     MERMA de 10 g de Carne de Birria → valorada al coste nuevo
--   P3     CERRAR una venta real que consume Carne de Birria (o regenerar su
--          consumo si ya está cerrada) + compute_sale_line_cost
--   P4     APROBAR un recuento real abierto que tenga algún artículo a media
--   Si alguno no se puede ensayar, sale dicho: eso es el hallazgo.

do $ensayo$
declare
  c_foodint constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  c_julio   constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  c_alcala  constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  c_patata  constant uuid := 'e0122bbf-007f-4150-958e-3bccbf63d221';
  c_sweet   constant uuid := 'fcdc5207-165e-41e2-bc7d-798a7bc8496c';
  v_out  text := '';
  v_h0   text; v_h1 text;
  v_n    int;  v_m int;
  v_max  numeric := 0;
  v_r    record;
  v_j    jsonb;
  v_birria uuid;
  v_c0 numeric; v_c1 numeric; v_c2 numeric; v_esp numeric;
  v_amt numeric; v_qty numeric;
  v_gr   uuid;
  v_last record;
  v_sale uuid; v_status text;
  v_cnt  uuid;
begin
  select md5(string_agg(id::text || ':' || coalesce(computed_cost::text, '-'), ',' order by id))
    into v_h0 from public.recipe_item;

  --@@MIGRACION@@

  -- ── E1 ──
  select md5(string_agg(id::text || ':' || coalesce(computed_cost::text, '-'), ',' order by id))
    into v_h1 from public.recipe_item;
  v_out := v_out || format(E'\nE1 computed_cost, tabla entera: antes %s despues %s → %s',
             left(v_h0, 8), left(v_h1, 8), case when v_h0 = v_h1 then 'IGUAL' else 'DISTINTA' end);
  for v_r in
    select a.name, r.grupo, r.estado, count(*) n from public.recipe_item_cost_rollout r
      join public.accounts a on a.id = r.account_id group by 1, 2, 3 order by 1, 2
  loop
    v_out := v_out || format(E'\n   rollout %s · %s · %s: %s', v_r.name, v_r.grupo, v_r.estado, v_r.n);
  end loop;
  v_out := v_out || E'\n   estrategias ahora: ' || (select string_agg(cost_strategy || '=' || n, ', ' order by cost_strategy)
             from (select cost_strategy, count(*) n from public.recipe_item group by 1) s);

  -- Suplantar a Julio: las funciones públicas llevan su guarda de cuenta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_julio, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c_julio::text, true);

  -- ── E2 ──
  v_n := 0; v_m := 0;
  for v_r in select * from public.encender_coste_medio_quietos(c_foodint) loop
    if v_r.encendido then
      v_n := v_n + 1;
      v_max := greatest(v_max, abs(coalesce(v_r.despues, 0) - coalesce(v_r.antes, 0)));
    else
      v_m := v_m + 1;
      v_out := v_out || format(E'\n   NO encendido %s: %s (%s → %s)', v_r.nombre, v_r.motivo, v_r.antes, v_r.despues);
    end if;
  end loop;
  v_out := v_out || format(E'\nE2 quietos encendidos %s, no encendidos %s, diferencia máxima %s €/base',
             v_n, v_m, v_max);

  -- ── E3 ──
  v_j := public.approve_average_cost(c_patata, false);
  v_out := v_out || format(E'\nE3 Patatas Bastón: %s', v_j::text);
  v_j := public.approve_average_cost(c_sweet, true);
  v_out := v_out || format(E'\nE3b Sweet Potato «solo si no cambia»: %s', v_j::text);

  -- ── E4 ──
  v_j := public._cost_average_nightly(c_foodint);
  v_out := v_out || format(E'\nE4 pasada: recalculados %s, cambiados %s, avisos %s, fallos %s',
             v_j->'recalculados', v_j->'cambiados', v_j->'avisos', v_j->'fallos');
  for v_r in select subject, message from public.system_alert_queue
              where kind in ('coste_medio_descartes', 'coste_medio_fallo') and created_at >= now() loop
    v_out := v_out || format(E'\n   AVISO %s\n%s', v_r.subject, v_r.message);
  end loop;

  -- ── E5 ──
  update public.kitchen_settings set cost_window_days_default = 30 where account_id = c_foodint;
  v_j := public._cost_average_nightly(c_foodint);
  v_out := v_out || format(E'\nE5 ventana 30 d, sin albarán: cambiados %s de %s · %s',
             v_j->'cambiados', v_j->'recalculados', left((v_j->'cambios')::text, 400));
  update public.kitchen_settings set cost_window_days_default = 90 where account_id = c_foodint;
  v_j := public._cost_average_nightly(c_foodint);
  v_out := v_out || format(E'\nE5b de vuelta a 90: cambiados %s', v_j->'cambiados');

  -- ── P1 RECIBIR ──
  select id, computed_cost into v_birria, v_c0 from public.recipe_item
   where account_id = c_foodint and name = 'Carne de Birria';
  begin
    select gr.supplier_id, grl.purchase_format_id, grl.qty_received, grl.qty_in_base,
           grl.doc_amount, grl.product_name
      into v_last
      from public.goods_receipt_line grl
      join public.goods_receipt gr on gr.id = grl.goods_receipt_id
     where grl.recipe_item_id = v_birria and grl.account_id = c_foodint
       and gr.status = 'confirmado' and grl.doc_amount > 0 and grl.purchase_format_id is not null
     order by gr.receipt_date desc limit 1;
    select (b->>'importe')::numeric, (b->>'cantidad')::numeric into v_amt, v_qty
      from (select public._article_weighted_cost(v_birria) b) x;
    v_esp := (v_amt + v_last.doc_amount * 1.5) / (v_qty + v_last.qty_in_base);

    insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date,
                                      status, source, supplier_doc_number, notes)
    values (c_foodint, c_alcala, v_last.supplier_id, current_date, 'borrador', 'manual',
            'ENSAYO-COSTE', 'ensayo revertido')
    returning id into v_gr;
    insert into public.goods_receipt_line (account_id, goods_receipt_id, recipe_item_id, product_name,
            qty_received, purchase_format_id, qty_in_base, unit_cost, doc_qty, doc_amount, position)
    values (c_foodint, v_gr, v_birria, v_last.product_name, v_last.qty_received,
            v_last.purchase_format_id, v_last.qty_in_base,
            v_last.doc_amount * 1.5 / v_last.qty_received, v_last.qty_received,
            v_last.doc_amount * 1.5, 0);

    perform public.receive_goods_receipt(v_gr, false);
    select computed_cost into v_c1 from public.recipe_item where id = v_birria;
    select status into v_status from public.goods_receipt where id = v_gr;
    v_out := v_out || format(E'\nP1 recibido (%s): %s → %s · esperado %s · %s',
               v_status, v_c0, v_c1, v_esp, case when abs(v_c1 - v_esp) < 1e-12 then 'OK' else 'NO CUADRA' end);
    if v_status = 'recibido' then
      perform public.confirm_goods_receipt(v_gr);
    end if;
    perform public.void_goods_receipt(v_gr);
    select computed_cost into v_c2 from public.recipe_item where id = v_birria;
    v_out := v_out || format(E'\n   anulado: %s · %s', v_c2,
               case when abs(v_c2 - v_c0) < 1e-12 then 'vuelve al de antes' else 'NO VUELVE' end);
  exception when others then
    v_out := v_out || format(E'\nP1 NO SE PUDO ENSAYAR: %s (%s)', sqlerrm, sqlstate);
  end;

  -- ── P2 MERMA ──
  begin
    select computed_cost into v_c0 from public.recipe_item where id = v_birria;
    select * into v_r from public.register_waste(c_foodint, c_alcala, v_birria, 'otro', 10,
             p_notes => 'ensayo revertido', p_user_id => c_julio, p_user_name => 'Julio');
    v_out := v_out || format(E'\nP2 merma 10 g: %s € (10 × coste %s = %s)', v_r.cost_eur, v_c0, 10 * v_c0);
  exception when others then
    v_out := v_out || format(E'\nP2 NO SE PUDO ENSAYAR: %s (%s)', sqlerrm, sqlstate);
  end;

  -- ── P3 VENTA ──
  begin
    select s.id, s.status into v_sale, v_status
      from public.sale s
     where s.account_id = c_foodint and s.sold_at > now() - interval '3 days'
       and exists (select 1 from public.sale_line sl
                    cross join lateral public._sale_line_raw_consumption(sl.id) r
                    where sl.sale_id = s.id and r.raw_item_id = v_birria)
     order by (s.status = 'open') desc, s.sold_at desc limit 1;
    if v_sale is null then
      v_out := v_out || E'\nP3 NO SE PUDO ENSAYAR: ninguna venta de 3 días consume Carne de Birria';
    else
      if v_status = 'open' then
        perform public.close_sale(v_sale);
      else
        perform public.generate_sale_consumption(v_sale);
      end if;
      select count(*), sum(public.compute_sale_line_cost(sl.id)) into v_n, v_c1
        from public.sale_line sl where sl.sale_id = v_sale and coalesce(sl.line_type, 'product') = 'product';
      select count(*) into v_m from public.stock_movement sm
       where sm.source_type = 'sale' and sm.source_id = v_sale and sm.recipe_item_id = v_birria;
      v_out := v_out || format(E'\nP3 venta %s (%s → %s): %s líneas, coste %s €, movimientos de birria %s',
                 left(v_sale::text, 8), v_status,
                 (select status from public.sale where id = v_sale), v_n, round(v_c1, 4), v_m);
    end if;
  exception when others then
    v_out := v_out || format(E'\nP3 FALLÓ: %s (%s)', sqlerrm, sqlstate);
  end;

  -- ── P4 RECUENTO ──
  begin
    select ic.id, ic.status into v_cnt, v_status
      from public.inventory_count ic
     where ic.account_id = c_foodint and ic.status in ('contando', 'en_revision')
       and exists (select 1 from public.inventory_count_line l
                     join public.recipe_item ri on ri.id = l.recipe_item_id
                    where l.inventory_count_id = ic.id and ri.cost_strategy = 'average_weighted')
     order by (ic.status = 'en_revision') desc, ic.created_at desc limit 1;
    if v_cnt is null then
      v_out := v_out || E'\nP4 NO SE PUDO ENSAYAR: ningún recuento abierto con artículos a media';
    else
      if v_status = 'contando' then
        perform public.close_inventory_count(v_cnt);
      end if;
      select * into v_r from public.apply_inventory_count(v_cnt, c_julio, 'Julio', false);
      v_out := v_out || format(E'\nP4 recuento %s (%s): ajustes %s, artículos recalculados %s',
                 left(v_cnt::text, 8), v_status, v_r.adjustments, v_r.items_recomputed);
    end if;
  exception when others then
    v_out := v_out || format(E'\nP4 FALLÓ: %s (%s)', sqlerrm, sqlstate);
  end;

  raise exception using message = 'ENSAYO (todo revertido)' || v_out;
end
$ensayo$;
