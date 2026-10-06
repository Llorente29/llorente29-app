-- ============================================================================
-- C03 · Limpieza única en staging-conta (SOLO STAGING). Se queda hecha.
--
-- Qué: las 41 fichas de proveedor que trajo el e2e del C02c a las 12:21 UTC
-- del 06/10 (run 37461486783) y no pudo deshacer, porque con el C03 dentro
-- «Deshacer entero» se paraba (lo arregla la 0160). Al borrar su empresa de
-- prueba, supplier.import_id (on delete set null) las dejó sueltas en la
-- cuenta A, y la importación siguiente las encontró por NIF («mismo NIF … →
-- acreedor» en vez de «ficha nueva»): e2e 37466147270.
--
-- Guardas: exactamente esas (cuenta A, ese minuto, import_id nulo, creadas
-- por el administrador de A al traer el plan); ninguna usada en otra tabla que
-- no sea parte de la ficha; y son 41. Si no, para y no borra nada.
-- ============================================================================
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_fichas uuid[]; v_terceros uuid[]; fk record; n bigint; usadas text[] := '{}'; n_borradas int; n_terceros int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Limpieza C02c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_fichas from public.supplier s
   where s.account_id = a and s.import_id is null and s.created_by_name = 'Admin Norte'
     and s.created_at >= '2026-10-06 12:21:00+00' and s.created_at < '2026-10-06 12:22:00+00';
  if cardinality(v_fichas) <> 41 then
    raise exception 'Limpieza C02c: esperaba 41 fichas y hay %. No se borra nada.', cardinality(v_fichas);
  end if;
  for fk in
    select c.conrelid::regclass::text tabla, a2.attname columna
      from pg_constraint c join pg_attribute a2 on a2.attrelid = c.conrelid and a2.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.supplier'::regclass and cardinality(c.conkey) = 1
       and c.conrelid::regclass::text not in ('supplier_contact', 'supplier_alias', 'supplier_learning', 'supplier_learning_log', 'supplier_proposal', 'party_role')
  loop
    execute format('select count(*) from %s where %I = any($1)', fk.tabla, fk.columna) into n using v_fichas;
    if n > 0 then usadas := usadas || format('%s en %s', n, fk.tabla); end if;
  end loop;
  if cardinality(usadas) > 0 then
    raise exception 'Limpieza C02c: alguna se usa (%). No se borra nada.', array_to_string(usadas, ', ');
  end if;
  select coalesce(array_agg(distinct r.party_id), '{}') into v_terceros from public.party_role r where r.supplier_id = any(v_fichas);
  if exists (select 1 from public.party_role r where r.party_id = any(v_terceros) and r.role <> 'supplier') then
    raise exception 'Limpieza C02c: algún tercero de esas fichas tiene otro papel. No se borra nada.';
  end if;
  delete from public.supplier where id = any(v_fichas);
  get diagnostics n_borradas = row_count;
  delete from public.party p where p.id = any(v_terceros) and not exists (select 1 from public.party_role r where r.party_id = p.id);
  get diagnostics n_terceros = row_count;
  raise notice 'Limpieza C02c: % fichas y % terceros borrados.', n_borradas, n_terceros;
end $$;
