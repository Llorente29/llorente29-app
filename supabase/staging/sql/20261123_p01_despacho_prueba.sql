-- supabase/staging/sql/20261123_p01_despacho_prueba.sql
--
-- SOLO STAGING. Prueba de 20261123T0100_p01_despacho y de su semilla, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. Contra la asesoría
-- de demo (seed_p01_despacho_staging.sql), con «hoy» = 13/10/2026.
--
--   1. La asesoría ve sus 8 clientes con permiso, con las cifras de arriba y
--      los filtros contados con la misma vara; no ve al que retiró el permiso
--      ni al de la invitación sin aceptar.
--   2. El certificado se mira por persona: Laura (administración) puede;
--      Jorge (encargado sin permiso) ve «sin permiso».
--   3. Responsable: lo pone una encargada; no a alguien de fuera; no a un
--      cliente sin permiso; quitarlo.
--   4. RLS de una EMPRESA CLIENTA: no ve a las demás clientas de su asesoría,
--      ni quién la lleva, ni el certificado de la asesoría, ni la pantalla.
--   5. RLS de OTRA CUENTA: no ve nada de la asesoría.
--   6. RLS de la ASESORÍA: lee las declaraciones de sus clientes con permiso
--      y no las de los otros dos.
--   7. «Soy una asesoría»: solo la administración; no se quita con clientes;
--      una nueva sin clientes se marca y ve la pantalla vacía. El correo de
--      respuesta, validado.
--   8. Retirar el permiso: el cliente desaparece en el acto.
--   9. La vuelta atrás para con datos; sin ellos lo quita todo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA despacho: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261123T0100_p01_despacho.sql
\i supabase/seeds/conta/seed_p01_despacho_staging.sql

