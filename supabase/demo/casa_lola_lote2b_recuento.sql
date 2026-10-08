-- Cuenta de demostración «Casa Lola» · LOTE 2b: un recuento completo de anoche, contado y aprobado por el camino real
-- (build_inventory_count → close_inventory_count → apply_inventory_count), actuando como el administrador de la cuenta.
-- Va DESPUÉS de ventas (lote 4) y compras (lote 2): deja en el almacén lo que «se contó», con su merma.
do $lote$
declare
  v_acc constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_loc uuid; v_uid uuid; v_ic uuid; v_cuando timestamptz; v_resumen text; v_pend int; v_carmen uuid; r record;
  -- contados a la baja a propósito, con su motivo
  motivos jsonb := '{"Jamón ibérico":[0.91,"merma","Recortes y tocino de las piezas."],"Cerveza":[0.93,"merma","Purgas y espuma de barril."],
                     "Gamba":[0.94,"caducado","Una caja retirada por fecha."],"Entrecot de ternera":[0.96,"uso_sin_apuntar","Comida de personal sin apuntar."]}';
begin
  select id into strict v_loc from locations where account_id = v_acc;
  select user_id into strict v_uid from user_profiles where account_id = v_acc and role = 'admin';
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if exists (select 1 from inventory_count where account_id = v_acc) then raise exception 'Casa Lola ya tiene un recuento: este lote no se repite'; end if;

  select id into strict v_carmen from employees where account_id = v_acc and name = 'Carmen Ortega';
  v_cuando := now() - interval '35 minutes';   -- el recuento de cierre de anoche

  insert into inventory_count (account_id, location_id, kind, status, blind, notes, started_at, started_by, started_by_name, created_by, created_by_name, is_opening, is_opening_manual)
  values (v_acc, v_loc, 'full', 'abierto', true, 'Recuento completo de cierre.', v_cuando, v_uid, 'Demo Folvy', v_uid, 'Demo Folvy', false, true)
  returning id into v_ic;

  perform public.build_inventory_count(v_ic, null, true);

  -- Cada cifra entra por save_count_line, que es la única puerta de counted_qty (incidente del 10/09).
  for r in
    select l.id, ri.name,
           case when coalesce(l.system_qty, 0) <= 0 then 0
                when u.abbreviation = 'ud' then floor(l.system_qty * f.factor)
                else round(l.system_qty * f.factor, -1) end as contado
      from inventory_count_line l
      join recipe_item ri on ri.id = l.recipe_item_id
      join kitchen_unit u on u.id = ri.base_unit_id
      cross join lateral (select coalesce((motivos -> ri.name ->> 0)::numeric, 0.965 + (abs(hashtext(ri.name)) % 36) / 1000.0) factor) f
     where l.inventory_count_id = v_ic
  loop
    perform public.save_count_line(r.id,
      case when r.contado <= 0 then '[{"method":"cero"}]'::jsonb else jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', r.contado)) end,
      null, v_carmen, 'tablet');
  end loop;

  update inventory_count_line l
     set reason_code = motivos -> ri.name ->> 1, reason_note = motivos -> ri.name ->> 2, reason_by = v_uid, reason_by_name = 'Demo Folvy'
    from recipe_item ri
   where l.inventory_count_id = v_ic and ri.id = l.recipe_item_id and motivos ? ri.name;

  perform public.close_inventory_count(v_ic);
  select count(*) into v_pend from public.count_lines_requiring_reason(v_ic) q join inventory_count_line l on l.id = q.line_id where coalesce(l.reason_code, '') = '';
  if v_pend > 0 then raise exception 'quedan % líneas que piden motivo: revisar los factores', v_pend; end if;
  perform public.apply_inventory_count(v_ic, v_uid, 'Demo Folvy', false);

  select format('recuento=%s estado=%s lineas=%s contadas=%s fuera_de_tolerancia=%s con_motivo=%s ajustes=%s merma_eur=%s valor_almacen=%s negativos=%s cuando=%s',
    (select code from inventory_count where id=v_ic), (select status from inventory_count where id=v_ic),
    (select count(*) from inventory_count_line where inventory_count_id=v_ic),
    (select count(*) from inventory_count_line where inventory_count_id=v_ic and counted_qty is not null),
    (select count(*) from inventory_count_line where inventory_count_id=v_ic and within_tolerance = false),
    (select count(*) from inventory_count_line where inventory_count_id=v_ic and reason_code is not null),
    (select count(*) from stock_movement where source_type='inventory_count' and source_id=v_ic),
    (select round(sum(variance_value),2) from inventory_count_line where inventory_count_id=v_ic),
    (select round(sum(stock_value)) from recipe_item_location_stock where account_id=v_acc),
    (select count(*) from recipe_item_location_stock where account_id=v_acc and qty_on_hand<0),
    to_char(v_cuando at time zone 'Europe/Madrid','DD/MM HH24:MI'))
  into v_resumen;
  --FIN--
end
$lote$;
