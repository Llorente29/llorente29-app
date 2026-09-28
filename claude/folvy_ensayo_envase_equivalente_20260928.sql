-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAYO POR CAMINOS (regla 10) de
--   supabase/migrations/20260929T0100_envase_equivalente_y_envase_del_menu.sql
--
-- CÓMO SE USA: se pega DENTRO de la migración, justo antes de su `rollback;`.
-- Todo lo de aquí se deshace con ella. Fuera de banda (00:30–12:15).
--
-- Los cuatro caminos, sobre filas REALES elegidas por consulta (regla 31), no
-- inventadas: cerrar una venta, recibir un albarán, apuntar una merma y aprobar
-- un recuento. Cada camino atrapa su propio error y lo APUNTA: un camino que
-- no se puede ensayar es un hallazgo, y se dice (regla 10).
-- ═══════════════════════════════════════════════════════════════════════════

create temp table _ensayo (paso text, que text, dato text) on commit drop;

do $ensayo$
declare
  v_acc   uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_cara  uuid;  v_alca uuid;
  v_sale  uuid;  v_line uuid;
  v_gr    uuid;  v_ic   uuid;
  v_n     int;
begin
  select id into v_cara from locations where account_id = v_acc and name = 'Foodint Carabanchel';
  select id into v_alca from locations where account_id = v_acc and name = 'Foodint Alcalá';

  -- ── E1a · VENTA con salsero de 120 en Carabanchel, SIN nada congelado ──
  -- La última venta cerrada de Carabanchel cuya línea explota al grupo de 120.
  -- Se borra su «esperado» DENTRO del ensayo para que elija por stock, no por
  -- pegajosidad: con el stock del 28/09 tiene que bajar la pieza única
  -- (545df9a1), no vaso + tapa (allí no hay tapas de 120).
  begin
    select sl.sale_id, sl.id into v_sale, v_line
      from sale_line sl join sale s on s.id = sl.sale_id
      join menu_item mi on mi.id = sl.menu_item_id
     where s.account_id = v_acc and s.location_id = v_cara and s.status = 'closed'
       and s.sold_at > now() - interval '7 days'
       and exists (select 1 from recipe_line rl
                    where rl.parent_item_id = mi.recipe_item_id
                      and rl.child_item_id = '5b6f84f2-bccd-40d4-b09a-b84d193a9db6')
     order by s.sold_at desc limit 1;
    if v_sale is null then
      insert into _ensayo values ('E1a', 'NO ENSAYABLE', 'ninguna venta de Carabanchel en 7 días con el grupo de 120 a primer nivel');
    else
      delete from sale_line_consumo_esperado where sale_id = v_sale;
      perform generate_sale_consumption(v_sale);
      insert into _ensayo
      select 'E1a', r.name, round(-sm.qty_base, 3)::text
        from stock_movement sm join recipe_item r on r.id = sm.recipe_item_id
       where sm.account_id = v_acc and sm.source_type = 'sale' and sm.source_id = v_sale
         and sm.recipe_item_id in ('545df9a1-1b51-43af-a2ed-59cc88b5696c', '6dfc0238-71b0-4102-be96-17c444820088',
                                   'bb458e8a-922a-41bf-869b-b5f145c88687');
      insert into _ensayo values ('E1a', 'venta', v_sale::text);
    end if;
  exception when others then
    insert into _ensayo values ('E1a', 'FALLO ' || sqlstate, sqlerrm);
  end;

  -- ── E1b · la MISMA venta regenerada otra vez: pegajosa, no se mueve ──
  begin
    if v_sale is not null then
      select count(*) into v_n from stock_movement where source_id = v_sale and source_type = 'sale';
      perform generate_sale_consumption(v_sale);
      insert into _ensayo values ('E1b', 'movimientos antes / después de regenerar',
        v_n::text || ' / ' || (select count(*) from stock_movement where source_id = v_sale and source_type = 'sale')::text);
    end if;
  exception when others then
    insert into _ensayo values ('E1b', 'FALLO ' || sqlstate, sqlerrm);
  end;

  -- ── E1c · VENTA de menú de Chivuos con consumo propio ──
  -- Solo DENTRO del ensayo se le pone la caja al menú más vendido; en la
  -- migración no va (espera a Julio, P2 del parte).
  begin
    update menu_item set combo_own_recipe_item_id = 'faeac2ea-2b0f-4c54-9dc5-99881876f522'
     where id = '155f8114-721c-4224-a5a8-b4ca4c571cbe';
    select sl.sale_id, sl.id into v_sale, v_line
      from sale_line sl join sale s on s.id = sl.sale_id
     where s.account_id = v_acc and sl.menu_item_id = '155f8114-721c-4224-a5a8-b4ca4c571cbe'
       and s.status = 'closed'
       and exists (select 1 from sale_line c where c.parent_sale_line_id = sl.id and c.line_type = 'combo_item')
     order by s.sold_at desc limit 1;
    if v_sale is null then
      insert into _ensayo values ('E1c', 'NO ENSAYABLE', 'ninguna venta cerrada del menú con combo_item');
    else
      perform generate_sale_consumption(v_sale);
      insert into _ensayo
      select 'E1c', r.name, round(-sm.qty_base, 3)::text
        from stock_movement sm join recipe_item r on r.id = sm.recipe_item_id
       where sm.source_type = 'sale' and sm.source_id = v_sale and r.type = 'packaging';
      insert into _ensayo values ('E1c', 'coste de la línea con caja', compute_sale_line_cost(v_line)::text);
    end if;
  exception when others then
    insert into _ensayo values ('E1c', 'FALLO ' || sqlstate, sqlerrm);
  end;

  -- ── E2 · ALBARÁN: confirmar un borrador real ──
  -- No lee grupos ni combos; se ensaya porque la regla lo pide y porque
  -- recalcula stock de artículos que ahora eligen los grupos.
  begin
    select id into v_gr from goods_receipt where account_id = v_acc and status = 'borrador'
     order by created_at desc limit 1;
    if v_gr is null then
      insert into _ensayo values ('E2', 'NO ENSAYABLE', 'no hay albarán en borrador');
    else
      perform confirm_goods_receipt(v_gr);
      insert into _ensayo values ('E2', 'albarán confirmado', v_gr::text ||
        ' · estado ' || (select status from goods_receipt where id = v_gr));
    end if;
  exception when others then
    insert into _ensayo values ('E2', 'FALLO ' || sqlstate, sqlerrm);
  end;

  -- ── E3 · MERMA: 1 caja de menú de Chivuos en Alcalá ──
  -- `stock_waste` no tiene NI UNA fila de Foodint: el motivo no sale de datos
  -- reales. Se usa 'merma', que es el literal que aparece en register_waste.
  begin
    perform register_waste(v_acc, v_alca, 'faeac2ea-2b0f-4c54-9dc5-99881876f522', 'merma',
                           1, 'ud', 1, 1, null, null, null, 'ENSAYO — se revierte', null, 'ensayo');
    insert into _ensayo values ('E3', 'caja Chivuos en Alcalá tras merma',
      (select round(qty_on_hand, 3)::text from recipe_item_location_stock
        where recipe_item_id = 'faeac2ea-2b0f-4c54-9dc5-99881876f522' and location_id = v_alca));
  exception when others then
    insert into _ensayo values ('E3', 'FALLO ' || sqlstate, sqlerrm);
  end;

  -- ── E4 · RECUENTO: aprobar uno abierto real ──
  begin
    select id into v_ic from inventory_count where account_id = v_acc and status = 'en_revision'
     order by created_at desc limit 1;
    if v_ic is null then
      insert into _ensayo values ('E4', 'NO ENSAYABLE', 'no hay recuento en_revision');
    else
      perform apply_inventory_count(v_ic, null, 'ensayo', false);
      insert into _ensayo values ('E4', 'recuento aprobado', v_ic::text ||
        ' · estado ' || (select status from inventory_count where id = v_ic));
      -- Y el requisito 5: ningún grupo aparece como línea contable.
      insert into _ensayo values ('E4', 'líneas de recuento que son grupo (esperado 0)',
        (select count(*)::text from inventory_count_line icl
          where icl.recipe_item_id in (select group_item_id from recipe_item_equivalente)));
    end if;
  exception when others then
    insert into _ensayo values ('E4', 'FALLO ' || sqlstate, sqlerrm);
  end;
end $ensayo$;

select * from _ensayo order by paso;
-- LO QUE TIENE QUE SALIR:
--   E1a · «Salsero Pp 120 Cc con Tapa» con la cantidad de la receta, y NI vaso
--         NI tapa de 120.
--   E1b · el mismo número de movimientos antes y después.
--   E1c · «Caja Hamburguesas Menú Chivuo´s» 1, además de las cajas de sus
--         componentes; y un coste de línea no nulo.
--   E2, E3, E4 · sin FALLO. Un NO ENSAYABLE se pega tal cual en el parte y
--         NO se hace commit sin decidir qué se hace con él.