-- Ids de la semilla (d5ac0000-0000-4000-8000-…).
create function pg_temp.id(s text) returns uuid language sql immutable as $f$ select ('d5ac0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $f$;
create function pg_temp.como(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$f$;
grant execute on function pg_temp.id(text), pg_temp.como(uuid) to authenticated;

-- Una persona de la empresa clienta 2 (Talleres de Prueba Ruiz), administradora.
do $$ begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', pg_temp.id('c02a'), 'authenticated', 'authenticated', 'p01.talleres@p01-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (pg_temp.id('c02a'), pg_temp.id('c020'), 'admin', true, 'Talleres (prueba)');
end $$;

-- ── 1 · La asesoría ve sus 8 clientes ────────────────────────────────────────
select pg_temp.como(pg_temp.id('a1'));
set local role authenticated;
do $$
declare v jsonb; r jsonb; c jsonb;
begin
  v := public.conta_despacho_trimestre(pg_temp.id('a0'), 2026, '3T', date '2026-10-13');
  r := v->'resumen';
  if (r->>'clientes')::int <> 8 or (r->>'modelos')::int <> 21 or (r->>'presentados')::int <> 7 or (r->>'listos')::int <> 6
     or (r->>'para_revisar')::int <> 8 or (r->>'vencen')::int <> 1 then
    raise exception 'PRUEBA despacho · 1: las cifras salen %; tienen que ser 8 clientes, 21 modelos, 7 presentados, 6 listos, 8 para revisar y 1 que vence.', r;
  end if;
  if (r->'filtros'->>'con_avisos')::int <> 2 or (r->'filtros'->>'listos')::int <> 3 or (r->'filtros'->>'sin_certificado')::int <> 2
     or (r->'filtros'->>'domiciliados')::int <> 1 then
    raise exception 'PRUEBA despacho · 1: los filtros salen %; tienen que ser 2 con avisos, 3 con listos, 2 sin certificado y 1 domiciliado.', r->'filtros';
  end if;
  if exists (select 1 from jsonb_array_elements(v->'clientes') x where x->>'nombre' like 'Fontanería%' or x->>'nombre' like 'Ferretería%') then
    raise exception 'PRUEBA despacho · 1: sale un cliente sin permiso.';
  end if;
  select x into c from jsonb_array_elements(v->'clientes') x where x->>'nombre' = 'Talleres de Prueba Ruiz';
  if (c->>'a_ingresar')::numeric <> 4902.10 or c->>'siguiente_paso' <> 'Presentar 3 modelos' or (c->>'listos_303')::int <> 1 then
    raise exception 'PRUEBA despacho · 1: Talleres sale %.', c;
  end if;
  select x into c from jsonb_array_elements(v->'clientes') x where x->>'nombre' = 'Ana Prueba Gómez';
  if c->>'siguiente_paso' <> 'Faltan 3 facturas por correo · vence el 15/10' or (c->>'orden')::int <> 0 then
    raise exception 'PRUEBA despacho · 1: Ana sale %.', c;
  end if;
  if (v->'clientes'->0->>'nombre') <> 'Ana Prueba Gómez' then
    raise exception 'PRUEBA despacho · 1: lo que vence no va primero: %.', v->'clientes'->0->>'nombre';
  end if;
  select x into c from jsonb_array_elements(v->'clientes') x where x->>'nombre' = 'Importaciones de Prueba Levante';
  if (c->>'a_compensar')::numeric <> 12040.00 or c->'certificado'->>'estado' <> 'caduca' or (c->'certificado'->>'dias')::int not between 1 and 30 then
    raise exception 'PRUEBA despacho · 1: Importaciones sale %.', c;
  end if;
  raise notice 'PRUEBA despacho · 1: la asesoría ve 8 clientes: %', r;
end $$;
reset role;

-- ── 2 · El certificado, por persona ──────────────────────────────────────────
select pg_temp.como(pg_temp.id('a3'));
set local role authenticated;
do $$
declare c jsonb;
begin
  select x into c from jsonb_array_elements(public.conta_despacho_trimestre(pg_temp.id('a0'), 2026, '3T', date '2026-10-13')->'clientes') x
   where x->>'nombre' = 'Talleres de Prueba Ruiz';
  if c->'certificado'->>'estado' <> 'sin_permiso' or c->>'siguiente_paso' <> 'Pedir permiso para usar el certificado' then
    raise exception 'PRUEBA despacho · 2: Jorge, sin permiso, ve %.', c->'certificado';
  end if;
  raise notice 'PRUEBA despacho · 2: Jorge ve el certificado «sin permiso» y «%».', c->>'siguiente_paso';
end $$;
reset role;

-- ── 3 · Responsable ──────────────────────────────────────────────────────────
select pg_temp.como(pg_temp.id('a2'));   -- Marta, encargada
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.conta_despacho_responsable_poner(pg_temp.id('a0'), pg_temp.id('c06e'), pg_temp.id('a3'));
  if v->>'mensaje' <> 'Jorge Sanz lleva ahora Panadería de Prueba Norte.' then raise exception 'PRUEBA despacho · 3: asignar dice %.', v; end if;
  begin
    perform public.conta_despacho_responsable_poner(pg_temp.id('a0'), pg_temp.id('c06e'), pg_temp.id('c02a'));
    raise exception 'PRUEBA despacho · 3: se asigna a alguien que no es de la asesoría.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.conta_despacho_responsable_poner(pg_temp.id('a0'), pg_temp.id('c09e'), pg_temp.id('a3'));
    raise exception 'PRUEBA despacho · 3: se asigna un cliente que retiró el permiso.';
  exception when insufficient_privilege then null;
  end;
  v := public.conta_despacho_responsable_poner(pg_temp.id('a0'), pg_temp.id('c06e'), null);
  if v->>'mensaje' <> 'Panadería de Prueba Norte se queda sin responsable.' then raise exception 'PRUEBA despacho · 3: quitar dice %.', v; end if;
  raise notice 'PRUEBA despacho · 3: asignar, no a alguien de fuera ni a un cliente sin permiso, y quitar.';
end $$;
reset role;

-- ── 4 · Una empresa clienta no ve a las demás ────────────────────────────────
select pg_temp.como(pg_temp.id('c02a'));
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.tax_client_assignee;
  if n <> 0 then raise exception 'PRUEBA despacho · 4: la clienta ve % responsables de la asesoría.', n; end if;
  select count(*) into n from public.company_tax_presenter;
  if n <> 1 then raise exception 'PRUEBA despacho · 4: la clienta ve % enlaces con la asesoría (solo el suyo).', n; end if;
  select count(*) into n from public.tax_return where company_id <> pg_temp.id('c02e');
  if n <> 0 then raise exception 'PRUEBA despacho · 4: la clienta ve % declaraciones de otras.', n; end if;
  select count(*) into n from public.tax_return where company_id = pg_temp.id('c02e');
  if n <> 3 then raise exception 'PRUEBA despacho · 4: la clienta ve % de sus 3 declaraciones.', n; end if;
  select count(*) into n from public.company where id <> pg_temp.id('c02e');
  if n <> 0 then raise exception 'PRUEBA despacho · 4: la clienta ve % empresas que no son la suya.', n; end if;
  select count(*) into n from public.tax_certificate;
  if n <> 0 then raise exception 'PRUEBA despacho · 4: la clienta ve % certificados de la asesoría.', n; end if;
  if public.conta_impuesto_puede_ver(pg_temp.id('c08e')) then raise exception 'PRUEBA despacho · 4: la clienta puede ver los impuestos del Bar.'; end if;
  begin
    perform public.conta_despacho_trimestre(pg_temp.id('a0'), 2026, '3T');
    raise exception 'PRUEBA despacho · 4: la clienta abre la pantalla de la asesoría.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_despacho_equipo(pg_temp.id('a0'));
    raise exception 'PRUEBA despacho · 4: la clienta ve el equipo de la asesoría.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA despacho · 4: la clienta solo ve lo suyo.';
end $$;
reset role;

-- ── 5 · Otra cuenta no ve nada ───────────────────────────────────────────────
select pg_temp.como('c01a0000-0000-4000-8000-0000000000a1');   -- administración de la cuenta A
set local role authenticated;
do $$
declare n int;
begin
  begin
    perform public.conta_despacho_trimestre(pg_temp.id('a0'), 2026, '3T');
    raise exception 'PRUEBA despacho · 5: otra cuenta abre la pantalla de la asesoría.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_despacho_soy(pg_temp.id('a0'));
    raise exception 'PRUEBA despacho · 5: otra cuenta pregunta por la asesoría.';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.tax_client_assignee where account_id = pg_temp.id('a0');
  if n <> 0 then raise exception 'PRUEBA despacho · 5: otra cuenta ve % responsables.', n; end if;
  select count(*) into n from public.tax_return where account_id::text like 'd5ac0000-%';
  if n <> 0 then raise exception 'PRUEBA despacho · 5: otra cuenta ve % declaraciones de los clientes.', n; end if;
  raise notice 'PRUEBA despacho · 5: otra cuenta no ve nada.';
end $$;
reset role;

-- ── 6 · La asesoría lee lo de sus clientes con permiso, y nada más ───────────
select pg_temp.como(pg_temp.id('a1'));
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.tax_return where company_id = pg_temp.id('c02e');
  if n <> 3 then raise exception 'PRUEBA despacho · 6: la asesoría ve % de las 3 declaraciones de Talleres.', n; end if;
  select count(*) into n from public.tax_return where company_id in (pg_temp.id('c09e'), pg_temp.id('c10e'));
  if n <> 0 then raise exception 'PRUEBA despacho · 6: la asesoría ve % declaraciones de clientes sin permiso.', n; end if;
  raise notice 'PRUEBA despacho · 6: la asesoría lee lo de sus clientes con permiso y nada de los otros dos.';
end $$;
reset role;

-- ── 7 · «Soy una asesoría» y el correo de respuesta ─────────────────────────
select pg_temp.como(pg_temp.id('a2'));   -- Marta: encargada, no administración
set local role authenticated;
do $$ begin
  begin
    perform public.conta_despacho_marcar(pg_temp.id('a0'), false);
    raise exception 'PRUEBA despacho · 7: una encargada cambia «Soy una asesoría».';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_despacho_correo_poner(pg_temp.id('a0'), 'no es un correo');
    raise exception 'PRUEBA despacho · 7: se guarda un correo que no lo es.';
  exception when invalid_parameter_value then null;
  end;
  if public.conta_despacho_correo_poner(pg_temp.id('a0'), ' Respuestas@P01-prueba.test ')->>'correo' <> 'respuestas@p01-prueba.test' then
    raise exception 'PRUEBA despacho · 7: el correo no se guarda limpio.';
  end if;
end $$;
reset role;
select pg_temp.como(pg_temp.id('a1'));
set local role authenticated;
do $$ begin
  begin
    perform public.conta_despacho_marcar(pg_temp.id('a0'), false);
    raise exception 'PRUEBA despacho · 7: se deja de ser asesoría con 8 clientes dentro.';
  exception when invalid_parameter_value then
    raise notice 'PRUEBA despacho · 7: %', sqlerrm;
  end;
  if (public.conta_despacho_soy(pg_temp.id('a0'))->>'correo_respuesta') <> 'respuestas@p01-prueba.test' then
    raise exception 'PRUEBA despacho · 7: «soy» no da el correo de respuesta.';
  end if;
end $$;
reset role;
select pg_temp.como('c01d0000-0000-4000-8000-0000000000d1');   -- la cuenta D, sin clientes
set local role authenticated;
do $$
declare v jsonb;
begin
  if (public.conta_despacho_soy('c01d0000-0000-4000-8000-00000000000d')->>'asesoria')::boolean then
    raise exception 'PRUEBA despacho · 7: la cuenta D ya es asesoría antes de decirlo.';
  end if;
  v := public.conta_despacho_marcar('c01d0000-0000-4000-8000-00000000000d', true);
  if not (public.conta_despacho_soy('c01d0000-0000-4000-8000-00000000000d')->>'asesoria')::boolean then
    raise exception 'PRUEBA despacho · 7: marcar no deja la cuenta como asesoría.';
  end if;
  if (public.conta_despacho_trimestre('c01d0000-0000-4000-8000-00000000000d', 2026, '3T')->'resumen'->>'clientes')::int <> 0 then
    raise exception 'PRUEBA despacho · 7: una asesoría nueva sale con clientes.';
  end if;
  raise notice 'PRUEBA despacho · 7: %', v->>'mensaje';
end $$;
reset role;

-- ── 8 · Retirar el permiso: el cliente desaparece en el acto ─────────────────
select pg_temp.como(pg_temp.id('c02a'));
set local role authenticated;
select public.conta_impuesto_presentador_retirar(pg_temp.id('c02e'));
reset role;
select pg_temp.como(pg_temp.id('a1'));
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.conta_despacho_trimestre(pg_temp.id('a0'), 2026, '3T', date '2026-10-13');
  if (v->'resumen'->>'clientes')::int <> 7 or exists (select 1 from jsonb_array_elements(v->'clientes') x where x->>'nombre' = 'Talleres de Prueba Ruiz') then
    raise exception 'PRUEBA despacho · 8: Talleres retiró el permiso y sigue saliendo (% clientes).', v->'resumen'->>'clientes';
  end if;
  if exists (select 1 from public.tax_return where company_id = pg_temp.id('c02e')) then
    raise exception 'PRUEBA despacho · 8: la asesoría sigue leyendo las declaraciones de Talleres.';
  end if;
  raise notice 'PRUEBA despacho · 8: retirado el permiso, Talleres ya no sale y sus declaraciones ya no se leen.';
end $$;
reset role;

-- ── 9 · La vuelta atrás ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
savepoint con_datos;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261123T0100_p01_despacho.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint con_datos;
do $$ begin
  if to_regprocedure('public.conta_despacho_trimestre(uuid,integer,text,date)') is null then
    raise exception 'PRUEBA despacho · 9: con datos, la vuelta atrás ha quitado algo.';
  end if;
end $$;
-- Sin datos: se vacía lo de la semilla y la cuenta D, y entonces sí lo quita todo.
delete from public.tax_client_assignee;
update public.accounts set tax_advisor_since = null, tax_advisor_by = null where tax_advisor_since is not null;
\i supabase/vuelta-atras/20261123T0100_p01_despacho.down.sql
do $$ begin
  if to_regprocedure('public.conta_despacho_trimestre(uuid,integer,text,date)') is not null or to_regclass('public.tax_client_assignee') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'tax_advisor_since') then
    raise exception 'PRUEBA despacho · 9: sin datos, la vuelta atrás deja algo.';
  end if;
  raise notice 'PRUEBA despacho · 9: con datos para; sin ellos, lo quita todo.';
end $$;
-- Y se puede volver a aplicar.
\i supabase/migrations/20261123T0100_p01_despacho.sql

rollback;
