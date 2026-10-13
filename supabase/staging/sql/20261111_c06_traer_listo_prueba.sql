-- supabase/staging/sql/20261111_c06_traer_listo_prueba.sql
--
-- SOLO STAGING. Prueba de «C06 · traer de Diez: los pasos de antes y la
-- subcuenta sin nombre» (20261111T0300): conta_diez_subcuentas,
-- conta_diez_listo, company_account.name_pending y su disparador. Todo en una
-- transacción con ROLLBACK: no cambia staging.
--
--   1. Una empresa recién creada: falta «datos»; con el alta hecha, «plan»;
--      con el plan elegido y activado, «banco»; con la subcuenta del banco,
--      «diez»; y la base registrada sale en el paso.
--   2. conta_diez_subcuentas: la que llega SIN nombre entra con el nombre de
--      su cuenta del plan, marcada (name_pending) y en «sinNombre»; la que trae
--      nombre, igual que antes; la de serie, igual; la de dígitos mal y la que
--      no cuelga de nada, rechazadas como antes.
--   3. Ponerle nombre quita la marca (company_account_rename).
--   4. Como el cliente: ve los pasos de SU empresa (y cuántas sin nombre) y no
--      los de otra cuenta.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06 traer listo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

do $$
declare
  u  constant uuid := 'c0600000-0000-4000-8000-0000000000f7';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'listo.prueba@c06-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    ('c0600000-0000-4000-8000-0000000000f6', 'Prueba Listo', 'c06-prueba-listo', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, 'c0600000-0000-4000-8000-0000000000f6', 'admin', true, 'Prueba Listo', now(), now());
  insert into public.company (id, account_id, legal_name, setup_step) values
    ('c0600000-0000-4000-8000-0000000000f8', 'c0600000-0000-4000-8000-0000000000f6', 'Prueba Listo, S.L.', 'nombre');
end $$;

set local role service_role;

-- 1 · Los pasos, en orden.
do $$
declare r jsonb; c constant uuid := 'c0600000-0000-4000-8000-0000000000f8';
begin
  r := public.conta_diez_listo(c);
  if r ->> 'falta' <> 'datos' then raise exception '1: recién creada, esperaba que faltara «datos» y falta %.', r ->> 'falta'; end if;
  update public.company set legal_name = 'Prueba Listo, S.L.', tax_id = 'B12345674', tax_id_type = 'nif_es', entity_kind = 'company',
         setup_step = 'hecho', setup_completed_at = now() where id = c;
  r := public.conta_diez_listo(c);
  if r ->> 'falta' <> 'plan' then raise exception '1: con el alta, esperaba «plan» y falta %.', r ->> 'falta'; end if;
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits) values (c, 'c0600000-0000-4000-8000-0000000000f6', 'pymes', 8);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values ('c0600000-0000-4000-8000-0000000000f6', c, 'pymes', '62900000', '629', 'Otros servicios', 'template', 'serie');
  r := public.conta_diez_listo(c);
  if r ->> 'falta' <> 'banco' then raise exception '1: con el plan, esperaba «banco» y falta %.', r ->> 'falta'; end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values ('c0600000-0000-4000-8000-0000000000f6', c, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');
  r := public.conta_diez_listo(c);
  if r ->> 'falta' <> 'diez' or (r -> 'pasos' -> 3 ->> 'base') is not null then raise exception '1: con el banco, esperaba «diez» sin base y es %.', r; end if;
  perform public.conta_diez_base_poner(c, 'C0061', 'Prueba de los pasos', 'Folvy (prueba)');
  r := public.conta_diez_listo(c);
  if (r -> 'pasos' -> 3 ->> 'base') <> 'C0061' then raise exception '1: la base no sale en el paso «diez» (%).', r; end if;
  raise notice '1 OK: datos → plan → banco → diez, y la base registrada en su paso.';
end $$;

-- 2 · Las subcuentas que llegan de Diez.
do $$
declare r jsonb; c constant uuid := 'c0600000-0000-4000-8000-0000000000f8'; v_run uuid; a record;
begin
  insert into public.import_run (account_id, company_id, program, kind, created_by_name)
  values ('c0600000-0000-4000-8000-0000000000f6', c, 'diez', 'historico', 'Prueba C06') returning id into v_run;
  r := public.conta_diez_subcuentas(c, v_run, jsonb_build_array(
    jsonb_build_object('code', '57200002', 'nombre', null),
    jsonb_build_object('code', '57200003', 'nombre', 'Banco de la prueba'),
    jsonb_build_object('code', '62900000', 'nombre', 'Otros servicios'),
    jsonb_build_object('code', '1234', 'nombre', 'Corta'),
    jsonb_build_object('code', '99900001', 'nombre', 'De nada')));
  if (r -> 'sinNombre') <> '["57200002"]'::jsonb then raise exception '2: «sinNombre» debería ser [57200002] y es %.', r -> 'sinNombre'; end if;
  if (r ->> 'nuevas')::int <> 2 or (r ->> 'estaban')::int <> 1 or jsonb_array_length(r -> 'rechazadas') <> 2 then
    raise exception '2: esperaba 2 nuevas, 1 que estaba y 2 rechazadas, y es %.', r;
  end if;
  select name, name_pending, name_source, kind, source into a from public.company_account where company_id = c and code = '57200002';
  if not a.name_pending or a.name_source is not null or a.name <> (select p.name from public.pgc_account p where p.plan = 'pymes' and p.code = '572' and p.valid_to is null) then
    raise exception '2: la sin nombre no lleva el nombre del plan, la marca o lleva nombre de Diez (%).', row_to_json(a);
  end if;
  select name, name_pending into a from public.company_account where company_id = c and code = '57200003';
  if a.name <> 'Banco de la prueba' or a.name_pending then raise exception '2: la que trae nombre cambió (%).', row_to_json(a); end if;
  if (public.conta_diez_listo(c) ->> 'sinNombre')::int <> 1 then raise exception '2: los pasos no cuentan la sin nombre.'; end if;
  raise notice '2 OK: la sin nombre entra marcada con el nombre del plan; lo demás, como antes.';
end $$;

-- 3 · Ponerle nombre quita la marca.
do $$
declare v_id uuid;
begin
  select id into v_id from public.company_account where company_id = 'c0600000-0000-4000-8000-0000000000f8' and code = '57200002';
  update public.company_account set name = 'Banco Segundo' where id = v_id;
  if (select name_pending from public.company_account where id = v_id) then raise exception '3: con nombre, sigue marcada.'; end if;
  raise notice '3 OK: con nombre, deja de estar pendiente.';
end $$;
reset role;

-- 4 · Como el cliente.
select set_config('request.jwt.claims', json_build_object('sub', 'c0600000-0000-4000-8000-0000000000f7', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c0600000-0000-4000-8000-0000000000f7', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_diez_listo('c0600000-0000-4000-8000-0000000000f8');
  if r ->> 'falta' <> 'diez' then raise exception '4: el cliente no ve sus pasos (%).', r; end if;
  begin
    perform public.conta_diez_listo('c0600000-0000-4000-8000-0000000000d1');
    raise exception '4: el cliente ve los pasos de otra cuenta';
  exception when insufficient_privilege then null;
  end;
  raise notice '4 OK: el cliente ve los pasos de su empresa y no los de otra.';
end $$;
reset role;

rollback;
