-- supabase/migrations/20261009T0170_c03_borrar_proveedor.sql
--
-- C03 · Al BORRAR un proveedor, su tercero no se queda huérfano.
--
-- party_role.supplier_id es «on delete cascade»: al borrar un proveedor se va
-- su papel, pero el party se quedaba sin ningún papel, saliendo en «Todos» de
-- Clientes y proveedores sin nada que lo explique. Lo enseñaron las capturas
-- del e2e (37471541076): 51 terceros sin papel en staging (45 en la cuenta A,
-- 6 en la B), todos de proveedores que crean y borran las e2e del C01b.
--
-- Ahora, ANTES de borrar el proveedor: se quita su papel y, si a su tercero no
-- le queda ningún otro (cliente, plataforma, socio de marca), se borra el
-- tercero. Si le queda alguno, se conserva: es un cliente que además fue
-- proveedor, y eso no se pierde por borrar la ficha de proveedor.
--
-- Solo añade (una función y un disparador nuevos sobre supplier): no reemplaza
-- nada ni toca datos. Vuelta atrás:
-- supabase/vuelta-atras/20261009T0170_c03_borrar_proveedor.down.sql

create or replace function public.party_al_borrar_proveedor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_party uuid;
begin
  delete from public.party_role where supplier_id = old.id returning party_id into v_party;
  if v_party is not null and not exists (select 1 from public.party_role r where r.party_id = v_party) then
    delete from public.party where id = v_party;
  end if;
  return old;
end $$;
revoke all on function public.party_al_borrar_proveedor() from public, anon, authenticated;

drop trigger if exists trg_party_al_borrar_proveedor on public.supplier;
create trigger trg_party_al_borrar_proveedor before delete on public.supplier
  for each row execute function public.party_al_borrar_proveedor();
