-- ============================================================================
-- C00 · Tarea 6 · Un dato de PRUEBA para que la sugerencia del 115 salga en
-- staging-conta. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- La regla es real (conta_sugerencias_calcular, migración 0160): un proveedor
-- de alquiler (cuenta 621) con un 19 % de retención, y la empresa no presenta
-- el 115. El DATO es de prueba: un proveedor inventado en la cuenta B, cuya
-- empresa (Cocina de Prueba Sur, Canarias) solo presenta el 111. En
-- producción no puede salir todavía: las columnas de la ficha de proveedor
-- (C01) aún no están allí. Idempotente.
-- ============================================================================

insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, entity_kind, country_code, expense_category_id, irpf_withholding_pct)
select 'c01b0000-0000-4000-8000-00000000000b', 'Locales del Sur (alquiler)', 'Locales del Sur, S.L.', 'B35000025', 'nif_es', 'company', 'ES',
       (select id from public.expense_category where is_system and pgc_account_hint = '621' limit 1), 19
 where not exists (select 1 from public.supplier where account_id = 'c01b0000-0000-4000-8000-00000000000b' and name = 'Locales del Sur (alquiler)');

insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, entity_kind, country_code, expense_category_id, irpf_withholding_pct)
select 'c01a0000-0000-4000-8000-00000000000a', 'Locales del Norte (alquiler)', 'Locales del Norte, S.L.', 'B28000024', 'nif_es', 'company', 'ES',
       (select id from public.expense_category where is_system and pgc_account_hint = '621' limit 1), 19
 where not exists (select 1 from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' and name = 'Locales del Norte (alquiler)');

do $$
begin
  raise notice 'SUGERENCIA DE PRUEBA: proveedores de alquiler al 19 %% en A: % · en B: %',
    (select count(*) from public.supplier s join public.expense_category e on e.id = s.expense_category_id
      where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and e.pgc_account_hint = '621' and s.irpf_withholding_pct = 19),
    (select count(*) from public.supplier s join public.expense_category e on e.id = s.expense_category_id
      where s.account_id = 'c01b0000-0000-4000-8000-00000000000b' and e.pgc_account_hint = '621' and s.irpf_withholding_pct = 19);
end $$;
