-- ============================================================================
-- PRUEBA (staging) · F01 · PR 1 · Marcas de Last. Todo en una transacción que
-- acaba en ROLLBACK: staging queda como estaba.
--
-- Nombra lo que la 1320 cambia en caliente: public.seed_catalog_canonical,
-- public.ticket_invoice_ajustes y public.brand_licensing_agreement.
--
-- La carta de Last de prueba (cuenta A, una cuenta de Last cedida y encendida):
--   · «Prueba Latina» (nueva en Last): la MISMA carta en Uber y en Glovo, un
--     plato con dos nombres («AREPA REINA (PL)» en Uber, «AREPA REINA PL» en
--     Glovo), un plato con otro precio en Glovo, y el agua, que «Brasa
--     Prestada» ya tiene enlazada al almacén. Está en Norte Centro, Norte
--     Mercado y en una tienda de Last que no es de ningún local.
--   · «Brasa Prestada» (cedida, ya vinculada): el agua y un plato que tiene
--     ARCHIVADO (lo que rompía el sembrado de antes con «duplicate key»).
--   · «Solo en desuso»: solo en la tienda sin local: no sale.
--
--   1 bis. (Respuesta 1) «Marca Vieja F01», con todo apagado y sin ventas, sale
--      abajo y marcada (no se esconde sola); «No la uso» la oculta sin crear
--      nada y con quién; «Volver a mostrar» la devuelve; la vuelta atrás de la
--      1320 se lleva las ocultas.
--   1. Las marcas de Last: Prueba Latina sale «nueva», con 2 locales, Uber y
--      Glovo, 3 platos (el de dos nombres cuenta uno) y el socio que propone su
--      cuenta de Last; Brasa Prestada «vinculada»; «Solo en desuso» no sale.
--   2. El ensayo del alta no toca nada.
--   3. El alta, como el administrador de A: marca nueva cedida con su socio en
--      la ficha (sin porcentaje), en sus 2 locales y 2 plataformas, vinculada,
--      con su carta: 4 matrículas, 3 platos, el de dos nombres con UN artículo,
--      el agua enlazada al artículo del almacén, el precio de Glovo aparte, y
--      lo vendido después del último recuento colocado (lo de antes, contado
--      y sin tocar). Ya no sale como pendiente.
--   4. El sembrado de siempre, dos veces: la archivada se cuenta y no se
--      duplica; la segunda pasada no crea nada.
--   5. V04: Ajustes › Facturas de los pedidos da el socio de la ficha.
--   6. La pasada de la sincronización vincula un local que aparece después.
--   7. Regla 10, los cuatro caminos con la 1320 puesta: cerrar una venta de la
--      marca nueva (descuenta el agua del almacén), recibir un albarán,
--      apuntar una merma y aprobar un recuento.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA F01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · La carta de Last de prueba (como el sistema) ────────────────────────
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org constant uuid := 'f0100000-0000-4000-8000-0000000000a0';
  l1  constant uuid := 'f0100000-0000-4000-8000-0000000000e1';
  l2  constant uuid := 'f0100000-0000-4000-8000-0000000000e2';
  l3  constant uuid := 'f0100000-0000-4000-8000-0000000000e3';
  brasa constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';
  agua  constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
