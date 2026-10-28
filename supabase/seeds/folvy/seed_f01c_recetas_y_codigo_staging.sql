-- ============================================================================
-- F01 · PR 3 · La carta de Last de prueba de las recetas que faltan (tablero 3)
-- y del código cambiado (tablero 4). SOLO STAGING. Necesita la 0850.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/marcas/recetas-y-codigo.spec.ts, en la cuenta A, con su propia
-- cuenta de Last («Cocina Propia de Prueba», encendida) y dos tiendas: una en
-- Norte Centro y otra en Norte Mercado.
--   · «Pollería de Prueba», ya dada de alta en Folvy y vinculada en Norte
--     Centro. Su carta: Pollo asado, Muslitos y Pechuga, con receta; el Agua,
--     del almacén; «Alitas de Prueba», con el plato vacío (sin receta), y
--     «Croquetas de Prueba», sin artículo todavía.
--   · «Pollería Express» llega a Norte Mercado con OTRO código y la carta
--     IDÉNTICA (las mismas 6 matrículas): la pasada la une sola y avisa.
--   · «Pollos Nuevos» llega a Norte Mercado con otro código y una carta que
--     solo SE PARECE (3 de sus 4 platos se llaman como los de la Pollería, con
--     otras matrículas, y un Wrap que no está): se pregunta.
--
--   e2e_f01c_preparar(p_que): la prueba no tiene la clave de servicio, y cada
--   pasada (ordenador y móvil) tiene que empezar igual. Esta función —que SOLO
--   existe en staging, por esta semilla— se la deja usar al administrador de A
--   (el de la plantilla o el de su carril), y solo en SU cuenta:
--     · 'empezar' deja la carta como al principio (sin unir Express ni Nuevos,
--                 Alitas sin receta, Croquetas sin artículo) y pone las ventas
--                 de la prueba, vendidas ahora: 1 de Alitas, 1 de Express y 2
--                 de Pollos Nuevos (estas tres, sin marca). Devuelve la lectura
--                 de «Alitas de Prueba» que la prueba hace pasar por la de
--                 Cocina (una sesión de extract-recipe, sin llamar a la IA);
--     · 'pasada'  lo que hace la pasada de cada hora con las de carta idéntica
--                 (_f01c_reconocer_solas, de la 0850);
--     · 'limpiar' lo mismo que 'empezar', sin ventas ni lectura.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta la
-- cuenta A o sus locales. Se puede volver a aplicar.
-- ============================================================================

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org   constant uuid := 'f01c2e00-0000-4000-8000-0000000000a0';
  t1    constant uuid := 'f01c2e00-0000-4000-8000-0000000000e1';
  t2    constant uuid := 'f01c2e00-0000-4000-8000-0000000000e2';
  centro  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  mercado constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  marca constant uuid := 'f01c2e00-0000-4000-8000-0000000000b1';
  ud    constant uuid := 'c1b0a000-0000-4000-8000-000000000104';
  pan   constant uuid := 'c1b0a000-0000-4000-8000-000000000203';
  agua  constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla F01c ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if (select count(*) from public.locations where account_id = a and id in (centro, mercado)) <> 2 then
    raise exception 'Semilla F01c: faltan los locales Norte Centro y Norte Mercado de la cuenta A.';
  end if;
  if (select count(*) from public.recipe_item where account_id = a and id in (pan, agua)) <> 2
     or not exists (select 1 from public.kitchen_unit where id = ud and account_id = a) then
    raise exception 'Semilla F01c: faltan el pan, el agua o la unidad «ud» de la cuenta A (semilla de Compras).';
  end if;
  if to_regclass('public.f01_receta_puesta') is null then
    raise exception 'Semilla F01c: falta la 0850 (f01_receta_puesta).';
  end if;

  if not exists (select 1 from public.external_integration where account_id = a and source = 'lastapp' and external_org_id = org) then
    -- Sin secreto detrás: ninguna prueba llama a Last.
    insert into public.external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active, token_secret_name)
    values (a, 'lastapp', org, 'Cocina Propia de Prueba', 'own', true, 'e2e_last_token_prueba');
  end if;
  insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active)
  select a, 'lastapp', x.ext, x.loc, true
    from (values (t1::text, centro), (t2::text, mercado)) x(ext, loc)
   where not exists (select 1 from public.external_location_map m where m.account_id = a and m.source = 'lastapp' and m.external_location_id = x.ext);

  -- La marca de Folvy y sus platos.
  insert into public.brand (id, account_id, name, slug, ownership_type, is_active, catalog_source, created_by_name)
  values (marca, a, 'Pollería de Prueba', 'polleria-de-prueba', 'own', true, 'pos', 'semilla F01c')
  on conflict (id) do nothing;
  insert into public.brand_location_availability (account_id, brand_id, location_id, is_active, active_since, notes)
  values (a, marca, centro, true, current_date, 'semilla F01c')
  on conflict (account_id, brand_id, location_id) do nothing;
  insert into public.brand_channel (account_id, brand_id, channel_id, is_active, created_by_name)
  select a, marca, sc.id, true, 'semilla F01c' from public.sales_channel sc where sc.account_id = a and sc.slug in ('uber', 'glovo')
  on conflict (brand_id, channel_id) do nothing;

  insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_active, source, created_by_name)
  values ('f01c2e00-0000-4000-8000-0000000002d1', a, 'dish', 'Pollo asado de Prueba', ud, true, 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000002d2', a, 'dish', 'Muslitos de Prueba', ud, true, 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000002d3', a, 'dish', 'Pechuga de Prueba', ud, true, 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000002d5', a, 'dish', 'Alitas de Prueba', ud, true, 'import', 'semilla F01c')
  on conflict (id) do nothing;
  insert into public.recipe_line (id, account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
  values ('f01c2e00-0000-4000-8000-0000000003d1', a, 'f01c2e00-0000-4000-8000-0000000002d1', pan, 1, ud, 1),
         ('f01c2e00-0000-4000-8000-0000000003d2', a, 'f01c2e00-0000-4000-8000-0000000002d2', pan, 1, ud, 1),
         ('f01c2e00-0000-4000-8000-0000000003d3', a, 'f01c2e00-0000-4000-8000-0000000002d3', pan, 1, ud, 1)
  on conflict (id) do nothing;

  -- Las 6 matrículas de la Pollería (la misma carta en Uber y Glovo).
  insert into public.menu_item (id, account_id, brand_id, recipe_item_id, name, price, product_type, external_source, external_id, source, created_by_name)
  values ('f01c2e00-0000-4000-8000-0000000004d1', a, marca, 'f01c2e00-0000-4000-8000-0000000002d1', 'Pollo asado de Prueba', 12.5, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d1', 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000004d2', a, marca, 'f01c2e00-0000-4000-8000-0000000002d2', 'Muslitos de Prueba', 8.9, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d2', 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000004d3', a, marca, 'f01c2e00-0000-4000-8000-0000000002d3', 'Pechuga de Prueba', 9.9, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d3', 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000004d4', a, marca, agua, 'Agua mineral 50 cl', 2, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d4', 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000004d5', a, marca, 'f01c2e00-0000-4000-8000-0000000002d5', 'Alitas de Prueba', 7.5, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d5', 'import', 'semilla F01c'),
         ('f01c2e00-0000-4000-8000-0000000004d6', a, marca, null, 'Croquetas de Prueba', 6.5, 'item', 'lastapp', 'f01c2e00-0000-4000-8000-0000000001d6', 'import', 'semilla F01c')
  on conflict (id) do nothing;

  -- Las cartas de Last: la Pollería en Norte Centro; Express (idéntica) y
  -- Pollos Nuevos (se parece) en Norte Mercado, cada una con su código.
  insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
       external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
       external_location_id, seen_in_catalog_at, is_enabled, last_synced_at)
  select a, 'lastapp', org,
         ('f01c2e00-' || lpad(to_hex(x.n), 4, '0') || '-4000-8000-' || lpad(to_hex(c.i * 16 + m.j), 12, '0'))::uuid,
         ('f01c2e00-0000-4000-8000-0000000001' || lpad(to_hex(x.n), 2, '0'))::uuid,
         m.marca, m.codigo, x.nombre, x.cents, 'PRODUCT', c.ch, array[c.ch], m.tienda, now(), true, now()
    from (values (209, 'Pollo asado de Prueba', 1250, 'pp'), (210, 'Muslitos de Prueba', 890, 'pp'), (211, 'Pechuga de Prueba', 990, 'pp'),
                 (212, 'Agua mineral 50 cl', 200, 'pp'), (213, 'Alitas de Prueba', 750, 'pp'), (214, 'Croquetas de Prueba', 650, 'pp'),
                 (225, 'Pollo asado de Prueba', 1250, 'pn'), (226, 'Muslitos de Prueba', 890, 'pn'), (227, 'Pechuga de Prueba', 990, 'pn'),
                 (228, 'Wrap de Pollo', 850, 'pn')) x(n, nombre, cents, de)
    cross join (values (1, 'uber'), (2, 'glovo')) c(i, ch)
    join (values (1, 'Pollería de Prueba', 'f01c-pp-1', t1, 'pp'), (2, 'Pollería Express', 'f01c-px-2', t2, 'pp'),
                 (3, 'Pollos Nuevos', 'f01c-pn-3', t2, 'pn')) m(j, marca, codigo, tienda, de) on m.de = x.de
  on conflict (account_id, source, catalog_product_id, external_location_id) do nothing;
  -- (Las matrículas de la Pollería, 0xd1…0xd6, son las de sus platos en Folvy.)

  -- La Pollería, ya dada de alta y vinculada en Norte Centro.
  insert into public.external_brand_alta (account_id, source, external_org_id, external_brand_name, brand_id, created_by_name)
  values (a, 'lastapp', org, 'Pollería de Prueba', marca, 'semilla F01c')
  on conflict (account_id, source, external_org_id, external_brand_name) do nothing;
  insert into public.external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id, is_ignored)
  values (a, 'lastapp', t1::text, 'f01c-pp-1', marca, false)
  on conflict (account_id, source, external_location_id, external_brand_id) do nothing;

  raise notice 'Semilla F01c OK: «Pollería de Prueba» (6 platos: 3 con receta, 1 del almacén, Alitas sin receta, Croquetas sin artículo), «Pollería Express» (idéntica) y «Pollos Nuevos» (se parece) en Last (cuenta A).';
end $$;

create or replace function public.e2e_f01c_preparar(p_que text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org      constant uuid := 'f01c2e00-0000-4000-8000-0000000000a0';
  v_cuenta uuid;
  v_marca  uuid;
  v_alitas uuid;
  v_t1     text;
  v_t2     text;
  v_centro uuid;
  v_merc   uuid;
  v_sesion uuid;
  v_solas  jsonb;
  v_n      integer := 0;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'e2e_f01c_preparar: esta base tiene cuentas de producción.';
  end if;
  if p_que not in ('empezar', 'pasada', 'limpiar') then raise exception 'e2e_f01c_preparar: «empezar», «pasada» o «limpiar».'; end if;
  -- La cuenta del que llama: la A de la plantilla o la de su carril, la que tiene la carta de prueba.
  select up.account_id into v_cuenta from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin'
     and exists (select 1 from public.external_integration ei where ei.account_id = up.account_id and ei.external_org_id = org)
   limit 1;
  if v_cuenta is null then raise exception 'e2e_f01c_preparar: solo el administrador de la cuenta con la carta de prueba.' using errcode = '42501'; end if;

  if p_que = 'pasada' then
    v_solas := public._f01c_reconocer_solas(v_cuenta);
    return jsonb_build_object('cuenta', v_cuenta, 'reconocidas_solas', v_solas);
  end if;

  select b.id into v_marca from public.brand b where b.account_id = v_cuenta and b.name = 'Pollería de Prueba' and b.archived_at is null limit 1;
  -- Las tiendas de Last de la prueba en esta cuenta (en un carril tienen otro id).
  select max(e.external_location_id::text) filter (where e.external_brand_name = 'Pollería de Prueba'),
         max(e.external_location_id::text) filter (where e.external_brand_name = 'Pollos Nuevos')
    into v_t1, v_t2
    from public.external_catalog_product e where e.account_id = v_cuenta and e.external_org_id = org;
  select lm.location_id into v_centro from public.external_location_map lm where lm.account_id = v_cuenta and lm.source = 'lastapp' and lm.external_location_id = v_t1;
  select lm.location_id into v_merc from public.external_location_map lm where lm.account_id = v_cuenta and lm.source = 'lastapp' and lm.external_location_id = v_t2;

  -- Express y Nuevos, sin unir: sin alta, sin vínculos, sin avisos ni decisiones.
  delete from public.external_brand_alta where account_id = v_cuenta and external_org_id = org and external_brand_name <> 'Pollería de Prueba';
  delete from public.external_brand_map where account_id = v_cuenta and source = 'lastapp' and external_brand_id in ('f01c-px-2', 'f01c-pn-3');
  delete from public.f01_marca_reconocida where account_id = v_cuenta and external_org_id = org;
  delete from public.brand_location_availability where account_id = v_cuenta and brand_id = v_marca and location_id is distinct from v_centro;
  -- Lo que la unión sembró en la carta (las matrículas de Pollos Nuevos),
  -- archivado y con la matrícula apartada: el sembrado no resucita una archivada,
  -- y la pasada siguiente tiene que poder volver a sembrarla.
  update public.menu_item set archived_at = coalesce(archived_at, now()), external_id = external_id || '-e2e-' || id::text, updated_at = now()
   where account_id = v_cuenta and brand_id = v_marca and external_id not like '%-e2e-%'
     and external_id not in (select distinct e.organization_product_id::text from public.external_catalog_product e
                              where e.account_id = v_cuenta and e.external_org_id = org and e.external_brand_name = 'Pollería de Prueba');
  -- Alitas, otra vez sin receta; Croquetas, otra vez sin artículo.
  select mi.recipe_item_id into v_alitas from public.menu_item mi
   where mi.account_id = v_cuenta and mi.brand_id = v_marca and mi.name = 'Alitas de Prueba' and mi.archived_at is null limit 1;
  delete from public.recipe_line where account_id = v_cuenta and parent_item_id = v_alitas;
  update public.menu_item set recipe_item_id = null, updated_at = now()
   where account_id = v_cuenta and brand_id = v_marca and name = 'Croquetas de Prueba' and recipe_item_id is not null;
  delete from public.f01_receta_puesta where account_id = v_cuenta
     and recipe_item_id in (select mi.recipe_item_id from public.menu_item mi where mi.account_id = v_cuenta and mi.brand_id = v_marca);
  -- Las ventas de pasadas anteriores, anuladas (no se borran: lo que cuelga de ellas sigue en pie).
  update public.sale set is_active = false, status = 'cancelled', updated_at = now()
   where account_id = v_cuenta and source = 'lastapp' and external_ref like 'f01c-e2e-%' and is_active;
  update public.sale set external_ref = external_ref || '-' || id::text
   where account_id = v_cuenta and source = 'lastapp' and external_ref like 'f01c-e2e-%' and external_ref not like ('%-' || id::text);
  update public.external_catalog_product set seen_in_catalog_at = now(), missing_since = null, last_synced_at = now()
   where account_id = v_cuenta and external_org_id = org;

  if p_que = 'empezar' then
    insert into public.sale (account_id, location_id, brand_id, source, sold_at, status, order_status, total, is_active,
                             external_ref, external_brand_text, external_location_text, raw_products, raw_tab)
    select v_cuenta, x.loc, x.marca, 'lastapp', now(), 'open', 'accepted', x.cents / 100.0, true,
           'f01c-e2e-' || x.n, x.codigo, x.tienda,
           jsonb_build_array(jsonb_build_object('name', x.plato, 'quantity', 1, 'price', x.cents,
                                                'organizationProductId', 'f01c2e00-0000-4000-8000-0000000001' || x.mat))::text, '{}'
      from (values (1, v_centro, v_marca, 'f01c-pp-1', v_t1, 'Alitas de Prueba', 750, 'd5'),
                   (2, v_merc, null::uuid, 'f01c-px-2', v_t2, 'Pollo asado de Prueba', 1250, 'd1'),
                   (3, v_merc, null::uuid, 'f01c-pn-3', v_t2, 'Pollo asado de Prueba', 1250, 'e1'),
                   (4, v_merc, null::uuid, 'f01c-pn-3', v_t2, 'Wrap de Pollo', 850, 'e4')) x(n, loc, marca, codigo, tienda, plato, cents, mat);
    get diagnostics v_n = row_count;
    -- Cada venta, casada como la casaría el pedido.
    perform public.reprocess_sale(s.id) from public.sale s
     where s.account_id = v_cuenta and s.source = 'lastapp' and s.external_ref like 'f01c-e2e-_' and s.is_active;

    -- La lectura de «Alitas de Prueba» (como la deja extract-recipe), por confirmar.
    insert into public.recipe_item_ai_session (account_id, kind, status, input_text, parsed_result, ai_model)
    values (v_cuenta, 'conversational', 'pending_review', 'Alitas de Prueba: 1 ud de pan de hamburguesa',
            jsonb_build_object('dish', jsonb_build_object('name', 'Alitas de Prueba', 'brand', 'Pollería de Prueba'),
                               'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Pan de hamburguesa', 'quantity', 1, 'unit', 'ud'))),
            'e2e (sin IA)')
    returning id into v_sesion;
  end if;
  return jsonb_build_object('cuenta', v_cuenta, 'marca', v_marca, 'ventas', v_n, 'sesion', v_sesion);
end $$;
revoke all on function public.e2e_f01c_preparar(text) from public, anon;
grant execute on function public.e2e_f01c_preparar(text) to authenticated;
