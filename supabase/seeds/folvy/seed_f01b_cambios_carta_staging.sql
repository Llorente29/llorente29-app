-- ============================================================================
-- F01 · PR 2 · CAMBIOS DE CARTA · Los extras de la carta de Last de prueba.
-- SOLO STAGING. Va después de la 1910 y de la semilla del PR 1
-- (seed_f01_marcas_last_staging.sql, «Latina de Prueba» en la cuenta A).
-- ----------------------------------------------------------------------------
-- Para tests/e2e/marcas/cambios-last.spec.ts: la pregunta «Extras» de los
-- tequeños de «Latina de Prueba», con dos extras:
--   · «Pan de hamburguesa extra» (0,90 €): Folvy propone «Pan de hamburguesa ·
--     1 ud», el artículo del almacén de A que se llama así;
--   · «Salsa de la casa» (0,50 €): Folvy no sabe qué es (falta).
--
--   e2e_f01b_preparar(): deja la marca dada de alta (como propia: desde la rama
--   staging no tiene la 1322) y los dos extras sin decidir. Quita lo que dejó
--   una pasada anterior (la opción y la pregunta de Folvy creadas al guardar y
--   lo que descuentan). SOLO existe en staging, por esta semilla. La usa el
--   administrador de A (el de la plantilla o el de su carril), en SU cuenta.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org      constant uuid := 'f01e2e00-0000-4000-8000-0000000000a0';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla F01b ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.external_integration where account_id = a_cuenta and external_org_id = org) then
    raise exception 'Semilla F01b: falta la carta de Last de prueba del PR 1 (seed_f01_marcas_last_staging.sql).';
  end if;
  insert into public.external_catalog_modifier (account_id, source, external_org_id, group_id, slot_id, modifier_id, group_name,
                                                group_min, group_max, name, price_cents, product_ids, seen_in_catalog_at)
  values
    (a_cuenta, 'lastapp', org, 'f01e2e-grupo-extras', 'f01e2e-hueco-1', 'f01e2e-extra-1', 'Extras', 0, 3, 'Pan de hamburguesa extra', 90,
     array['f01e2e00-0000-4000-8000-000000000004'], now()),
    (a_cuenta, 'lastapp', org, 'f01e2e-grupo-extras', 'f01e2e-hueco-2', 'f01e2e-extra-2', 'Extras', 0, 3, 'Salsa de la casa', 50,
     array['f01e2e00-0000-4000-8000-000000000004'], now())
  on conflict (account_id, source, external_org_id, group_id, slot_id) do nothing;
  raise notice 'Semilla F01b OK: dos extras de Last en los tequeños de «Latina de Prueba».';
end $$;

create or replace function public.e2e_f01b_preparar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org constant uuid := 'f01e2e00-0000-4000-8000-0000000000a0';
  v_cuenta uuid;
  r jsonb;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'e2e_f01b_preparar: esta base tiene cuentas de producción.';
  end if;
  select up.account_id into v_cuenta from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin'
     and exists (select 1 from public.external_integration ei where ei.account_id = up.account_id and ei.external_org_id = org)
   limit 1;
  if v_cuenta is null then raise exception 'e2e_f01b_preparar: solo el administrador de la cuenta con la carta de prueba.' using errcode = '42501'; end if;

  -- Lo que dejó una pasada anterior al guardar.
  delete from public.modifier_recipe_impact i using public.modifier_option o
   where i.modifier_option_id = o.id and o.account_id = v_cuenta and o.pos_modifier_id like 'f01e2e-extra-%';
  delete from public.modifier_option where account_id = v_cuenta and pos_modifier_id like 'f01e2e-extra-%';
  delete from public.modifier_group where account_id = v_cuenta and external_source = 'lastapp' and external_id = 'f01e2e-grupo-extras';
  -- La carta y sus extras, vistos ahora; la marca, dada de alta si no lo está.
  perform public.e2e_f01_preparar('empezar');
  update public.external_catalog_modifier set seen_in_catalog_at = now(), missing_since = null where account_id = v_cuenta and external_org_id = org;
  r := public._f01_alta_marca(v_cuenta, org, 'Latina de Prueba', 'Latina de Prueba', true, null, false, auth.uid(), 'e2e F01b');
  return jsonb_build_object('cuenta', v_cuenta, 'brand_id', r->>'brand_id');
end $$;
revoke all on function public.e2e_f01b_preparar() from public, anon;
grant execute on function public.e2e_f01b_preparar() to authenticated;
