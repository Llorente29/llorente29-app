-- supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
--
-- SOLO STAGING. Prueba de «C06 · Contabilidad sola — el alta de una cuenta
-- solo de contabilidad» (20261111T0100): accounts (product_brand y
-- accounts_business_type_check), feature_flags.grant_reason,
-- conta_crear_cuenta_sola y los seis disparadores de siembra:
-- trg_adopt_mandatory_courses_on_account_insert, trg_seed_appcc_on_account_insert,
-- trg_seed_ingredient_families_on_account_insert, tg_seed_staff_roles,
-- create_account_gestoria_config_default y trg_seed_vacation_settings_on_account_insert.
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
--   1. Una cuenta solo de contabilidad: SOLO tiene su perfil y su interruptor.
--      Se cuentan las filas de TODAS las tablas de public con account_id (no
--      una lista escrita a mano: una siembra nueva también saldría).
--   2. Antes = después para las demás: una cuenta como las de siempre
--      (product_brand null) sigue recibiendo las seis siembras.
--   3. El interruptor dice quién y por qué; el registro de plataforma, quién y cuándo.
--   4. Las puertas: un usuario normal no llama a la función; un usuario que no
--      es administrador de la plataforma tampoco da de alta; sin motivo, no.
--   5. «Otra actividad» entra; lo de antes sigue entrando; lo inventado, no.
--   6. Como el cliente (authenticated, con su sub): ve su cuenta con la marca y
--      su interruptor, que es lo que lee el front para no enseñar Cocina.
--   7. conta_contrasena_de_marca: dice sí solo para una persona de una cuenta
--      de ESA marca; el cliente no la puede llamar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06 cuenta sola: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Dos usuarios inventados: quien da de alta (administrador de la plataforma) y el cliente.
do $$
declare
  v_plat constant uuid := 'c0600000-0000-4000-8000-0000000000f1';
  v_cli  constant uuid := 'c0600000-0000-4000-8000-0000000000f2';
  v_otro constant uuid := 'c0600000-0000-4000-8000-0000000000f3';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.correo, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values (v_plat, 'prueba.plataforma@c06-prueba.test'), (v_cli, 'prueba.cliente@c06-prueba.test'), (v_otro, 'prueba.otro@c06-prueba.test')) as u(id, correo);
  insert into public.platform_admins (user_id, full_name, role, active) values (v_plat, 'Plataforma de prueba C06', 'admin', true);
end $$;

-- ── 4 · Las puertas (antes de dar de alta nada) ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c0600000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.conta_crear_cuenta_sola('Intento', 'c06-intento', 'c0600000-0000-4000-8000-0000000000f2', 'X', 'contabilidad', 'probar', 'c0600000-0000-4000-8000-0000000000f1');
  raise exception 'PRUEBA C06 · 4: un usuario normal ha podido llamar a conta_crear_cuenta_sola.';
exception when insufficient_privilege then
  raise notice 'C06 · 4: un usuario normal no llama a la función (42501). OK';
end $$;
reset role;

set local role service_role;
do $$ begin
  begin
    perform public.conta_crear_cuenta_sola('Intento', 'c06-intento', 'c0600000-0000-4000-8000-0000000000f2', 'X', 'contabilidad', 'probar', 'c0600000-0000-4000-8000-0000000000f3');
    raise exception 'PRUEBA C06 · 4: alguien que no es de la plataforma ha dado de alta una cuenta.';
  exception when insufficient_privilege then raise notice 'C06 · 4: quien no es administrador de la plataforma no da de alta. OK';
  end;
  begin
    perform public.conta_crear_cuenta_sola('Intento', 'c06-intento', 'c0600000-0000-4000-8000-0000000000f2', 'X', 'contabilidad', '  ', 'c0600000-0000-4000-8000-0000000000f1');
    raise exception 'PRUEBA C06 · 4: se ha dado de alta sin motivo.';
  exception when raise_exception then
    if sqlerrm not like 'Falta por qué%' then raise; end if;
    raise notice 'C06 · 4: sin motivo no hay alta. OK';
  end;
end $$;

-- ── 1 y 3 · El alta de una cuenta solo de contabilidad ──────────────────────
select set_config('prueba.cuenta', public.conta_crear_cuenta_sola(
  'Empresa Inventada C06, S.L.', 'c06-prueba-sola', 'c0600000-0000-4000-8000-0000000000f2', 'Ana Inventada',
  'contabilidad', 'Prueba de staging del C06', 'c0600000-0000-4000-8000-0000000000f1')::text, true);
