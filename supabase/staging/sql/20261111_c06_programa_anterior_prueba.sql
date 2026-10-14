-- supabase/staging/sql/20261111_c06_programa_anterior_prueba.sql
--
-- SOLO STAGING. Prueba de «C06 · de qué programa viene cada empresa»
-- (20261111T0400): conta_programa_anterior, su registro y
-- conta_programa_anterior_poner. Todo en una transacción con ROLLBACK.
--
--   1. Lo que ya existía no cambia: ninguna empresa tiene fila al aplicarla
--      (Foodint en producción tampoco: su alta es de antes), y
--      conta_diez_listo da lo mismo para todas las empresas antes y después de
--      contestar la pregunta en otra (la misma vara a los dos lados).
--   2. Como el cliente: contesta «Holded», cambia a «Otro: Contaplus», y el
--      registro tiene las dos (alta y cambio) con quién.
--   3. Lo que no vale: «Otro» sin nombre, un programa que no está en la lista,
--      y la empresa de otra cuenta (42501).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06 programa anterior: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Lo de antes: ninguna fila, y conta_diez_listo de todas, para comparar.
do $$
declare n int;
begin
  select count(*) into n from public.conta_programa_anterior p
   join public.company c on c.id = p.company_id
   where c.created_at < now() - interval '10 minutes';
  if n <> 0 then raise exception '1: esperaba 0 respuestas en empresas de antes y hay %.', n; end if;
end $$;
create temporary table listo_antes on commit drop as
  select c.id, public.conta_diez_listo(c.id)::text as listo from public.company c;

do $$
declare
  u  constant uuid := 'c0600000-0000-4000-8000-0000000000e7';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'programa.prueba@c06-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    ('c0600000-0000-4000-8000-0000000000e6', 'Prueba Programa', 'c06-prueba-programa', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, 'c0600000-0000-4000-8000-0000000000e6', 'admin', true, 'Prueba Programa', now(), now());
  insert into public.company (id, account_id, legal_name, setup_step) values
    ('c0600000-0000-4000-8000-0000000000e8', 'c0600000-0000-4000-8000-0000000000e6', 'Prueba Programa, S.L.', 'cuentas');
end $$;

-- La empresa de OTRA cuenta, tomada antes de ser el cliente (como cliente, la RLS no la deja ver).
select set_config('prueba.otra_empresa', (select id::text from public.company where account_id <> 'c0600000-0000-4000-8000-0000000000e6' order by created_at limit 1), true);

-- 2 · Como el cliente.
select set_config('request.jwt.claims', json_build_object('sub', 'c0600000-0000-4000-8000-0000000000e7', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c0600000-0000-4000-8000-0000000000e7', true);
set local role authenticated;

do $$
declare r record; n int; c constant uuid := 'c0600000-0000-4000-8000-0000000000e8';
begin
  perform public.conta_programa_anterior_poner(c, 'holded', null);
  perform public.conta_programa_anterior_poner(c, 'otro', 'Contaplus');
  select programa, otro_nombre, puesto_por into r from public.conta_programa_anterior where company_id = c;
  if r.programa <> 'otro' or r.otro_nombre <> 'Contaplus' or r.puesto_por <> 'c0600000-0000-4000-8000-0000000000e7' then
    raise exception '2: esperaba «otro: Contaplus» puesto por la persona y hay %.', row_to_json(r);
  end if;
  select count(*) into n from public.conta_programa_anterior_registro
   where company_id = c and ((accion = 'alta' and despues = 'holded') or (accion = 'cambio' and antes = 'holded' and despues = 'otro: Contaplus'));
  if n <> 2 then raise exception '2: el registro tenía que tener el alta (holded) y el cambio (a otro: Contaplus); tiene % de las dos.', n; end if;

  -- 3 · Lo que no vale.
  begin
    perform public.conta_programa_anterior_poner(c, 'otro', '  ');
    raise exception '3: «Otro» sin nombre entró.';
  exception when check_violation then null;
  end;
  begin
    perform public.conta_programa_anterior_poner(c, 'contaplus', null);
    raise exception '3: un programa fuera de la lista entró.';
  exception when check_violation then null;
  end;
  begin
    perform public.conta_programa_anterior_poner(current_setting('prueba.otra_empresa')::uuid, 'diez', null);
    raise exception '3: contestó por una empresa de otra cuenta.';
  exception when insufficient_privilege then null;
  end;
  -- La tabla no se escribe a mano.
  begin
    insert into public.conta_programa_anterior (company_id, account_id, programa) values (c, 'c0600000-0000-4000-8000-0000000000e6', 'sage');
    raise exception '3: el cliente escribió la tabla a mano.';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- 1 (después) · conta_diez_listo da lo mismo en todas las de antes.
do $$
declare n int;
begin
  select count(*) into n from listo_antes a where public.conta_diez_listo(a.id)::text is distinct from a.listo;
  if n <> 0 then raise exception '1: conta_diez_listo cambió en % empresas al contestar la pregunta en otra.', n; end if;
  raise notice 'PRUEBA C06 programa anterior OK: % empresas de antes sin fila y con los mismos pasos; contestar, cambiar y el registro; «Otro» sin nombre, fuera de lista, otra cuenta y escritura a mano, rechazados.',
    (select count(*) from listo_antes);
end $$;

rollback;