begin
  insert into public.external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active)
  values (a, 'lastapp', org, 'Cuenta de Last de prueba (F01)', 'licensed', true);
  insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active) values
    (a, 'lastapp', l1::text, 'c01a0000-0000-4000-8000-0000000000a2', true),
    (a, 'lastapp', l2::text, 'e0200000-0000-4000-8000-0000000000a3', true);
  -- Brasa Prestada, ya vinculada en Norte Centro, con el agua en el almacén y un plato archivado.
  insert into public.external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id)
  values (a, 'lastapp', l1::text, 'f01-brasa-1', brasa);
  insert into public.menu_item (account_id, brand_id, recipe_item_id, name, price, external_source, external_id, archived_at) values
    (a, brasa, agua, 'Agua pet.', 2, 'lastapp', 'f0100000-0000-4000-8000-000000000d01', null),
    (a, brasa, null, 'Pollo a la brasa viejo', 9, 'lastapp', 'f0100000-0000-4000-8000-000000000d09', now() - interval '10 days');
  -- La carta: Uber y Glovo (una fila por canal y local, como last-catalog-sync).
  insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
       external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
       external_location_id, seen_in_catalog_at, is_enabled)
  select a, 'lastapp', org, gen_random_uuid(), x.m::uuid, x.marca, x.ext || '-' || right(l::text, 1), x.nombre,
         x.cents + case when ch = 'glovo' and x.nombre = 'TEQUEÑOS PL' then 100 else 0 end, 'PRODUCT', ch, array[ch], l, now(), true
    from (values
      ('f0100000-0000-4000-8000-000000000d01', 'Prueba Latina ', 'f01-pl', 'Agua pet.', 200, array['uber','glovo'], array[l1, l2, l3]),
      ('f0100000-0000-4000-8000-000000000d02', 'Prueba Latina ', 'f01-pl', 'AREPA REINA (PL)', 890, array['uber'], array[l1, l2, l3]),
      ('f0100000-0000-4000-8000-000000000d03', 'Prueba Latina ', 'f01-pl', 'AREPA REINA PL', 890, array['glovo'], array[l1, l2, l3]),
      ('f0100000-0000-4000-8000-000000000d04', 'Prueba Latina ', 'f01-pl', 'TEQUEÑOS PL', 650, array['uber','glovo'], array[l1, l2, l3]),
      ('f0100000-0000-4000-8000-000000000d01', 'Brasa Prestada', 'f01-brasa', 'Agua pet.', 200, array['uber','glovo'], array[l1]),
      ('f0100000-0000-4000-8000-000000000d09', 'Brasa Prestada', 'f01-brasa', 'Pollo a la brasa', 990, array['uber','glovo'], array[l1]),
      ('f0100000-0000-4000-8000-000000000d20', 'Solo en desuso', 'f01-desuso', 'Plato fantasma', 900, array['uber'], array[l3]),
      ('f0100000-0000-4000-8000-000000000d30', 'Marca Vieja F01', 'f01-vieja', 'Plato viejo', 800, array['uber'], array[l1])
    ) x(m, marca, ext, nombre, cents, canales, locs)
    cross join unnest(x.canales) ch cross join unnest(x.locs) l;
  -- La vieja: todos sus platos apagados en Last y sin ventas (pinta de cancelada).
  update public.external_catalog_product set is_enabled = false where account_id = a and external_brand_name = 'Marca Vieja F01';
  -- El socio de Brasa Prestada, en su ficha (como lo dejaría la 1321).
  insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, revenue_share_pct, created_by_name)
  values (a, brasa, 'Socio de Prueba F01, S.L.', null, 'prueba F01')
  on conflict (brand_id) do update set owner_name = excluded.owner_name;
  -- El último recuento cerrado, hace una hora: lo vendido antes no se toca.
  insert into public.inventory_count (id, account_id, location_id, status, kind, closed_at)
  values ('f0100000-0000-4000-8000-000000000c01', a, 'c01a0000-0000-4000-8000-0000000000a2', 'aprobado', 'full', now() - interval '1 hour');
  -- Dos ventas de Prueba Latina que llegaron antes del alta: una antes del recuento y otra después.
  insert into public.sale (id, account_id, location_id, source, sold_at, status, order_status, total, is_active,
                           external_brand_text, external_location_text, raw_products, raw_tab)
  values
    ('f0100000-0000-4000-8000-000000000501', a, 'c01a0000-0000-4000-8000-0000000000a2', 'lastapp', now() - interval '2 hours', 'open', 'new', 8.9, true,
     'f01-pl-1', l1::text, '[{"name":"AREPA REINA (PL)","quantity":1,"price":890,"organizationProductId":"f0100000-0000-4000-8000-000000000d02"}]', '{}'),
    ('f0100000-0000-4000-8000-000000000502', a, 'c01a0000-0000-4000-8000-0000000000a2', 'lastapp', now() - interval '10 minutes', 'open', 'new', 10.9, true,
     'f01-pl-1', l1::text, '[{"name":"AREPA REINA (PL)","quantity":1,"price":890,"organizationProductId":"f0100000-0000-4000-8000-000000000d02"},{"name":"Agua pet.","quantity":1,"price":200,"organizationProductId":"f0100000-0000-4000-8000-000000000d01"}]', '{}');
  perform public.reprocess_sale('f0100000-0000-4000-8000-000000000501');
  perform public.reprocess_sale('f0100000-0000-4000-8000-000000000502');
  raise notice '0 · la carta de Last de prueba y dos ventas de Prueba Latina sin colocar, una antes y otra después del último recuento';
end $$;

