-- supabase/staging/sql/20261118_q05_interruptor_nucleo_prueba.sql
--
-- SOLO STAGING. Prueba del Q05 · «Pantallas nuevas (en pruebas)», el interruptor conta_nucleo,
-- en la ficha de la cuenta (20261118T2029). Todo en una transacción con ROLLBACK: no cambia
-- staging. Usuarios, cuenta y nombres inventados.
--
--   1. Quien no es administrador de la plataforma sigue sin poder encenderlo ni verlo (42501).
--   2. La ficha lee los cuatro interruptores, en su orden, con conta_nucleo el cuarto.
--   3. Sin «Contabilidad» no se enciende («Enciende antes la contabilidad.»); sin motivo, nada.
--   4. Con «Contabilidad»: se enciende, dice quién y por qué, y la auditoría lo apunta; se
--      apaga igual, sin borrar la fila.
--   5. Apagar «Contabilidad» apaga también «Pantallas nuevas», con su apunte «al apagar la
--      contabilidad»; no borra ninguna fila.
--   6. La vuelta atrás vuelve a las tres claves (conta_nucleo ya no se admite), y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA Q05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261118T2029_q05_interruptor_nucleo.sql

-- Dos usuarios inventados (el administrador de la plataforma y uno que no lo es) y una cuenta sin Sumied.
do $$
declare
  v_plat constant uuid := 'f05f0000-0000-4000-8000-0000000000a1';
  v_otro constant uuid := 'f05f0000-0000-4000-8000-0000000000a2';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.correo, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values (v_plat, 'prueba.plataforma@q05-prueba.test'), (v_otro, 'prueba.otro@q05-prueba.test')) as u(id, correo);
  insert into public.platform_admins (user_id, full_name, role, active) values (v_plat, 'Plataforma de prueba Q05', 'admin', true);
  insert into public.accounts (id, name, slug, status, country, created_by, business_type, product_brand)
  values ('f05f0000-0000-4000-8000-0000000000c1', 'Bar Inventado Q05', 'q05-bar-inventado', 'active', 'ES', v_plat, 'otra_actividad', 'contabilidad');
end $$;

-- ── 1 · Solo el administrador de la plataforma ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'f05f0000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', true, 'Intento sin permiso');
    raise exception 'PRUEBA Q05 · 1: un usuario que NO es administrador de la plataforma ha encendido «Pantallas nuevas».';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_interruptores_de_cuenta('f05f0000-0000-4000-8000-0000000000c1');
    raise exception 'PRUEBA Q05 · 1: un usuario que no es administrador de la plataforma ve los interruptores.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.feature_flags where account_id = 'f05f0000-0000-4000-8000-0000000000c1') then
    raise exception 'PRUEBA Q05 · 1: el intento sin permiso ha dejado algo escrito.';
  end if;
  raise notice 'PRUEBA Q05 · 1: quien no es administrador de la plataforma no enciende «Pantallas nuevas» ni la ve (42501).';
end $$;

