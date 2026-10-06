-- ============================================================================
-- C03 · Limpieza única en staging-conta (SOLO STAGING). Se queda hecha.
--
-- Los terceros que se quedaron sin ningún papel antes de la 0170: los de los
-- proveedores que crean y borran las e2e (C01b y otras). Medido el 06/10:
-- 51 (45 en la cuenta A, 6 en la B), todos con source = 'supplier'.
--
-- Guardas: solo terceros sin ningún papel, nacidos de un proveedor, y que
-- nada apunta a ellos (liquidaciones, cesión, aportaciones, datos fiscales,
-- cuentas del plan). Si alguno lo tiene, para y no borra nada.
-- ============================================================================
do $$
declare v uuid[]; n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Limpieza: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  select coalesce(array_agg(p.id), '{}') into v from public.party p
   where p.source = 'supplier' and not exists (select 1 from public.party_role r where r.party_id = p.id);
  if exists (select 1 from public.channel_settlement where party_id = any(v))
     or exists (select 1 from public.licensed_settlement where party_id = any(v))
     or exists (select 1 from public.brand_licensing_agreement where party_id = any(v))
     or exists (select 1 from public.brand_partner_contribution where party_id = any(v))
     or exists (select 1 from public.customer_fiscal where party_id = any(v))
     or exists (select 1 from public.company_account_link where entity = 'customer' and entity_id = any(v::text[])) then
    raise exception 'Limpieza: algún tercero sin papel tiene algo colgando. No se borra nada.';
  end if;
  delete from public.party where id = any(v);
  get diagnostics n = row_count;
  raise notice 'Limpieza: % terceros sin papel borrados.', n;
end $$;
