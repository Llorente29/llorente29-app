-- supabase/staging/sql/20261110_gb_sin_titulo_prueba.sql
--
-- SOLO STAGING. Prueba de la 1520 del GB (nº 29, 2: «Te lleva: Sin título», no).
-- Cambia public.conta_portal_quien_lleva con la misma firma. Necesita la 1530
-- (portal de Code 3) y la 1403 (si falta, la pone dentro de la transacción).
-- Todo en ROLLBACK, datos inventados (T11).
--
--   1. Con nombre: {nombre, correo}, como antes.
--   2. «Sin título» (también «  sin título  ») o sin nombre, aunque haya correo: null.
--   3. Sin sesión: no se puede llamar. Y la vuelta atrás deja la de antes, byte a byte.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1520: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_yo(uuid,boolean)') is null then
    raise exception 'PRUEBA GB-1520 · 0: falta la 1530 (portal de Code 3) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_quien_lleva(uuid)') is null as falta_la_1403 \gset
\if :falta_la_1403
\i supabase/migrations/20261110T1403_gb_quien_lleva.sql
\endif
select position('untitled' in prosrc) > 0 as ya_esta_la_1520 from pg_proc where oid = to_regprocedure('public.conta_portal_quien_lleva(uuid)') \gset
\if :ya_esta_la_1520
\i supabase/vuelta-atras/20261110T1520_gb_sin_titulo.down.sql
\endif

-- La huella de la función de antes, para la vuelta atrás.
create temp table _antes on commit drop as
select md5(pg_get_functiondef(to_regprocedure('public.conta_portal_quien_lleva(uuid)'))) as huella;

\i supabase/migrations/20261110T1520_gb_sin_titulo.sql

create temp table _g on commit drop as
select p.account_id as cuenta,
       '0000a1a1-0000-4000-8000-000000001520'::uuid as pa, '0000a2a2-0000-4000-8000-000000001520'::uuid as pb,
       '0000a3a3-0000-4000-8000-000000001520'::uuid as pc, null::uuid as ca, null::uuid as cb, null::uuid as cc
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;

do $$
declare g _g; xa uuid; xb uuid; xc uuid;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GB-1520 · 0: staging no tiene un administrador.'; end if;
  insert into auth.users (id, email) values (g.pa, 'portal.a.1520@ejemplo.invalid'), (g.pb, 'portal.b.1520@ejemplo.invalid'), (g.pc, 'portal.c.1520@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Sin Título A Prueba, S.L.', 'B00001520') returning id into xa;
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Sin Título B Prueba, S.L.', 'B00001521') returning id into xb;
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Sin Título C Prueba, S.L.', 'B00001522') returning id into xc;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha)
  values (g.cuenta, xa, 'activo', '{"nombre":"Cliente Sin Título A Prueba, S.L.","responsable":{"idExterno":"7","nombre":" Gestora Prueba ","correo":"gestora.prueba@ejemplo.invalid"}}'),
         (g.cuenta, xb, 'activo', '{"nombre":"Cliente Sin Título B Prueba, S.L.","responsable":{"idExterno":"1","nombre":"  Sin título  ","correo":"sin.titulo@ejemplo.invalid"}}'),
         (g.cuenta, xc, 'activo', '{"nombre":"Cliente Sin Título C Prueba, S.L.","responsable":{"idExterno":"9","nombre":"","correo":"solo.correo@ejemplo.invalid"}}');
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, user_id, permiso)
  values (g.cuenta, xa, 'portal.a.1520@ejemplo.invalid', 'Persona A', g.pa, 'todo'),
         (g.cuenta, xb, 'portal.b.1520@ejemplo.invalid', 'Persona B', g.pb, 'facturas_documentos'),
         (g.cuenta, xc, 'portal.c.1520@ejemplo.invalid', 'Persona C', g.pc, 'todo');
  update _g set ca = xa, cb = xb, cc = xc;
end $$;
grant select on _g to authenticated, anon;
create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to authenticated, anon;
select pa as pa, pb as pb, pc as pc from _g \gset

select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'a', coalesce(public.conta_portal_quien_lleva((select ca from _g)), '"nada"');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'pb', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'b', coalesce(public.conta_portal_quien_lleva((select cb from _g)), '"nada"');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'pc', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'c', coalesce(public.conta_portal_quien_lleva(null), '"nada"');
reset role;

do $$ begin
  if (select r from _r where paso = 'a') <> '{"nombre":"Gestora Prueba","correo":"gestora.prueba@ejemplo.invalid"}' then
    raise exception 'PRUEBA GB-1520 · 1: con nombre no dice quién lleva al cliente (%).', (select jsonb_object_agg(paso, r) from _r);
  end if;
  if (select r from _r where paso = 'b') <> '"nada"' or (select r from _r where paso = 'c') <> '"nada"' then
    raise exception 'PRUEBA GB-1520 · 2: «Sin título» o sin nombre tenían que dar null (%).', (select jsonb_object_agg(paso, r) from _r);
  end if;
  if has_function_privilege('anon', 'public.conta_portal_quien_lleva(uuid)', 'execute') then
    raise exception 'PRUEBA GB-1520 · 3: se puede llamar sin sesión.';
  end if;
  raise notice 'GB-1520 · 1 a 3: con nombre, quién lleva; «Sin título» o sin nombre, null aunque haya correo; sin sesión, no. OK';
end $$;

\i supabase/vuelta-atras/20261110T1520_gb_sin_titulo.down.sql
do $$ begin
  if md5(pg_get_functiondef(to_regprocedure('public.conta_portal_quien_lleva(uuid)'))) is distinct from (select huella from _antes) then
    raise exception 'PRUEBA GB-1520 · 3: la vuelta atrás no deja la función de antes.';
  end if;
  raise notice 'GB-1520 · 3: la vuelta atrás deja la función de antes, byte a byte. OK';
end $$;

rollback;
