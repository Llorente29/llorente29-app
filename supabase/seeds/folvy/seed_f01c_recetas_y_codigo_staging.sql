-- ============================================================================
-- F01 · PR 3 · La carta de Last de prueba de las recetas que faltan (tablero 3)
-- y del código cambiado (tablero 4). SOLO STAGING. Necesita la 0850.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/marcas/recetas-y-codigo.spec.ts, en la cuenta A. DOS JUEGOS
-- que no se tocan, uno para el ordenador y otro para el móvil, porque las dos
-- pasadas corren A LA VEZ sobre la misma cuenta (Respuesta 10: con un solo
-- juego, cada una contaba las ventas de la otra). El del móvil lleva « M»
-- detrás de cada nombre, y su propia cuenta de Last, sus tiendas y sus ids.
-- Cada juego, con su cuenta de Last («Cocina Propia de Prueba», encendida) y
-- dos tiendas: una en Norte Centro y otra en Norte Mercado.
--   · «Pollería de Prueba», ya dada de alta en Folvy y vinculada en Norte
--     Centro. Su carta: Pollo asado, Muslitos y Pechuga, con receta; el Agua,
--     del almacén; «Alitas de Prueba», con el plato vacío (sin receta), y
--     «Croquetas de Prueba», sin artículo todavía.
--   · «Pollería Express» llega a Norte Mercado con OTRO código y la carta
--     IDÉNTICA (las mismas 6 matrículas): la pasada la une sola y avisa.
--   · «Pollos Nuevos» llega a Norte Mercado con otro código y una carta que
--     solo SE PARECE (3 de sus 4 platos se llaman como los de la Pollería, con
--     otras matrículas, y un Wrap que no está): se pregunta.
--   Y en el almacén de A, «Alitas de pollo» (por unidades): lo que lleva la
--   receta de Alitas que lee la prueba.
--
--   e2e_f01c_preparar(p_que, p_juego): la prueba no tiene la clave de servicio,
--   y cada pasada tiene que empezar SIEMPRE igual, la lance quien la lance y
--   cuantas veces sea. Esta función —que SOLO existe en staging, por esta
--   semilla— se la deja usar al administrador de A (el de la plantilla o el de
--   su carril), solo en SU cuenta y solo en el juego que nombra ('ordenador' o
--   'movil'):
--     · 'empezar' deja la carta como al principio (sin unir Express ni Nuevos,
--                 Alitas sin receta, Croquetas sin artículo), BORRA las ventas
--                 de la prueba de pasadas anteriores (no las anula: una anulada
--                 se seguía contando) y pone las de esta, vendidas ahora: 1 de
--                 Alitas, 1 de Express y 2 de Pollos Nuevos (estas tres, sin
--                 marca). Devuelve la lectura de «Alitas de Prueba» que la
--                 prueba hace pasar por la de Cocina (una sesión de
--                 extract-recipe, sin llamar a la IA): 6 ud de alitas de pollo;
--     · 'pasada'  lo que hace la pasada de cada hora con las de carta idéntica
--                 (_f01c_reconocer_solas, de la 0850);
--     · 'limpiar' lo mismo que 'empezar', sin ventas ni lectura.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta la
-- cuenta A o sus locales. Se puede volver a aplicar.
-- ============================================================================

