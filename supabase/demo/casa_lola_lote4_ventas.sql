-- Cuenta de demostración «Casa Lola» · LOTE 4: ventas por el camino real (sale + sale_line; el motor de consumo descuenta solo).
-- Se lanza por tramos de fechas (:DESDE / :HASTA, ambas incluidas). Un día que ya tiene ventas DEMO no se repite.
-- FUERA DE LA BANDA DE SERVICIO: recalcula el almacén venta a venta.
-- OJO AL ENSAYAR: el consumo cuelga de un disparador DIFERIDO (salta al confirmar). En un ensayo revertido hay que
-- poner `set constraints all immediate;` antes del raise, o saldrá «0 consumos» y parecerá que el motor no funciona.
do $lote$
declare
  v_acc   constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_desde constant date := :DESDE;
  v_hasta constant date := :HASTA;
  v_brand uuid; v_loc uuid; v_ch_salon uuid; v_ch_shop uuid; v_ch_del uuid[]; v_ch uuid;
  m jsonb; mo jsonb; mr jsonb;           -- carta: nombre -> {id, p}; extras: nombre -> {id, p}; precio de reparto: nombre -> p
  v_dia date; v_dow int; v_f numeric; v_n int; k int; j int; v_pax int; v_tipo text; v_lunch boolean;
  v_t timestamptz; v_min int; v_sale uuid; v_lines jsonb; v_total numeric; v_ref text; v_seq int; v_quien text;
  v_name text; v_pid uuid; v_cnt jsonb; v_key text; v_ventas int := 0; v_lineas int := 0;
  bebidas  text[] := array['Caña','Caña','Caña','Caña','Doble','Refresco','Refresco','Agua','Agua','Copa de vino tinto','Copa de vino tinto','Vermut'];
  picar    text[] := array['Croquetas de jamón (6)','Croquetas de jamón (6)','Croquetas de jamón (6)','Ensaladilla rusa','Ensaladilla rusa','Patatas bravas','Patatas bravas','Patatas bravas','Jamón ibérico','Tabla de quesos','Gambas al ajillo','Pan con tomate','Pan con tomate'];
  entrantes text[] := array['Ensalada de tomate y ventresca','Salmorejo','Salmorejo','Huevos rotos con jamón','Huevos rotos con jamón','Lentejas estofadas'];
  princ    text[] := array['Merluza a la plancha','Merluza a la plancha','Salmón con verduras','Entrecot a la brasa','Entrecot a la brasa','Lomo con patatas','Pollo asado','Pollo asado','Hamburguesa Casa Lola','Hamburguesa Casa Lola','Hamburguesa Casa Lola','Arroz de gambas','Espaguetis boloñesa','Espaguetis boloñesa'];
  postres  text[] := array['Tarta de queso','Tarta de queso','Tarta de queso','Flan casero','Flan casero','Yogur con fruta','Fruta de temporada'];
  cafes    text[] := array['Café solo','Café con leche','Café con leche'];
  m1 text[] := array['Salmorejo','Lentejas estofadas','Ensaladilla rusa'];
  m2 text[] := array['Lomo con patatas','Pollo asado','Espaguetis boloñesa','Merluza a la plancha'];
  m3 text[] := array['Flan casero','Fruta de temporada','Yogur con fruta','Café solo','Café con leche'];
  m4 text[] := array['Caña','Refresco','Agua','Copa de vino tinto'];
  reparto  text[] := array['Croquetas de jamón (6)','Ensaladilla rusa','Patatas bravas','Huevos rotos con jamón','Hamburguesa Casa Lola','Hamburguesa Casa Lola','Lomo con patatas','Pollo asado','Pollo asado','Espaguetis boloñesa','Arroz de gambas','Salmón con verduras'];
  puntos   text[] := array['Poco hecho','Al punto','Al punto','Al punto','Hecho'];
  guarn    text[] := array['Patatas fritas','Patatas fritas','Patatas fritas','Ensalada','Verduras a la plancha'];
  mediodia text[] := array['Pablo Herrero','Andrés Molina','Sergio Campos'];
  noche    text[] := array['Marta Giménez','Lucía Navarro','Elena Vidal'];
