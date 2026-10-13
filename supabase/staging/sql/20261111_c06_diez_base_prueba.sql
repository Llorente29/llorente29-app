-- supabase/staging/sql/20261111_c06_diez_base_prueba.sql
--
-- SOLO STAGING. Prueba de «C06 · la base de Diez de cada empresa»
-- (20261111T0200): conta_diez_base, conta_diez_base_registro,
-- conta_diez_base_poner y sus dos disparadores. Todo en una transacción con
-- ROLLBACK: no cambia staging.
--
--   1. Folvy (service_role) registra la base de una empresa; queda el alta en
--      el registro, con quién y por qué.
--   2. C0001: ni por la función ni a mano. Ni una base mal escrita.
--   3. Una base es de UNA empresa: otra empresa no puede registrar la misma.
--   4. Cambiar la base deja «cambio» con antes y después; poner la misma, nada.
--   5. Como el cliente (authenticated, con su sub): VE la base de su empresa y
--      su registro, NO ve las de otra cuenta, y NO puede escribir ni llamar a
--      la función.
--   6. La empresa tiene que ser de la cuenta (no se cuela otra a mano).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06 base de Diez: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- Dos cuentas inventadas, cada una con su empresa, y el administrador de la primera.
do $$
declare
  u  constant uuid := 'c0600000-0000-4000-8000-0000000000e1';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'diez.prueba@c06-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    ('c0600000-0000-4000-8000-0000000000e0', 'Prueba Diez Uno', 'c06-prueba-diez-uno', 'active', 'otra_actividad', 'contabilidad'),
    ('c0600000-0000-4000-8000-0000000000e5', 'Prueba Diez Dos', 'c06-prueba-diez-dos', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, 'c0600000-0000-4000-8000-0000000000e0', 'admin', true, 'Prueba Diez', now(), now());
  insert into public.company (id, account_id, legal_name, setup_step) values
    ('c0600000-0000-4000-8000-0000000000e2', 'c0600000-0000-4000-8000-0000000000e0', 'Prueba Diez Uno, S.L.', 'hecho'),
    ('c0600000-0000-4000-8000-0000000000e6', 'c0600000-0000-4000-8000-0000000000e5', 'Prueba Diez Dos, S.L.', 'hecho');
end $$;

-- 1 · Folvy registra la base de la empresa uno.
set local role service_role;
do $$
declare r jsonb; n int;
begin
  r := public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e2', ' c0042 ', 'Viene de Diez (prueba C06)', 'Folvy (prueba)');
  if (r ->> 'base') <> 'C0042' or not (r ->> 'cambia')::boolean then raise exception '1: esperaba C0042 nueva, y es %', r; end if;
  select count(*) into n from public.conta_diez_base_registro
   where company_id = 'c0600000-0000-4000-8000-0000000000e2' and accion = 'alta' and despues = 'C0042' and por = 'Folvy (prueba)' and motivo like 'Viene de Diez%';
  if n <> 1 then raise exception '1: el registro no tiene el alta con quién y por qué (%).', n; end if;
  raise notice '1 OK: base registrada y su alta en el registro.';
end $$;

-- 2 · C0001, nunca; una base mal escrita, tampoco.
do $$
begin
  begin
    perform public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e6', 'C0001', 'x', 'y');
    raise exception '2: la función dejó registrar C0001';
  exception when raise_exception then
    if sqlerrm not like '%C0001 no se toca%' then raise; end if;
  end;
  begin
    insert into public.conta_diez_base (company_id, account_id, nombre_bd, motivo, puesto_por)
    values ('c0600000-0000-4000-8000-0000000000e6', 'c0600000-0000-4000-8000-0000000000e5', 'c0001', 'x', 'y');
    raise exception '2: a mano entró C0001';
  exception when check_violation then null;
  end;
  begin
    perform public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e6', 'BASE9', 'x', 'y');
    raise exception '2: entró una base mal escrita';
  exception when raise_exception then
    if sqlerrm not like '%no válida%' then raise; end if;
  end;
  raise notice '2 OK: C0001 no entra ni por la función ni a mano; una base mal escrita, tampoco.';
