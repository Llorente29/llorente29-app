-- supabase/staging/sql/20261108_g05_entrar_en_el_cliente_prueba.sql
--
-- SOLO STAGING. Prueba de 20261108T1225_g05_entrar_en_el_cliente y de
-- 20261108T1226_g05_disparadores (los de public.user_profiles y
-- public.company_tax_presenter, pasos 7 a 9), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. Contra la asesoría
-- de demo del P01 (seed_p01_despacho_staging.sql, que ya está en staging) y
-- la gestoría de G05 (seed_g05_entrar_staging.sql: un cliente de Folvy con dos
-- sociedades del mismo nombre comercial). Todo inventado (T11).
--
--   1. Laura (administración de la asesoría) entra en Hostal de Prueba Mayor:
--      una fila de acceso, manager, con el despacho, la bienvenida copiada y
--      la cuenta del cliente abierta. Dos veces seguidas: una sola fila (y dos
--      entradas en el rastro).
--   2. Quien no es del despacho recibe NO_AUTORIZADO; un cliente que retiró el
--      permiso, también.
--   3. Un acceso de despacho no abre otro: quien solo está por el despacho no
--      puede entrar en otro cliente.
--   4. conta_despacho_donde dice si la cuenta abierta es un acceso de
--      despacho, y de cuál; mis_empresas sigue como estaba.
--   5. conta_despacho_mis_clientes, desde dentro del cliente: los clientes con
--      permiso de su despacho, por razón social (las dos «Asador de Prueba»,
--      cada una con la suya).
--   6. Volver: abre la asesoría y da su ruta. Desde la asesoría, NO_ES_DE_DESPACHO.
--   7. Retirar el permiso de una de las dos sociedades no apaga el acceso;
--      retirar el de la última, sí (active = false, la fila sigue).
--   8. Entrar otra vez tras devolver el permiso reactiva la misma fila.
--   9. Una fila nueva de user_profiles para quien ya hizo la bienvenida la
--      copia; mi_bienvenida_hecha lo dice.
--  1b. Lo mismo como usuario (set local role authenticated), y el rastro con RLS.
--  10. La vuelta atrás lo quita todo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261108T1225_g05_entrar_en_el_cliente.sql
\i supabase/migrations/20261108T1226_g05_disparadores.sql
\i supabase/seeds/conta/seed_g05_entrar_staging.sql