reset role;

create temp table c06_filas (tabla text, filas bigint) on commit drop;

do $$
declare
  v_cuenta uuid := current_setting('prueba.cuenta')::uuid;
  r record; n bigint; v_con text[]; v_n bigint;
begin
  for r in select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE' order by 1 loop
    execute format('select count(*) from public.%I where account_id = $1', r.table_name) into n using v_cuenta;
    if n > 0 then insert into c06_filas values (r.table_name, n); end if;
  end loop;
  select array_agg(tabla || '=' || filas order by tabla) into v_con from c06_filas;
  raise notice 'C06 · 1: la cuenta sola tiene filas en: %', v_con;
  if v_con is distinct from array['feature_flags=1', 'user_profiles=1'] then
    raise exception 'PRUEBA C06 · 1: una cuenta solo de contabilidad debía tener solo su perfil y su interruptor, y tiene: %', v_con;
  end if;

  perform 1 from public.accounts where id = v_cuenta and product_brand = 'contabilidad' and business_type = 'otra_actividad'
    and created_by = 'c0600000-0000-4000-8000-0000000000f1' and status = 'active';
  if not found then raise exception 'PRUEBA C06 · 1: la cuenta no lleva su marca, su actividad o quién la creó.'; end if;

  perform 1 from public.feature_flags where account_id = v_cuenta and feature_key = 'conta' and enabled
    and source = 'manual_grant' and granted_by = 'c0600000-0000-4000-8000-0000000000f1' and grant_reason = 'Prueba de staging del C06';
  if not found then raise exception 'PRUEBA C06 · 3: el interruptor conta no dice quién ni por qué.'; end if;

  perform 1 from public.user_profiles p
   where p.account_id = v_cuenta and p.user_id = 'c0600000-0000-4000-8000-0000000000f2' and p.role = 'admin' and p.active
     and p.welcome_completed_at is null;
  if not found then raise exception 'PRUEBA C06 · 1: el cliente no es administrador de su cuenta, o no tiene que pasar por la bienvenida.'; end if;
  -- El conjunto de permisos solo se puede mirar donde existe (producción); staging-conta no tiene permission_sets.
  if to_regclass('public.permission_sets') is not null then
    execute $q$select count(*) from public.user_profiles p join public.permission_set_assignments a on a.user_profile_id = p.id
      join public.permission_sets s on s.id = a.permission_set_id and s.name = 'gerente_total' where p.account_id = $1$q$ into v_n using v_cuenta;
    if v_n <> 1 then raise exception 'PRUEBA C06 · 1: el administrador no tiene su conjunto de permisos gerente_total.'; end if;
  else
    raise notice 'C06 · 1: esta base no tiene permission_sets: el conjunto de permisos no se puede mirar aquí.';
  end if;

  perform 1 from public.platform_audit_log l join public.platform_admins pa on pa.id = l.platform_admin_id
   where l.target_account_id = v_cuenta and l.event_type = 'account_created' and pa.user_id = 'c0600000-0000-4000-8000-0000000000f1'
     and l.details->>'marca' = 'contabilidad' and l.details->>'motivo' = 'Prueba de staging del C06' and l.created_at is not null;
  if not found then raise exception 'PRUEBA C06 · 3: no queda en el registro de plataforma quién y cuándo.'; end if;
  raise notice 'C06 · 1 y 3: cuenta sola con su marca, su interruptor (quién y por qué) y su registro. OK';
end $$;

