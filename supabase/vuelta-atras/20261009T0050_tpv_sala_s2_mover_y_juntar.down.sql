-- VUELTA ATRÁS de 20261009T0050_tpv_sala_s2_mover_y_juntar.sql
--
-- ⚠️ Fuera de banda, como la ida. Quita las dos funciones de mover, la tabla de
--    movimientos y las columnas nuevas. Las cuentas ya juntadas se quedan como
--    están (canceladas, con su motivo); solo pierden el puntero a la que las
--    recibió. Los envíos que llegaron de otra mesa pierden la mesa de origen.
--    pos_table_detail vuelve a la versión de S1.

do $$
declare v_h time := (now() at time zone 'Europe/Madrid')::time; n_m int; n_j int;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'vuelta atrás tpv_sala_s2: son las % — dentro de la banda. Esperar.', v_h;
  end if;
  select count(*) into n_m from public.sale_table_move;
  select count(*) into n_j from public.sale where merged_into_sale_id is not null;
  raise notice 'se pierden % movimientos apuntados y el puntero de % cuentas juntadas', n_m, n_j;
end $$;

drop function if exists public.pos_table_move(uuid, uuid, text);
drop function if exists public.pos_table_move_lines(uuid[], uuid, integer, text);
drop function if exists public._pos_print_table_notice(sale, text, text, text[]);
drop function if exists public._pos_dest_table(uuid, sale);

drop table if exists public.sale_table_move;
alter table public.sale_fire drop column if exists origin_fire_id, drop column if exists origin_table_name;
alter table public.sale drop column if exists merged_into_sale_id;

-- pos_table_detail sin 'originTableName' (la de S1).
create or replace function public.pos_table_detail(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_s sale; v jsonb;
begin
  v_s := public._pos_table_sale(p_sale_id);
  select jsonb_build_object(
    'saleId', v_s.id, 'posShortCode', v_s.pos_short_code, 'brandId', v_s.brand_id,
    'tableId', dt.id, 'tableName', dt.name, 'seats', dt.seats,
    'zoneId', z.id, 'zoneName', z.name, 'zoneKind', z.kind,
    'covers', v_s.covers, 'openedAt', coalesce(v_s.opened_at, v_s.created_at),
    'servedByName', v_s.served_by_name, 'total', v_s.total,
    'state', public._pos_table_state(v_s),
    'billRequestedAt', v_s.bill_requested_at, 'paidAt', v_s.paid_at,
    'paymentMethod', v_s.payment_method,
    'fires', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'number', f.fire_number, 'firedAt', f.fired_at, 'firedByName', f.fired_by_name
      ) order by f.fire_number) from sale_fire f where f.sale_id = v_s.id), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sl.id, 'name', sl.product_name, 'menuItemId', sl.menu_item_id,
        'quantity', sl.quantity, 'unitPrice', sl.unit_price, 'lineTotal', sl.line_total,
        'kitchenNote', sl.kitchen_note, 'fireId', sl.fire_id, 'voidedAt', sl.voided_at,
        'voidReason', (select v.reason_label from sale_line_void v where v.sale_line_id = sl.id),
        'createdAt', sl.created_at,
        'summary', coalesce((select jsonb_agg(h.product_name order by h.created_at)
                             from sale_line h where h.parent_sale_line_id = sl.id), '[]'::jsonb)
      ) order by sl.created_at, sl.id)
      from sale_line sl where sl.sale_id = v_s.id and sl.parent_sale_line_id is null), '[]'::jsonb)
  ) into v
  from dining_table dt join dining_zone z on z.id = dt.zone_id
  where dt.id = v_s.table_id;
  return v;
end $$;

notify pgrst, 'reload schema';
