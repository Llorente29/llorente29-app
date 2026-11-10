-- supabase/staging/sql/20261109_gp_portal_bitrix_prueba.sql
--
-- SOLO STAGING. Prueba de la 2345 (GP · nº 17: «Invitar al portal» y «Contestar
-- un mensaje» desde la pestaña de Bitrix24, sin sesión de Sumied). Todo en una
-- transacción con ROLLBACK, con datos inventados (T11): no cambia staging.
--
--   1. Quién mira: con un portal y un correo que no son de nadie, «sin_acceso»;
--      con una ficha que no es de ningún cliente, «sin_enlazar»; con una ficha
--      rara, «ficha_rara». Nada se escribe.
--   2. Invitar: el administrador (por su correo de Bitrix24) invita a una
--      persona al portal del cliente de la ficha abierta; el acceso queda a
--      nombre de quien mira. Un correo que no vale, «no» con su frase.
--   3. Contestar: el mensaje queda de la gestoría, escrito por esa persona, y lo
--      del cliente, leído. Vacío, «no».
--   4. Permisos: solo service_role; ni anon ni authenticated (tampoco la persona
--      del portal) pueden llamar a ninguna de las tres.
--   5. La vuelta atrás: fuera las tres funciones.
--
-- sin usuario: lo llama el servidor (service_role) después de comprobar con Bitrix24 quién mira; la prueba 4 mira que nadie con sesión pueda.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-2345: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select to_regprocedure('public.conta_portal_bitrix_invitar(text,text,text,text,text,text,text)') is not null as ya_esta_la_2345 \gset
\if :ya_esta_la_2345
\i supabase/vuelta-atras/20261109T2345_gp_portal_bitrix.down.sql
\endif
\i supabase/migrations/20261109T2345_gp_portal_bitrix.sql

-- ── 0 · Un portal de Bitrix24 inventado en la cuenta de un administrador, y la ficha de un cliente ─
create temp table _g on commit drop as
select p.account_id as cuenta, p.user_id as admin, lower(u.email) as correo, null::uuid as cliente, 'prueba-2345.bitrix24.example'::text as portal
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role = 'admin' and u.email is not null order by p.created_at limit 1;
do $$
declare g _g; v_cli uuid;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GP-2345 · 0: staging no tiene un administrador con correo.'; end if;
  -- Que el correo no esté en otra cuenta con este portal (no lo está: el portal es inventado).
  insert into public.conta_crm (account_id, crm, entorno, portal) values (g.cuenta, 'bitrix24', 'pruebas', g.portal)
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Bitrix Prueba, S.L.', 'B00002345') returning id into v_cli;
  insert into public.conta_gestoria_ficha (account_id, party_id, crm, tipo_ficha, id_externo) values (g.cuenta, v_cli, 'bitrix24', 'empresa', '2345001');
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto) values (g.cuenta, v_cli, 'cliente', 'Cliente de Prueba', '¿Me mandáis el 303?');
  update _g set cliente = v_cli;
end $$;

-- ── 1 · Quién mira ─────────────────────────────────────────────────────────────
do $$
declare g _g; v jsonb;
begin
  select * into g from _g;
  perform set_config('request.jwt.claims', '', true);
  v := public.conta_portal_bitrix_invitar(g.portal, 'nadie@ejemplo.invalid', 'empresa', '2345001', 'x@ejemplo.invalid');
  if v ->> 'estado' <> 'sin_acceso' then raise exception 'PRUEBA GP-2345 · 1: un correo que no es de nadie da %', v; end if;
  v := public.conta_portal_bitrix_contestar('otro-portal.bitrix24.example', g.correo, 'empresa', '2345001', 'hola');
  if v ->> 'estado' <> 'sin_acceso' then raise exception 'PRUEBA GP-2345 · 1: otro portal da %', v; end if;
  v := public.conta_portal_bitrix_contestar(g.portal, g.correo, 'empresa', '2345999', 'hola');
  if v ->> 'estado' <> 'sin_enlazar' then raise exception 'PRUEBA GP-2345 · 1: una ficha sin cliente da %', v; end if;
  v := public.conta_portal_bitrix_contestar(g.portal, g.correo, 'tarea', '1', 'hola');
  if v ->> 'estado' <> 'ficha_rara' then raise exception 'PRUEBA GP-2345 · 1: una ficha rara da %', v; end if;
  if exists (select 1 from public.conta_portal_acceso where party_id = g.cliente) or (select count(*) from public.conta_portal_mensaje where party_id = g.cliente) <> 1 then
    raise exception 'PRUEBA GP-2345 · 1: sin saber quién mira, se ha escrito algo.';
  end if;
  raise notice 'GP-2345 · 1: sin_acceso, sin_enlazar y ficha_rara, sin escribir nada. OK';
