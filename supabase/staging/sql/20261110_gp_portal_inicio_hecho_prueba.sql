-- supabase/staging/sql/20261110_gp_portal_inicio_hecho_prueba.sql
--
-- SOLO STAGING. Prueba de la 0945 (GP · nº 24, puntos 1 y 4: Inicio como la
-- maqueta). Todo en una transacción con ROLLBACK, con datos inventados (T11): no
-- cambia staging.
--
--   1. «Lo que te pide tu gestoría»: lo pendiente, primero; lo hecho en los
--      últimos 14 días, después, con su estado, cuándo y lo recibido; lo hecho
--      hace más de 14 días y lo anulado, no.
--   2. «Lo último»: las nóminas del último mes que dejó la gestoría, con cuántas.
--   3. «Facturas y documentos» no ve ni lo que se le pide ni las nóminas.
--   4. La vuelta atrás: public.conta_portal_inicio como estaba (sin lo hecho).
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-0945: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) > 0 as ya_esta_la_0945 \gset
\if :ya_esta_la_0945
\i supabase/vuelta-atras/20261110T0945_gp_portal_inicio_hecho.down.sql
\endif
\i supabase/migrations/20261110T0945_gp_portal_inicio_hecho.sql

-- ── 0 · Un cliente con su cuenta propia, dos personas, cuatro peticiones y nóminas de dos meses ─
create temp table _g on commit drop as
select p.account_id as cuenta, '0000a1a1-0000-4000-8000-000000000945'::uuid as todo_u, '0000a1a1-0000-4000-8000-000000000946'::uuid as fd_u, null::uuid as cliente
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;
do $$
declare g _g; v_cli uuid; v_a uuid; q2 uuid; v_e uuid; m0 timestamptz := date_trunc('month', now()) + interval '2 days'; m1 timestamptz := date_trunc('month', now()) - interval '1 month' + interval '2 days';
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GP-0945 · 0: staging no tiene un administrador.'; end if;
  insert into auth.users (id, email) values (g.todo_u, 'todo.0945@ejemplo.invalid'), (g.fd_u, 'facturas.0945@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Inicio Prueba, S.L.', 'B00000945') returning id into v_cli;
  -- Su cuenta propia en Sumied: la de la gestoría misma (basta para leer sus nóminas).
  insert into public.conta_gestoria_cliente (party_id, account_id, cuenta_propia_account_id) values (v_cli, g.cuenta, g.cuenta);
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'todo.0945@ejemplo.invalid', g.todo_u, 'todo') returning id into v_a;
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'facturas.0945@ejemplo.invalid', g.fd_u, 'facturas_documentos');
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, fecha_limite) values (g.cuenta, v_cli, 'contestar', 'Pendiente de prueba', current_date + 5);
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, estado, hecha_at) values (g.cuenta, v_cli, 'subir', 'Hecha hace dos días', 'hecha', now() - interval '2 days') returning id into q2;
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, estado, hecha_at) values (g.cuenta, v_cli, 'subir', 'Hecha hace veinte días', 'hecha', now() - interval '20 days');
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, estado, hecha_at) values (g.cuenta, v_cli, 'contestar', 'Anulada de prueba', 'anulada', now());
  insert into public.conta_portal_subida (account_id, party_id, acceso_id, peticion_id, ruta, nombre) values
    (g.cuenta, v_cli, v_a, q2, g.cuenta || '/' || v_cli || '/subidas/a.pdf', 'a.pdf'), (g.cuenta, v_cli, v_a, q2, g.cuenta || '/' || v_cli || '/subidas/b.pdf', 'b.pdf');
  -- Nóminas: tres de este mes y una del anterior (sale solo el último mes, con 3).
  insert into public.employees (account_id, name) values (g.cuenta, 'Persona Prueba 0945') returning id into v_e;
  insert into public.documents (employee_id, type, name, file_path, carpeta, created_at) values
    (v_e, 'nomina', 'n1.pdf', 'x/n1.pdf', 'nominas', m0), (v_e, 'nomina', 'n2.pdf', 'x/n2.pdf', 'nominas', m0), (v_e, 'nomina', 'n3.pdf', 'x/n3.pdf', 'nominas', m0),
    (v_e, 'nomina', 'n0.pdf', 'x/n0.pdf', 'nominas', m1);
  update _g set cliente = v_cli;
end $$;
grant select on _g to authenticated;
select todo_u as todo_u, fd_u as fd_u from _g \gset

-- ── 1 y 2 · «Todo» ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'todo_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb := public.conta_portal_inicio((select cliente from _g)); p jsonb; n jsonb;
begin
  p := j -> 'peticiones';
  if jsonb_array_length(p) <> 2 or p -> 0 ->> 'titulo' <> 'Pendiente de prueba' or p -> 0 ->> 'estado' <> 'pendiente'
     or p -> 1 ->> 'titulo' <> 'Hecha hace dos días' or p -> 1 ->> 'estado' <> 'hecha' or (p -> 1 ->> 'recibidas')::int <> 2 or p -> 1 ->> 'hecha' is null then
    raise exception 'PRUEBA GP-0945 · 1: las peticiones no son lo pendiente y lo hecho hace poco, con lo recibido: %', p;
  end if;
  select x into n from jsonb_array_elements(j -> 'novedades') x where x ->> 'tipo' = 'nomina';
  if n is null or (n ->> 'n')::int <> 3 or n ->> 'id' <> to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM') then
    raise exception 'PRUEBA GP-0945 · 2: «Lo último» no trae las nóminas del último mes (3): %', j -> 'novedades';
  end if;
  raise notice 'GP-0945 · 1 y 2: lo pendiente primero, lo hecho hace poco con 2 recibidos; ni lo viejo ni lo anulado; las 3 nóminas del último mes en «Lo último». OK';
end $$;
reset role;

-- ── 3 · «Facturas y documentos» ────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'fd_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb := public.conta_portal_inicio((select cliente from _g));
begin
  if jsonb_array_length(j -> 'peticiones') <> 0 or exists (select 1 from jsonb_array_elements(j -> 'novedades') x where x ->> 'tipo' = 'nomina') then
    raise exception 'PRUEBA GP-0945 · 3: «Facturas y documentos» ve peticiones o nóminas: %', j;
  end if;
  raise notice 'GP-0945 · 3: «Facturas y documentos» no ve ni peticiones ni nóminas. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 4 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261110T0945_gp_portal_inicio_hecho.down.sql
do $$ begin
  if position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-0945 · 4: la vuelta atrás no deja public.conta_portal_inicio como estaba.';
  end if;
  raise notice 'GP-0945 · 4: la vuelta atrás deja public.conta_portal_inicio como estaba. OK';
end $$;

rollback;
