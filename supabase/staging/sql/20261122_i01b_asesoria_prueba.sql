-- supabase/staging/sql/20261122_i01b_asesoria_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0230_i01b_asesoria, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Correos de prueba (dominio .test).
-- La invitación de la empresa A a una asesoría:
--   1. Invitar: una viva por empresa; reenviar la misma, no antes de una hora;
--      no a alguien de la propia cuenta.
--   2. La página de aceptar ve la invitación por la huella del enlace.
--   3. Aceptar con un correo que ya es administrador de una cuenta (el de B):
--      vincula en el acto, con el consentimiento de quien invitó; B ya ve los
--      impuestos de A.
--   4. Aceptar sin cuenta: espera el alta; solo la plataforma la ve y la aprueba.
--   5. Cancelar: el enlace deja de valer. B no puede cancelar las de A.
--   6. Como mucho 5 invitaciones nuevas por empresa en 30 días.
--   7. La vuelta atrás para si hay invitaciones; sin ellas, lo quita todo; y
--      se puede volver a aplicar.
-- sin usuario: invitar, ver, aceptar y aprobar solo las llama conta-asesoria con la clave de servicio; el resto, como A, B y la plataforma.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA asesoría: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0230_i01b_asesoria.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;

-- La plataforma de la prueba.
do $$ begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', 'c1b00000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'prueba.plataforma@i01b-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.platform_admins (user_id, full_name, role, active) values ('c1b00000-0000-4000-8000-0000000000f1', 'Plataforma de prueba I01b', 'admin', true);
end $$;

-- ── 1 · Invitar ──────────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_a1 constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
        v_correo_b text; v_correo_a text; v jsonb;
begin
  select lower(email) into v_correo_b from auth.users where id = 'c01b0000-0000-4000-8000-0000000000b1';
  select lower(email) into v_correo_a from auth.users where id = v_a1;
  if v_correo_b is null or v_correo_a is null then raise exception 'PRUEBA asesoría: faltan los usuarios de A o de B.'; end if;
  insert into _p values ('correo_b', v_correo_b);
  update public.tax_advisor_invitation set status = 'cancelled', cancelled_at = now() where company_id = v_a and status in ('pending', 'waiting_approval');
  begin
    perform public.conta_asesoria_invitar(v_a1, v_a, v_correo_a, 'Yo misma', 'social_collaborator', repeat('0', 64));
    raise exception 'PRUEBA asesoría · 1: se invita como asesoría a alguien de la propia cuenta.';
  exception when invalid_parameter_value then null;
  end;
  v := public.conta_asesoria_invitar(v_a1, v_a, upper(v_correo_b), 'Asesoría B de prueba', 'social_collaborator', repeat('1', 64));
  if (v->>'reenvio')::boolean then raise exception 'PRUEBA asesoría · 1: la primera sale como reenvío.'; end if;
  insert into _p values ('inv1', v->>'id');
  begin
    perform public.conta_asesoria_invitar(v_a1, v_a, 'otra@i01b-prueba.test', 'Otra', 'social_collaborator', repeat('2', 64));
    raise exception 'PRUEBA asesoría · 1: dos invitaciones vivas para la misma empresa.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.conta_asesoria_invitar(v_a1, v_a, v_correo_b, 'Asesoría B de prueba', 'social_collaborator', repeat('3', 64));
    raise exception 'PRUEBA asesoría · 1: se reenvía antes de una hora.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.conta_asesoria_invitar('c01b0000-0000-4000-8000-0000000000b1', v_a, 'x@i01b-prueba.test', 'X', 'social_collaborator', repeat('4', 64));
    raise exception 'PRUEBA asesoría · 1: B invita en nombre de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA asesoría · 1: una viva por empresa, sin reenvío antes de una hora, no a la propia cuenta, y solo su administrador.';
end $$;

-- ── 2 y 3 · Ver y aceptar con cuenta ─────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; v_b uuid; p public.company_tax_presenter;
begin
  v := public.conta_asesoria_ver(repeat('1', 64));
  if v->>'estado' <> 'pending' or v->>'correo' <> (select val from _p where k = 'correo_b') or v->>'empresa' is null then
    raise exception 'PRUEBA asesoría · 2: la página de aceptar ve %.', v;
  end if;
  v_b := public.conta_asesoria_cuenta_de((select val from _p where k = 'correo_b'));
  if v_b is null then raise exception 'PRUEBA asesoría · 3: el correo de B no sale como administrador de una cuenta.'; end if;
  v := public.conta_asesoria_aceptar(repeat('1', 64), v_b);
  select * into p from public.company_tax_presenter where company_id = v_a;
  if v->>'estado' <> 'accepted' or p.mode <> 'advisor' or p.advisor_account_id <> v_b or p.consented_by <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'PRUEBA asesoría · 3: aceptar deja % y quién presenta %/%.', v, p.mode, p.advisor_account_id;
  end if;
  insert into _p values ('cuenta_b', v_b::text);
  raise notice 'PRUEBA asesoría · 3: %', v->>'mensaje';
end $$;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if not public.conta_impuesto_puede_ver('3b34403a-a7d6-4a48-a8d7-737e8cababdc') then raise exception 'PRUEBA asesoría · 3: B, ya vinculada, no ve los impuestos de A.'; end if;
  raise notice 'PRUEBA asesoría · 3: B ve los impuestos de A.';
end $$;
reset role;