-- ── 2 · Antes = después: una cuenta como las de siempre sigue sembrándose ───
-- Sin identidad de usuario, como la crean create_account_tx y las semillas
-- (run 167: con el sub del cliente puesto, adopt_mandatory_courses la rechaza).
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_normal uuid; r record; n bigint; v_con text[];
begin
  insert into public.accounts (name, slug, status, country) values ('Cuenta Normal C06', 'c06-prueba-normal', 'active', 'ES') returning id into v_normal;
  truncate c06_filas;
  for r in select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE' order by 1 loop
    execute format('select count(*) from public.%I where account_id = $1', r.table_name) into n using v_normal;
    if n > 0 then insert into c06_filas values (r.table_name, n); end if;
  end loop;
  select array_agg(tabla || '=' || filas order by tabla) into v_con from c06_filas;
  raise notice 'C06 · 2: una cuenta de siempre recibe filas en: %', v_con;
  -- Medido en staging el 13/10 (cuenta C, solo lectura): una cuenta de siempre
  -- recibe staff_role, account_gestoria_config y vacation_settings. APPCC,
  -- familias de ingredientes y cursos no siembran nada aquí (staging no tiene
  -- sus datos de origen); en producción, sí. Se miran las tres que se pueden medir.
  if not exists (select 1 from c06_filas where tabla = 'account_gestoria_config' and filas = 1)
     or not exists (select 1 from c06_filas where tabla = 'staff_role' and filas > 0)
     or not exists (select 1 from c06_filas where tabla = 'vacation_settings' and filas > 0) then
    raise exception 'PRUEBA C06 · 2: una cuenta de siempre ya no se siembra como antes: %', v_con;
  end if;
  raise notice 'C06 · 2: las cuentas de siempre se siembran como antes. OK';
end $$;

-- ── 5 · «Otra actividad» entra; lo de antes también; lo inventado, no ───────
do $$ begin
  insert into public.accounts (name, slug, status, country, business_type) values ('Bar C06', 'c06-prueba-bar', 'active', 'ES', 'bar');
  insert into public.accounts (name, slug, status, country, business_type, product_brand) values ('Ferretería C06', 'c06-prueba-ferreteria', 'active', 'ES', 'otra_actividad', 'contabilidad');
  begin
    insert into public.accounts (name, slug, status, country, business_type) values ('Mal C06', 'c06-prueba-mal', 'active', 'ES', 'ferreteria');
    raise exception 'PRUEBA C06 · 5: ha entrado un business_type inventado.';
  exception when check_violation then raise notice 'C06 · 5: un tipo inventado no entra. OK';
  end;
  begin
    insert into public.accounts (name, slug, status, country, product_brand) values ('Mal C06', 'c06-prueba-mal', 'active', 'ES', 'Con Mayúsculas');
    raise exception 'PRUEBA C06 · 5: ha entrado una marca con un id que no es de la configuración.';
  exception when check_violation then raise notice 'C06 · 5: una marca mal escrita no entra. OK';
  end;
end $$;

-- ── 6 · Como el cliente: su cuenta con la marca y su interruptor ─────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c0600000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_cuenta uuid := current_setting('prueba.cuenta')::uuid;
begin
  perform 1 from public.accounts where id = v_cuenta and product_brand = 'contabilidad';
  if not found then raise exception 'PRUEBA C06 · 6: el cliente no lee la marca de su cuenta (el front no sabría que es solo de contabilidad).'; end if;
  perform 1 from public.feature_flags where account_id = v_cuenta and feature_key = 'conta' and enabled;
  if not found then raise exception 'PRUEBA C06 · 6: el cliente no lee su interruptor conta.'; end if;
  raise notice 'C06 · 6: el cliente lee su cuenta con la marca y su interruptor. OK';
end $$;
reset role;

-- ── 7 · «He olvidado la contraseña» con la marca ────────────────────────────
set local role authenticated;
do $$ begin
  perform * from public.conta_contrasena_de_marca('prueba.cliente@c06-prueba.test', 'contabilidad');
  raise exception 'PRUEBA C06 · 7: un usuario normal ha llamado a conta_contrasena_de_marca.';
exception when insufficient_privilege then raise notice 'C06 · 7: el cliente no llama a la función (42501). OK';
end $$;
reset role;
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from public.conta_contrasena_de_marca('Prueba.Cliente@c06-prueba.test ', 'contabilidad') where se_puede;
  if n <> 1 then raise exception 'PRUEBA C06 · 7: el cliente de una cuenta de la marca no puede pedir contraseña nueva (%).', n; end if;
  select count(*) into n from public.conta_contrasena_de_marca('prueba.cliente@c06-prueba.test', 'otra_marca');
  if n <> 0 then raise exception 'PRUEBA C06 · 7: con otra marca también dice que sí.'; end if;
  select count(*) into n from public.conta_contrasena_de_marca('prueba.otro@c06-prueba.test', 'contabilidad');
  if n <> 0 then raise exception 'PRUEBA C06 · 7: alguien sin cuenta de la marca recibiría el correo.'; end if;
  raise notice 'C06 · 7: solo las personas de una cuenta de la marca. OK';
end $$;
reset role;

rollback;
