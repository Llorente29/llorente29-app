-- SEMILLA · TPV Sala · staging-conta (oseymswjlzplqoxrfjzi). NUNCA en producción.
--
-- Una carta mínima para ensayar la Sala con los caminos de verdad (regla 10):
-- la marca «Casa Lola» en «Taberna de Prueba Norte · Norte Centro», tres
-- productos con escandallo (una materia prima cada uno) para que el consumo
-- escriba movimientos de stock, y una impresora de cocina+tickets.
--
-- Idempotente: ids fijos y `on conflict do nothing`.

do $$
begin
  -- Guarda: solo en staging. En staging no hay ni Foodint ni Folvy Interno.
  if exists (select 1 from public.accounts where id = '00000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.accounts where name ilike 'foodint%') then
    raise exception 'seed_tpv_sala_staging: esto parece producción (hay Folvy Interno o Foodint). Parar.';
  end if;
  if not exists (select 1 from public.locations where id = 'c01a0000-0000-4000-8000-0000000000a2') then
    raise exception 'seed_tpv_sala_staging: falta el local de prueba Norte Centro. Parar.';
  end if;
end $$;

-- Marca y su disponibilidad en el local
insert into public.brand (id, account_id, name, slug, color, is_active)
values ('7e000000-0000-4000-8000-000000000b01', 'c01a0000-0000-4000-8000-00000000000a', 'Casa Lola', 'casa-lola', '#D97706', true)
on conflict (id) do nothing;

insert into public.brand_location_availability (account_id, brand_id, location_id, is_active)
select 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000b01', 'c01a0000-0000-4000-8000-0000000000a2', true
where not exists (select 1 from public.brand_location_availability
                  where brand_id = '7e000000-0000-4000-8000-000000000b01' and location_id = 'c01a0000-0000-4000-8000-0000000000a2');

-- Materias primas (en unidades) y platos con su escandallo
insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_stockable, cost_strategy, fixed_cost) values
  ('7e000000-0000-4000-8000-000000000a01', 'c01a0000-0000-4000-8000-00000000000a', 'raw',  'Cerveza de barril (caña)', 'c1b0a000-0000-4000-8000-000000000104', true, 'fixed', 0.60),
  ('7e000000-0000-4000-8000-000000000a02', 'c01a0000-0000-4000-8000-00000000000a', 'raw',  'Secreto ibérico (ración)', 'c1b0a000-0000-4000-8000-000000000104', true, 'fixed', 5.20),
  ('7e000000-0000-4000-8000-000000000a03', 'c01a0000-0000-4000-8000-00000000000a', 'raw',  'Tarta de queso (porción)', 'c1b0a000-0000-4000-8000-000000000104', true, 'fixed', 1.40),
  ('7e000000-0000-4000-8000-000000000d01', 'c01a0000-0000-4000-8000-00000000000a', 'dish', 'Caña',                     'c1b0a000-0000-4000-8000-000000000104', false, 'fixed', null),
  ('7e000000-0000-4000-8000-000000000d02', 'c01a0000-0000-4000-8000-00000000000a', 'dish', 'Secreto ibérico',          'c1b0a000-0000-4000-8000-000000000104', false, 'fixed', null),
  ('7e000000-0000-4000-8000-000000000d03', 'c01a0000-0000-4000-8000-00000000000a', 'dish', 'Tarta de queso',           'c1b0a000-0000-4000-8000-000000000104', false, 'fixed', null)
on conflict (id) do nothing;

insert into public.recipe_line (id, account_id, parent_item_id, child_item_id, quantity_net, unit_id) values
  ('7e000000-0000-4000-8000-000000000c01', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000d01', '7e000000-0000-4000-8000-000000000a01', 1, 'c1b0a000-0000-4000-8000-000000000104'),
  ('7e000000-0000-4000-8000-000000000c02', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000d02', '7e000000-0000-4000-8000-000000000a02', 1, 'c1b0a000-0000-4000-8000-000000000104'),
  ('7e000000-0000-4000-8000-000000000c03', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000d03', '7e000000-0000-4000-8000-000000000a03', 1, 'c1b0a000-0000-4000-8000-000000000104')
on conflict (id) do nothing;

-- Carta
insert into public.menu_item (id, account_id, brand_id, recipe_item_id, name, category, price, vat_rate, product_type, is_active) values
  ('7e000000-0000-4000-8000-000000000e01', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000b01', '7e000000-0000-4000-8000-000000000d01', 'Caña',            'Bebidas',      2.50, 10, 'item', true),
  ('7e000000-0000-4000-8000-000000000e02', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000b01', '7e000000-0000-4000-8000-000000000d02', 'Secreto ibérico', 'Principales', 17.50, 10, 'item', true),
  ('7e000000-0000-4000-8000-000000000e03', 'c01a0000-0000-4000-8000-00000000000a', '7e000000-0000-4000-8000-000000000b01', '7e000000-0000-4000-8000-000000000d03', 'Tarta de queso',  'Postres',      5.50, 10, 'item', true)
on conflict (id) do nothing;

-- Impresora de cocina y tickets del local (sin IP real: el trabajo queda en cola)
insert into public.printer (id, account_id, location_id, name, transport, doc_types, config, is_active)
values ('7e000000-0000-4000-8000-000000000f01', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
        'Cocina (staging)', 'escpos_network', array['kitchen','bag'], '{"ip":"10.0.0.250","port":9100}', true)
on conflict (id) do nothing;
