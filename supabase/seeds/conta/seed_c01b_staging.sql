-- supabase/seeds/conta/seed_c01b_staging.sql
--
-- C01b · Los casos de la ficha de proveedor que faltaban en staging-conta
-- (comprobaciones previas §5). SOLO STAGING. Datos inventados con la forma de
-- los reales; nada copiado de producción. Se puede volver a lanzar: ids fijos
-- y «on conflict do nothing».
--
-- Cuenta A (Taberna de Prueba Norte):
--   · Unidades de cocina (kg, g, l, ud): staging no tenía ninguna.
--   · 4 artículos que se compran, con su proveedor, precio y principal
--     («Artículos que le compras» y «Migrar artículos»).
--   · Un plato con escandallo (Hamburguesa de prueba): sin él, la prueba de
--     clonado de migrate_kitchen_core no copiaría ningún proveedor.
--   · «Mercados del Norte»: dirección libre SIN código postal en la columna
--     vieja, y un teléfono (lo mueve la 0110: contacto y dirección por confirmar).
--   · La factura REPETIDA de Hermanos Ruiz: mismo número e importe que la
--     F-2026-0915 que ya hay.
--   · Dos documentos: ficha técnica de Hermanos Ruiz que caduca en 20 días
--     (la que dispara compliance_docs_due) y una de Panadería Luna.

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  a_sol    constant uuid := 'c01a0000-0000-4000-8000-0000000000a4';
  a_luna   constant uuid := 'c01a0000-0000-4000-8000-0000000000a5';
  a_norte  constant uuid := 'c1b0a000-0000-4000-8000-0000000000a6';
  u_kg  constant uuid := 'c1b0a000-0000-4000-8000-000000000101';
  u_g   constant uuid := 'c1b0a000-0000-4000-8000-000000000102';
  u_l   constant uuid := 'c1b0a000-0000-4000-8000-000000000103';
  u_ud  constant uuid := 'c1b0a000-0000-4000-8000-000000000104';
  i_tom constant uuid := 'c1b0a000-0000-4000-8000-000000000201';
  i_ace constant uuid := 'c1b0a000-0000-4000-8000-000000000202';
  i_pan constant uuid := 'c1b0a000-0000-4000-8000-000000000203';
  i_agu constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
  i_hamb constant uuid := 'c1b0a000-0000-4000-8000-000000000205';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C01b: esta base tiene cuentas de producción. No se siembra nada.';
  end if;

  insert into public.kitchen_unit (id, account_id, name, abbreviation, dimension, factor_to_base, is_base, is_seed, is_active)
  values (u_kg, a_cuenta, 'Kilogramo', 'kg', 'weight', 1, true, false, true),
         (u_g,  a_cuenta, 'Gramo',     'g',  'weight', 0.001, false, false, true),
         (u_l,  a_cuenta, 'Litro',     'l',  'volume', 1, true, false, true),
         (u_ud, a_cuenta, 'Unidad',    'ud', 'unit',   1, true, false, true)
  on conflict (id) do nothing;

  insert into public.recipe_item (id, account_id, type, name, base_unit_id, cost_strategy, is_purchasable, source, created_by_name)
  values (i_tom,  a_cuenta, 'raw',  'Tomate pera',           u_kg, 'last_purchase', true,  'manual', 'Semillas C01b'),
         (i_ace,  a_cuenta, 'raw',  'Aceite de oliva virgen', u_l,  'last_purchase', true,  'manual', 'Semillas C01b'),
         (i_pan,  a_cuenta, 'raw',  'Pan de hamburguesa',     u_ud, 'last_purchase', true,  'manual', 'Semillas C01b'),
         (i_agu,  a_cuenta, 'raw',  'Agua mineral 50 cl',     u_ud, 'last_purchase', true,  'manual', 'Semillas C01b'),
         (i_hamb, a_cuenta, 'dish', 'Hamburguesa de prueba',  u_ud, 'fixed',         false, 'manual', 'Semillas C01b')
  on conflict (id) do nothing;

  insert into public.recipe_line (id, account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
  values ('c1b0a000-0000-4000-8000-000000000301', a_cuenta, i_hamb, i_tom, 0.05, u_kg, 1),
         ('c1b0a000-0000-4000-8000-000000000302', a_cuenta, i_hamb, i_pan, 1,    u_ud, 2),
         ('c1b0a000-0000-4000-8000-000000000303', a_cuenta, i_hamb, i_ace, 0.01, u_l,  3)
  on conflict (id) do nothing;

  -- trg_article_supplier_recompute_cost recalcula el coste comprobando con
  -- belongs_to_account que el USUARIO tiene acceso al artículo, y aquí no hay
  -- usuario (conecta el workflow, sin permiso para apagar disparadores). Para
  -- estas inserciones la semilla se presenta como el administrador de la
  -- cuenta A, que es quien las haría en la app: el recálculo corre de verdad.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
  insert into public.article_supplier (id, account_id, recipe_item_id, supplier_id, last_price, is_preferred, is_active, supplier_item_name)
  values ('c1b0a000-0000-4000-8000-000000000401', a_cuenta, i_tom, a_ruiz, 2.40, true,  true, 'TOMATE PERA CAT. I'),
         ('c1b0a000-0000-4000-8000-000000000402', a_cuenta, i_ace, a_ruiz, 8.90, true,  true, 'ACEITE OLIVA VIRGEN 5L'),
         ('c1b0a000-0000-4000-8000-000000000403', a_cuenta, i_pan, a_luna, 0.35, true,  true, 'PAN BRIOCHE HAMBURGUESA'),
         ('c1b0a000-0000-4000-8000-000000000404', a_cuenta, i_agu, a_sol,  0.30, true,  true, 'AGUA MINERAL 50CL')
  on conflict (id) do nothing;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- El proveedor de la dirección libre sin CP (columna vieja, a propósito).
  insert into public.supplier (id, account_id, name, tax_id, phone, address, created_by_name)
  values (a_norte, a_cuenta, 'Mercados del Norte', 'B91000034', '600 000 007', 'Calle Mayor 3, Alcobendas', 'Semillas C01b')
  on conflict (id) do nothing;
  -- Y lo que le compras a él (después de crearlo, por la clave ajena).
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
  insert into public.article_supplier (id, account_id, recipe_item_id, supplier_id, last_price, is_preferred, is_active, supplier_item_name)
  values ('c1b0a000-0000-4000-8000-000000000405', a_cuenta, i_tom, a_norte, 2.65, false, true, 'TOMATE PERA')
  on conflict (id) do nothing;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- La repetida: mismo número e importe que la F-2026-0915 aprobada.
  insert into public.supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, source, created_by_name)
  values ('c1b0a000-0000-4000-8000-000000000501', a_cuenta, a_ruiz, a_local, 'F-2026-0915', date '2026-09-24', 'en_revision',
    1166.50, 116.65, 1283.15, 'ocr', 'Semillas C01b')
  on conflict (id) do nothing;

  insert into public.compliance_document (id, account_id, supplier_id, doc_family, title, file_path, status, expires_at)
  values ('c1b0a000-0000-4000-8000-000000000601', a_cuenta, a_ruiz, 'food_spec', 'Ficha técnica · Tomate pera',
          'semillas/c01b/ficha-tomate.pdf', 'active', current_date + 20),
         ('c1b0a000-0000-4000-8000-000000000602', a_cuenta, a_luna, 'food_spec', 'Ficha técnica · Pan de hamburguesa',
          'semillas/c01b/ficha-pan.pdf', 'active', current_date + 200)
  on conflict (id) do nothing;

  raise notice 'Semilla C01b: unidades, 5 artículos (1 plato), Mercados del Norte, la repetida y 2 documentos.';
end $$;
