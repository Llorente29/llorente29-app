-- ============================================================================
-- F01 · MARCAS DE LAST · La carta de Last de prueba de la e2e. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/marcas/alta-last.spec.ts (encargo F01, PR 1): en la cuenta A,
-- una cuenta de Last de marcas cedidas, encendida, con sus tiendas en Norte
-- Centro y Norte Mercado y una tercera sin local, y su carta:
--   · «Latina de Prueba» (nueva en Last): la MISMA carta en Uber y en Glovo, un
--     plato con dos nombres («AREPA REINA (LP)» en Uber, «AREPA REINA LP» en
--     Glovo), unos tequeños más caros en Glovo y el agua, que se llama como el
--     artículo del almacén de A («Agua mineral 50 cl»).
-- El extra nuevo de la carta de prueba va con el PR 2 (los cambios de carta,
-- tablero 5): el espejo de Last de hoy no guarda extras.
--
--   e2e_f01_preparar(p_que): la prueba no tiene la clave de servicio, y cada
--   pasada (ordenador y móvil) tiene que empezar con la marca SIN dar de alta.
--   Esta función —que SOLO existe en staging, por esta semilla, y no está en
--   ninguna migración— se la deja usar al administrador de A (el de la
--   plantilla o el de su carril), y solo en SU cuenta:
--     · 'empezar' archiva lo que dejó un alta anterior de «Latina de Prueba»
--                 (la marca y sus platos), quita su alta, sus vínculos y su ficha
--                 de socio, y pone la carta de Last «vista ahora»;
--     · 'limpiar' lo mismo, sin tocar la carta (al acabar la prueba).
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta la
-- cuenta A o sus locales. Se puede volver a aplicar.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org      constant uuid := 'f01e2e00-0000-4000-8000-0000000000a0';
  l1       constant uuid := 'f01e2e00-0000-4000-8000-0000000000e1';
  l2       constant uuid := 'f01e2e00-0000-4000-8000-0000000000e2';
  l3       constant uuid := 'f01e2e00-0000-4000-8000-0000000000e3';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla F01 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if (select count(*) from public.locations where account_id = a_cuenta and id in ('c01a0000-0000-4000-8000-0000000000a2', 'e0200000-0000-4000-8000-0000000000a3')) <> 2 then
    raise exception 'Semilla F01: faltan los locales Norte Centro y Norte Mercado de la cuenta A.';
  end if;

  if not exists (select 1 from public.external_integration where account_id = a_cuenta and source = 'lastapp' and external_org_id = org) then
    insert into public.external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active)
    values (a_cuenta, 'lastapp', org, 'Cocinas de Prueba', 'licensed', true);
  end if;
  insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active)
  select a_cuenta, 'lastapp', x.ext, x.loc, true
    from (values (l1::text, 'c01a0000-0000-4000-8000-0000000000a2'::uuid), (l2::text, 'e0200000-0000-4000-8000-0000000000a3'::uuid)) x(ext, loc)
   where not exists (select 1 from public.external_location_map m where m.account_id = a_cuenta and m.source = 'lastapp' and m.external_location_id = x.ext);

  -- La carta: una fila por plato, plataforma y tienda (como last-catalog-sync), con su id fijo.
  insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
       external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
       external_location_id, seen_in_catalog_at, is_enabled, last_synced_at)
  select a_cuenta, 'lastapp', org,
         ('f01e2e00-' || lpad(to_hex(x.n), 4, '0') || '-4000-8000-' || lpad(to_hex(c.i * 16 + t.j), 12, '0'))::uuid,
         ('f01e2e00-0000-4000-8000-0000000000' || lpad(to_hex(x.n), 2, '0'))::uuid,
         'Latina de Prueba ', 'f01e2e-lp-' || t.j, x.nombre,
         x.cents + case when c.ch = 'glovo' and x.nombre = 'TEQUEÑOS LP' then 100 else 0 end,
         'PRODUCT', c.ch, array[c.ch], t.loc, now(), true, now()
    from (values (1, 'Agua mineral 50 cl', 200, array['uber', 'glovo']),
                 (2, 'AREPA REINA (LP)', 890, array['uber']),
                 (3, 'AREPA REINA LP', 890, array['glovo']),
                 (4, 'TEQUEÑOS LP', 650, array['uber', 'glovo'])) x(n, nombre, cents, canales)
    cross join (values (1, 'uber'), (2, 'glovo')) c(i, ch)
    cross join (values (1, l1), (2, l2), (3, l3)) t(j, loc)
   where c.ch = any (x.canales)
  on conflict (account_id, source, catalog_product_id, external_location_id) do nothing;

  raise notice 'Semilla F01 OK: «Latina de Prueba» en Last (cuenta A), 4 matrículas, Uber y Glovo, en Norte Centro, Norte Mercado y una tienda sin local.';
end $$;

create or replace function public.e2e_f01_preparar(p_que text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org constant uuid := 'f01e2e00-0000-4000-8000-0000000000a0';
  v_cuenta uuid;
  v_marcas integer := 0;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'e2e_f01_preparar: esta base tiene cuentas de producción.';
  end if;
  if p_que not in ('empezar', 'limpiar') then raise exception 'e2e_f01_preparar: «empezar» o «limpiar».'; end if;
  -- La cuenta del que llama: la A de la plantilla o la de su carril, la que tiene la carta de prueba.
  select up.account_id into v_cuenta from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin'
     and exists (select 1 from public.external_integration ei where ei.account_id = up.account_id and ei.external_org_id = org)
   limit 1;
  if v_cuenta is null then raise exception 'e2e_f01_preparar: solo el administrador de la cuenta con la carta de prueba.' using errcode = '42501'; end if;

  -- Lo que dejó un alta anterior, archivado (no se borra: lo que apunte a ello sigue en pie).
  update public.menu_item mi set archived_at = now(), updated_at = now()
   where mi.account_id = v_cuenta and mi.archived_at is null
     and mi.brand_id in (select b.id from public.brand b where b.account_id = v_cuenta and b.name = 'Latina de Prueba' and b.archived_at is null);
  delete from public.brand_licensing_agreement a
   where a.account_id = v_cuenta and a.brand_id in (select b.id from public.brand b where b.account_id = v_cuenta and b.name = 'Latina de Prueba');
  delete from public.external_brand_map where account_id = v_cuenta and source = 'lastapp' and external_brand_id like 'f01e2e-lp-%';
  delete from public.external_brand_alta where account_id = v_cuenta and external_org_id = org;
  update public.brand b set archived_at = now(), is_active = false, updated_at = now()
   where b.account_id = v_cuenta and b.name = 'Latina de Prueba' and b.archived_at is null;
  get diagnostics v_marcas = row_count;

  if p_que = 'empezar' then
    update public.external_catalog_product set seen_in_catalog_at = now(), missing_since = null, last_synced_at = now()
     where account_id = v_cuenta and external_org_id = org;
  end if;
  return jsonb_build_object('cuenta', v_cuenta, 'marcas_archivadas', v_marcas);
end $$;
revoke all on function public.e2e_f01_preparar(text) from public, anon;
grant execute on function public.e2e_f01_preparar(text) to authenticated;