-- ── 4 · Aceptar sin cuenta: espera el alta ───────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb;
begin
  v := public.conta_asesoria_invitar('c01a0000-0000-4000-8000-0000000000a1', v_a, 'asesoria.nueva@i01b-prueba.test', 'Asesoría Nueva de prueba', 'power_of_attorney', repeat('5', 64));
  insert into _p values ('inv2', v->>'id');
  if public.conta_asesoria_cuenta_de('asesoria.nueva@i01b-prueba.test') is not null then raise exception 'PRUEBA asesoría · 4: un correo sin usuario sale con cuenta.'; end if;
  v := public.conta_asesoria_aceptar(repeat('5', 64), null);
  if v->>'estado' <> 'waiting_approval' then raise exception 'PRUEBA asesoría · 4: aceptar sin cuenta deja %.', v; end if;
  raise notice 'PRUEBA asesoría · 4: %', v->>'mensaje';
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_asesoria_pendientes();
    raise exception 'PRUEBA asesoría · 4: A ve las altas pendientes de la plataforma.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c1b00000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.conta_asesoria_pendientes()) x where x->>'id' = (select val from _p where k = 'inv2')) then
    raise exception 'PRUEBA asesoría · 4: la plataforma no ve el alta pendiente.';
  end if;
end $$;
reset role;
do $$
declare v jsonb;
begin
  begin
    perform public.conta_asesoria_aprobar((select val::uuid from _p where k = 'inv2'), 'c01a0000-0000-4000-8000-0000000000a1', (select val::uuid from _p where k = 'cuenta_b'));
    raise exception 'PRUEBA asesoría · 4: aprueba el alta quien no es de la plataforma.';
  exception when insufficient_privilege then null;
  end;
  v := public.conta_asesoria_aprobar((select val::uuid from _p where k = 'inv2'), 'c1b00000-0000-4000-8000-0000000000f1', (select val::uuid from _p where k = 'cuenta_b'));
  if not exists (select 1 from public.tax_advisor_invitation where id = (select val::uuid from _p where k = 'inv2') and status = 'accepted' and approved_by is not null) then
    raise exception 'PRUEBA asesoría · 4: aprobar no deja la invitación aceptada.';
  end if;
  raise notice 'PRUEBA asesoría · 4: %', v->>'mensaje';
end $$;

-- ── 5 · Cancelar ─────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.conta_asesoria_invitar('c01a0000-0000-4000-8000-0000000000a1', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'cancelada@i01b-prueba.test', 'Cancelada', 'social_collaborator', repeat('6', 64));
  insert into _p values ('inv3', v->>'id');
end $$;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_asesoria_cancelar((select val::uuid from _p where k = 'inv3'));
    raise exception 'PRUEBA asesoría · 5: B cancela una invitación de A.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := public.conta_asesoria_de_empresa('3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  if v->>'id' <> (select val from _p where k = 'inv3') then raise exception 'PRUEBA asesoría · 5: la invitación viva de A sale %.', v; end if;
  raise notice 'PRUEBA asesoría · 5: %', public.conta_asesoria_cancelar((select val::uuid from _p where k = 'inv3'));
end $$;
reset role;
do $$ begin
  begin
    perform public.conta_asesoria_aceptar(repeat('6', 64), null);
    raise exception 'PRUEBA asesoría · 5: una invitación cancelada se acepta.';
  exception when invalid_parameter_value then
    raise notice 'PRUEBA asesoría · 5: cancelada, su enlace ya no vale: %', sqlerrm;
  end;
end $$;

-- ── 6 · Como mucho 5 en 30 días ──────────────────────────────────────────────
do $$
declare v jsonb; k int;
begin
  for k in 7 .. 9 loop
    if (select count(*) from public.tax_advisor_invitation where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and created_at > now() - interval '30 days') >= 5 then exit; end if;
    v := public.conta_asesoria_invitar('c01a0000-0000-4000-8000-0000000000a1', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'tope' || k || '@i01b-prueba.test', 'Tope', 'social_collaborator', repeat(k::text, 64));
    update public.tax_advisor_invitation set status = 'cancelled', cancelled_at = now() where id = (v->>'id')::uuid;
  end loop;
  begin
    perform public.conta_asesoria_invitar('c01a0000-0000-4000-8000-0000000000a1', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'sexta@i01b-prueba.test', 'Sexta', 'social_collaborator', repeat('a', 64));
    raise exception 'PRUEBA asesoría · 6: una sexta invitación en 30 días.';
  exception when invalid_parameter_value then
    raise notice 'PRUEBA asesoría · 6: %', sqlerrm;
  end;
end $$;

-- ── 7 · Su vuelta atrás ──────────────────────────────────────────────────────
\set ON_ERROR_STOP 0
savepoint para;
\i supabase/vuelta-atras/20261122T0230_i01b_asesoria.down.sql
rollback to savepoint para;
\set ON_ERROR_STOP 1
do $$ begin
  if to_regclass('public.tax_advisor_invitation') is null then raise exception 'PRUEBA asesoría · 7: con invitaciones, la vuelta atrás no ha parado.'; end if;
  delete from public.tax_advisor_invitation;
end $$;
\i supabase/vuelta-atras/20261122T0230_i01b_asesoria.down.sql
do $$ begin
  if to_regclass('public.tax_advisor_invitation') is not null or to_regprocedure('public.conta_asesoria_aceptar(text, uuid)') is not null then
    raise exception 'PRUEBA asesoría · 7: la vuelta atrás deja algo de la 0230.';
  end if;
  raise notice 'PRUEBA asesoría · 7: con invitaciones para; sin ellas, lo quita todo.';
end $$;
\i supabase/migrations/20261122T0230_i01b_asesoria.sql
do $$ begin
  if to_regprocedure('public.conta_asesoria_aceptar(text, uuid)') is null then raise exception 'PRUEBA asesoría · 7: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA asesoría · 7: y otra vez delante.';
end $$;

\echo '>>> Prueba de la invitación a la asesoría (0230) en verde. ROLLBACK: no queda nada.'
rollback;
