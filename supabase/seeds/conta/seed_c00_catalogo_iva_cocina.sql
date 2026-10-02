-- ============================================================================
-- C00 · D1 · Catálogo de IVA de Cocina en staging-conta. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- staging-conta tiene vat_category y vat_rate VACÍAS, y sin filas no hay nada
-- que comparar antes y después de que vat_rate_for pase a leer de tax_rate.
-- Esto copia las de PRODUCCIÓN tal cual, leídas en solo lectura el 03/10/2026:
--
--   select code, name, description, sort_order, is_active
--     from vat_category order by sort_order;                       -- 5 filas
--   select c.code, r.rate, r.equivalence_surcharge, r.valid_from, r.valid_to
--     from vat_rate r join vat_category c on c.id = r.category_id
--    order by c.code, r.valid_from;                                -- 6 filas
--   (las 6 también en tests/conta/cumplimiento/vat_rate_produccion.json)
--
-- Son catálogos GLOBALES (sin account_id): no son datos de ninguna cuenta ni de
-- Folvy Interno. Los id no se copian (se anclan por `code`, que es único).
-- family_vat_default NO se siembra: D1 no la cambia (sigue apuntando a
-- vat_category) y el ensayo no la necesita.
--
-- Idempotente: si ya están, no hace nada.
-- ============================================================================

insert into public.vat_category (code, name, description, sort_order, is_active) values
  ('alimento_basico',   'Alimento básico',  'Pan, harinas, leche, queso, huevos, fruta, verdura, legumbres, cereales naturales', 1, true),
  ('aceite_oliva',      'Aceite de oliva',  'Aceite de oliva (superreducido permanente desde 2025)', 2, true),
  ('alimento_general',  'Alimento general', 'Resto de alimentos, pastas, aceites de semillas, carnes, pescados procesados', 3, true),
  ('bebida_alcoholica', 'Bebida o azúcar',  'Bebidas alcohólicas y bebidas con azúcares/edulcorantes añadidos', 4, true),
  ('no_alimentario',    'No alimentario',   'Limpieza, menaje, packaging y otros no alimentarios', 5, true)
on conflict (code) do nothing;

insert into public.vat_rate (category_id, rate, equivalence_surcharge, valid_from, valid_to)
select c.id, v.rate, v.surcharge, v.valid_from, v.valid_to
  from (values
    ('aceite_oliva',       2::numeric, 0.26::numeric, date '2024-10-01', date '2024-12-31'),
    ('aceite_oliva',       4,          0.5,           date '2025-01-01', null::date),
    ('alimento_basico',    4,          0.5,           date '2025-01-01', null),
    ('alimento_general',  10,          1.4,           date '2025-01-01', null),
    ('bebida_alcoholica', 21,          5.2,           date '2025-01-01', null),
    ('no_alimentario',    21,          5.2,           date '2025-01-01', null)
  ) as v(code, rate, surcharge, valid_from, valid_to)
  join public.vat_category c on c.code = v.code
 where not exists (select 1 from public.vat_rate r
                    where r.category_id = c.id and r.valid_from = v.valid_from);

do $$
declare n_cat int; n_tipo int;
begin
  select count(*) into n_cat from public.vat_category;
  select count(*) into n_tipo from public.vat_rate;
  if n_cat <> 5 or n_tipo <> 6 then
    raise exception 'SEMILLA D1: esperaba 5 categorías y 6 tipos; hay % y %.', n_cat, n_tipo;
  end if;
  raise notice 'SEMILLA D1: 5 categorías y 6 tipos, como en producción.';
end $$;