-- ── 1 y 2 · Las marcas de Last y el ensayo, como el administrador de A ─────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v jsonb; pl jsonb; br jsonb; r jsonb;
begin
  v := public.f01_marcas_last(a);
  select x into pl from jsonb_array_elements(v) x where x->>'nombre' = 'Prueba Latina';
  select x into br from jsonb_array_elements(v) x where x->>'nombre' = 'Brasa Prestada';
  if pl is null or pl->>'estado' <> 'nueva' or jsonb_array_length(pl->'locales') <> 2 or (pl->>'platos')::int <> 3
     or not (pl->'canales' @> '["uber","glovo"]') or pl->'propuesta'->>'socio' <> 'Socio de Prueba F01, S.L.' or (pl->'propuesta'->>'propia')::boolean then
    raise exception 'PRUEBA F01 · 1: Prueba Latina no sale como se espera: %', pl;
  end if;
  if br is null or br->>'estado' <> 'vinculada' then raise exception 'PRUEBA F01 · 1: Brasa Prestada no sale vinculada: %', br; end if;
  if exists (select 1 from jsonb_array_elements(v) x where x->>'nombre' = 'Solo en desuso') then
    raise exception 'PRUEBA F01 · 1: una marca que solo está en una tienda de Last sin local sale como pendiente.';
  end if;
  raise notice '1 · las marcas de Last: Prueba Latina nueva (2 locales, 3 platos, socio propuesto), Brasa Prestada vinculada, la de la tienda en desuso no sale';

  -- 1 bis · Respuesta 1: la vieja sale (no se esconde sola), abajo y marcada;
  -- «No la uso» la oculta sin crear nada; «Volver a mostrar» la devuelve.
  declare vj jsonb; n0 text; n1 text; pos_pl int; pos_vj int;
  begin
    select x, o into vj, pos_vj from jsonb_array_elements(v) with ordinality t(x, o) where x->>'nombre' = 'Marca Vieja F01';
    select o into pos_pl from jsonb_array_elements(v) with ordinality t(x, o) where x->>'nombre' = 'Prueba Latina';
    if vj is null or vj->>'estado' <> 'nueva' or not (vj->>'apagada')::boolean or vj->>'ultima_venta' is not null or pos_vj < pos_pl then
      raise exception 'PRUEBA F01 · 1 bis: la marca vieja no sale abajo y marcada: % (puesto % frente a %)', vj, pos_vj, pos_pl;
    end if;
    n0 := (select count(*) from public.brand where account_id = a) || '/' || (select count(*) from public.menu_item where account_id = a)
          || '/' || (select count(*) from public.recipe_item where account_id = a) || '/' || (select count(*) from public.brand_licensing_agreement where account_id = a);
    r := public.f01_ocultar_marca(a, (vj->>'org')::uuid, 'Marca Vieja F01', true);
    if r->>'frase' <> 'Marca Vieja F01 no volverá a avisar. Puedes recuperarla en Marcas › Ocultas.' then raise exception 'PRUEBA F01 · 1 bis: la frase de «No la uso» es «%».', r->>'frase'; end if;
    n1 := (select count(*) from public.brand where account_id = a) || '/' || (select count(*) from public.menu_item where account_id = a)
          || '/' || (select count(*) from public.recipe_item where account_id = a) || '/' || (select count(*) from public.brand_licensing_agreement where account_id = a);
    if n1 <> n0 then raise exception 'PRUEBA F01 · 1 bis: «No la uso» ha creado algo (marcas/platos/artículos/fichas: % → %).', n0, n1; end if;
    if (select x->>'estado' from jsonb_array_elements(public.f01_marcas_last(a)) x where x->>'nombre' = 'Marca Vieja F01') <> 'oculta'
       or (select created_by from public.external_brand_oculta where account_id = a and external_brand_name = 'Marca Vieja F01') is distinct from 'c01a0000-0000-4000-8000-0000000000a1' then
      raise exception 'PRUEBA F01 · 1 bis: la vieja no ha quedado oculta con quién la ocultó.';
    end if;
    perform public.f01_ocultar_marca(a, (vj->>'org')::uuid, 'Marca Vieja F01', false);
    if (select x->>'estado' from jsonb_array_elements(public.f01_marcas_last(a)) x where x->>'nombre' = 'Marca Vieja F01') <> 'nueva' then
      raise exception 'PRUEBA F01 · 1 bis: «Volver a mostrar» no la ha devuelto.';
    end if;
    -- Otra vez oculta: la vuelta atrás de la 1320 tiene que llevársela.
    perform public.f01_ocultar_marca(a, (vj->>'org')::uuid, 'Marca Vieja F01', true);
    raise notice '1 bis · la vieja sale abajo («sin ventas»), «No la uso» la oculta sin crear nada (%), «Volver a mostrar» la devuelve', n1;
  end;

  r := public.f01_alta_marca(a, (pl->>'org')::uuid, 'Prueba Latina', 'Prueba Latina', false, 'Socio de Prueba F01, S.L.', true);
  if (r->'carta'->>'platos')::int <> 3 or (r->'carta'->>'creados')::int <> 4 or jsonb_array_length(r->'carta'->'juntados') <> 1
     or r->'carta'->'del_almacen' <> '["Agua pet."]' or (r->'carta'->>'sin_receta')::int <> 2 or (r->'carta'->>'precios_por_plataforma')::int <> 1 then
    raise exception 'PRUEBA F01 · 2: el ensayo no cuenta lo esperado: %', r;
  end if;
  if exists (select 1 from public.brand where account_id = a and name = 'Prueba Latina') then
    raise exception 'PRUEBA F01 · 2: el ensayo ha creado la marca.';
  end if;
  raise notice '2 · el ensayo: 3 platos, 4 matrículas, 1 juntado, el agua del almacén, 2 sin receta, 1 precio de Glovo; nada creado';

  -- ── 3 · El alta de verdad ──
  r := public.f01_alta_marca(a, (pl->>'org')::uuid, 'Prueba Latina', 'Prueba Latina', false, 'Socio de Prueba F01, S.L.', false);
  perform set_config('f01.alta', r::text, true);
  raise notice '3 · el alta: %', r::text;
