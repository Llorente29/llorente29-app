-- supabase/staging/sql/20261031_s01f_interruptores_prueba.sql
--
-- SOLO STAGING. Prueba del S01f · los interruptores de Sumied por cuenta
-- (20261031T1705 y 20261031T1706). Todo en una transacción con ROLLBACK: no
-- cambia staging. Usuarios, cuenta y nombres inventados.
--
--   1. Solo el administrador de la plataforma: un usuario que no lo es no
--      enciende nada (42501), ni ve los interruptores; y no queda nada escrito.
--      Si lo consigue, la prueba FALLA a propósito.
--   2. Sin «Contabilidad» no hay «Impuestos» ni «Laboral»; sin motivo, nada.
--   3. Encender: el interruptor dice quién y por qué, y la auditoría lo apunta
--      («account_feature_changed», de false a true, con el motivo).
--   4. Apagar «Contabilidad» apaga las tres, con un apunte por cada una; no
--      borra ninguna fila. Y lo que la ficha lee: quién, motivo y los datos.
--   5. La vuelta atrás de las dos, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01f: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261031T1705_s01f_auditoria_interruptor.sql
\i supabase/migrations/20261031T1706_s01f_interruptores.sql

-- Dos usuarios inventados (el administrador de la plataforma y uno que no lo es) y una cuenta sin Sumied.
do $$
declare
  v_plat constant uuid := 'f01f0000-0000-4000-8000-0000000000a1';
  v_otro constant uuid := 'f01f0000-0000-4000-8000-0000000000a2';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.correo, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values (v_plat, 'prueba.plataforma@s01f-prueba.test'), (v_otro, 'prueba.otro@s01f-prueba.test')) as u(id, correo);
  insert into public.platform_admins (user_id, full_name, role, active) values (v_plat, 'Plataforma de prueba S01f', 'admin', true);
  insert into public.accounts (id, name, slug, status, country, created_by, business_type, product_brand)
  values ('f01f0000-0000-4000-8000-0000000000c1', 'Bar Inventado S01f', 's01f-bar-inventado', 'active', 'ES', v_plat, 'otra_actividad', 'contabilidad');
end $$;

-- ── 1 · Solo el administrador de la plataforma ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'f01f0000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta', true, 'Intento sin permiso');
    raise exception 'PRUEBA S01f · 1: un usuario que NO es administrador de la plataforma ha encendido la contabilidad.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_interruptores_de_cuenta('f01f0000-0000-4000-8000-0000000000c1');
    raise exception 'PRUEBA S01f · 1: un usuario que no es administrador de la plataforma ve los interruptores de otra cuenta.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.feature_flags where account_id = 'f01f0000-0000-4000-8000-0000000000c1')
     or exists (select 1 from public.platform_audit_log where target_account_id = 'f01f0000-0000-4000-8000-0000000000c1') then
    raise exception 'PRUEBA S01f · 1: el intento sin permiso ha dejado algo escrito.';
  end if;
  raise notice 'PRUEBA S01f · 1: quien no es administrador de la plataforma no enciende nada ni lo ve (42501), y no queda nada escrito.';
end $$;

