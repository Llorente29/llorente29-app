-- scripts/video/albaran-sembrar.sql — V02 · lo que el vídeo de Folvy necesita, en la cuenta A del CARRIL.
--
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -v cuenta=<uuid> -f scripts/video/albaran-sembrar.sql
--
-- SOLO STAGING y solo en el carril del run (se borra entero al acabar). Para si
-- la cuenta es la plantilla. Datos inventados que parecen de verdad (T11): un
-- proveedor de frutas y verduras con NIF de ceros, y cuatro artículos de compra
-- con su formato y su código en el catálogo del proveedor, para que el asistente
-- de recepción case cada línea del albarán sola. La oficina aprueba aparte.

\set ON_ERROR_STOP 1
select set_config('video.cuenta', :'cuenta', false);
-- Los disparadores de Folvy (el coste de un artículo al cambiar su catálogo) miran quién lo pide:
-- la persona administradora de A del carril (su id es el de la cuenta con «a1» al final), como en la app.
select set_config('request.jwt.claims', json_build_object('sub', regexp_replace(:'cuenta', '00000000000a$', '0000000000a1'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', regexp_replace(:'cuenta', '00000000000a$', '0000000000a1'), true);

do $$
declare
  c uuid := current_setting('video.cuenta')::uuid;
  prov uuid; u_kg uuid; u_l uuid; u_ud uuid; it uuid; fmt uuid; x record;
begin
  if split_part(c::text, '-', 2) = '0000' then raise exception 'V02: % es la plantilla, no un carril. No se siembra nada.', c; end if;
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'V02: esta base tiene cuentas de producción. No se siembra nada.';
  end if;

  -- El proveedor: el «Hermanos Ruiz» de la plantilla, con nombre de frutería y NIF de ceros.
  select id into prov from public.supplier where account_id = c and name = 'Hermanos Ruiz';
  if prov is null then raise exception 'V02: no está «Hermanos Ruiz» en el carril.'; end if;
  update public.supplier set tax_id = null where account_id = c and tax_id = 'B00000018' and id <> prov;
  update public.supplier set name = 'Frutas y Verduras La Huerta', legal_name = 'Frutas y Verduras La Huerta, S.L.', tax_id = 'B00000018' where id = prov;

  select id into u_kg from public.kitchen_unit where account_id = c and abbreviation = 'kg' order by is_base desc limit 1;
  select id into u_l  from public.kitchen_unit where account_id = c and abbreviation = 'l'  order by is_base desc limit 1;
  select id into u_ud from public.kitchen_unit where account_id = c and abbreviation = 'ud' order by is_base desc limit 1;
  if u_kg is null or u_l is null or u_ud is null then raise exception 'V02: faltan las unidades kg, l o ud en la cuenta del carril.'; end if;

  -- Los cuatro artículos, su formato de compra y su fila en el catálogo del proveedor. El precio del
  -- catálogo va por unidad de base (kg, l, ud). La patata, a 0,70 €/kg: en el albarán llega a 0,75 (+7 %).
  for x in select * from (values
      ('Tomate pera',            'kg', 'Caja 10 kg',   10::numeric, 'TOM-10', 'Tomate pera, caja 10 kg',              1.49::numeric),
      ('Lechuga romana',         'ud', 'Caja 12 ud',   12::numeric, 'LEC-12', 'Lechuga romana, caja 12 ud',           0.95::numeric),
      ('Patata agria',           'kg', 'Saco 25 kg',   25::numeric, 'PAT-25', 'Patata agria, saco 25 kg',             0.70::numeric),
      ('Aceite de oliva virgen', 'l',  'Garrafa 5 l',   5::numeric, 'ACE-05', 'Aceite de oliva virgen extra, garrafa 5 l', 6.90::numeric)
    ) as t(nombre, unidad, formato, en_base, codigo, en_albaran, precio)
  loop
    select id into it from public.recipe_item where account_id = c and name = x.nombre and type = 'raw' limit 1;
    if it is null then
      insert into public.recipe_item (account_id, type, name, base_unit_id, cost_strategy, is_purchasable, is_stockable, source, created_by_name)
      values (c, 'raw', x.nombre, case x.unidad when 'kg' then u_kg when 'l' then u_l else u_ud end, 'last_purchase', true, true, 'manual', 'Vídeo V02')
      returning id into it;
    end if;
    update public.recipe_item set is_purchasable = true, is_stockable = true,
           alt_names = (select array(select distinct e from unnest(coalesce(alt_names, '{}'::text[]) || array[x.en_albaran]) e)),
           supplier_codes = coalesce(supplier_codes, '{}'::jsonb) || jsonb_build_object(prov::text, x.codigo)
     where id = it;
    select id into fmt from public.recipe_item_purchase_format where item_id = it and name = x.formato and account_id = c limit 1;
    if fmt is null then
      insert into public.recipe_item_purchase_format (account_id, item_id, name, qty_in_base, is_piece, is_weighted, source, is_active, created_by_name, use_in_count)
      values (c, it, x.formato, x.en_base, true, false, 'manual', true, 'Vídeo V02', true)
      returning id into fmt;
    end if;
    update public.article_supplier set supplier_code = x.codigo, supplier_item_name = x.en_albaran, last_price = x.precio,
           purchase_format_id = fmt, is_preferred = true, is_active = true
     where account_id = c and supplier_id = prov and recipe_item_id = it;
    if not found then
      insert into public.article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, supplier_item_name, last_price, purchase_format_id, is_preferred, is_active, source)
      values (c, it, prov, x.codigo, x.en_albaran, x.precio, fmt, true, true, 'manual');
    end if;
  end loop;

  -- El local y la cuenta, con nombre de bar (el de la cabecera y el de «Entregar en»).
  update public.locations set name = 'Taberna del Mercado' where account_id = c and name = 'Norte Centro';
  update public.accounts set name = 'Taberna del Mercado' where id = c;

  -- La oficina aprueba aparte: la recepción de cocina queda esperándola.
  update public.supply_settings set require_separate_approval = true where account_id = c;
  if not found then
    insert into public.supply_settings (account_id, require_separate_approval, created_by_name) values (c, true, 'Vídeo V02');
  end if;
end $$;