do $$
declare
  a       constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  centro  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  mercado constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  ud      constant uuid := 'c1b0a000-0000-4000-8000-000000000104';
  pan     constant uuid := 'c1b0a000-0000-4000-8000-000000000203';
  agua    constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
  j       record;
  org     uuid;
  t1      uuid;
  t2      uuid;
  marca   uuid;
  -- El principio de los ids del juego: el segundo grupo dice cuál (0000 ordenador, 0001 móvil).
  pre     text;
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

  -- Lo que lleva la receta de Alitas que lee la prueba.
  insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_active, cost_strategy, fixed_cost, created_by_name)
  values ('f01c2e00-0000-4000-8000-000000000205', a, 'raw', 'Alitas de pollo', ud, true, 'fixed', 0.35, 'semilla F01c')
  on conflict (id) do nothing;

  for j in select * from (values ('0000', '', 'f01c'), ('0001', ' M', 'f01c-m')) x(g, suf, cod) loop
    pre := 'f01c2e00-' || j.g || '-4000-8000-';
    org := (pre || '0000000000a0')::uuid;
    t1 := (pre || '0000000000e1')::uuid;
    t2 := (pre || '0000000000e2')::uuid;
    marca := (pre || '0000000000b1')::uuid;

    if not exists (select 1 from public.external_integration where account_id = a and source = 'lastapp' and external_org_id = org) then
      -- Sin secreto detrás: ninguna prueba llama a Last.
      insert into public.external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active, token_secret_name)
      values (a, 'lastapp', org, 'Cocina Propia de Prueba' || j.suf, 'own', true, 'e2e_last_token_prueba');
    end if;
    insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active)
    select a, 'lastapp', x.ext, x.loc, true
      from (values (t1::text, centro), (t2::text, mercado)) x(ext, loc)
     where not exists (select 1 from public.external_location_map m where m.account_id = a and m.source = 'lastapp' and m.external_location_id = x.ext);

    -- La marca de Folvy y sus platos.
    insert into public.brand (id, account_id, name, slug, ownership_type, is_active, catalog_source, created_by_name)
    values (marca, a, 'Pollería de Prueba' || j.suf, 'polleria-de-prueba' || case when j.suf = '' then '' else '-m' end, 'own', true, 'pos', 'semilla F01c')
    on conflict (id) do nothing;
    insert into public.brand_location_availability (account_id, brand_id, location_id, is_active, active_since, notes)
    values (a, marca, centro, true, current_date, 'semilla F01c')
    on conflict (account_id, brand_id, location_id) do nothing;
    insert into public.brand_channel (account_id, brand_id, channel_id, is_active, created_by_name)
    select a, marca, sc.id, true, 'semilla F01c' from public.sales_channel sc where sc.account_id = a and sc.slug in ('uber', 'glovo')
    on conflict (brand_id, channel_id) do nothing;

    insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_active, source, created_by_name)
    select (pre || x.k)::uuid, a, 'dish', x.nombre || j.suf, ud, true, 'import', 'semilla F01c'
      from (values ('0000000002d1', 'Pollo asado de Prueba'), ('0000000002d2', 'Muslitos de Prueba'),
                   ('0000000002d3', 'Pechuga de Prueba'), ('0000000002d5', 'Alitas de Prueba')) x(k, nombre)
    on conflict (id) do nothing;
    insert into public.recipe_line (id, account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
    select (pre || x.k)::uuid, a, (pre || x.p)::uuid, pan, 1, ud, 1
      from (values ('0000000003d1', '0000000002d1'), ('0000000003d2', '0000000002d2'), ('0000000003d3', '0000000002d3')) x(k, p)
    on conflict (id) do nothing;

    -- Las 6 matrículas de la Pollería (la misma carta en Uber y Glovo).
    insert into public.menu_item (id, account_id, brand_id, recipe_item_id, name, price, product_type, external_source, external_id, source, created_by_name)
    select (pre || x.k)::uuid, a, marca, x.ri, x.nombre || case when x.ri = agua then '' else j.suf end, x.precio, 'item', 'lastapp',
           pre || x.mat, 'import', 'semilla F01c'
      from (values ('0000000004d1', (pre || '0000000002d1')::uuid, 'Pollo asado de Prueba', 12.5, '0000000001d1'),
                   ('0000000004d2', (pre || '0000000002d2')::uuid, 'Muslitos de Prueba', 8.9, '0000000001d2'),
                   ('0000000004d3', (pre || '0000000002d3')::uuid, 'Pechuga de Prueba', 9.9, '0000000001d3'),
                   ('0000000004d4', agua, 'Agua mineral 50 cl', 2.0, '0000000001d4'),
                   ('0000000004d5', (pre || '0000000002d5')::uuid, 'Alitas de Prueba', 7.5, '0000000001d5'),
                   ('0000000004d6', null::uuid, 'Croquetas de Prueba', 6.5, '0000000001d6')) x(k, ri, nombre, precio, mat)
    on conflict (id) do nothing;

    -- Las cartas de Last: la Pollería en Norte Centro; Express (idéntica) y
    -- Pollos Nuevos (se parece) en Norte Mercado, cada una con su código.
    -- Las matrículas de la Pollería (0xd1…0xd6) son las de sus platos en Folvy.
    insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
         external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
         external_location_id, seen_in_catalog_at, is_enabled, last_synced_at)
    select a, 'lastapp', org,
           ('f01c2e00-' || lpad(to_hex(x.n), 4, '0') || '-40' || right(j.g, 2) || '-8000-' || lpad(to_hex(c.i * 16 + m.k), 12, '0'))::uuid,
           (pre || '0000000001' || lpad(to_hex(x.n), 2, '0'))::uuid,
           m.marca || j.suf, j.cod || m.codigo, x.nombre || case when x.nombre = 'Agua mineral 50 cl' then '' else j.suf end,
           x.cents, 'PRODUCT', c.ch, array[c.ch], m.tienda, now(), true, now()
      from (values (209, 'Pollo asado de Prueba', 1250, 'pp'), (210, 'Muslitos de Prueba', 890, 'pp'), (211, 'Pechuga de Prueba', 990, 'pp'),
                   (212, 'Agua mineral 50 cl', 200, 'pp'), (213, 'Alitas de Prueba', 750, 'pp'), (214, 'Croquetas de Prueba', 650, 'pp'),
                   (225, 'Pollo asado de Prueba', 1250, 'pn'), (226, 'Muslitos de Prueba', 890, 'pn'), (227, 'Pechuga de Prueba', 990, 'pn'),
                   (228, 'Wrap de Pollo', 850, 'pn')) x(n, nombre, cents, de)
      cross join (values (1, 'uber'), (2, 'glovo')) c(i, ch)
      join (values (1, 'Pollería de Prueba', '-pp-1', t1, 'pp'), (2, 'Pollería Express', '-px-2', t2, 'pp'),
                   (3, 'Pollos Nuevos', '-pn-3', t2, 'pn')) m(k, marca, codigo, tienda, de) on m.de = x.de
    on conflict (account_id, source, catalog_product_id, external_location_id) do nothing;

    -- La Pollería, ya dada de alta y vinculada en Norte Centro.
    insert into public.external_brand_alta (account_id, source, external_org_id, external_brand_name, brand_id, created_by_name)
    values (a, 'lastapp', org, 'Pollería de Prueba' || j.suf, marca, 'semilla F01c')
    on conflict (account_id, source, external_org_id, external_brand_name) do nothing;
    insert into public.external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id, is_ignored)
    values (a, 'lastapp', t1::text, j.cod || '-pp-1', marca, false)
    on conflict (account_id, source, external_location_id, external_brand_id) do nothing;
  end loop;

  raise notice 'Semilla F01c OK: dos juegos (ordenador y móvil, « M») de «Pollería de Prueba» (6 platos: 3 con receta, 1 del almacén, Alitas sin receta, Croquetas sin artículo), «Pollería Express» (idéntica) y «Pollos Nuevos» (se parece) en Last (cuenta A).';
