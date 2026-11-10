-- supabase/staging/sql/20261109_gp_portal_demo_prueba.sql
--
-- SOLO STAGING. Prueba de la 2240 (GP · el portal de la demo). Todo en una
-- transacción con ROLLBACK, con datos inventados (T11): no cambia staging.
--
--   1. En la cuenta demo, con un Talleres Ruiz inventado: preparar deja los
--      ajustes (banco y tarjeta), el acceso de Tomás Ruiz (sin usuario), un
--      mensaje y una petición «para el 10», todo ya avisado (no sale correo).
--   2. Preparar otra vez no duplica nada (como después de «Volver a empezar»,
--      que vacía las tablas del portal: vuelve a ponerlo).
--   3. Solo una cuenta demo, y solo quien la lleva: en otra cuenta, o con una
--      persona que no es de la demo, para.
--   4. La regla de los permisos: anon no; authenticated y service_role sí.
--   5. La vuelta atrás: fuera la función y lo sembrado.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la persona que no lleva la demo se prueba con su sesión.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-2240: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select to_regprocedure('public.conta_portal_demo_preparar(uuid)') is not null as ya_esta_la_2240 \gset
\if :ya_esta_la_2240
\i supabase/vuelta-atras/20261109T2240_gp_portal_demo.down.sql
\endif

-- ── 0 · La cuenta demo (la de staging o una inventada) y un Talleres Ruiz inventado ─
create temp table _g on commit drop as select 'de000000-0000-4000-8000-0000000000a0'::uuid as demo, null::uuid as cliente, null::uuid as otra, null::uuid as persona;
do $$
declare v_otra uuid; v_persona uuid; v_cli uuid;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0') then
    insert into public.accounts (id, name, slug, is_demo) values ('de000000-0000-4000-8000-0000000000a0', 'Gestoría Demo (prueba)', 'gestoria-demo-prueba-2240', true);
  end if;
  update public.accounts set is_demo = true where id = 'de000000-0000-4000-8000-0000000000a0';
  if not exists (select 1 from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0' and name = 'Talleres Ruiz, S.L.') then
    insert into public.party (account_id, name, tax_id) values ('de000000-0000-4000-8000-0000000000a0', 'Talleres Ruiz, S.L.', 'B00002240') returning id into v_cli;
  else
    select id into v_cli from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0' and name = 'Talleres Ruiz, S.L.' order by created_at limit 1;
  end if;
  -- Otra cuenta (no demo) con un administrador: la persona que no lleva la demo.
  select p.account_id, p.user_id into v_otra, v_persona from public.user_profiles p
   where p.active and p.role = 'admin' and p.account_id <> 'de000000-0000-4000-8000-0000000000a0' order by p.created_at limit 1;
  update _g set cliente = v_cli, otra = v_otra, persona = v_persona;
end $$;

\i supabase/migrations/20261109T2240_gp_portal_demo.sql

-- ── 1 y 2 · Preparar, y preparar otra vez ──────────────────────────────────────
do $$
declare g _g; v jsonb; n1 int; n2 int; q public.conta_portal_peticion;
begin
  select * into g from _g;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v := public.conta_portal_demo_preparar(g.demo);   -- la migración ya la llamó una vez: esta es la segunda
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.conta_portal_ajustes where account_id = g.demo and pagar_devuelto @> array['banco', 'tarjeta']) then
    raise exception 'PRUEBA GP-2240 · 1: el devuelto no se paga por los dos caminos.';
  end if;
  if not exists (select 1 from public.conta_portal_acceso where party_id = g.cliente and correo = 'tomas.ruiz@talleresruiz.example' and user_id is null and permiso = 'todo' and revocado_at is null) then
    raise exception 'PRUEBA GP-2240 · 1: falta el acceso de Tomás Ruiz.';
  end if;
  select * into q from public.conta_portal_peticion where party_id = g.cliente and estado = 'pendiente';
  if q.id is null or extract(day from q.fecha_limite) <> 10 or q.fecha_limite <= (now() at time zone 'Europe/Madrid')::date or q.avisado_at is null then
    raise exception 'PRUEBA GP-2240 · 1: la petición no es «para el 10» del mes que viene, o no va avisada: %', to_jsonb(q);
  end if;
  if exists (select 1 from public.conta_portal_mensaje where party_id = g.cliente and avisado_at is null) then
    raise exception 'PRUEBA GP-2240 · 1: el mensaje de bienvenida mandaría un correo.';
  end if;
  select (select count(*) from public.conta_portal_acceso where party_id = g.cliente) + (select count(*) from public.conta_portal_mensaje where party_id = g.cliente)
       + (select count(*) from public.conta_portal_peticion where party_id = g.cliente) into n1;
  if n1 <> 3 then raise exception 'PRUEBA GP-2240 · 2: preparar dos veces deja % filas (acceso, mensaje y petición: 3).', n1; end if;
  if v ->> 'frase' not like 'El portal de la demo ya estaba preparado%' then raise exception 'PRUEBA GP-2240 · 2: la segunda vez dice «%».', v ->> 'frase'; end if;
  -- Como después de «Volver a empezar»: vacías las tablas del portal, vuelve a ponerlo.
  delete from public.conta_portal_peticion where account_id = g.demo; delete from public.conta_portal_mensaje where account_id = g.demo;
  delete from public.conta_portal_acceso where account_id = g.demo; delete from public.conta_portal_ajustes where account_id = g.demo;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v := public.conta_portal_demo_preparar(g.demo);
  perform set_config('request.jwt.claims', '', true);
  select (select count(*) from public.conta_portal_acceso where party_id = g.cliente) + (select count(*) from public.conta_portal_mensaje where party_id = g.cliente)
       + (select count(*) from public.conta_portal_peticion where party_id = g.cliente) + (select count(*) from public.conta_portal_ajustes where account_id = g.demo) into n2;
  if n2 <> 4 then raise exception 'PRUEBA GP-2240 · 2: después de vaciar, preparar deja % filas (4).', n2; end if;
  raise notice 'GP-2240 · 1 y 2: preparar deja ajustes, acceso, mensaje y petición «para el %», ya avisados; otra vez, nada más; después de vaciar, lo vuelve a poner. OK', to_char(q.fecha_limite, 'DD/MM');