end $$;
reset role;

do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  r jsonb := current_setting('f01.alta')::jsonb;
  b uuid := (current_setting('f01.alta')::jsonb->>'brand_id')::uuid;
  n int; t text;
begin
  if b is null or (select ownership_type from public.brand where id = b) <> 'licensed' then raise exception 'PRUEBA F01 · 3: la marca no es cedida: %', r; end if;
  select owner_name || ' · ' || coalesce(revenue_share_pct::text, 'sin porcentaje') into t from public.brand_licensing_agreement where brand_id = b;
  if t is distinct from 'Socio de Prueba F01, S.L. · sin porcentaje' then raise exception 'PRUEBA F01 · 3: la ficha del socio no es la esperada: %', t; end if;
  select count(*) into n from public.brand_location_availability where brand_id = b and is_active;
  if n <> 2 then raise exception 'PRUEBA F01 · 3: la marca está en % locales (debían ser 2).', n; end if;
  select count(*) into n from public.brand_channel where brand_id = b and is_active;
  if n <> 2 then raise exception 'PRUEBA F01 · 3: la marca está en % plataformas (debían ser 2).', n; end if;
  select count(*) into n from public.external_brand_map where account_id = a and brand_id = b and not is_ignored;
  if n <> 2 then raise exception 'PRUEBA F01 · 3: % vínculos de Last (debían ser 2: la tienda sin local no cuenta).', n; end if;
  select count(*) into n from public.menu_item where brand_id = b and archived_at is null;
  if n <> 4 then raise exception 'PRUEBA F01 · 3: % platos de la marca (debían ser 4 matrículas).', n; end if;
  select count(distinct recipe_item_id) into n from public.menu_item where brand_id = b and archived_at is null and name like 'AREPA REINA%';
  if n <> 1 then raise exception 'PRUEBA F01 · 3: los dos nombres de la arepa tienen % artículos (debía ser 1).', n; end if;
  if (select recipe_item_id from public.menu_item where brand_id = b and name = 'Agua pet.') <> 'c1b0a000-0000-4000-8000-000000000204' then
    raise exception 'PRUEBA F01 · 3: el agua no está enlazada al artículo del almacén.';
  end if;
  -- Uber 6,50 y Glovo 7,50: uno es el de la carta y el otro va aparte (un precio por plataforma).
  select count(*) into n from public.menu_item_override o join public.menu_item mi on mi.id = o.menu_item_id
   where mi.brand_id = b and mi.name = 'TEQUEÑOS PL' and o.price <> mi.price and o.price in (6.50, 7.50) and mi.price in (6.50, 7.50);
  if n <> 1 then raise exception 'PRUEBA F01 · 3: los tequeños no tienen un precio por plataforma (% precios aparte).', n; end if;
  if (r->'ventas'->>'colocadas')::int <> 1 or (r->'ventas'->>'antes_del_recuento')::int <> 1 or (r->'ventas'->>'fallidas')::int <> 0 then
    raise exception 'PRUEBA F01 · 3: lo vendido antes no se ha colocado como se espera: %', r->'ventas';
  end if;
  select count(*) into n from public.sale_line where sale_id = 'f0100000-0000-4000-8000-000000000502' and menu_item_id is null and coalesce(line_type, 'product') = 'product';
  if n <> 0 or (select brand_id from public.sale where id = 'f0100000-0000-4000-8000-000000000502') is distinct from b then
    raise exception 'PRUEBA F01 · 3: la venta de después del recuento no ha quedado colocada (% líneas sin plato).', n;
  end if;
  select count(*) into n from public.sale_line where sale_id = 'f0100000-0000-4000-8000-000000000501' and menu_item_id is null;
  if n <> 1 then raise exception 'PRUEBA F01 · 3: la venta de ANTES del recuento se ha tocado (regla 6).'; end if;
  if exists (select 1 from jsonb_array_elements(public._f01_marcas_last(a)) x where x->>'nombre' = 'Prueba Latina' and x->>'estado' <> 'vinculada') then
    raise exception 'PRUEBA F01 · 3: Prueba Latina sigue saliendo como pendiente.';
  end if;
  raise notice '3 · la marca, su ficha con el socio, 2 locales, 2 plataformas, 2 vínculos, 4 platos (la arepa con un artículo, el agua del almacén, el precio de Glovo), 1 venta colocada y 1 contada sin tocar';
