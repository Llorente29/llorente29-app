-- ============================================================================
-- C03 · Prueba en staging-conta de 20261009T0170 (borrar un proveedor no deja
-- su tercero huérfano). En una transacción que acaba en ROLLBACK.
--   1. Con la 0170 quitada: borrar un proveedor deja su tercero sin papeles
--      (se reproduce lo que enseñaron las capturas).
--   2. Con la 0170: el tercero se va con él.
--   3. Si el tercero es también cliente, se queda, con su papel de cliente.
-- ============================================================================
begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.proveedor(p_n text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier (account_id, name, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Prueba 0170 ' || p_n, 'prueba 0170') returning id into v;
  return v;
end $$;

\echo '>>> 1. Sin la 0170: el tercero se queda huérfano (se reproduce)'
\ir ../../vuelta-atras/20261009T0170_c03_borrar_proveedor.down.sql
do $$
declare v_s uuid := pg_temp.proveedor('A'); v_p uuid;
begin
  select party_id into v_p from public.party_role where supplier_id = v_s;
  if v_p is null then raise exception 'PRUEBA 1: el proveedor nuevo no tiene tercero (el disparador del C03 no corrió).'; end if;
  delete from public.supplier where id = v_s;
  if not exists (select 1 from public.party where id = v_p) then raise exception 'PRUEBA 1: el tercero ya no existe: el fallo no se reproduce.'; end if;
  if exists (select 1 from public.party_role where party_id = v_p) then raise exception 'PRUEBA 1: el tercero aún tiene papel.'; end if;
  raise notice 'PRUEBA 1 ok (se reproduce): el tercero % se queda sin ningún papel.', v_p;
end $$;

\echo '>>> 2. Con la 0170: el tercero se va con su proveedor'
\ir ../../migrations/20261009T0170_c03_borrar_proveedor.sql
do $$
declare v_s uuid := pg_temp.proveedor('B'); v_p uuid;
begin
  select party_id into v_p from public.party_role where supplier_id = v_s;
  delete from public.supplier where id = v_s;
  if exists (select 1 from public.party where id = v_p) then raise exception 'PRUEBA 2: el tercero sigue ahí.'; end if;
  raise notice 'PRUEBA 2 ok: proveedor y tercero borrados.';
end $$;

\echo '>>> 3. Si además es cliente, el tercero se queda con su papel de cliente'
do $$
declare v_s uuid := pg_temp.proveedor('C'); v_p uuid;
begin
  select party_id into v_p from public.party_role where supplier_id = v_s;
  perform public.party_add_role(v_p, 'customer', '{}'::jsonb);
  delete from public.supplier where id = v_s;
  if not exists (select 1 from public.party where id = v_p) then raise exception 'PRUEBA 3: se ha borrado un tercero que es cliente.'; end if;
  if (select array_agg(role) from public.party_role where party_id = v_p) <> array['customer'] then raise exception 'PRUEBA 3: le quedan papeles que no son el de cliente.'; end if;
  raise notice 'PRUEBA 3 ok: el tercero se queda como cliente.';
end $$;

\echo '>>> Prueba de la 0170 en verde. ROLLBACK: no queda nada.'
rollback;