-- A partir de aquí, como el administrador de la plataforma.
select set_config('request.jwt.claims', json_build_object('sub', 'f01f0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 2 · Sin «Contabilidad» no hay «Impuestos» ni «Laboral»; sin motivo, nada ─
do $$ begin
  begin
    perform public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta_impuestos', true, 'Probar');
    raise exception 'PRUEBA S01f · 2: se ha encendido «Impuestos» con la contabilidad apagada.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Enciende antes la contabilidad.' then raise; end if;
  end;
  begin
    perform public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta_laboral', true, 'Probar');
    raise exception 'PRUEBA S01f · 2: se ha encendido «Laboral» con la contabilidad apagada.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Enciende antes la contabilidad.' then raise; end if;
  end;
  begin
    perform public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta', true, '   ');
    raise exception 'PRUEBA S01f · 2: se ha encendido sin motivo.';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Falta el motivo%' then raise; end if;
  end;
  raise notice 'PRUEBA S01f · 2: «Impuestos» y «Laboral» piden antes la contabilidad; sin motivo no se enciende nada.';
end $$;

-- ── 3 · Encender: quién, por qué, y su apunte ──────────────────────────────
do $$
declare r jsonb; n int;
begin
  r := public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta', true, 'Alta de cliente nuevo');
  if r->>'cuenta' <> 'Bar Inventado S01f' or jsonb_array_length(r->'cambiados') <> 1 then
    raise exception 'PRUEBA S01f · 3: encender la contabilidad no devuelve la cuenta y lo cambiado: %', r;
  end if;
  perform 1 from public.feature_flags where account_id = 'f01f0000-0000-4000-8000-0000000000c1' and feature_key = 'conta' and enabled
    and granted_by = 'f01f0000-0000-4000-8000-0000000000a1' and grant_reason = 'Alta de cliente nuevo' and source = 'manual_grant';
  if not found then raise exception 'PRUEBA S01f · 3: el interruptor no dice quién ni por qué.'; end if;

  r := public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta_laboral', true, 'Llevamos sus nóminas');
  r := public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta_laboral', true, 'Otra vez');
  if jsonb_array_length(r->'cambiados') <> 0 then raise exception 'PRUEBA S01f · 3: encender lo que ya está encendido cambia algo: %', r; end if;
end $$;
-- La auditoría solo la lee el dueño (sus políticas no dejan al rol authenticated): se mira fuera del rol.
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.platform_audit_log
   where target_account_id = 'f01f0000-0000-4000-8000-0000000000c1' and event_type = 'account_feature_changed'
     and details->>'interruptor' = 'conta' and (details->>'de')::boolean = false and (details->>'a')::boolean = true
     and details->>'motivo' = 'Alta de cliente nuevo'
     and platform_admin_id = (select id from public.platform_admins where user_id = 'f01f0000-0000-4000-8000-0000000000a1');
  if n <> 1 then raise exception 'PRUEBA S01f · 3: la auditoría no apunta el encendido (% apuntes).', n; end if;
  select count(*) into n from public.platform_audit_log where target_account_id = 'f01f0000-0000-4000-8000-0000000000c1';
  if n <> 2 then raise exception 'PRUEBA S01f · 3: debía haber 2 apuntes (contabilidad y laboral; lo ya encendido no apunta) y hay %.', n; end if;
  raise notice 'PRUEBA S01f · 3: encendida la contabilidad y laboral, con quién y por qué, y su apunte; lo ya encendido no se toca.';
end $$;
set local role authenticated;

-- ── 4 · Apagar la contabilidad apaga las tres; lo que lee la ficha ─────────
do $$
declare r jsonb; n int; f jsonb;
begin
  r := public.conta_interruptor_cambiar('f01f0000-0000-4000-8000-0000000000c1', 'conta', false, 'Deja de ser cliente');
  if jsonb_array_length(r->'cambiados') <> 2 then
    raise exception 'PRUEBA S01f · 4: apagar la contabilidad debía apagar la contabilidad y laboral (impuestos estaba apagado): %', r;
  end if;
  select count(*) into n from public.feature_flags where account_id = 'f01f0000-0000-4000-8000-0000000000c1';
  if n <> 2 then raise exception 'PRUEBA S01f · 4: se han borrado o creado filas de interruptores (% filas).', n; end if;
  if exists (select 1 from public.feature_flags where account_id = 'f01f0000-0000-4000-8000-0000000000c1' and enabled) then
    raise exception 'PRUEBA S01f · 4: después de apagar la contabilidad queda algo encendido.';
  end if;

  r := public.conta_interruptores_de_cuenta('f01f0000-0000-4000-8000-0000000000c1');
  f := r->'interruptores'->0;
  if jsonb_array_length(r->'interruptores') <> 3 or f->>'clave' <> 'conta' or (f->>'encendida')::boolean
     or f->>'quien' <> 'Plataforma de prueba S01f' or f->>'motivo' <> 'Deja de ser cliente'
     or (r->'interruptores'->1->>'existe')::boolean or (r->'datos'->>'asientos')::int <> 0 then
    raise exception 'PRUEBA S01f · 4: lo que lee la ficha no cuadra: %', r;
  end if;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.platform_audit_log
   where target_account_id = 'f01f0000-0000-4000-8000-0000000000c1' and event_type = 'account_feature_changed';
  if n <> 4 then raise exception 'PRUEBA S01f · 4: la auditoría debía tener 4 apuntes (2 encendidos y 2 apagados) y tiene %.', n; end if;
  perform 1 from public.platform_audit_log
   where target_account_id = 'f01f0000-0000-4000-8000-0000000000c1' and details->>'interruptor' = 'conta_laboral'
     and (details->>'a')::boolean = false and details->>'por' = 'al apagar la contabilidad';
  if not found then raise exception 'PRUEBA S01f · 4: el apagado de laboral no dice que fue al apagar la contabilidad.'; end if;
  raise notice 'PRUEBA S01f · 4: apagar la contabilidad apaga lo encendido, sin borrar nada y con su apunte; la ficha lee quién, motivo y datos.';
end $$;

-- ── 5 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261031T1706_s01f_interruptores.down.sql
\i supabase/vuelta-atras/20261031T1705_s01f_auditoria_interruptor.down.sql
do $$ begin
  if to_regprocedure('public.conta_interruptor_cambiar(uuid,text,boolean,text)') is not null
     or to_regprocedure('public.conta_interruptores_de_cuenta(uuid)') is not null then
    raise exception 'PRUEBA S01f · 5: la vuelta atrás deja alguna de las dos funciones.';
  end if;
  begin
    insert into public.platform_audit_log (event_type, target_account_id) values ('account_feature_changed', 'f01f0000-0000-4000-8000-0000000000c1');
    raise exception 'PRUEBA S01f · 5: después de la vuelta atrás, la auditoría sigue admitiendo el tipo nuevo.';
  exception when check_violation then null;
  end;
end $$;
\i supabase/migrations/20261031T1705_s01f_auditoria_interruptor.sql
\i supabase/migrations/20261031T1706_s01f_interruptores.sql
do $$ begin raise notice 'PRUEBA S01f · 5: la vuelta atrás quita las dos funciones y el tipo nuevo de la auditoría; y otra vez delante.'; end $$;

rollback;