end $$;

-- La de antes tenía un solo argumento: se quita, y no queda una sobrecarga
-- (regla 2 de CLAUDE.md).
drop function if exists public.e2e_f01c_preparar(text);

create or replace function public.e2e_f01c_preparar(p_que text, p_juego text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g      text;
  v_suf    text;
  v_cod    text;
  v_org    uuid;
  v_cuenta uuid;
  v_marca  uuid;
  v_alitas uuid;
  v_t1     text;
  v_t2     text;
  v_centro uuid;
  v_merc   uuid;
  v_sesion uuid;
  v_solas  jsonb;
  v_borradas integer := 0;
  v_n      integer := 0;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'e2e_f01c_preparar: esta base tiene cuentas de producción.';
  end if;
  if p_que not in ('empezar', 'pasada', 'limpiar') then raise exception 'e2e_f01c_preparar: «empezar», «pasada» o «limpiar».'; end if;
  if p_juego not in ('ordenador', 'movil') then raise exception 'e2e_f01c_preparar: el juego es «ordenador» o «movil».'; end if;
  v_g := case p_juego when 'ordenador' then '0000' else '0001' end;
  v_suf := case p_juego when 'ordenador' then '' else ' M' end;
  v_cod := case p_juego when 'ordenador' then 'f01c' else 'f01c-m' end;
  v_org := ('f01c2e00-' || v_g || '-4000-8000-0000000000a0')::uuid;

  -- La cuenta del que llama: la A de la plantilla o la de su carril, la que tiene la carta de prueba.
  select up.account_id into v_cuenta from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin'
     and exists (select 1 from public.external_integration ei where ei.account_id = up.account_id and ei.external_org_id = v_org)
   limit 1;
  if v_cuenta is null then raise exception 'e2e_f01c_preparar: solo el administrador de la cuenta con la carta de prueba.' using errcode = '42501'; end if;

  if p_que = 'pasada' then
    -- Solo las de este juego: lo que la pasada une en el otro no es de esta prueba.
    select coalesce(jsonb_agg(public._f01c_unir(v_cuenta, c.org, c.nombre, (c.comparacion->>'brand_id')::uuid, 'sola', c.comparacion, null, null)), '[]'::jsonb)
      into v_solas
      from public._f01c_candidatas(v_cuenta) c
     where c.org = v_org and (c.comparacion->>'identica')::boolean;
    return jsonb_build_object('cuenta', v_cuenta, 'juego', p_juego, 'reconocidas_solas', v_solas);
  end if;

  select b.id into v_marca from public.brand b where b.account_id = v_cuenta and b.name = 'Pollería de Prueba' || v_suf and b.archived_at is null limit 1;
  -- Las tiendas de Last de la prueba en esta cuenta (en un carril tienen otro id).
  select max(e.external_location_id::text) filter (where e.external_brand_name = 'Pollería de Prueba' || v_suf),
         max(e.external_location_id::text) filter (where e.external_brand_name = 'Pollos Nuevos' || v_suf)
    into v_t1, v_t2
    from public.external_catalog_product e where e.account_id = v_cuenta and e.external_org_id = v_org;
  select lm.location_id into v_centro from public.external_location_map lm where lm.account_id = v_cuenta and lm.source = 'lastapp' and lm.external_location_id = v_t1;
  select lm.location_id into v_merc from public.external_location_map lm where lm.account_id = v_cuenta and lm.source = 'lastapp' and lm.external_location_id = v_t2;

  -- Express y Nuevos, sin unir: sin alta, sin vínculos, sin avisos ni decisiones.
  delete from public.external_brand_alta where account_id = v_cuenta and external_org_id = v_org and external_brand_name <> 'Pollería de Prueba' || v_suf;
  delete from public.external_brand_map where account_id = v_cuenta and source = 'lastapp' and external_brand_id in (v_cod || '-px-2', v_cod || '-pn-3');
  delete from public.f01_marca_reconocida where account_id = v_cuenta and external_org_id = v_org;
  delete from public.brand_location_availability where account_id = v_cuenta and brand_id = v_marca and location_id is distinct from v_centro;
  -- Lo que la unión sembró en la carta (las matrículas de Pollos Nuevos),
  -- archivado y con la matrícula apartada: el sembrado no resucita una archivada,
  -- y la pasada siguiente tiene que poder volver a sembrarla.
  update public.menu_item set archived_at = coalesce(archived_at, now()), external_id = external_id || '-e2e-' || id::text, updated_at = now()
   where account_id = v_cuenta and brand_id = v_marca and external_id not like '%-e2e-%'
     and external_id not in (select distinct e.organization_product_id::text from public.external_catalog_product e
                              where e.account_id = v_cuenta and e.external_org_id = v_org and e.external_brand_name = 'Pollería de Prueba' || v_suf);
  -- Alitas, otra vez sin receta; Croquetas, otra vez sin artículo.
  select mi.recipe_item_id into v_alitas from public.menu_item mi
   where mi.account_id = v_cuenta and mi.brand_id = v_marca and mi.name = 'Alitas de Prueba' || v_suf and mi.archived_at is null limit 1;
  delete from public.recipe_line where account_id = v_cuenta and parent_item_id = v_alitas;
  update public.menu_item set recipe_item_id = null, updated_at = now()
   where account_id = v_cuenta and brand_id = v_marca and name = 'Croquetas de Prueba' || v_suf and recipe_item_id is not null;
  delete from public.f01_receta_puesta where account_id = v_cuenta
     and recipe_item_id in (select mi.recipe_item_id from public.menu_item mi where mi.account_id = v_cuenta and mi.brand_id = v_marca);
  -- Las ventas de pasadas anteriores de este juego, BORRADAS (con lo que
  -- descontaron): una anulada se seguía contando y las cifras crecían.
  delete from public.stock_movement sm
   where sm.account_id = v_cuenta and sm.source_type = 'sale'
     and sm.source_id in (select s.id from public.sale s where s.account_id = v_cuenta and s.source = 'lastapp' and s.external_ref like 'f01c-e2e-' || p_juego || '-%');
  delete from public.sale s where s.account_id = v_cuenta and s.source = 'lastapp' and s.external_ref like 'f01c-e2e-' || p_juego || '-%';
  get diagnostics v_borradas = row_count;
  update public.external_catalog_product set seen_in_catalog_at = now(), missing_since = null, last_synced_at = now()
   where account_id = v_cuenta and external_org_id = v_org;

  if p_que = 'empezar' then
    insert into public.sale (account_id, location_id, brand_id, source, sold_at, status, order_status, total, is_active,
                             external_ref, external_brand_text, external_location_text, raw_products, raw_tab)
    select v_cuenta, x.loc, x.marca, 'lastapp', now(), 'open', 'accepted', x.cents / 100.0, true,
           'f01c-e2e-' || p_juego || '-' || x.n, x.codigo, x.tienda,
           jsonb_build_array(jsonb_build_object('name', x.plato || v_suf, 'quantity', 1, 'price', x.cents,
                                                'organizationProductId', 'f01c2e00-' || v_g || '-4000-8000-0000000001' || x.mat))::text, '{}'
      from (values (1, v_centro, v_marca, v_cod || '-pp-1', v_t1, 'Alitas de Prueba', 750, 'd5'),
                   (2, v_merc, null::uuid, v_cod || '-px-2', v_t2, 'Pollo asado de Prueba', 1250, 'd1'),
                   (3, v_merc, null::uuid, v_cod || '-pn-3', v_t2, 'Pollo asado de Prueba', 1250, 'e1'),
                   (4, v_merc, null::uuid, v_cod || '-pn-3', v_t2, 'Wrap de Pollo', 850, 'e4')) x(n, loc, marca, codigo, tienda, plato, cents, mat);
    get diagnostics v_n = row_count;
    -- Cada venta, casada como la casaría el pedido.
    perform public.reprocess_sale(s.id) from public.sale s
     where s.account_id = v_cuenta and s.source = 'lastapp' and s.external_ref like 'f01c-e2e-' || p_juego || '-_';

    -- La lectura de «Alitas de Prueba» (como la deja extract-recipe), por confirmar.
    insert into public.recipe_item_ai_session (account_id, kind, status, input_text, parsed_result, ai_model)
    values (v_cuenta, 'conversational', 'pending_review', 'Alitas de Prueba' || v_suf || ': 6 ud de alitas de pollo',
            jsonb_build_object('dish', jsonb_build_object('name', 'Alitas de Prueba' || v_suf, 'brand', 'Pollería de Prueba' || v_suf),
                               'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Alitas de pollo', 'quantity', 6, 'unit', 'ud'))),
            'e2e (sin IA)')
    returning id into v_sesion;
  end if;
  return jsonb_build_object('cuenta', v_cuenta, 'juego', p_juego, 'marca', v_marca, 'ventas', v_n, 'borradas', v_borradas, 'sesion', v_sesion);
end $$;
revoke all on function public.e2e_f01c_preparar(text, text) from public, anon;
grant execute on function public.e2e_f01c_preparar(text, text) to authenticated;