begin
  select id into strict v_brand from brand where account_id = v_acc;
  select id into strict v_loc from locations where account_id = v_acc;
  select id into strict v_ch_salon from sales_channel where account_id = v_acc and slug = 'salon';
  select id into strict v_ch_shop  from sales_channel where account_id = v_acc and slug = 'shop';
  select array_agg(id order by slug) into v_ch_del from sales_channel where account_id = v_acc and channel_type = 'delivery';  -- glovo, justeat, uber
  select jsonb_object_agg(name, jsonb_build_object('id', id, 'p', price)) into m from menu_item where account_id = v_acc and archived_at is null;
  select jsonb_object_agg(name, jsonb_build_object('id', id, 'p', price_impact)) into mo from modifier_option where account_id = v_acc;
  select jsonb_object_agg(mi.name, o.price) into mr from menu_item_override o join menu_item mi on mi.id = o.menu_item_id
   where o.account_id = v_acc and o.channel_id = v_ch_del[1];

  for v_dia in select d::date from generate_series(v_desde, v_hasta, interval '1 day') d loop
    if exists (select 1 from sale where account_id = v_acc and external_ref like 'DEMO-' || to_char(v_dia, 'YYYYMMDD') || '-%') then continue; end if;
    v_dow := extract(isodow from v_dia)::int;
    v_f := (array[0.70, 0.75, 0.85, 1.00, 1.35, 1.50, 1.20])[v_dow] * (0.9 + random() * 0.2);
    v_seq := 0;

    -- k: 1..n sala/terraza/barra · luego reparto · luego recogida
    v_n := round(60 * v_f)::int + round(14 * v_f)::int + round(4 * v_f)::int;
    for k in 1 .. v_n loop
      v_seq := v_seq + 1; v_lines := '[]'::jsonb; v_cnt := '{}'::jsonb;
      v_tipo := case when k <= round(60 * v_f)::int then 'sala' when k <= round(60 * v_f)::int + round(14 * v_f)::int then 'reparto' else 'recogida' end;
      v_lunch := random() < case when v_tipo = 'sala' then 0.55 else 0.40 end;
      v_min := case when v_lunch then 13 * 60 + floor(random() * 180)::int else 20 * 60 + 30 + floor(random() * 170)::int end;

      if v_tipo = 'sala' then
        v_ch := v_ch_salon;
        if v_lunch and v_dow <= 5 and random() < 0.35 then
          -- MENÚ DEL DÍA
          v_pax := 1 + floor(random() * 3)::int;
          for j in 1 .. v_pax loop
            v_pid := gen_random_uuid();
            v_lines := v_lines || jsonb_build_object('id', v_pid, 'par', null, 't', 'product', 'mi', m->'Menú del día'->>'id', 'mo', null, 'n', 'Menú del día', 'q', 1, 'p', (m->'Menú del día'->>'p')::numeric);
            v_name := m1[1 + floor(random() * 3)::int];
            v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'combo_item', 'mi', m->v_name->>'id', 'mo', null, 'n', v_name, 'q', 1, 'p', 0);
            v_name := m2[1 + floor(random() * 4)::int];
            v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'combo_item', 'mi', m->v_name->>'id', 'mo', null, 'n', v_name, 'q', 1, 'p', case when v_name = 'Merluza a la plancha' then 3 else 0 end);
            v_name := m3[1 + floor(random() * 5)::int];
            v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'combo_item', 'mi', m->v_name->>'id', 'mo', null, 'n', v_name, 'q', 1, 'p', 0);
            v_name := m4[1 + floor(random() * 4)::int];
            v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'combo_item', 'mi', m->v_name->>'id', 'mo', null, 'n', v_name, 'q', 1, 'p', 0);
          end loop;
        elsif random() < 0.28 then
          -- BARRA: unas bebidas y, a veces, algo de picar
          if random() < 0.5 then v_min := case when v_lunch then 11 * 60 + floor(random() * 120)::int else 18 * 60 + 30 + floor(random() * 120)::int end; end if;
          for j in 1 .. 1 + floor(random() * 3)::int loop
            v_name := case when v_min < 12 * 60 + 30 and random() < 0.6 then cafes[1 + floor(random() * 3)::int] else bebidas[1 + floor(random() * 12)::int] end;
            v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1));
          end loop;
          if random() < 0.5 then v_name := picar[1 + floor(random() * 13)::int]; v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); end if;
        else
          -- MESA A LA CARTA
          v_pax := case when random() < 0.15 then 5 + floor(random() * 2)::int else 2 + floor(random() * 3)::int end;
          for j in 1 .. v_pax loop
            v_name := bebidas[1 + floor(random() * 12)::int];
            v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1 + (random() < 0.3)::int));
          end loop;
          if v_pax >= 3 and not v_lunch and random() < 0.3 then
            v_name := case when random() < 0.65 then 'Botella Rioja crianza' else 'Botella Ribera del Duero' end;
            v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(1));
          end if;
          for j in 1 .. ceil(v_pax / 2.0)::int loop
            v_name := picar[1 + floor(random() * 13)::int];
            v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1));
          end loop;
          if random() < 0.4 then v_name := entrantes[1 + floor(random() * 6)::int]; v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); end if;
          j := 1;
          while j <= v_pax loop
            v_name := princ[1 + floor(random() * 14)::int];
            if v_name = 'Arroz de gambas' then
              if j = v_pax then continue; end if;        -- mínimo dos: si sólo queda uno, pide otra cosa
              v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 2)); j := j + 2;
            elsif v_name in ('Entrecot a la brasa', 'Merluza a la plancha', 'Hamburguesa Casa Lola') then
              v_pid := gen_random_uuid();
              v_lines := v_lines || jsonb_build_object('id', v_pid, 'par', null, 't', 'product', 'mi', m->v_name->>'id', 'mo', null, 'n', v_name, 'q', 1, 'p', (m->v_name->>'p')::numeric);
              if v_name <> 'Merluza a la plancha' then
                v_key := puntos[1 + floor(random() * 5)::int];
                v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'modifier', 'mi', null, 'mo', mo->v_key->>'id', 'n', v_key, 'q', 1, 'p', 0);
              end if;
              if v_name <> 'Hamburguesa Casa Lola' then
                v_key := guarn[1 + floor(random() * 5)::int];
                v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'modifier', 'mi', null, 'mo', mo->v_key->>'id', 'n', v_key, 'q', 1, 'p', 0);
              elsif random() < 0.25 then
                v_key := (array['Extra de queso', 'Extra de bacon', 'Huevo frito'])[1 + floor(random() * 3)::int];
                v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', v_pid, 't', 'modifier', 'mi', null, 'mo', mo->v_key->>'id', 'n', v_key, 'q', 1, 'p', (mo->v_key->>'p')::numeric);
              end if;
              j := j + 1;
            else
              v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); j := j + 1;
            end if;
          end loop;
          for j in 1 .. v_pax loop
            if random() < 0.35 then v_name := postres[1 + floor(random() * 7)::int]; v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); end if;
            if random() < 0.45 then v_name := cafes[1 + floor(random() * 3)::int]; v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); end if;
          end loop;
        end if;
      else
        -- REPARTO (precio de plataforma) y RECOGIDA (precio de carta)
        v_ch := case when v_tipo = 'recogida' then v_ch_shop else v_ch_del[1 + (floor(random() * 10)::int >= 5)::int + (floor(random() * 10)::int >= 7)::int] end;
        for j in 1 .. 1 + floor(random() * 2.2)::int loop
          v_name := reparto[1 + floor(random() * 12)::int];
          v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + case when v_name = 'Arroz de gambas' then 2 else 1 end));
        end loop;
        if random() < 0.25 then v_name := (array['Tarta de queso', 'Flan casero'])[1 + floor(random() * 2)::int]; v_cnt := jsonb_set(v_cnt, array[v_name], to_jsonb(coalesce((v_cnt->>v_name)::int, 0) + 1)); end if;
      end if;

      -- lo contado sin extras: una línea por artículo
      for v_key in select jsonb_object_keys(v_cnt) loop
        v_lines := v_lines || jsonb_build_object('id', gen_random_uuid(), 'par', null, 't', 'product', 'mi', m->v_key->>'id', 'mo', null, 'n', v_key, 'q', (v_cnt->>v_key)::int,
                     'p', case when v_tipo = 'reparto' then coalesce((mr->>v_key)::numeric, (m->v_key->>'p')::numeric) else (m->v_key->>'p')::numeric end);
      end loop;

      select sum((x->>'q')::numeric * (x->>'p')::numeric) into v_total from jsonb_array_elements(v_lines) x;
      v_t := ((v_dia + make_interval(mins => v_min)) at time zone 'Europe/Madrid') + make_interval(secs => floor(random() * 60)::int);
      v_ref := 'DEMO-' || to_char(v_dia, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');
      v_quien := case when v_tipo <> 'sala' then null when v_min < 17 * 60 then mediodia[1 + floor(random() * 3)::int] else noche[1 + floor(random() * 3)::int] end;

      insert into sale (account_id, brand_id, channel_id, location_id, source, external_ref, sold_at, total, paid, tax, taxable_base, payment_method, payment_status, paid_at,
                        service_type, status, order_status, opened_at, closed_at, accepted_at, ready_at, delivered_at, created_at, created_by_name, pos_short_code, platform_order_code, is_active)
      values (v_acc, v_brand, v_ch, v_loc, case v_tipo when 'sala' then 'folvy_pos' when 'recogida' then 'folvy_shop' else 'import' end, v_ref, v_t, v_total, v_total,
              round(v_total - v_total / 1.10, 2), round(v_total / 1.10, 2),
              case when v_tipo = 'sala' then (case when random() < 0.72 then 'card' else 'cash' end) when v_tipo = 'recogida' then 'stripe' else null end,
              'paid', v_t + make_interval(mins => case when v_tipo = 'sala' then 35 + floor(random() * 50)::int else 0 end),
              case v_tipo when 'sala' then null when 'recogida' then 'pickup' else 'platform_delivery' end, 'closed', 'completed',
              v_t, v_t + make_interval(mins => case when v_tipo = 'sala' then 40 + floor(random() * 50)::int else 30 + floor(random() * 20)::int end),
              v_t, v_t + make_interval(mins => 9 + floor(random() * 14)::int),
              v_t + make_interval(mins => case when v_tipo = 'sala' then 12 + floor(random() * 15)::int else 30 + floor(random() * 20)::int end),
              v_t, v_quien, case when v_tipo = 'sala' then 'T' || lpad(v_seq::text, 3, '0') end,
              case when v_tipo = 'reparto' then upper(substr(md5(v_ref), 1, 5)) end, true)
      returning id into v_sale;

      -- TODAS las líneas en UNA sentencia: el motor de consumo salta una vez por venta, y tiene que verlas todas.
      insert into sale_line (id, account_id, sale_id, raw_text, product_name, quantity, unit_price, line_total, menu_item_id, map_source, map_needs_review,
                             parent_sale_line_id, line_type, modifier_option_id, created_at)
      select (x->>'id')::uuid, v_acc, v_sale, x->>'n', x->>'n', (x->>'q')::numeric, (x->>'p')::numeric, (x->>'q')::numeric * (x->>'p')::numeric,
             (x->>'mi')::uuid, 'pos', false, (x->>'par')::uuid, x->>'t', (x->>'mo')::uuid, v_t
        from jsonb_array_elements(v_lines) x;
      v_ventas := v_ventas + 1; v_lineas := v_lineas + jsonb_array_length(v_lines);
    end loop;
  end loop;
  --FIN--
end
$lote$;