-- A partir de aquí, como el administrador de la plataforma.
select set_config('request.jwt.claims', json_build_object('sub', 'f05f0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 2 · Los cuatro, en su orden ─────────────────────────────────────────────
do $$
declare r jsonb;
begin
  r := public.conta_interruptores_de_cuenta('f05f0000-0000-4000-8000-0000000000c1');
  if (select array_agg(x->>'clave' order by o) from jsonb_array_elements(r->'interruptores') with ordinality as t(x, o))
     is distinct from array['conta', 'conta_impuestos', 'conta_laboral', 'conta_nucleo'] then
    raise exception 'PRUEBA Q05 · 2: la ficha no lee los cuatro en su orden: %.', r->'interruptores';
  end if;
  if (r->'interruptores'->3->>'encendida')::boolean or (r->'interruptores'->3->>'existe')::boolean then
    raise exception 'PRUEBA Q05 · 2: «Pantallas nuevas» de una cuenta nueva no sale apagada y sin fila: %.', r->'interruptores'->3;
  end if;
  raise notice 'PRUEBA Q05 · 2: la ficha lee los cuatro interruptores, con «Pantallas nuevas» el cuarto, apagado.';
end $$;

-- ── 3 · Sin «Contabilidad» no se enciende; sin motivo, nada ─────────────────
do $$ begin
  begin
    perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', true, 'Probar las pantallas nuevas');
    raise exception 'PRUEBA Q05 · 3: «Pantallas nuevas» se ha encendido con la contabilidad apagada.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Enciende antes la contabilidad.' then raise; end if;
  end;
  begin
    perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', true, '   ');
    raise exception 'PRUEBA Q05 · 3: se ha cambiado sin motivo.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA Q05 · 3: sin contabilidad no se enciende («Enciende antes la contabilidad.») y sin motivo, nada.';
end $$;

-- ── 4 · Con «Contabilidad»: se enciende con quién y por qué, y se apaga igual ──
do $$
declare r jsonb; i jsonb;
begin
  perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta', true, 'Alta de prueba');
  r := public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', true, 'Probar las pantallas nuevas');
  if r->'cambiados' <> '[{"clave":"conta_nucleo","de":false,"a":true}]'::jsonb or r->>'cuenta' <> 'Bar Inventado Q05' then
    raise exception 'PRUEBA Q05 · 4: encender no dice lo que ha cambiado: %.', r;
  end if;
  i := public.conta_interruptores_de_cuenta('f05f0000-0000-4000-8000-0000000000c1')->'interruptores'->3;
  if not (i->>'encendida')::boolean or i->>'quien' <> 'Plataforma de prueba Q05' or i->>'motivo' <> 'Probar las pantallas nuevas' then
    raise exception 'PRUEBA Q05 · 4: encendida, la ficha no dice quién ni por qué: %.', i;
  end if;
  r := public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', false, 'Volver a lo de hoy');
  if r->'cambiados' <> '[{"clave":"conta_nucleo","de":true,"a":false}]'::jsonb then
    raise exception 'PRUEBA Q05 · 4: apagar no dice lo que ha cambiado: %.', r;
  end if;
  if not exists (select 1 from public.feature_flags where account_id = 'f05f0000-0000-4000-8000-0000000000c1' and feature_key = 'conta_nucleo' and not enabled) then
    raise exception 'PRUEBA Q05 · 4: apagar ha borrado la fila de «Pantallas nuevas».';
  end if;
  raise notice 'PRUEBA Q05 · 4: con contabilidad se enciende, con quién, motivo y apunte; se apaga igual sin borrar la fila.';
end $$;

-- ── 5 · Apagar «Contabilidad» apaga también «Pantallas nuevas» ──────────────
do $$
declare r jsonb;
begin
  perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', true, 'Otra vez');
  r := public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta', false, 'Baja de prueba');
  if r->'cambiados' <> '[{"clave":"conta","de":true,"a":false},{"clave":"conta_nucleo","de":true,"a":false}]'::jsonb then
    raise exception 'PRUEBA Q05 · 5: apagar la contabilidad no apaga «Pantallas nuevas»: %.', r;
  end if;
end $$;
reset role;
-- La auditoría y las filas, como postgres: authenticated no lee platform_audit_log (como en la S01f).
do $$ begin
  perform 1 from public.platform_audit_log
   where target_account_id = 'f05f0000-0000-4000-8000-0000000000c1' and event_type = 'account_feature_changed'
     and details->>'interruptor' = 'conta_nucleo' and (details->>'a')::boolean and details->>'motivo' = 'Probar las pantallas nuevas';
  if not found then raise exception 'PRUEBA Q05 · 4: la auditoría no apunta el encendido de «Pantallas nuevas».'; end if;
  perform 1 from public.platform_audit_log
   where target_account_id = 'f05f0000-0000-4000-8000-0000000000c1' and details->>'interruptor' = 'conta_nucleo'
     and not (details->>'a')::boolean and details->>'por' = 'al apagar la contabilidad';
  if not found then raise exception 'PRUEBA Q05 · 5: el apagado de «Pantallas nuevas» no dice que fue al apagar la contabilidad.'; end if;
  if (select count(*) from public.feature_flags where account_id = 'f05f0000-0000-4000-8000-0000000000c1' and feature_key in ('conta', 'conta_nucleo')) <> 2 then
    raise exception 'PRUEBA Q05 · 5: apagar la contabilidad ha borrado alguna fila.';
  end if;
  raise notice 'PRUEBA Q05 · 5: apagar la contabilidad apaga también «Pantallas nuevas», con su apunte en la auditoría (y el del encendido), sin borrar nada.';
end $$;

-- ── 6 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261118T2029_q05_interruptor_nucleo.down.sql
select set_config('request.jwt.claims', json_build_object('sub', 'f05f0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.conta_interruptores_de_cuenta('f05f0000-0000-4000-8000-0000000000c1')->'interruptores') <> 3 then
    raise exception 'PRUEBA Q05 · 6: después de la vuelta atrás, la ficha no vuelve a las tres.';
  end if;
  begin
    perform public.conta_interruptor_cambiar('f05f0000-0000-4000-8000-0000000000c1', 'conta_nucleo', false, 'Después de la vuelta atrás');
    raise exception 'PRUEBA Q05 · 6: después de la vuelta atrás, se sigue admitiendo conta_nucleo.';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
\i supabase/migrations/20261118T2029_q05_interruptor_nucleo.sql
do $$ begin raise notice 'PRUEBA Q05 · 6: la vuelta atrás vuelve a las tres claves; y otra vez delante.'; end $$;

rollback;
