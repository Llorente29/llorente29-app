-- VARIANTE PRODUCCIÓN del ensayo de S2 (Folvy Interno, local de laboratorio).
-- ⚠️ Fuera de banda. Cómo, esta noche, en UNA ejecución del editor SQL:
--   begin;
--   <la parte B entera>  (20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql)
--   <S2 entera>          (20261009T0050_tpv_sala_s2_mover_y_juntar.sql)
--   <este fichero>
-- Termina con un error que lleva los resultados: el error deshace TODO, también
-- B y S2. Si los 9 salen true, se aplican B y S2 de verdad, sin el ensayo.
-- El de S1 (20261009_tpv_sala_s1_ensayo.sql) se pasa antes, por separado.
--
-- ENSAYO · TPV Sala S2 (mover y juntar) — se revierte SIEMPRE: termina con un
-- error que lleva los resultados dentro, y ese error deshace todo lo escrito.
--
-- Requiere S1 (A y B) y S2 aplicadas en la base donde se ejecute. Las tres
-- constantes de abajo son las de staging-conta; en producción, las de Folvy
-- Interno (ver el ensayo de S1).
--
-- Caminos (regla 10: se EJECUTAN, no se miran):
--   M1  mesa E4 (4) con 2 cañas enviadas → se cambia a E5 libre: misma cuenta,
--       mismas líneas, la E4 queda libre, aviso «CAMBIO DE MESA» en cocina
--   M2  E6 (2) con 2 secretos enviados; la E5 se junta con la E6: una cuenta,
--       6 comensales, 2 envíos (el de la M5 renumerado detrás y con su mesa de
--       origen), líneas con sus mismos id, la E5 cancelada «Juntada con…» y
--       apuntando a la E6, el consumo entero en la E6 y nada en la E5
--   M3  una línea de la E6 a la E7 libre (2 comensales): abre la E7, la línea
--       llega con su envío de origen y su hora, importes recalculados en las dos
--   M4  esa línea vuelve de la E7 a la E6 (ocupada); la E7 queda sin nada
--   M5  no deja mover una cuenta cobrada ni juntar con una mesa cobrada
--   M6  queda escrito quién movió qué: 4 filas en sale_table_move
--
-- M3 y M4 miden también el consumo de cada cuenta: así cazó el ensayo en staging
-- (08/10) que el destino se recalculaba antes de que el origen soltara la línea
-- (clave única stock_movement_sale_line_dedup, 23505). El Postgres local NO lo
-- reproduce: le falta el disparador de consumo de `sale`.

create temp table if not exists ensayo_s2 (paso text, ok boolean, detalle text);