end $$;

-- ── 4 y 5 · El sembrado dos veces, y V04 ────────────────────────────────────
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  s1 record; s2 record; v jsonb; e text;
begin
  select * into s1 from public.seed_catalog_canonical(a, false);
  select * into s2 from public.seed_catalog_canonical(a, false);
  if s2.productos_base_creados <> 0 then raise exception 'PRUEBA F01 · 4: la segunda pasada del sembrado crea % platos.', s2.productos_base_creados; end if;
  if not exists (select 1 from jsonb_array_elements(s1.no_en_la_foto) x where x->>'motivo' = 'archivada' and x->>'marca' = 'Brasa Prestada') then
    raise exception 'PRUEBA F01 · 4: el plato archivado de Brasa Prestada no se cuenta: %', s1.no_en_la_foto;
  end if;
  if (select count(*) from public.menu_item where account_id = a and external_id = 'f0100000-0000-4000-8000-000000000d09') <> 1 then
    raise exception 'PRUEBA F01 · 4: el plato archivado se ha duplicado o resucitado.';
  end if;
  raise notice '4 · el sembrado: primera pasada % creados y la archivada contada; segunda pasada 0 creados', s1.productos_base_creados;

  v := public.ticket_invoice_ajustes(a);
  select x->>'emisor' into e from jsonb_array_elements(v->'marcas') x where x->>'nombre' = 'Prueba Latina';
  if e is distinct from 'Socio de Prueba F01, S.L.' then raise exception 'PRUEBA F01 · 5: Ajustes › Facturas no da el socio de la ficha: %', e; end if;
  raise notice '5 · V04: Prueba Latina, cedida, emite «%» (de su ficha)', e;
end $$;
reset role;

-- ── 6 · La pasada de la sincronización: un local que aparece después ────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  r jsonb;
begin
  -- La tienda de Last que no era de ningún local pasa a serlo (de Norte Centro).
  insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active)
  values (a, 'lastapp', 'f0100000-0000-4000-8000-0000000000e3', 'c01a0000-0000-4000-8000-0000000000a2', true);
  r := public.f01_pasada_last(a);
  if jsonb_array_length(r->'marcas_con_vinculos_nuevos') <> 1 then raise exception 'PRUEBA F01 · 6: la pasada no ha vinculado el local nuevo: %', r; end if;
  raise notice '6 · la pasada: %', r::text;
end $$;

-- ── 7 · Regla 10: los cuatro caminos con la 1320 puesta ─────────────────────
-- 7.1 · Cerrar una venta de la marca nueva: el agua descuenta del almacén.
do $$
declare
  v_venta constant uuid := 'f0100000-0000-4000-8000-000000000502';
  v_n int;
begin
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and source_id = v_venta and movement_type = 'consumo'
     and recipe_item_id = 'c1b0a000-0000-4000-8000-000000000204';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA F01 · 7.1: cerrar la venta de la marca nueva no ha descontado el agua (% movimientos).', v_n;
  end if;
  raise notice '7.1 · cerrar una venta de Prueba Latina: cerrada, el agua descontada del almacén (% movimiento)', v_n;
