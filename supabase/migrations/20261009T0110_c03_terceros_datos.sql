-- ============================================================================
-- C03 · 2 · DATOS: cada proveedor, con su tercero
-- ----------------------------------------------------------------------------
-- Un tercero por proveedor que exista (con su nombre, su NIF normalizado y su
-- archivado) y el papel de proveedor enlazado a su ficha. NO se toca ni una
-- fila de `supplier`: la prueba de staging compara su huella antes y después.
--
-- Misma regla que el disparador de alta: un NIF, un tercero; si dos
-- proveedores de la misma cuenta comparten NIF (Cocina lo permite), el más
-- antiguo se queda el NIF y el otro va a un tercero sin NIF, y lo dice el
-- agente. Medido en producción el 06/10 (solo lectura, cuenta de Foodint): 65
-- proveedores, 0 NIF repetidos, 27 sin NIF.
--
-- Las cuentas 430 traídas de Diez NO se enlazan aquí: se proponen en la
-- revisión de la ficha (por NIF o nombre) y las confirma la persona.
-- Vuelta atrás: supabase/vuelta-atras/20261009T0110_c03_terceros_datos.down.sql
-- ============================================================================

do $$
declare
  s record; v_party uuid; v_nif text; n_nuevos int := 0; n_juntos int := 0; n_sin_nif_por_choque int := 0;
begin
  for s in select * from public.supplier sp
            where not exists (select 1 from public.party_role r where r.supplier_id = sp.id)
            order by sp.account_id, sp.created_at, sp.id loop
    v_party := null;
    v_nif := public.party_nif(s.tax_id);
    if v_nif is not null then
      select id into v_party from public.party where account_id = s.account_id and tax_id = v_nif;
      if v_party is not null and exists (select 1 from public.party_role where party_id = v_party and role = 'supplier') then
        v_party := null; v_nif := null; n_sin_nif_por_choque := n_sin_nif_por_choque + 1;
      end if;
    end if;
    if v_party is null then
      insert into public.party (account_id, name, tax_id, archived_at, source, created_at, created_by, created_by_name)
      values (s.account_id, s.name, v_nif, s.archived_at, 'supplier', s.created_at, s.created_by, s.created_by_name)
      returning id into v_party;
      n_nuevos := n_nuevos + 1;
    else
      n_juntos := n_juntos + 1;
    end if;
    insert into public.party_role (account_id, party_id, role, supplier_id, created_at, created_by)
    values (s.account_id, v_party, 'supplier', s.id, s.created_at, s.created_by);
  end loop;

  if exists (select 1 from public.supplier sp where not exists (select 1 from public.party_role r where r.supplier_id = sp.id)) then
    raise exception 'C03 · queda algún proveedor sin tercero: no se sigue.';
  end if;
  raise notice 'C03 · terceros: % nuevos, % proveedores juntados a un tercero que ya existía, % sin NIF por NIF repetido.',
    n_nuevos, n_juntos, n_sin_nif_por_choque;
end $$;
