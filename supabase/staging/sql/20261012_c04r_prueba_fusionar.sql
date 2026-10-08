-- ============================================================================
-- C04 R4 · Prueba en staging-conta de 20261012T0120_c04r_fusionar_terceros.sql
-- Todo dentro de una transacción que acaba en ROLLBACK: no queda nada.
--
--   1. Foto de antes de las tablas que la fusión puede tocar.
--   2. Entra la migración. Foto de después con la misma vara: idéntica (solo añade).
--   3. Como el administrador de A, el caso de producción: la ficha «de Diez»
--      (proveedor + cliente, sin NIF) y la vieja de Cocina (proveedor
--      archivado + socio de marca, con NIF). Se fusiona la vieja en la de Diez:
--        · el papel de socio pasa a la que queda; el de proveedor se queda en
--          la vieja (cada ficha de proveedor de Cocina es de un solo tercero);
--        · el NIF pasa a la que queda;
--        · la vieja queda archivada con «Fusionado con …»;
--        · party_merge lo apunta con su resumen.
--   4. Deshacer: todo vuelve como estaba (misma foto de las dos fichas).
--   5. No fusiona lo que tiene asientos validados (PARA, 23514).
--   6. El administrador de B no fusiona fichas de A (42501).
--   7. Vuelta atrás de la migración: sale limpia y se vuelve a aplicar.
-- ============================================================================
begin;

\echo '>>> 1. Foto de antes'
do $$ begin
  if to_regclass('public.party_merge') is not null then
    raise exception 'PRUEBA C04R4 fusionar · 1: staging ya tiene party_merge; la foto de antes no sería de antes.';
  end if;
end $$;
create temp table foto (que text primary key, antes text, despues text) on commit drop;
insert into foto (que, antes)
select 'party', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.party x
union all select 'party_role', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.party_role x
union all select 'company_account_link', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.company_account_link x
union all select 'journal_entry', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.journal_entry x
union all select 'supplier', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.supplier x;

\echo '>>> 2. La migración'
\ir ../../migrations/20261012T0120_c04r_fusionar_terceros.sql

update foto f set despues = x.h from (
  select 'party' que, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) h from public.party x
  union all select 'party_role', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.party_role x
  union all select 'company_account_link', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.company_account_link x
  union all select 'journal_entry', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.journal_entry x
  union all select 'supplier', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.supplier x) x where x.que = f.que;
do $$ declare v text; begin
  select string_agg(que, ', ') into v from foto where antes is distinct from despues;
  if v is not null then raise exception 'PRUEBA C04R4 fusionar · 2: antes ≠ después en %', v; end if;
  raise notice 'PRUEBA C04R4 fusionar · 2: antes = después en las 5 tablas (misma vara).';
end $$;

\echo '>>> 3. Fusionar, como el administrador de A'
-- Las fichas de prueba (nombres inventados), creadas como lo hace Cocina: el
-- disparador party_desde_proveedor les da su tercero.
insert into public.supplier (id, account_id, name, created_by_name)
values ('c04f0000-0000-4000-8000-0000000000d1', 'c01a0000-0000-4000-8000-00000000000a', 'Fusión Prueba Diez', 'prueba C04R4'),
       ('c04f0000-0000-4000-8000-0000000000d2', 'c01a0000-0000-4000-8000-00000000000a', 'FUSION PRUEBA VIEJO', 'prueba C04R4');
update public.supplier set archived_at = now() - interval '30 days' where id = 'c04f0000-0000-4000-8000-0000000000d2';
create temp table fichas on commit drop as
select (select party_id from public.party_role where supplier_id = 'c04f0000-0000-4000-8000-0000000000d1') queda,
       (select party_id from public.party_role where supplier_id = 'c04f0000-0000-4000-8000-0000000000d2') se_va;
insert into public.party_role (account_id, party_id, role)
select 'c01a0000-0000-4000-8000-00000000000a', queda, 'customer' from fichas
union all select 'c01a0000-0000-4000-8000-00000000000a', se_va, 'brand_partner' from fichas;
update public.party set tax_id = 'B99000017' where id = (select se_va from fichas);
create temp table antes_fichas on commit drop as
select p.id, to_jsonb(p) - 'updated_at' fila, (select jsonb_agg(r.role order by r.role) from public.party_role r where r.party_id = p.id) papeles
  from public.party p where p.id in (select queda from fichas union all select se_va from fichas);

grant select on fichas, antes_fichas to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.party_merge_do((select queda from fichas), (select se_va from fichas), 'prueba C04R4');
reset role;
-- Lo que devolvió, leído del rastro (la tabla temporal la crea quien tiene permiso, no authenticated).
create temp table r_fusion on commit drop as
select jsonb_build_object('fusion', m.id, 'resumen', m.summary) r from public.party_merge m order by m.done_at desc limit 1;
grant select on r_fusion to authenticated;

