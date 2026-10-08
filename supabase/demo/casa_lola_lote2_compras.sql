-- Cuenta de demostración «Casa Lola» · LOTE 2: proveedores, formatos de compra, zonas de almacén y albaranes.
-- Los albaranes se dimensionan sobre el consumo REAL que dejaron las ventas (lote 4): cada entrega pide lo que falta para llegar a la siguiente (+4 %), descontando lo que ya hay.
-- Va DESPUÉS del lote 4. Cada albarán entra por _post_goods_receipt_lines, la misma función que usa la recepción.
do $lote$
declare
  v_acc constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_loc uuid;
  v_ini constant date := date '2026-08-13';
  v_fin date;   -- último día con ventas
  -- [nombre, razón social, días de reparto (1 = lunes), familias que sirve, zona de almacén por defecto]
  prov jsonb := '[
   ["Frutas y Verduras Hermanos Vega","Hermanos Vega Frutas y Verduras, S.L.",[1,3,5],["Frutas y hortalizas"]],
   ["Carnes Sierra Norte","Cárnicas Sierra Norte, S.L.",[2,5],["Carnes y aves","Charcutería y quesos"]],
   ["Pescados del Cantábrico","Pescados del Cantábrico Madrid, S.L.",[2,4,6],["Pescados y mariscos"]],
   ["Distribuciones Castilla","Distribuciones Alimentarias Castilla, S.A.",[1],["Aceites, salsas y condimentos","Conservas y encurtidos","Cereales, pasta y legumbres","Especias","Lácteos y huevos","Congelados","Café, infusiones y solubles"]],
   ["Bodegas y Bebidas Madrid","Bodegas y Bebidas Madrid, S.L.",[4],["Vinos y bebidas alcohólicas","Bebidas sin alcohol"]],
   ["Panadería La Espiga","Panadería La Espiga, S.L.",[1,3,5,6],["Panadería y pastelería"]]
  ]';
  formatos jsonb := '{"Cerveza":["Barril 30 L",30000],"Vino tinto":["Caja 6 botellas 75 cl",4500],"Refresco de cola":["Caja 24 latas 33 cl",7920],"Agua":["Caja 24 botellas 50 cl",12000],
    "Aceite de oliva virgen extra":["Garrafa 5 L",5000],"Aceite de girasol":["Garrafa 10 L",10000],"Huevo":["Docena",12],"Pan de hamburguesa":["Bolsa de 12",12],
    "Rioja crianza (botella 75 cl)":["Caja de 6 botellas",6],"Ribera del Duero (botella 75 cl)":["Caja de 6 botellas",6],"Leche entera":["Caja 6 L",6000],"Vermut rojo":["Botella 1 L",1000],"Patata":["Saco 25 kg",25000]}';
  -- zona de almacén por familia de ingrediente
  zonas jsonb := '{"Frutas y hortalizas":"Cámara fría","Carnes y aves":"Cámara fría","Pescados y mariscos":"Cámara fría","Lácteos y huevos":"Cámara fría","Charcutería y quesos":"Cámara fría",
    "Congelados":"Congelador","Vinos y bebidas alcohólicas":"Bodega y bebidas","Bebidas sin alcohol":"Bodega y bebidas"}';
  v_uid uuid;
  p jsonb; r record; l record; v_sup uuid; v_gr uuid; v_n int; v_pos int; v_d date; v_nd date; v_dias int[]; v_resumen text;
