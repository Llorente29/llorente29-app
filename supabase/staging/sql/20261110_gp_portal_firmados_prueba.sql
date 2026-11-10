-- supabase/staging/sql/20261110_gp_portal_firmados_prueba.sql
--
-- SOLO STAGING. Prueba de la 0005 (GP · nº 19.1: lo firmado, en Documentos).
-- Todo en una transacción con ROLLBACK, con datos inventados (T11): no cambia
-- staging.
--
--   1. Quien tiene «Todo» ve en public.conta_portal_documentos lo que ha firmado
--      (la petición, cuándo y que ya está el PDF); lo pendiente o anulado, no.
--   2. «Facturas y documentos» no ve lo firmado (no puede firmar ni abrirlo).
--   3. Lo de antes sigue igual (impuestos, nóminas y lo subido).
--   4. La vuelta atrás: public.conta_portal_documentos como estaba (sin «firmados»).
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-0005: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select position('''firmados''' in pg_get_functiondef('public.conta_portal_documentos(uuid)'::regprocedure)) > 0 as ya_esta_la_0005 \gset
\if :ya_esta_la_0005
\i supabase/vuelta-atras/20261110T0005_gp_portal_firmados.down.sql
\endif
\i supabase/migrations/20261110T0005_gp_portal_firmados.sql

-- ── 0 · Un cliente con dos personas en el portal y tres peticiones de firma ────
create temp table _g on commit drop as
select p.account_id as cuenta, '0000a1a1-0000-4000-8000-000000000005'::uuid as todo_u, '0000a1a1-0000-4000-8000-000000000006'::uuid as fd_u, null::uuid as cliente
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;
do $$
declare g _g; v_cli uuid; v_a uuid; q1 uuid; q2 uuid; q3 uuid;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GP-0005 · 0: staging no tiene un administrador.'; end if;
  insert into auth.users (id, email) values (g.todo_u, 'todo.0005@ejemplo.invalid'), (g.fd_u, 'facturas.0005@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Firmas Prueba, S.L.', 'B00000005') returning id into v_cli;
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'todo.0005@ejemplo.invalid', g.todo_u, 'todo') returning id into v_a;
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'facturas.0005@ejemplo.invalid', g.fd_u, 'facturas_documentos');
  -- Firmada (con su PDF), pendiente y anulada.
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, documento_ruta, estado, hecha_at)
  values (g.cuenta, v_cli, 'firmar', 'Hoja de encargo de prueba', g.cuenta || '/' || v_cli || '/peticiones/hoja.pdf', 'hecha', now()) returning id into q1;
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, documento_ruta)
  values (g.cuenta, v_cli, 'firmar', 'Contrato pendiente de prueba', g.cuenta || '/' || v_cli || '/peticiones/contrato.pdf') returning id into q2;
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, documento_ruta, estado, hecha_at)
  values (g.cuenta, v_cli, 'firmar', 'Anulada de prueba', g.cuenta || '/' || v_cli || '/peticiones/anulada.pdf', 'anulada', now()) returning id into q3;
  insert into public.conta_portal_firma (account_id, party_id, peticion_id, acceso_id, canal, destino, codigo_hash, expira_at, firmada_at, ip, navegador, pdf_ruta)
  values (g.cuenta, v_cli, q1, v_a, 'correo', 't•••@ejemplo.invalid', repeat('0', 64), now() + interval '10 minutes', now(), '192.0.2.5', 'Prueba', g.cuenta || '/' || v_cli || '/firmas/x.pdf');
  update _g set cliente = v_cli;
end $$;
grant select on _g to authenticated;

-- ── 1 y 3 · «Todo» ve lo firmado; lo de antes, igual ───────────────────────────
select todo_u as todo_u, fd_u as fd_u from _g \gset
select set_config('request.jwt.claims', json_build_object('sub', :'todo_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb := public.conta_portal_documentos((select cliente from _g));
begin
  if jsonb_array_length(j -> 'firmados') <> 1 or j -> 'firmados' -> 0 ->> 'titulo' <> 'Hoja de encargo de prueba'
     or (j -> 'firmados' -> 0 ->> 'pdf')::boolean is not true or j -> 'firmados' -> 0 ->> 'firmada' is null then
    raise exception 'PRUEBA GP-0005 · 1: «Todo» no ve justo lo firmado: %', j -> 'firmados';
  end if;
  if not (j ? 'impuestos' and j ? 'nominas' and j ? 'subidas' and j ? 'puede_subir') then raise exception 'PRUEBA GP-0005 · 3: falta algo de lo de antes: %', j; end if;
  raise notice 'GP-0005 · 1 y 3: «Todo» ve lo firmado (no lo pendiente ni lo anulado), con su PDF; lo de antes, igual. OK';
end $$;
reset role;

-- ── 2 · «Facturas y documentos» no lo ve ───────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'fd_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb := public.conta_portal_documentos((select cliente from _g));
begin
  if jsonb_array_length(j -> 'firmados') <> 0 then raise exception 'PRUEBA GP-0005 · 2: «Facturas y documentos» ve lo firmado.'; end if;
  raise notice 'GP-0005 · 2: «Facturas y documentos» no ve lo firmado. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 4 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261110T0005_gp_portal_firmados.down.sql
do $$ begin
  if position('''firmados''' in pg_get_functiondef('public.conta_portal_documentos(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-0005 · 4: la vuelta atrás no deja public.conta_portal_documentos como estaba.';
  end if;
  raise notice 'GP-0005 · 4: la vuelta atrás deja public.conta_portal_documentos como estaba. OK';
end $$;

rollback;