end $$;

-- 3 · Una base, una empresa.
do $$
begin
  begin
    perform public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e6', 'C0042', 'x', 'y');
    raise exception '3: dos empresas con la misma base';
  exception when unique_violation then null;
  end;
  raise notice '3 OK: la C0042 ya es de otra empresa y no entra.';
end $$;

-- 4 · Cambiar deja antes y después; poner la misma, nada.
do $$
declare r jsonb; n int;
begin
  r := public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e2', 'C0042', 'otra vez', 'Folvy (prueba)');
  if (r ->> 'cambia')::boolean then raise exception '4: la misma base cuenta como cambio'; end if;
  r := public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e2', 'C0043', 'Se equivocaron de base', 'Folvy (prueba)');
  select count(*) into n from public.conta_diez_base_registro
   where company_id = 'c0600000-0000-4000-8000-0000000000e2' and accion = 'cambio' and antes = 'C0042' and despues = 'C0043';
  if n <> 1 then raise exception '4: falta el cambio C0042 → C0043 en el registro (%).', n; end if;
  select count(*) into n from public.conta_diez_base_registro where company_id = 'c0600000-0000-4000-8000-0000000000e2';
  if n <> 2 then raise exception '4: esperaba 2 apuntes (alta y cambio) y hay %.', n; end if;
  raise notice '4 OK: el cambio queda con antes y después; repetir la misma no apunta nada.';
end $$;

-- 6 · La empresa tiene que ser de la cuenta.
do $$
begin
  begin
    insert into public.conta_diez_base (company_id, account_id, nombre_bd, motivo, puesto_por)
    values ('c0600000-0000-4000-8000-0000000000e6', 'c0600000-0000-4000-8000-0000000000e0', 'C0050', 'x', 'y');
    raise exception '6: entró una empresa con la cuenta de otra';
  exception when raise_exception then
    if sqlerrm not like '%no es de la cuenta%' then raise; end if;
  end;
  perform public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e6', 'C0050', 'La segunda empresa', 'Folvy (prueba)');
  raise notice '6 OK: la empresa va con su cuenta; la otra registra la suya.';
end $$;
reset role;

-- 5 · Como el cliente: ve lo suyo, no lo de otra cuenta, y no escribe.
select set_config('request.jwt.claims', json_build_object('sub', 'c0600000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c0600000-0000-4000-8000-0000000000e1', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.conta_diez_base;
  if n <> 1 then raise exception '5: el cliente ve % bases (esperaba solo la suya).', n; end if;
  if (select nombre_bd from public.conta_diez_base) <> 'C0043' then raise exception '5: no ve la de su empresa'; end if;
  select count(*) into n from public.conta_diez_base_registro;
  if n <> 2 then raise exception '5: el cliente ve % apuntes del registro (esperaba los 2 suyos).', n; end if;
  begin
    update public.conta_diez_base set nombre_bd = 'C0099';
    raise exception '5: el cliente ha podido cambiar la base';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.conta_diez_base (company_id, account_id, nombre_bd, motivo, puesto_por)
    values ('c0600000-0000-4000-8000-0000000000e2', 'c0600000-0000-4000-8000-0000000000e0', 'C0098', 'x', 'y');
    raise exception '5: el cliente ha podido registrar una base';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.conta_diez_base_registro;
    raise exception '5: el cliente ha podido borrar el registro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_diez_base_poner('c0600000-0000-4000-8000-0000000000e2', 'C0097', 'x', 'y');
    raise exception '5: el cliente ha podido llamar a la función';
  exception when insufficient_privilege then null;
  end;
  raise notice '5 OK: el cliente ve su base y su registro, no los de otra cuenta, y no escribe nada.';
end $$;
reset role;

rollback;