begin
  select id into strict v_loc from locations where account_id = v_acc;
  select max((sold_at at time zone 'Europe/Madrid')::date) into strict v_fin from sale where account_id = v_acc;
  -- Las funciones de compras y costes exigen ser de la cuenta. Se actúa como el administrador de ESTA cuenta (demo@idasal.com),
  -- sólo dentro de esta transacción: es quien haría estas altas desde la pantalla.
  select user_id into strict v_uid from user_profiles where account_id = v_acc and role = 'admin';
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if exists (select 1 from supplier where account_id = v_acc) then raise exception 'Casa Lola ya tiene proveedores: este lote no se repite'; end if;

  -- 1. Zonas de almacén y dónde vive cada artículo.
  insert into storage_area (account_id, location_id, name, position, active, created_by_name)
  select v_acc, v_loc, z.name, z.pos, true, 'Demo Folvy' from (values ('Cámara fría', 2), ('Congelador', 3), ('Bodega y bebidas', 4)) z(name, pos);
  insert into recipe_item_storage_area (account_id, recipe_item_id, storage_area_id, position)
  select v_acc, ri.id, sa.id, row_number() over (partition by sa.id order by ri.name)
    from recipe_item ri join recipe_family f on f.id = ri.family_id
    join storage_area sa on sa.account_id = v_acc and sa.name = coalesce(zonas ->> f.name, 'Almacén principal')
   where ri.account_id = v_acc and ri.type = 'raw';

  -- 2. Formato de compra de cada ingrediente.
  insert into recipe_item_purchase_format (account_id, item_id, name, qty_in_base, is_piece, is_weighted, source, is_active, use_in_count, created_by_name)
  select v_acc, ri.id,
         coalesce(formatos -> ri.name ->> 0, case u.abbreviation when 'g' then 'Kilo' when 'ml' then 'Litro' else 'Unidad' end),
         coalesce((formatos -> ri.name ->> 1)::numeric, case u.abbreviation when 'ud' then 1 else 1000 end),
         u.abbreviation = 'ud', u.abbreviation = 'g' and not (formatos ? ri.name), 'manual', true, true, 'Demo Folvy'
    from recipe_item ri join kitchen_unit u on u.id = ri.base_unit_id
   where ri.account_id = v_acc and ri.type = 'raw';

  -- 3. Proveedores, lo que sirve cada uno y sus albaranes.
  for p in select * from jsonb_array_elements(prov) loop
    insert into supplier (account_id, name, legal_name, is_active, payment_method, payment_terms_days, invoicing_frequency, default_location_id, created_by_name)
    values (v_acc, p->>0, p->>1, true, 'transfer', 30, 'monthly', v_loc, 'Demo Folvy') returning id into v_sup;

    insert into article_supplier (account_id, recipe_item_id, supplier_id, purchase_format_id, supplier_item_name, last_price, is_preferred, is_active, source)
    select v_acc, ri.id, v_sup, pf.id, upper(ri.name), ri.fixed_cost, true, true, 'manual'
      from recipe_item ri join recipe_family f on f.id = ri.family_id
      join recipe_item_purchase_format pf on pf.item_id = ri.id and pf.account_id = v_acc
     where ri.account_id = v_acc and ri.type = 'raw' and f.name in (select jsonb_array_elements_text(p->3));

    select array_agg(x::int) into v_dias from jsonb_array_elements_text(p->2) x;
    v_n := 0;
    for r in
      select d::date dia, coalesce(lead(d::date) over (order by d), d::date + 7) sig
        from generate_series(v_ini, v_fin, interval '1 day') d
       where d::date = v_ini or extract(isodow from d)::int = any(v_dias)
       order by d
    loop
      v_n := v_n + 1; v_gr := null; v_pos := 0;
      for l in
        select ri.id item, ri.name, pf.id fmt, pf.qty_in_base qib, ri.fixed_cost,
               ceil(greatest(( coalesce((select sum(-sm.qty_base) from stock_movement sm
                                 where sm.account_id = v_acc and sm.recipe_item_id = ri.id and sm.movement_type = 'consumo'
                                   and sm.occurred_at >= (r.dia::timestamp at time zone 'Europe/Madrid')
                                   and sm.occurred_at <  (r.sig::timestamp at time zone 'Europe/Madrid')), 0)
                      -- los días que la entrega tiene que cubrir y todavía no han pasado: al ritmo de las dos últimas semanas
                    + greatest(r.sig - (v_fin + 1), 0)
                      * coalesce((select sum(-sm.qty_base) / 14.0 from stock_movement sm
                                   where sm.account_id = v_acc and sm.recipe_item_id = ri.id and sm.movement_type = 'consumo'
                                     and sm.occurred_at >= ((v_fin - 13)::timestamp at time zone 'Europe/Madrid')), 0)
                    ) * 1.04
                    -- menos lo que ya hay en casa esa mañana: se pide lo que falta, no lo que se gasta
                    - coalesce((select sum(sm.qty_base) from stock_movement sm
                                 where sm.account_id = v_acc and sm.recipe_item_id = ri.id
                                   and sm.occurred_at < (r.dia::timestamp at time zone 'Europe/Madrid')), 0)
                    , 0) / pf.qty_in_base) as q
          from article_supplier a join recipe_item ri on ri.id = a.recipe_item_id
          join recipe_item_purchase_format pf on pf.id = a.purchase_format_id
         where a.account_id = v_acc and a.supplier_id = v_sup
         order by ri.name
      loop
        continue when l.q is null or l.q <= 0;
        if v_gr is null then
          insert into goods_receipt (account_id, location_id, supplier_id, supplier_doc_number, receipt_date, received_at, status, source, needs_review, created_by_name, delivered_by)
          values (v_acc, v_loc, v_sup, 'A' || to_char(r.dia, 'YYMMDD') || '-' || lpad(v_n::text, 3, '0'), r.dia,
                  ((r.dia + time '08:10') at time zone 'Europe/Madrid') + make_interval(mins => abs(hashtext(p->>0)) % 50),
                  'borrador', 'manual', false, 'Carmen Ortega', split_part(p->>0, ' ', 1))
          returning id into v_gr;
        end if;
        v_pos := v_pos + 1;
        insert into goods_receipt_line (account_id, goods_receipt_id, recipe_item_id, product_name, raw_text, qty_received, purchase_format_id, qty_in_base, unit_cost,
                                        map_source, map_needs_review, position, doc_qty, doc_amount)
        select v_acc, v_gr, l.item, upper(l.name), upper(l.name), l.q, l.fmt, l.q * l.qib, pr.precio, 'code', false, v_pos, l.q, round(l.q * pr.precio, 2)
          from (select round(l.fixed_cost * l.qib * (1 + ((abs(hashtext(l.name || r.dia::text)) % 9) - 4) / 100.0), 2) precio) pr;
      end loop;
      if v_gr is not null then
        perform public._post_goods_receipt_lines(v_gr, false);
        update goods_receipt set status = 'confirmado', needs_review = false where id = v_gr;
      end if;
    end loop;
  end loop;

  select format('proveedores=%s formatos=%s articulo_proveedor=%s zonas=%s albaranes=%s (confirmados=%s) lineas=%s compras_eur=%s recepciones=%s con_stock=%s en_negativo=%s valor_almacen=%s',
    (select count(*) from supplier where account_id=v_acc),
    (select count(*) from recipe_item_purchase_format where account_id=v_acc),
    (select count(*) from article_supplier where account_id=v_acc),
    (select count(*) from storage_area where account_id=v_acc),
    (select count(*) from goods_receipt where account_id=v_acc),
    (select count(*) from goods_receipt where account_id=v_acc and status='confirmado'),
    (select count(*) from goods_receipt_line where account_id=v_acc),
    (select round(sum(doc_amount)) from goods_receipt_line where account_id=v_acc),
    (select count(*) from stock_movement where account_id=v_acc and movement_type='recepcion'),
    (select count(*) from recipe_item_location_stock where account_id=v_acc and qty_on_hand > 0),
    (select count(*) from recipe_item_location_stock where account_id=v_acc and qty_on_hand < 0),
    (select round(sum(stock_value)) from recipe_item_location_stock where account_id=v_acc))
  into v_resumen;
  --FIN--
end
$lote$;