do $blk$
declare
  c_acc  constant uuid := '00000000-0000-0000-0000-000000000001';   -- producción: Folvy Interno
  c_loc  constant uuid := '8a78366c-18cb-4ae2-9cf1-38e5d9a927c0';   -- producción: Foodint Alcalá (laboratorio)
  c_user constant uuid := 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a';   -- producción: Julio
  v_brand uuid; v_items uuid[]; v_zone uuid; i int; v_r jsonb;
  t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid;
  s4 uuid; s6 uuid; s7 uuid; s8 uuid; v_l4 uuid[]; v_l6 uuid[]; v_line uuid; v_mov int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c_user::text, true);

  insert into printer (account_id, location_id, name, transport, doc_types, config, is_active)
  values (c_acc, c_loc, 'ENSAYO cocina', 'escpos_network', array['kitchen','bag'], '{"ip":"10.0.0.250"}', true);

  select bla.brand_id into v_brand from brand_location_availability bla
  where bla.account_id = c_acc and bla.location_id = c_loc and bla.is_active limit 1;
  select array_agg(id) into v_items from (
    select mi.id from menu_item mi
    where mi.account_id = c_acc and mi.brand_id = v_brand and mi.archived_at is null and mi.is_active is not false
      and coalesce(mi.product_type, 'item') <> 'combo'
      and not exists (select 1 from modifier_group_assignment a where a.menu_item_id = mi.id)
    order by mi.name limit 3) x;

  insert into dining_zone (account_id, location_id, name, kind, sort_order) values (c_acc, c_loc, 'ENSAYO S2', 'sala', 9) returning id into v_zone;
  for i in 4..8 loop
    insert into dining_table (account_id, location_id, zone_id, name, seats, sort_order) values (c_acc, c_loc, v_zone, 'M' || i, 4, i);
  end loop;
  select id into t4 from dining_table where location_id = c_loc and name = 'M4' and is_active;
  select id into t5 from dining_table where location_id = c_loc and name = 'M5' and is_active;
  select id into t6 from dining_table where location_id = c_loc and name = 'M6' and is_active;
  select id into t7 from dining_table where location_id = c_loc and name = 'M7' and is_active;
  select id into t8 from dining_table where location_id = c_loc and name = 'M8' and is_active;

  -- M1
  s4 := (public.pos_table_open(t4, 4, v_brand, null)->>'saleId')::uuid;
  perform public.pos_table_fire(s4, jsonb_build_array(jsonb_build_object('menuItemId', v_items[1], 'quantity', 2, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)), null);
  select array_agg(id order by id) into v_l4 from sale_line where sale_id = s4;
  v_r := public.pos_table_move(s4, t5, null);
  insert into ensayo_s2 select 'M1 cambiar a mesa libre',
    v_r->>'kind' = 'move' and (select table_id = t5 from sale where id = s4)
    and (select array_agg(id order by id) from sale_line where sale_id = s4) = v_l4
    and not exists (select 1 from sale where table_id = t4 and table_cleared_at is null and status <> 'cancelled')
    and exists (select 1 from print_job where sale_id = s4 and payload->>'title' = 'CAMBIO DE MESA'),
    (v_r->>'kind') || ' → ' || (v_r->>'tableName') || ' · avisos ' || (v_r->>'printJobs');

  -- M2
  s6 := (public.pos_table_open(t6, 2, v_brand, null)->>'saleId')::uuid;
  perform public.pos_table_fire(s6, jsonb_build_array(jsonb_build_object('menuItemId', v_items[2], 'quantity', 2, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)), null);
  v_r := public.pos_table_move(s4, t6, null);
  insert into ensayo_s2 select 'M2 juntar con mesa ocupada',
    v_r->>'kind' = 'merge' and (v_r->>'saleId')::uuid = s6
    and (select covers = 6 from sale where id = s6)
    and (select count(*) = 2 from sale_fire where sale_id = s6)
    and (select origin_table_name = 'M5' and fire_number = 2 from sale_fire where sale_id = s6 and fire_number = 2)
    and (select array_agg(id order by id) from sale_line where id = any (v_l4) and sale_id = s6) = v_l4
    and (select status = 'cancelled' and merged_into_sale_id = s6 and table_cleared_at is not null and total = 0 from sale where id = s4),
    (select 'covers ' || covers || ' · total ' || total from sale where id = s6)
      || ' · E4/5 ' || (select status || ' / ' || cancel_reason from sale where id = s4);
  insert into ensayo_s2 select 'M2 consumo entero en la que recibe',
    (select count(*) from stock_movement where source_type = 'sale' and source_id = s4 and movement_type = 'consumo') = 0
    and (select count(*) from stock_movement where source_type = 'sale' and source_id = s6 and movement_type = 'consumo' and sale_line_id is not null) = 2,
    (select count(*) from stock_movement where source_type = 'sale' and source_id = s6 and movement_type = 'consumo') || ' movimientos en la que recibe · '
      || (select count(*) from stock_movement where source_type = 'sale' and source_id = s4 and movement_type = 'consumo') || ' en la juntada';
  insert into ensayo_s2 select 'M2 detalle: el envío 2 dice de qué mesa viene',
    (select f->>'originTableName' = 'M5' from jsonb_array_elements(public.pos_table_detail(s6)->'fires') f where (f->>'number')::int = 2), '';

  -- M3
  select id into v_line from sale_line where sale_id = s6 and parent_sale_line_id is null and menu_item_id = v_items[1];
  v_r := public.pos_table_move_lines(array[v_line], t7, 2, null);
  s7 := (v_r->>'saleId')::uuid;
  insert into ensayo_s2 select 'M3 línea a mesa libre',
    (select sale_id = s7 from sale_line where id = v_line)
    and (select covers = 2 and service_type = 'dine_in' from sale where id = s7)
    and (select f.origin_table_name = 'M5' and f.origin_fire_id is not null
         from sale_line sl join sale_fire f on f.id = sl.fire_id where sl.id = v_line)
    and (select total from sale where id = s7) > 0
    and (select total from sale where id = s6) = (select coalesce(sum(line_total), 0) from sale_line where sale_id = s6 and parent_sale_line_id is null)
    and (select count(*) from stock_movement where source_type = 'sale' and source_id = s7 and movement_type = 'consumo') = 1
    and (select count(*) from stock_movement where source_type = 'sale' and source_id = s6 and movement_type = 'consumo') = 1,
    (select 'E7 ' || total from sale where id = s7) || ' · E6 ' || (select total from sale where id = s6) || ' · aviso ' || (v_r->>'printJobs');

  -- M4
  v_r := public.pos_table_move_lines(array[v_line], t6, null, null);
  insert into ensayo_s2 select 'M4 línea de vuelta a mesa ocupada',
    (select sale_id = s6 from sale_line where id = v_line)
    and (select total = 0 from sale where id = s7)
    and not exists (select 1 from sale_line where sale_id = s7)
    and (select count(*) from stock_movement where source_type = 'sale' and source_id = s7 and movement_type = 'consumo') = 0
    and (select count(*) from stock_movement where source_type = 'sale' and source_id = s6 and movement_type = 'consumo') = 2,
    (select 'E6 ' || total from sale where id = s6) || ' · E7 ' || (select total from sale where id = s7);

  -- M5
  s8 := (public.pos_table_open(t8, 2, v_brand, null)->>'saleId')::uuid;
  perform public.pos_table_fire(s8, jsonb_build_array(jsonb_build_object('menuItemId', v_items[3], 'quantity', 1, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)), null);
  perform public.pos_table_charge(s8, 'cash');
  begin
    perform public.pos_table_move(s6, t8, null);
    insert into ensayo_s2 values ('M5 no junta con una cobrada', false, 'la juntó');
  exception when others then
    insert into ensayo_s2 values ('M5 no junta con una cobrada', sqlerrm like '%cobrada%', sqlerrm);
  end;
  begin
    perform public.pos_table_move(s8, t4, null);
    insert into ensayo_s2 values ('M5 no mueve una cobrada', false, 'la movió');
  exception when others then
    insert into ensayo_s2 values ('M5 no mueve una cobrada', sqlerrm like '%cobrada%', sqlerrm);
  end;

  -- M6
  select count(*) into v_mov from sale_table_move where from_sale_id in (s4, s6, s7) or to_sale_id in (s4, s6, s7);
  insert into ensayo_s2 values ('M6 queda escrito quién movió qué', v_mov = 4, v_mov || ' movimientos');

  raise exception 'RESULTADO_ENSAYO_S2 %', (select jsonb_agg(jsonb_build_array(ok, paso, detalle)) from ensayo_s2);
end $blk$;