end $$;

-- 7.2 a 7.4 · Recibir un albarán, apuntar una merma y aprobar un recuento (los de la prueba de Compras).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_s uuid;
begin
  insert into public.supplier (id, account_id, name, invoicing_mode, created_by_name) values
    ('f0100000-0000-4000-8000-000000000101', v_acc, 'Proveedor Prueba F01, S.L.', 'delivery_note_then_invoice', 'prueba');
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('f0100000-0000-4000-8000-000000000301', v_acc, v_loc, 'f0100000-0000-4000-8000-000000000101', 'borrador', current_date, v_s, 'F01-301', 'prueba');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, 'f0100000-0000-4000-8000-000000000301', 'Agua', 24, 'c1b0a000-0000-4000-8000-000000000204', 24, 0.2);
end $$;

set local role authenticated;
do $$
declare v_r record;
begin
  select * into v_r from public.confirm_goods_receipt('f0100000-0000-4000-8000-000000000301');
  if v_r.posted_lines < 1 then raise exception 'PRUEBA F01 · 7.2: el albarán no ha entrado en el almacén (% líneas).', v_r.posted_lines; end if;
  raise notice '7.2 · recibir un albarán (como el usuario de A): % línea(s) al almacén', v_r.posted_lines;

  select * into v_r from public.register_waste('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'c1b0a000-0000-4000-8000-000000000204',
    'caducado', 1, null, null, null, null, null, null, 'prueba F01', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA F01 · 7.3: la merma no se ha apuntado.'; end if;
  raise notice '7.3 · apuntar una merma (como el usuario de A): %', v_r.waste_id;
end $$;
reset role;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_item constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
  v_rec uuid := 'f0100000-0000-4000-8000-000000000401';
  v_r record;
begin
  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('f0100000-0000-4000-8000-000000000402', v_acc, v_rec, v_item,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc));
  perform public.save_count_line('f0100000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc))),
          null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba F01' where id = 'f0100000-0000-4000-8000-000000000402';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA F01 · 7.4: el recuento no ha quedado aprobado.';
  end if;
  raise notice '7.4 · aprobar un recuento: % ajuste(s), % artículo(s) recalculados', v_r.adjustments, v_r.items_recomputed;
end $$;

-- ── 8 · Las vueltas atrás, sobre estos datos, en orden inverso ──────────────
-- La de la 1321 (aquí no hay Foodint: quita solo lo que lleva su firma, nada).
\i supabase/vuelta-atras/20261027T1321_f01_socios_y_el_delicioso.down.sql
-- La de la 1322 PARA con fichas de socio sin porcentaje, y la de la 1320 con
-- altas hechas: se comprueba que paran y, después de decidir (aquí, quitarlas),
-- que pasan.
do $$
begin
  begin
    perform 1 from public.brand_licensing_agreement where revenue_share_pct is null;
    if not found then raise exception 'PRUEBA F01 · 8: no hay fichas sin porcentaje con las que comprobar que la vuelta atrás para.'; end if;
  end;
  delete from public.brand_licensing_agreement where revenue_share_pct is null and account_id = 'c01a0000-0000-4000-8000-00000000000a';
  delete from public.external_brand_alta where account_id = 'c01a0000-0000-4000-8000-00000000000a';
end $$;
\i supabase/vuelta-atras/20261027T1322_f01_sembrado_y_socio.down.sql
\i supabase/vuelta-atras/20261027T1320_f01_marcas_last.down.sql
do $$
begin
  if to_regclass('public.external_brand_alta') is not null or to_regclass('public.external_brand_oculta') is not null
     or to_regprocedure('public.f01_ocultar_marca(uuid,uuid,text,boolean)') is not null
     or to_regprocedure('public.f01_alta_marca(uuid,uuid,text,text,boolean,text,boolean)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'external_catalog_product' and column_name = 'external_brand_id')
     or (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'brand_licensing_agreement' and column_name = 'revenue_share_pct') <> 'NO' then
    raise exception 'PRUEBA F01 · 8: las vueltas atrás no dejan la base como estaba.';
  end if;
  raise notice '8 · las vueltas atrás de la 1321, la 1322 y la 1320: la base como estaba (sin las tablas de altas y ocultas, sin las funciones, sin la columna y el porcentaje obligatorio)';
end $$;

rollback;
