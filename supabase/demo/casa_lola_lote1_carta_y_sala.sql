-- Cuenta de demostración «Casa Lola» · LOTE 1: costes, carta, escandallos, alérgenos, extras, menú del día y sala.
-- Solo escribe en la cuenta 623d946a-a0ce-4f34-8c00-9761dfed8331. Se niega a correr dos veces.
do $lote$
declare
  v_acc   constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_brand uuid; v_loc uuid;
  u_g  constant uuid := '8fc3baae-04cc-4b2c-83cc-7fa0181e74e4';
  u_ml constant uuid := '953c626f-146b-484f-b3f5-47c42eeacc0e';
  u_ud constant uuid := '869711c3-eabd-4e95-92f2-555efaaba6b0';
  r jsonb; l jsonb; o jsonb; s jsonb;
  v_ri uuid; v_child uuid; v_unit uuid; v_fam uuid; v_cat uuid; v_mi uuid; v_grp uuid; v_opt uuid; v_slot uuid; v_zone uuid;
  v_pos int; v_n int; v_resumen text;

  costes jsonb := '{"Aceite de girasol":0.0018,"Aceite de oliva virgen extra":0.0085,"Aceitunas":0.006,"Agua":0.0005,"Ajo":0.005,"Albahaca fresca":0.02,"Arroz":0.0018,"Atún":0.022,"Bacon":0.009,"Café en grano":0.016,"Carne picada de ternera":0.0095,"Cebolla":0.0012,"Cerveza":0.0019,"Chorizo":0.009,"Comino":0.012,"Espagueti":0.0016,"Gamba":0.016,"Garbanzos":0.0022,"Guisantes congelados":0.0025,"Harina de trigo":0.0009,"Huevo":0.22,"Jamón serrano":0.018,"Ketchup":0.0025,"Leche entera":0.00095,"Lechuga":0.0022,"Lentejas":0.0024,"Limón":0.002,"Lomo de cerdo":0.0075,"Maíz dulce":0.0035,"Mantequilla":0.009,"Mayonesa":0.0032,"Merluza":0.013,"Mostaza":0.003,"Mozzarella":0.008,"Nata para cocinar":0.0034,"Orégano":0.015,"Pan de hamburguesa":0.35,"Pan rústico":0.003,"Patata":0.0011,"Patatas fritas congeladas":0.0019,"Pechuga de pollo":0.007,"Pimentón":0.011,"Pimienta negra":0.022,"Pimiento":0.0026,"Pollo entero":0.0039,"Queso curado":0.015,"Refresco de cola":0.00136,"Sal":0.0004,"Salmón":0.015,"Salsa de soja":0.004,"Tomate":0.0024,"Tomate triturado":0.0015,"Vinagre de vino":0.0015,"Vino tinto":0.006,"Yogur natural":0.0024,"Zanahoria":0.0011}';

  -- [nombre, unidad, coste por unidad base, familia de ingrediente, alérgenos]
  nuevos jsonb := '[
    ["Jamón ibérico","g",0.06,"Charcutería y quesos",[]],
    ["Entrecot de ternera","g",0.024,"Carnes y aves",[]],
    ["Queso crema","g",0.0065,"Lácteos y huevos",["milk"]],
    ["Azúcar","g",0.0011,"Panadería y pastelería",[]],
    ["Galleta","g",0.004,"Panadería y pastelería",["gluten"]],
    ["Pan rallado","g",0.002,"Panadería y pastelería",["gluten"]],
    ["Fruta de temporada","g",0.0025,"Frutas y hortalizas",[]],
    ["Vermut rojo","ml",0.007,"Vinos y bebidas alcohólicas",["sulphites"]],
    ["Rioja crianza (botella 75 cl)","ud",6.80,"Vinos y bebidas alcohólicas",["sulphites"]],
    ["Ribera del Duero (botella 75 cl)","ud",9.20,"Vinos y bebidas alcohólicas",["sulphites"]]
  ]';

  -- [nombre, emoji, tipo de demanda]
  categorias jsonb := '[["Para picar","🍤","cocina"],["Entrantes","🥗","cocina"],["Principales","🍽️","cocina"],["Postres","🍰","postre"],["Bebidas","🍷","bebida"],["Café","☕","barra"],["Menú del día","📋","cocina"]]';

  platos jsonb := '[
   {"n":"Croquetas de jamón (6)","c":"Para picar","f":"Frito","p":9.50,"d":"Caseras, de jamón serrano. Seis unidades.","l":[["Leche entera",250],["Harina de trigo",30],["Mantequilla",25],["Jamón serrano",40],["Huevo",0.5],["Pan rallado",40],["Aceite de girasol",60]]},
   {"n":"Ensaladilla rusa","c":"Para picar","f":"Entrante frío","p":8.50,"d":"Con ventresca de atún y mayonesa.","l":[["Patata",200],["Zanahoria",40],["Guisantes congelados",30],["Atún",40],["Huevo",1],["Mayonesa",60],["Aceitunas",15]]},
   {"n":"Patatas bravas","c":"Para picar","f":"Ración","p":7.00,"d":"Con salsa brava de la casa y alioli.","l":[["Patata",300],["Aceite de girasol",50],["Tomate triturado",60],["Pimentón",2],["Ajo",3],["Mayonesa",20]]},
   {"n":"Jamón ibérico","c":"Para picar","f":"Ración","p":22.00,"d":"Cortado a cuchillo, con pan.","l":[["Jamón ibérico",80],["Pan rústico",60]]},
   {"n":"Tabla de quesos","c":"Para picar","f":"Ración","p":14.00,"d":"Quesos curados con pan y aceitunas.","l":[["Queso curado",180],["Pan rústico",60],["Aceitunas",20]]},
   {"n":"Gambas al ajillo","c":"Para picar","f":"Marisco","p":13.50,"d":"En cazuela, con ajo y aceite de oliva.","l":[["Gamba",180],["Ajo",10],["Aceite de oliva virgen extra",40],["Pan rústico",40]]},
   {"n":"Pan con tomate","c":"Para picar","f":"Pan","p":3.50,"d":"Pan rústico tostado, tomate y aceite de oliva.","l":[["Pan rústico",120],["Tomate",80],["Aceite de oliva virgen extra",15],["Sal",1]]},
   {"n":"Ensalada de tomate y ventresca","c":"Entrantes","f":"Ensalada","p":11.00,"d":"Tomate de temporada, ventresca y cebolla.","l":[["Tomate",250],["Atún",70],["Cebolla",30],["Aceite de oliva virgen extra",20],["Vinagre de vino",5]]},
   {"n":"Salmorejo","c":"Entrantes","f":"Sopa / Crema","p":7.50,"d":"Con huevo y jamón.","l":[["Tomate",220],["Pan rústico",50],["Aceite de oliva virgen extra",30],["Ajo",2],["Huevo",0.5],["Jamón serrano",15]]},
   {"n":"Huevos rotos con jamón","c":"Entrantes","f":"Entrante caliente","p":12.50,"d":"Patatas, dos huevos y jamón serrano.","l":[["Patata",300],["Huevo",2],["Jamón serrano",50],["Aceite de girasol",50]]},
   {"n":"Lentejas estofadas","c":"Entrantes","f":"Guiso / Estofado","p":9.00,"d":"Con chorizo y verduras.","l":[["Lentejas",90],["Chorizo",40],["Zanahoria",40],["Cebolla",30],["Patata",60],["Pimentón",1],["Aceite de oliva virgen extra",10]]},
   {"n":"Merluza a la plancha","c":"Principales","f":"Pescado","p":18.50,"d":"Lomo de merluza con ajo y limón.","l":[["Merluza",220],["Aceite de oliva virgen extra",15],["Limón",20],["Ajo",3]]},
   {"n":"Salmón con verduras","c":"Principales","f":"Pescado","p":17.50,"d":"A la plancha, con verduras salteadas.","l":[["Salmón",200],["Zanahoria",60],["Pimiento",60],["Cebolla",40],["Aceite de oliva virgen extra",15]]},
   {"n":"Entrecot a la brasa","c":"Principales","f":"Parrilla / Brasa","p":24.00,"d":"300 g de ternera, al punto que pidas.","l":[["Entrecot de ternera",300],["Sal",3],["Aceite de oliva virgen extra",5]]},
   {"n":"Lomo con patatas","c":"Principales","f":"Parrilla / Brasa","p":14.50,"d":"Lomo de cerdo a la plancha con patatas y pimientos.","l":[["Lomo de cerdo",200],["Patatas fritas congeladas",150],["Aceite de girasol",30],["Pimiento",40]]},
   {"n":"Pollo asado","c":"Principales","f":"Parrilla / Brasa","p":13.50,"d":"Medio pollo asado con patatas.","l":[["Pollo entero",500],["Patata",150],["Aceite de oliva virgen extra",10],["Limón",15]]},
   {"n":"Hamburguesa Casa Lola","c":"Principales","f":"Hamburguesa","p":13.00,"d":"180 g de ternera, queso, bacon y patatas.","l":[["Carne picada de ternera",180],["Pan de hamburguesa",1],["Queso curado",25],["Bacon",30],["Lechuga",20],["Tomate",30],["Cebolla",15],["Patatas fritas congeladas",120],["Aceite de girasol",20]]},
   {"n":"Arroz de gambas","c":"Principales","f":"Arroz","p":16.00,"d":"Precio por persona. Mínimo dos.","l":[["Arroz",100],["Gamba",100],["Tomate triturado",40],["Pimiento",30],["Ajo",3],["Aceite de oliva virgen extra",20]]},
   {"n":"Espaguetis boloñesa","c":"Principales","f":"Pasta","p":11.50,"d":"Con ragú de ternera y queso curado.","l":[["Espagueti",110],["Carne picada de ternera",90],["Tomate triturado",120],["Cebolla",30],["Zanahoria",20],["Queso curado",15],["Aceite de oliva virgen extra",10]]},
   {"n":"Tarta de queso","c":"Postres","f":"Tarta","p":6.50,"d":"Al horno, hecha en casa.","l":[["Queso crema",90],["Nata para cocinar",60],["Huevo",0.75],["Azúcar",30],["Galleta",20],["Mantequilla",10]]},
   {"n":"Flan casero","c":"Postres","f":"Postre","p":5.00,"d":"De huevo, con caramelo.","l":[["Leche entera",120],["Huevo",1],["Azúcar",35]]},
   {"n":"Yogur con fruta","c":"Postres","f":"Postre","p":4.50,"d":"Yogur natural con fruta de temporada.","l":[["Yogur natural",150],["Fruta de temporada",80]]},
   {"n":"Fruta de temporada","c":"Postres","f":"Postre","p":4.00,"d":"Preparada.","l":[["Fruta de temporada",220]]},
   {"n":"Caña","c":"Bebidas","f":"Cerveza","p":2.80,"d":"Cerveza de barril, 20 cl.","l":[["Cerveza",200]]},
   {"n":"Doble","c":"Bebidas","f":"Cerveza","p":3.80,"d":"Cerveza de barril, 33 cl.","l":[["Cerveza",330]]},
   {"n":"Refresco","c":"Bebidas","f":"Refresco","p":3.00,"d":"33 cl.","l":[["Refresco de cola",330]]},
   {"n":"Agua","c":"Bebidas","f":"Sin alcohol","p":2.50,"d":"Mineral, 50 cl.","l":[["Agua",500]]},
   {"n":"Copa de vino tinto","c":"Bebidas","f":"Vino (copa)","p":3.50,"d":"Tinto de la casa.","l":[["Vino tinto",150]]},
   {"n":"Botella Rioja crianza","c":"Bebidas","f":"Vino (botella)","p":19.00,"d":"75 cl.","l":[["Rioja crianza (botella 75 cl)",1]]},
   {"n":"Botella Ribera del Duero","c":"Bebidas","f":"Vino (botella)","p":24.00,"d":"75 cl.","l":[["Ribera del Duero (botella 75 cl)",1]]},
   {"n":"Vermut","c":"Bebidas","f":"Vermut / Aperitivo","p":3.50,"d":"Rojo, con aceituna.","l":[["Vermut rojo",90],["Aceitunas",10]]},
   {"n":"Café solo","c":"Café","f":"Café","p":1.60,"d":"","l":[["Café en grano",8]]},
   {"n":"Café con leche","c":"Café","f":"Café","p":1.90,"d":"","l":[["Café en grano",8],["Leche entera",150]]}
  ]';

  -- grupo: nombre, tipo, mín, máx, platos, opciones [nombre, precio, por defecto, ingrediente, cantidad]
  grupos jsonb := '[
   {"n":"Punto de la carne","t":"choice","min":1,"max":1,"en":["Entrecot a la brasa","Hamburguesa Casa Lola"],"o":[["Poco hecho",0,false,null,null],["Al punto",0,true,null,null],["Hecho",0,false,null,null]]},
   {"n":"Guarnición","t":"side","min":1,"max":1,"en":["Entrecot a la brasa","Merluza a la plancha"],"o":[["Patatas fritas",0,true,"Patatas fritas congeladas",150],["Ensalada",0,false,"Lechuga",80],["Verduras a la plancha",0,false,"Pimiento",100]]},
   {"n":"Extras","t":"extras","min":0,"max":3,"en":["Hamburguesa Casa Lola"],"o":[["Extra de queso",1.00,false,"Queso curado",25],["Extra de bacon",1.50,false,"Bacon",30],["Huevo frito",1.20,false,"Huevo",1]]}
  ]';

  -- menú del día: hueco, opciones [plato, suplemento]
  menu jsonb := '[
   {"n":"Primero","o":[["Salmorejo",0],["Lentejas estofadas",0],["Ensaladilla rusa",0]]},
   {"n":"Segundo","o":[["Lomo con patatas",0],["Pollo asado",0],["Espaguetis boloñesa",0],["Merluza a la plancha",3.00]]},
   {"n":"Postre o café","o":[["Flan casero",0],["Fruta de temporada",0],["Yogur con fruta",0],["Café solo",0],["Café con leche",0]]},
   {"n":"Bebida","o":[["Caña",0],["Refresco",0],["Agua",0],["Copa de vino tinto",0]]}
  ]';

  delivery text[] := array['Croquetas de jamón (6)','Ensaladilla rusa','Patatas bravas','Huevos rotos con jamón','Hamburguesa Casa Lola','Lomo con patatas','Pollo asado','Espaguetis boloñesa','Arroz de gambas','Salmón con verduras','Tarta de queso','Flan casero'];

  -- [zona, tipo, mesas [nombre, sitios, ancho]]
  sala jsonb := '[
   {"n":"Sala","k":"sala","t":[["1",2,1],["2",2,1],["3",4,1],["4",4,1],["5",4,1],["6",6,2],["7",4,1],["8",2,1],["9",6,1],["10",4,1],["11",2,1],["12",8,2],["13",2,1]]},
   {"n":"Terraza","k":"terraza","t":[["T1",4,1],["T2",2,1],["T3",4,1],["T4",4,1],["T5",6,2],["T6",4,1],["T7",2,1],["T8",4,1]]},
   {"n":"Barra","k":"barra","t":[["B1",2,1],["B2",2,1],["B3",2,1],["B4",2,1],["B5",2,1],["B6",2,1]]}
  ]';
