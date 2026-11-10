-- supabase/staging/sql/20261110_gb_quien_lleva_prueba.sql
--
-- SOLO STAGING. Prueba de la 1403 del GB (nº 24, el 7 de Code 3: quién lleva al
-- cliente, para el portal). Necesita la 1530 (portal de Code 3), que ya está en
-- staging; si falta, para y lo dice. Todo en ROLLBACK, datos inventados (T11).
--
--   1. La persona del portal (con permiso «todo» o «solo facturas») ve quién
--      lleva a su cliente: el responsable que guardó la lectura del CRM.
--   2. Sin responsable en la ficha: null. Otro cliente: no lo ve (42501).
--   3. Sin sesión: no se puede llamar. Y la vuelta atrás.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1403: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_yo(uuid,boolean)') is null then
    raise exception 'PRUEBA GB-1403 · 0: falta la 1530 (portal de Code 3) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_quien_lleva(uuid)') is not null as ya_esta_la_1403 \gset
\if :ya_esta_la_1403
\i supabase/vuelta-atras/20261110T1403_gb_quien_lleva.down.sql
\endif
\i supabase/migrations/20261110T1403_gb_quien_lleva.sql

create temp table _g on commit drop as
select p.account_id as cuenta,
       '0000a1a1-0000-4000-8000-000000001403'::uuid as pa, '0000a2a2-0000-4000-8000-000000001403'::uuid as pa2,
       '0000b1b1-0000-4000-8000-000000001403'::uuid as pb, null::uuid as ca, null::uuid as cb
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;

do $$
declare g _g; xa uuid; xb uuid;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GB-1403 · 0: staging no tiene un administrador.'; end if;
  insert into auth.users (id, email) values (g.pa, 'portal.a.1403@ejemplo.invalid'), (g.pa2, 'portal.a2.1403@ejemplo.invalid'), (g.pb, 'portal.b.1403@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Quién Lleva A Prueba, S.L.', 'B00001403') returning id into xa;
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Quién Lleva B Prueba, S.L.', 'B00001404') returning id into xb;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha)
  values (g.cuenta, xa, 'activo', '{"nombre":"Cliente Quién Lleva A Prueba, S.L.","responsable":{"idExterno":"7","nombre":"Gestora Prueba","correo":"gestora.prueba@ejemplo.invalid"}}'),
         (g.cuenta, xb, 'activo', '{"nombre":"Cliente Quién Lleva B Prueba, S.L.","responsable":{"idExterno":"9","nombre":null,"correo":null}}');
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, user_id, permiso)
  values (g.cuenta, xa, 'portal.a.1403@ejemplo.invalid', 'Persona A', g.pa, 'todo'),
         (g.cuenta, xa, 'portal.a2.1403@ejemplo.invalid', 'Persona A2', g.pa2, 'facturas_documentos'),
         (g.cuenta, xb, 'portal.b.1403@ejemplo.invalid', 'Persona B', g.pb, 'todo');
  update _g set ca = xa, cb = xb;
end $$;
grant select on _g to authenticated, anon;
create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to authenticated, anon;
select pa as pa, pa2 as pa2, pb as pb, ca as ca, cb as cb from _g \gset

-- 1 · Con «todo» y con «solo facturas».
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'a', public.conta_portal_quien_lleva((select ca from _g));
insert into _r select 'a_sin', public.conta_portal_quien_lleva(null);
do $$ begin
  begin
    perform public.conta_portal_quien_lleva((select cb from _g));
    insert into _r values ('a_a_b', '"se pudo"');
  exception when insufficient_privilege then insert into _r values ('a_a_b', '"no"'); end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'pa2', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'a2', public.conta_portal_quien_lleva((select ca from _g));
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'pb', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'b', coalesce(public.conta_portal_quien_lleva((select cb from _g)), '"nada"');
reset role;

do $$
declare esperado jsonb := '{"nombre":"Gestora Prueba","correo":"gestora.prueba@ejemplo.invalid"}';
begin
  if (select r from _r where paso = 'a') <> esperado or (select r from _r where paso = 'a_sin') <> esperado or (select r from _r where paso = 'a2') <> esperado then
    raise exception 'PRUEBA GB-1403 · 1: no dice quién lleva al cliente (%).', (select jsonb_object_agg(paso, r) from _r);
  end if;
  if (select r from _r where paso = 'b') <> '"nada"' or (select r from _r where paso = 'a_a_b') <> '"no"' then
    raise exception 'PRUEBA GB-1403 · 2: sin responsable u otro cliente no son lo esperado (%).', (select jsonb_object_agg(paso, r) from _r);
  end if;
  if has_function_privilege('anon', 'public.conta_portal_quien_lleva(uuid)', 'execute') then
    raise exception 'PRUEBA GB-1403 · 3: se puede llamar sin sesión.';
  end if;
  raise notice 'GB-1403 · 1 a 3: quién lleva, con «todo» y con «solo facturas»; sin responsable, nada; otro cliente, no; sin sesión, no. OK';
end $$;

\i supabase/vuelta-atras/20261110T1403_gb_quien_lleva.down.sql
do $$ begin
  if to_regprocedure('public.conta_portal_quien_lleva(uuid)') is not null then raise exception 'PRUEBA GB-1403 · 3: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-1403 · 3: la vuelta atrás la quita. OK';
end $$;

rollback;
