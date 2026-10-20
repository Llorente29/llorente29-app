-- supabase/vuelta-atras/20261125T0310_i01d_proveedores_foodint.down.sql
--
-- Vuelta atrás de 20261125T0310_i01d_proveedores_foodint (solo Foodint):
-- Trypleez vuelve a país ES sin NIF, y fuera las cuatro fichas que dio de alta
-- (las de created_by_name «Sumied · I01d …»), su enlace con su 410 y su tercero
-- si no tiene otro papel. Si alguna ya tiene facturas, PARA: ya no es la de la
-- 0310 y borrarla se llevaría trabajo hecho.
--
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no
-- está en staging; la prueba de la 0300 la ejecuta igual (y la 0310) para ver
-- que se leen y que, sin Foodint, no tocan nada. Su prueba con datos es el
-- ENSAYO de la tanda en producción (todo en una transacción y rollback).

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_emp constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_try constant uuid := '0277a82e-fe98-42b1-9e2f-2eef1e0f6a26';
  v_ids uuid[]; v_parties uuid[];
begin
  if not exists (select 1 from public.company where id = v_emp and account_id = v_acc) then
    raise notice 'I01d 0310 (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.supplier
   where account_id = v_acc and created_by_name = 'Sumied · I01d (alta de los proveedores extranjeros de Diez)';
  if exists (select 1 from public.supplier_invoice where account_id = v_acc and supplier_id = any (v_ids)) then
    raise exception 'I01d 0310 (vuelta atrás): alguna de las fichas dadas de alta ya tiene facturas: no se deshace.';
  end if;
  select coalesce(array_agg(r.party_id), '{}') into v_parties from public.party_role r
   where r.account_id = v_acc and r.supplier_id = any (v_ids)
     and not exists (select 1 from public.party_role o where o.party_id = r.party_id and o.supplier_id is distinct from r.supplier_id);
  delete from public.company_account_link where account_id = v_acc and company_id = v_emp and entity = 'supplier' and entity_id = any (select unnest(v_ids)::text);
  delete from public.supplier where account_id = v_acc and id = any (v_ids);
  delete from public.party p where p.account_id = v_acc and p.id = any (v_parties)
     and not exists (select 1 from public.party_role o where o.party_id = p.id);
  update public.supplier
     set country_code = 'ES', tax_id_type = null, tax_id = null, tax_id_check_status = null, tax_id_checked_at = null, tax_id_verified_at = null, updated_at = now()
   where id = v_try and account_id = v_acc;
  raise notice 'I01d 0310 (vuelta atrás): % fichas fuera; Trypleez otra vez con país ES y sin NIF.', cardinality(v_ids);
end $$;