create function pg_temp.id(s text) returns uuid language sql immutable as $f$ select ('d5ac0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $f$;
create function pg_temp.g(s text) returns uuid language sql immutable as $f$ select ('9050' || '0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $f$;
-- Como una persona con sesión; y la cuenta abierta se vuelve a calcular (la memoria es por transacción).
create function pg_temp.como(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
         set_config('folvy.cuenta_activa', '', true)
$f$;
create function pg_temp.olvidar() returns void language sql as $f$ select set_config('folvy.cuenta_activa', '', true) $f$;
create function pg_temp.falla(p_sql text, p_esperado text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_esperado then return; end if;
    raise exception 'PRUEBA G05: «%» falló con «%», y se esperaba «%».', p_sql, sqlerrm, p_esperado;
  end;
  raise exception 'PRUEBA G05: «%» no falló, y se esperaba «%».', p_sql, p_esperado;
end $f$;

-- ── 1. Entrar, dos veces ────────────────────────────────────────────────────
do $$
declare r jsonb; f public.user_profiles; o public.user_profiles; n int;
begin
  perform pg_temp.como(pg_temp.id('a1'));
  r := public.conta_despacho_entrar(pg_temp.id('c01e'));
  if r->>'account_id' <> pg_temp.id('c010')::text or r->>'company_id' <> pg_temp.id('c01e')::text
     or r->'despacho'->>'account_id' <> pg_temp.id('a0')::text or coalesce(r->>'razon_social', '') = '' then
    raise exception 'PRUEBA G05 · 1: la respuesta no cuadra: %', r;
  end if;
  select * into f from public.user_profiles where user_id = pg_temp.id('a1') and account_id = pg_temp.id('c010');
  select * into o from public.user_profiles where user_id = pg_temp.id('a1') and account_id = pg_temp.id('a0');
  if f.role <> 'manager' or not f.active or f.advisor_account_id is distinct from pg_temp.id('a0')
     or f.welcome_completed_at is distinct from o.welcome_completed_at or f.terms_accepted_at is distinct from o.terms_accepted_at
     or f.display_name is distinct from o.display_name then
    raise exception 'PRUEBA G05 · 1: la fila de acceso no cuadra (rol %, activa %, despacho %, bienvenida %).', f.role, f.active, f.advisor_account_id, f.welcome_completed_at;
  end if;
  perform pg_temp.olvidar();
  if public._cuenta_activa() is distinct from pg_temp.id('c010') then
    raise exception 'PRUEBA G05 · 1: la cuenta abierta no es la del cliente.';
  end if;
  -- Otra vez: sin efecto doble.
  r := public.conta_despacho_entrar(pg_temp.id('c01e'));
  select count(*) into n from public.user_profiles where user_id = pg_temp.id('a1') and account_id = pg_temp.id('c010');
  if n <> 1 then raise exception 'PRUEBA G05 · 1: dos entradas dejan % filas, y tiene que ser 1.', n; end if;
  select count(*) into n from public.conta_despacho_entrada where user_id = pg_temp.id('a1') and company_id = pg_temp.id('c01e');
  if n <> 2 then raise exception 'PRUEBA G05 · 1: el rastro tiene % entradas, y tienen que ser 2.', n; end if;
  raise notice 'PRUEBA G05 · 1: entrar, dos veces: una fila de acceso, con la bienvenida; dos entradas en el rastro. OK.';
end $$;

-- ── 1b. Lo mismo como usuario (set local role authenticated) ───────────────
-- Las funciones nuevas se pueden llamar con sesión (grant a authenticated), y
-- el rastro lo ve el cliente abierto; la administración de otro cliente, no.
select set_config('request.jwt.claims', json_build_object('sub', 'd5ac0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
       set_config('folvy.cuenta_activa', '', true);
set local role authenticated;
do $$
declare r jsonb; n int;
begin
  r := public.conta_despacho_entrar('d5ac0000-0000-4000-8000-00000000c01e');
  if r->>'account_id' <> 'd5ac0000-0000-4000-8000-00000000c010' then raise exception 'PRUEBA G05 · 1b: entrar como usuario no abre Hostal: %', r; end if;
  if public.conta_despacho_donde()->'abierto' is null or jsonb_array_length(public.conta_despacho_mis_clientes()) < 8 or not public.mi_bienvenida_hecha() then
    raise exception 'PRUEBA G05 · 1b: como usuario, dónde, los clientes o la bienvenida no cuadran.';
  end if;
  select count(*) into n from public.conta_despacho_entrada;
  if n < 3 then raise exception 'PRUEBA G05 · 1b: dentro de Hostal, el rastro se ve con % entradas (al menos 3).', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'd5ac0000-0000-4000-8000-00000000c02a', 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', '', true);
  select count(*) into n from public.conta_despacho_entrada;
  if n <> 0 then raise exception 'PRUEBA G05 · 1b: la administración de Talleres ve % entradas de otro cliente.', n; end if;
  raise notice 'PRUEBA G05 · 1b: como usuario: entrar, dónde, los clientes y la bienvenida; el rastro, solo el del cliente abierto. OK.';
end $$;
reset role;

-- ── 2. NO_AUTORIZADO ────────────────────────────────────────────────────────
do $$ begin
  -- La administración de Talleres (cliente) no es del despacho.
  perform pg_temp.como(pg_temp.id('c02a'));
  perform pg_temp.falla(format('select public.conta_despacho_entrar(%L)', pg_temp.id('c01e')), 'NO_AUTORIZADO');
  -- Fontanería retiró el permiso: ni la asesoría entra.
  perform pg_temp.como(pg_temp.id('a1'));
  perform pg_temp.falla(format('select public.conta_despacho_entrar(%L)', pg_temp.id('c09e')), 'NO_AUTORIZADO');
  -- Sin sesión.
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.falla(format('select public.conta_despacho_entrar(%L)', pg_temp.id('c01e')), 'SIN_SESION');
  raise notice 'PRUEBA G05 · 2: quien no es del despacho, un cliente sin permiso y sin sesión: NO_AUTORIZADO / SIN_SESION. OK.';
end $$;

-- ── 3. Un acceso de despacho no abre otro ───────────────────────────────────
do $$ begin
  -- La administración de Talleres pasa a tener SOLO un acceso de despacho en Hostal (a mano):
  -- con eso no puede entrar en otro cliente de la asesoría.
  insert into public.user_profiles (user_id, account_id, role, active, advisor_account_id)
  values (pg_temp.id('c02a'), pg_temp.id('c010'), 'manager', true, pg_temp.id('a0'));
  perform pg_temp.como(pg_temp.id('c02a'));
  perform pg_temp.falla(format('select public.conta_despacho_entrar(%L)', pg_temp.id('c03e')), 'NO_AUTORIZADO');
  delete from public.user_profiles where user_id = pg_temp.id('c02a') and account_id = pg_temp.id('c010');
  raise notice 'PRUEBA G05 · 3: un acceso de despacho no abre otro cliente. OK.';
end $$;

-- ── 4. conta_despacho_donde, y mis_empresas sigue igual ─────────────────────
do $$
declare d jsonb; e jsonb;
begin
  perform pg_temp.como(pg_temp.id('a1'));
  d := public.conta_despacho_donde();
  if d->'abierto'->>'account_id' is distinct from pg_temp.id('c010')::text or d->'abierto'->>'despacho_id' is distinct from pg_temp.id('a0')::text
     or coalesce(d->'abierto'->>'despacho_nombre', '') = '' or not (d->'accesos' @> to_jsonb(array[pg_temp.id('c010')::text])) then
    raise exception 'PRUEBA G05 · 4: conta_despacho_donde no dice que Hostal se abre por el despacho: %', d;
  end if;
  e := public.mis_empresas();
  if not exists (select 1 from jsonb_array_elements(e) x where x->>'account_id' = pg_temp.id('c010')::text and (x->>'activa')::boolean)
     or exists (select 1 from jsonb_array_elements(e) x where x ? 'despacho_id') then
    raise exception 'PRUEBA G05 · 4: mis_empresas no cuadra: %', e;
  end if;
  -- En la asesoría, nada abierto por despacho; los accesos, los mismos.
  perform public.cambiar_empresa(pg_temp.id('a0'));
  perform pg_temp.olvidar();
  d := public.conta_despacho_donde();
  if d->'abierto' <> 'null'::jsonb or jsonb_array_length(d->'accesos') <> 1 then
    raise exception 'PRUEBA G05 · 4: en la asesoría, conta_despacho_donde no cuadra: %', d;
  end if;
  raise notice 'PRUEBA G05 · 4: conta_despacho_donde, dentro y fuera del cliente; mis_empresas como antes. OK.';
end $$;

-- ── 5. Los clientes de mis despachos, desde dentro ──────────────────────────
do $$
declare l jsonb; n int; razones text[];
begin
  perform pg_temp.como(pg_temp.id('a1'));
  perform public.conta_despacho_entrar(pg_temp.id('c01e'));
  l := public.conta_despacho_mis_clientes();
  select count(*) into n from jsonb_array_elements(l);
  if n <> (select count(*) from public.conta_despacho_clientes(pg_temp.id('a0'))) or n < 8 then
    raise exception 'PRUEBA G05 · 5: salen % clientes, y tienen que ser los % con permiso.', n, (select count(*) from public.conta_despacho_clientes(pg_temp.id('a0')));
  end if;
  if exists (select 1 from jsonb_array_elements(l) x where x->>'company_id' = pg_temp.id('c09e')::text) then
    raise exception 'PRUEBA G05 · 5: sale el cliente que retiró el permiso.';
  end if;
  if exists (select 1 from jsonb_array_elements(l) x where x->>'despacho_id' <> pg_temp.id('a0')::text) then
    raise exception 'PRUEBA G05 · 5: salen clientes de otra gestoría.';
  end if;
  -- La gestora de G05: las dos «Asador de Prueba», cada una con su razón social.
  perform pg_temp.como(pg_temp.g('a1'));
  select array_agg(x->>'razon_social' order by x->>'razon_social') into razones
    from jsonb_array_elements(public.conta_despacho_mis_clientes()) x where x->>'nombre' = 'Asador de Prueba';
  if razones is distinct from array['Asador de Prueba Norte, S.L.', 'Asador de Prueba Sur, S.L.'] then
    raise exception 'PRUEBA G05 · 5: las dos «Asador de Prueba» no salen con su razón social: %', razones;
  end if;
  -- Quien no es de ninguna asesoría: lista vacía.
  perform pg_temp.como(pg_temp.id('c02a'));
  if jsonb_array_length(public.conta_despacho_mis_clientes()) <> 0 then
    raise exception 'PRUEBA G05 · 5: un cliente ve clientes de la asesoría.';
  end if;
  raise notice 'PRUEBA G05 · 5: % clientes desde dentro, solo de su despacho; las dos «Asador de Prueba» por razón social; ninguno para quien no es de la asesoría. OK.', n;
end $$;

-- ── 6. Volver ───────────────────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  perform pg_temp.como(pg_temp.id('a1'));
  perform public.conta_despacho_entrar(pg_temp.id('c01e'));
  r := public.conta_despacho_volver();
  if r->>'account_id' <> pg_temp.id('a0')::text or r->>'ruta' <> 'impuestos/clientes' then
    raise exception 'PRUEBA G05 · 6: volver no cuadra: %', r;
  end if;
  perform pg_temp.olvidar();
  if public._cuenta_activa() is distinct from pg_temp.id('a0') then raise exception 'PRUEBA G05 · 6: no ha vuelto a la asesoría.'; end if;
  perform pg_temp.falla('select public.conta_despacho_volver()', 'NO_ES_DE_DESPACHO');
  raise notice 'PRUEBA G05 · 6: volver abre la asesoría; desde ella, NO_ES_DE_DESPACHO. OK.';
end $$;

-- ── 7. Se retira solo ───────────────────────────────────────────────────────
do $$
declare v_activa boolean;
begin
  perform pg_temp.como(pg_temp.g('a1'));
  perform public.conta_despacho_entrar(pg_temp.g('e1'));
  -- Una de las dos sociedades retira el permiso: el acceso sigue (la otra lo da).
  update public.company_tax_presenter set revoked_at = now(), revoked_by = pg_temp.g('a1') where company_id = pg_temp.g('e1');
  select active into v_activa from public.user_profiles where user_id = pg_temp.g('a1') and account_id = pg_temp.g('c0');
  if not v_activa then raise exception 'PRUEBA G05 · 7: retirar una de dos ha apagado el acceso.'; end if;
  -- La última: se apaga, y la fila sigue.
  update public.company_tax_presenter set revoked_at = now(), revoked_by = pg_temp.g('a1') where company_id = pg_temp.g('e2');
  select active into v_activa from public.user_profiles where user_id = pg_temp.g('a1') and account_id = pg_temp.g('c0');
  if v_activa is null then raise exception 'PRUEBA G05 · 7: la fila de acceso se ha borrado; tiene que quedar apagada.'; end if;
  if v_activa then raise exception 'PRUEBA G05 · 7: sin permiso vivo, el acceso sigue encendido.'; end if;
  perform pg_temp.falla(format('select public.cambiar_empresa(%L)', pg_temp.g('c0')), 'NO_AUTORIZADO');
  -- El acceso de Laura a Hostal (otra cuenta, otra gestoría) no se toca.
  if not (select active from public.user_profiles where user_id = pg_temp.id('a1') and account_id = pg_temp.id('c010')) then
    raise exception 'PRUEBA G05 · 7: se ha apagado el acceso de otra cuenta.';
  end if;
  raise notice 'PRUEBA G05 · 7: una de dos no apaga; la última, sí (la fila queda). OK.';
end $$;

-- ── 8. Devolver el permiso y entrar: la misma fila, encendida ───────────────
do $$
declare n int; v_activa boolean;
begin
  update public.company_tax_presenter set revoked_at = null, revoked_by = null where company_id = pg_temp.g('e2');
  perform pg_temp.como(pg_temp.g('a1'));
  perform public.conta_despacho_entrar(pg_temp.g('e2'));
  select count(*), bool_and(active) into n, v_activa from public.user_profiles where user_id = pg_temp.g('a1') and account_id = pg_temp.g('c0');
  if n <> 1 or not v_activa then raise exception 'PRUEBA G05 · 8: % filas, activa %.', n, v_activa; end if;
  raise notice 'PRUEBA G05 · 8: con el permiso devuelto, entrar reactiva la misma fila. OK.';
end $$;

-- ── 9. La bienvenida de raíz ────────────────────────────────────────────────
do $$
declare f public.user_profiles; o public.user_profiles;
begin
  -- Marta, invitada a otra cuenta (como haría invitar-persona): sin bienvenida en la fila nueva.
  insert into public.user_profiles (user_id, account_id, role, active) values (pg_temp.id('a2'), pg_temp.id('c020'), 'worker', true)
  returning * into f;
  select * into o from public.user_profiles where user_id = pg_temp.id('a2') and account_id = pg_temp.id('a0');
  if f.welcome_completed_at is distinct from o.welcome_completed_at or f.terms_accepted_at is distinct from o.terms_accepted_at or f.welcome_completed_at is null then
    raise exception 'PRUEBA G05 · 9: la fila nueva no copia la bienvenida (% / %).', f.welcome_completed_at, o.welcome_completed_at;
  end if;
  -- Una persona sin bienvenida en ninguna parte: nada que copiar.
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pg_temp.g('f9'), 'authenticated', 'authenticated', 'g05.nueva@g05-prueba.test', now(), now());
  insert into public.user_profiles (user_id, account_id, role, active) values (pg_temp.g('f9'), pg_temp.id('c030'), 'worker', true)
  returning * into f;
  if f.welcome_completed_at is not null then raise exception 'PRUEBA G05 · 9: se ha inventado una bienvenida.'; end if;
  -- mi_bienvenida_hecha: Marta sí; la persona nueva, no.
  perform pg_temp.como(pg_temp.id('a2'));
  if not public.mi_bienvenida_hecha() then raise exception 'PRUEBA G05 · 9: mi_bienvenida_hecha dice que no a quien la hizo.'; end if;
  perform pg_temp.como(pg_temp.g('f9'));
  if public.mi_bienvenida_hecha() then raise exception 'PRUEBA G05 · 9: mi_bienvenida_hecha dice que sí a quien no la hizo.'; end if;
  raise notice 'PRUEBA G05 · 9: la fila nueva copia la bienvenida de otra cuenta; sin ninguna, no inventa. OK.';
end $$;

-- ── 10. La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261108T1226_g05_disparadores.down.sql
\i supabase/vuelta-atras/20261108T1225_g05_entrar_en_el_cliente.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'advisor_account_id')
     or to_regclass('public.conta_despacho_entrada') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
          ('conta_despacho_entrar', 'conta_despacho_volver', 'conta_despacho_mis_clientes', '_conta_despacho_retirar', '_conta_bienvenida_heredada', '_conta_despachos_de_quien_llama', 'conta_despacho_donde', 'mi_bienvenida_hecha'))
     or exists (select 1 from pg_trigger where tgname in ('user_profiles_bienvenida_heredada', 'company_tax_presenter_despacho_retirar')) then
    raise exception 'PRUEBA G05 · 10: la vuelta atrás ha dejado algo.';
  end if;
  raise notice 'PRUEBA G05 · 10: la vuelta atrás lo quita todo. OK.';
end $$;

rollback;