end $$;

-- ── 3 · Solo una cuenta demo, y solo quien la lleva ────────────────────────────
do $$
declare g _g;
begin
  select * into g from _g;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    perform public.conta_portal_demo_preparar(coalesce(g.otra, gen_random_uuid()));
    raise exception 'PRUEBA GP-2240 · 3: preparó el portal de una cuenta que no es demo.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;
grant select on _g to authenticated;
select persona as persona from _g \gset
\if :{?persona}
select set_config('request.jwt.claims', json_build_object('sub', :'persona', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.conta_portal_demo_preparar('de000000-0000-4000-8000-0000000000a0');
  raise exception 'PRUEBA GP-2240 · 3: alguien que no lleva la demo la ha preparado.';
exception when insufficient_privilege then
  raise notice 'GP-2240 · 3: solo una cuenta demo, y solo quien la lleva. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
\endif

-- ── 4 · Permisos ───────────────────────────────────────────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.conta_portal_demo_preparar(uuid)', 'execute') then raise exception 'PRUEBA GP-2240 · 4: anon puede preparar la demo.'; end if;
  if not has_function_privilege('authenticated', 'public.conta_portal_demo_preparar(uuid)', 'execute') then raise exception 'PRUEBA GP-2240 · 4: authenticated no puede (el botón).'; end if;
  if not has_function_privilege('service_role', 'public.conta_portal_demo_preparar(uuid)', 'execute') then raise exception 'PRUEBA GP-2240 · 4: service_role no puede.'; end if;
  raise notice 'GP-2240 · 4: anon no; authenticated (comprueba quién llama) y service_role sí. OK';
end $$;

-- ── 5 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261109T2240_gp_portal_demo.down.sql
do $$
declare g _g; n int;
begin
  select * into g from _g;
  if to_regprocedure('public.conta_portal_demo_preparar(uuid)') is not null then raise exception 'PRUEBA GP-2240 · 5: la función sigue.'; end if;
  select (select count(*) from public.conta_portal_acceso where party_id = g.cliente) + (select count(*) from public.conta_portal_mensaje where party_id = g.cliente)
       + (select count(*) from public.conta_portal_peticion where party_id = g.cliente) + (select count(*) from public.conta_portal_ajustes where account_id = g.demo) into n;
  if n <> 0 then raise exception 'PRUEBA GP-2240 · 5: la vuelta atrás deja % filas sembradas.', n; end if;
  raise notice 'GP-2240 · 5: la vuelta atrás quita la función y lo sembrado. OK';
end $$;

rollback;