do $$
declare v jsonb := (select r from r_fusion); f record; v_papeles_a text; v_papeles_b text; v_a public.party; v_b public.party; v_m public.party_merge;
begin
  select * into f from fichas;
  select * into v_a from public.party where id = f.queda;
  select * into v_b from public.party where id = f.se_va;
  select string_agg(role, ',' order by role) into v_papeles_a from public.party_role where party_id = f.queda;
  select string_agg(role, ',' order by role) into v_papeles_b from public.party_role where party_id = f.se_va;
  if v_papeles_a <> 'brand_partner,customer,supplier' then raise exception 'PRUEBA C04R4 fusionar · 3a: papeles de la que queda «%».', v_papeles_a; end if;
  if v_papeles_b <> 'supplier' then raise exception 'PRUEBA C04R4 fusionar · 3b: en la que se va debía quedar solo su proveedor de Cocina; tiene «%».', v_papeles_b; end if;
  if v_a.tax_id is distinct from 'B99000017' or v_b.tax_id is not null then raise exception 'PRUEBA C04R4 fusionar · 3c: el NIF no pasó (queda %, se va %).', v_a.tax_id, v_b.tax_id; end if;
  if v_b.archived_at is null or v_b.archived_note <> 'Fusionado con Fusión Prueba Diez' then raise exception 'PRUEBA C04R4 fusionar · 3d: la que se va «%» / %.', v_b.archived_note, v_b.archived_at; end if;
  if v_a.archived_at is not null then raise exception 'PRUEBA C04R4 fusionar · 3e: la que queda está archivada.'; end if;
  select * into v_m from public.party_merge where id = (v->>'fusion')::uuid;
  if v_m.id is null or v_m.done_by_name <> 'prueba C04R4' or jsonb_array_length(v_m.kept_on_gone) <> 1 then raise exception 'PRUEBA C04R4 fusionar · 3f: rastro %', to_jsonb(v_m); end if;
  if v->>'resumen' not like 'FUSION PRUEBA VIEJO fusionado en Fusión Prueba Diez: 1 dato movido, con su NIF B99000017; se queda en FUSION PRUEBA VIEJO (archivada) lo que Fusión Prueba Diez ya tenía: su papel de proveedor.' then
    raise exception 'PRUEBA C04R4 fusionar · 3g: resumen «%».', v->>'resumen';
  end if;
  raise notice 'PRUEBA C04R4 fusionar · 3: %', v->>'resumen';
end $$;

\echo '>>> 4. Deshacer'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.party_merge_undo((select (r->>'fusion')::uuid from r_fusion), 'prueba C04R4');
reset role;
do $$ declare v_mal text; begin
  select string_agg(a.id::text, ', ') into v_mal from antes_fichas a join public.party p on p.id = a.id
   where (to_jsonb(p) - 'updated_at') is distinct from a.fila
      or (select jsonb_agg(r.role order by r.role) from public.party_role r where r.party_id = a.id) is distinct from a.papeles;
  if v_mal is not null then raise exception 'PRUEBA C04R4 fusionar · 4: después de deshacer no están como antes: %', v_mal; end if;
  if (select undone_at from public.party_merge where id = (select (r->>'fusion')::uuid from r_fusion)) is null then raise exception 'PRUEBA C04R4 fusionar · 4: la fusión no consta deshecha.'; end if;
  raise notice 'PRUEBA C04R4 fusionar · 4: deshecha; las dos fichas, idénticas a antes (fila y papeles).';
end $$;

\echo '>>> 5. Con asientos validados, PARA'
do $$
declare v_p uuid; v_otra uuid;
begin
  select e.party_id into v_p from public.journal_entry e
   where e.account_id = 'c01a0000-0000-4000-8000-00000000000a' and e.status = 'validado' and e.party_id is not null limit 1;
  if v_p is null then raise exception 'PRUEBA C04R4 fusionar · 5: la semilla de A no tiene un asiento validado con tercero; la prueba no podría fallar.'; end if;
  v_otra := (select queda from fichas);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  begin
    perform public.party_merge_do(v_otra, v_p, 'prueba C04R4');
    raise exception 'PRUEBA C04R4 fusionar · 5: fusionó un tercero con asientos validados.';
  exception when sqlstate '23514' then
    if sqlerrm not like '%lo validado no cambia de tercero%' then raise exception 'PRUEBA C04R4 fusionar · 5: mensaje «%».', sqlerrm; end if;
    raise notice 'PRUEBA C04R4 fusionar · 5: PARA — %', sqlerrm;
  end;
end $$;

\echo '>>> 6. El administrador de B no fusiona lo de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.party_merge_do((select queda from fichas), (select se_va from fichas), 'prueba C04R4 B');
    raise exception 'PRUEBA C04R4 fusionar · 6: B fusionó fichas de A.';
  exception when sqlstate '42501' or sqlstate 'P0002' then
    raise notice 'PRUEBA C04R4 fusionar · 6: B no puede — %', sqlerrm;
  end;
  if exists (select 1 from public.party_merge) then raise exception 'PRUEBA C04R4 fusionar · 6: B ve el rastro de A.'; end if;
end $$;
reset role;

\echo '>>> 7. Vuelta atrás de la migración, y otra vez'
delete from public.party_merge;
\ir ../../vuelta-atras/20261012T0120_c04r_fusionar_terceros.down.sql
do $$ begin
  if to_regclass('public.party_merge') is not null or to_regprocedure('public.party_merge_do(uuid,uuid,text)') is not null then
    raise exception 'PRUEBA C04R4 fusionar · 7: la vuelta atrás no lo quitó todo.';
  end if;
end $$;
\ir ../../migrations/20261012T0120_c04r_fusionar_terceros.sql
\ir ../../migrations/20261012T0120_c04r_fusionar_terceros.sql
\echo '>>> PRUEBA C04R4 fusionar: todo en verde. ROLLBACK.'
rollback;