end $$;

-- ── 2 · Invitar ────────────────────────────────────────────────────────────────
do $$
declare g _g; v jsonb; a public.conta_portal_acceso;
begin
  select * into g from _g;
  perform set_config('request.jwt.claims', '', true);
  v := public.conta_portal_bitrix_invitar(g.portal, upper(g.correo), 'empresa', '2345001', 'persona.portal@ejemplo.invalid', 'Persona de Prueba', 'todo');
  if v ->> 'estado' <> 'ok' or v ->> 'acceso_id' is null or (v ->> 'cliente')::uuid <> g.cliente then raise exception 'PRUEBA GP-2345 · 2: invitar da %', v; end if;
  select * into a from public.conta_portal_acceso where id = (v ->> 'acceso_id')::uuid;
  if a.party_id <> g.cliente or a.invitado_por <> g.admin or a.permiso <> 'todo' then raise exception 'PRUEBA GP-2345 · 2: el acceso no es como se pidió: %', to_jsonb(a); end if;
  v := public.conta_portal_bitrix_invitar(g.portal, g.correo, 'empresa', '2345001', 'esto-no-es-un-correo');
  if v ->> 'estado' <> 'no' or coalesce(v ->> 'frase', '') = '' then raise exception 'PRUEBA GP-2345 · 2: un correo que no vale da %', v; end if;
  raise notice 'GP-2345 · 2: invita como quien mira, al cliente de la ficha abierta; un correo malo, «no» con su frase. OK';
end $$;

-- ── 3 · Contestar ──────────────────────────────────────────────────────────────
do $$
declare g _g; v jsonb; m public.conta_portal_mensaje;
begin
  select * into g from _g;
  perform set_config('request.jwt.claims', '', true);
  v := public.conta_portal_bitrix_contestar(g.portal, g.correo, 'empresa', '2345001', 'Sí, te lo subo hoy a tus documentos.');
  if v ->> 'estado' <> 'ok' then raise exception 'PRUEBA GP-2345 · 3: contestar da %', v; end if;
  select * into m from public.conta_portal_mensaje where id = (v ->> 'id')::uuid;
  if m.de <> 'gestoria' or m.autor <> g.admin or m.party_id <> g.cliente then raise exception 'PRUEBA GP-2345 · 3: el mensaje no es de la gestoría por quien mira: %', to_jsonb(m); end if;
  if exists (select 1 from public.conta_portal_mensaje where party_id = g.cliente and de = 'cliente' and leido_at is null) then
    raise exception 'PRUEBA GP-2345 · 3: lo del cliente sigue sin leer.';
  end if;
  v := public.conta_portal_bitrix_contestar(g.portal, g.correo, 'empresa', '2345001', '   ');
  if v ->> 'estado' <> 'no' then raise exception 'PRUEBA GP-2345 · 3: un mensaje vacío da %', v; end if;
  raise notice 'GP-2345 · 3: contesta como la gestoría, por quien mira, y deja leído lo del cliente; vacío, «no». OK';
end $$;

-- ── 4 · Permisos ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public._conta_portal_bitrix_quien(text,text,text,text)', 'public.conta_portal_bitrix_invitar(text,text,text,text,text,text,text)',
                           'public.conta_portal_bitrix_contestar(text,text,text,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA GP-2345 · 4: anon puede llamar a %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA GP-2345 · 4: authenticated puede llamar a %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'PRUEBA GP-2345 · 4: service_role no puede llamar a %', f; end if;
  end loop;
  raise notice 'GP-2345 · 4: las tres, solo service_role. OK';
end $$;

-- ── 5 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261109T2345_gp_portal_bitrix.down.sql
do $$ begin
  if to_regprocedure('public.conta_portal_bitrix_invitar(text,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.conta_portal_bitrix_contestar(text,text,text,text,text)') is not null
     or to_regprocedure('public._conta_portal_bitrix_quien(text,text,text,text)') is not null then
    raise exception 'PRUEBA GP-2345 · 5: la vuelta atrás deja alguna función.';
  end if;
  raise notice 'GP-2345 · 5: la vuelta atrás quita las tres. OK';
end $$;

rollback;