begin
  select id into strict v_brand from brand where account_id = v_acc;
  select id into strict v_loc   from locations where account_id = v_acc;
  if exists (select 1 from menu_item where account_id = v_acc) or exists (select 1 from dining_zone where account_id = v_acc) then
    raise exception 'Casa Lola ya tiene carta o sala: este lote no se repite';
  end if;

  -- 1. Costes de los ingredientes de la plantilla (regla 3: computed a NULL al fijar el coste).
  update recipe_item ri set cost_strategy = 'fixed', fixed_cost = (costes ->> ri.name)::numeric, computed_cost = null
   where ri.account_id = v_acc and ri.type = 'raw' and costes ? ri.name;
  get diagnostics v_n = row_count;
  if v_n <> 56 then raise exception 'costes: esperaba 56 ingredientes, tocados %', v_n; end if;

  -- 2. Ingredientes que faltaban.
  for r in select * from jsonb_array_elements(nuevos) loop
    select id into strict v_fam from recipe_family where account_id = v_acc and scope = 'ingredient' and parent_family_id is null and name = r->>3;
    insert into recipe_item (account_id, type, name, base_unit_id, cost_strategy, fixed_cost, family_id, is_stockable, is_purchasable, source, created_by_name)
    values (v_acc, 'raw', r->>0, case r->>1 when 'g' then u_g when 'ml' then u_ml else u_ud end, 'fixed', (r->>2)::numeric, v_fam, true, true, 'manual', 'Demo Folvy')
    returning id into v_ri;
    insert into recipe_item_allergen (recipe_item_id, allergen_code, state, source)
    select v_ri, a, 'contains', 'manual' from jsonb_array_elements_text(r->4) a;
  end loop;

  -- 3. Dónde se vende.
  insert into brand_location_availability (account_id, brand_id, location_id, is_active, active_since) values (v_acc, v_brand, v_loc, true, current_date);
  insert into brand_channel (account_id, brand_id, channel_id, is_active) select v_acc, v_brand, id, true from sales_channel where account_id = v_acc;

  -- 4. Categorías de la carta.
  v_pos := 0;
  for r in select * from jsonb_array_elements(categorias) loop
    v_pos := v_pos + 1;
    insert into menu_category (account_id, brand_id, name, emoji, position, demand_kind, is_active) values (v_acc, v_brand, r->>0, r->>1, v_pos, r->>2, true);
  end loop;

  -- 5. Platos: ficha, escandallo y artículo de carta.
  v_pos := 0;
  for r in select * from jsonb_array_elements(platos) loop
    v_pos := v_pos + 1;
    select id into strict v_fam from recipe_family where account_id = v_acc and scope = 'dish' and name = r->>'f';
    select id into strict v_cat from menu_category where account_id = v_acc and brand_id = v_brand and name = r->>'c';
    insert into recipe_item (account_id, type, name, base_unit_id, cost_strategy, family_id, yield_portions, source, created_by_name)
    values (v_acc, 'dish', r->>'n', u_ud, 'fixed', v_fam, 1, 'manual', 'Demo Folvy') returning id into v_ri;
    v_n := 0;
    for l in select * from jsonb_array_elements(r->'l') loop
      v_n := v_n + 1;
      select id, base_unit_id into strict v_child, v_unit from recipe_item where account_id = v_acc and type = 'raw' and name = l->>0;
      insert into recipe_line (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross, unit_id, position)
      values (v_acc, v_ri, v_child, (l->>1)::numeric, (l->>1)::numeric, v_unit, v_n);
    end loop;
    perform public._kitchen_recompute_item_unguarded(v_ri);
    perform public._recompute_recipe_item_allergens(v_ri);
    insert into menu_item (account_id, brand_id, recipe_item_id, name, description, price, vat_rate, product_type, menu_category_id, position, source, target_food_cost_pct, created_by_name)
    values (v_acc, v_brand, v_ri, r->>'n', nullif(r->>'d',''), (r->>'p')::numeric, 10, 'item', v_cat, v_pos, 'manual', 30, 'Demo Folvy');
  end loop;

  -- 6. Extras y elecciones, con lo que descuentan.
  v_pos := 0;
  for r in select * from jsonb_array_elements(grupos) loop
    v_pos := v_pos + 1;
    insert into modifier_group (account_id, brand_id, name, min_selections, max_selections, allow_repetition, group_type, position, is_active)
    values (v_acc, v_brand, r->>'n', (r->>'min')::int, (r->>'max')::int, false, r->>'t', v_pos, true) returning id into v_grp;
    v_n := 0;
    for o in select * from jsonb_array_elements(r->'o') loop
      v_n := v_n + 1;
      insert into modifier_option (account_id, modifier_group_id, name, price_impact, is_default, position, is_active)
      values (v_acc, v_grp, o->>0, (o->>1)::numeric, (o->>2)::boolean, v_n, true) returning id into v_opt;
      if o->>3 is null then
        insert into modifier_recipe_impact (account_id, modifier_option_id, impact_type, status, source, confirmed_by_name, confirmed_at)
        values (v_acc, v_opt, 'none', 'confirmed', 'human', 'Demo Folvy', now());
      else
        select id, base_unit_id into strict v_child, v_unit from recipe_item where account_id = v_acc and type = 'raw' and name = o->>3;
        insert into modifier_recipe_impact (account_id, modifier_option_id, impact_type, target_recipe_item_id, quantity, unit_id, status, source, confirmed_by_name, confirmed_at)
        values (v_acc, v_opt, 'add_item', v_child, (o->>4)::numeric, v_unit, 'confirmed', 'human', 'Demo Folvy', now());
      end if;
    end loop;
    v_n := 0;
    for l in select * from jsonb_array_elements(r->'en') loop
      v_n := v_n + 1;
      select id into strict v_mi from menu_item where account_id = v_acc and brand_id = v_brand and name = l#>>'{}';
      insert into modifier_group_assignment (account_id, modifier_group_id, menu_item_id, position) values (v_acc, v_grp, v_mi, v_pos);
    end loop;
  end loop;

  -- 7. Menú del día.
  select id into strict v_cat from menu_category where account_id = v_acc and brand_id = v_brand and name = 'Menú del día';
  insert into menu_item (account_id, brand_id, name, description, price, vat_rate, product_type, menu_category_id, position, source, created_by_name)
  values (v_acc, v_brand, 'Menú del día', 'Primero, segundo, postre o café, pan y bebida.', 14.90, 10, 'combo', v_cat, 100, 'manual', 'Demo Folvy') returning id into v_mi;
  v_pos := 0;
  for s in select * from jsonb_array_elements(menu) loop
    v_pos := v_pos + 1;
    insert into combo_slot (account_id, combo_item_id, name, min_selections, max_selections, position, is_active)
    values (v_acc, v_mi, s->>'n', 1, 1, v_pos, true) returning id into v_slot;
    v_n := 0;
    for o in select * from jsonb_array_elements(s->'o') loop
      v_n := v_n + 1;
      select id into strict v_child from menu_item where account_id = v_acc and brand_id = v_brand and name = o->>0;
      insert into combo_slot_option (account_id, combo_slot_id, menu_item_id, price_impact, is_default, position, is_active)
      values (v_acc, v_slot, v_child, (o->>1)::numeric, false, v_n, true);
    end loop;
  end loop;

  -- 8. Precios de reparto: +15 %, redondeado a 0,10.
  insert into menu_item_override (account_id, menu_item_id, channel_id, price)
  select v_acc, m.id, c.id, round(m.price * 1.15, 1)
    from menu_item m cross join sales_channel c
   where m.account_id = v_acc and c.account_id = v_acc and c.channel_type = 'delivery' and m.name = any(delivery);

  -- 9. Sala.
  v_pos := 0;
  for r in select * from jsonb_array_elements(sala) loop
    v_pos := v_pos + 1;
    insert into dining_zone (account_id, location_id, name, kind, sort_order, is_active) values (v_acc, v_loc, r->>'n', r->>'k', v_pos, true) returning id into v_zone;
    v_n := 0;
    for l in select * from jsonb_array_elements(r->'t') loop
      v_n := v_n + 1;
      insert into dining_table (account_id, location_id, zone_id, name, seats, sort_order, grid_width, is_active)
      values (v_acc, v_loc, v_zone, l->>0, (l->>1)::int, v_n, (l->>2)::int, true);
    end loop;
  end loop;

  select format('ingredientes=%s (sin coste=%s) platos=%s (sin coste=%s) lineas=%s carta=%s categorias=%s grupos=%s opciones=%s impactos=%s huecos_menu=%s opciones_menu=%s precios_reparto=%s zonas=%s mesas=%s alergenos_en_platos=%s coste_medio_pct=%s peor_pct=%s',
    (select count(*) from recipe_item where account_id=v_acc and type='raw'),
    (select count(*) from recipe_item where account_id=v_acc and type='raw' and coalesce(computed_cost,fixed_cost) is null),
    (select count(*) from recipe_item where account_id=v_acc and type='dish'),
    (select count(*) from recipe_item where account_id=v_acc and type='dish' and coalesce(computed_cost,0)=0),
    (select count(*) from recipe_line where account_id=v_acc),
    (select count(*) from menu_item where account_id=v_acc),
    (select count(*) from menu_category where account_id=v_acc),
    (select count(*) from modifier_group where account_id=v_acc),
    (select count(*) from modifier_option where account_id=v_acc),
    (select count(*) from modifier_recipe_impact where account_id=v_acc),
    (select count(*) from combo_slot where account_id=v_acc),
    (select count(*) from combo_slot_option where account_id=v_acc),
    (select count(*) from menu_item_override where account_id=v_acc),
    (select count(*) from dining_zone where account_id=v_acc),
    (select count(*) from dining_table where account_id=v_acc),
    (select count(*) from recipe_item_allergen a join recipe_item ri on ri.id=a.recipe_item_id where ri.account_id=v_acc and ri.type='dish' and a.state='contains'),
    (select round(avg(ri.computed_cost / (m.price/1.10) * 100),1) from menu_item m join recipe_item ri on ri.id=m.recipe_item_id where m.account_id=v_acc),
    (select round(max(ri.computed_cost / (m.price/1.10) * 100),1) from menu_item m join recipe_item ri on ri.id=m.recipe_item_id where m.account_id=v_acc))
  into v_resumen;
  --ENSAYO--
  raise notice 'CASA LOLA LOTE 1: %', v_resumen;
end
$lote$;
