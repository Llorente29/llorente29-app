-- ============================================================================
-- PRUEBA (staging) · B01 · Respuesta 20 (0055): el cargo que el banco anula.
-- Todo en una transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999,
-- T11), en la cuenta D, sembrados por el dueño; lo demás COMO USUARIO (el
-- administrador de D con su sesión, y alguien de otra cuenta).
--
-- Un banco con estos extractos (el saldo de Sumied y el del banco):
--   e1 29/10  primero, cierra en 175,55.
--   e2 30/10  HUECO +3.308,46, cierra en 75,55: un cargo de −3.308,46 que lo
--             explica solo, y otro de −5,00 que no.            → aviso
--   e3 03/11  HUECO −50,00 y e4 04/11 HUECO +50,00 con un cargo de −50,00: el
--             banco lo descontó un día antes. Retraso, no anulado. → nada
--   e5 05/11  HUECO +30,00 con cargos de −10, −20 y −30: dos formas de sumarlo.
--             No adivina.                                       → nada
--   e6 06/11  HUECO +21,16 con un cargo de −21,16 CASADO.       → aviso
--
--   0. Sin la 0055 (vuelta atrás delante) no hay nada; con ella, las funciones
--      y las columnas, y quién puede llamar a qué.
--   1. El administrador ve los dos avisos (e2 y e6), con sus cifras; alguien de
--      otra cuenta no ve nada (42501).
--   2. «Quitarlo» en e2: aparta el cargo con su motivo y su línea, devuelve lo
--      que se dice, y el aviso se va. Otra vez: «ya no está». En e6: deshace
--      el casado y lo aparta.
--   3. «Deshacer» el apartado de e2: vuelve a pendiente, con su línea, y el
--      aviso vuelve. Deshacer lo que no está apartado: falla.
--   4. «No, es bueno» en e2: el aviso no vuelve.
--   5. La vuelta atrás quita todo; la 0055 otra vez lo pone.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01·20: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

create temp table _r (clave text primary key, v text) on commit drop;
grant all on _r to authenticated;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1'),
  ('motivo', 'Anulado por el banco: no había saldo');

-- 0 · Sin la 0055, y con ella.
\i supabase/vuelta-atras/20261107T0055_b01s_cargo_anulado.down.sql
do $$ begin
  if to_regprocedure('public.bank_cargos_anulados(uuid)') is not null or exists (select 1 from information_schema.columns where table_name = 'bank_movement' and column_name = 'not_cancelled_at') then
    raise exception 'PRUEBA B01·20 · 0: la vuelta atrás no lo quita todo.';
  end if;
end $$;
\i supabase/migrations/20261107T0055_b01s_cargo_anulado.sql
do $$
declare f text;
begin
  foreach f in array array['public.bank_cargos_anulados(uuid)', 'public.bank_anulado_quitar(uuid,uuid)', 'public.bank_anulado_es_bueno(uuid,uuid)', 'public.bank_desapartar(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA B01·20 · 0: anon puede llamar a %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA B01·20 · 0: authenticated no puede llamar a %.', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public._bank_cargos_anulados(uuid)', 'execute') then
    raise exception 'PRUEBA B01·20 · 0: authenticated puede llamar a _bank_cargos_anulados (no comprueba quién).';
  end if;
end $$;

-- La siembra (como el dueño).
do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa');
  t uuid; s uuid; m uuid; k int := 0;
  ext record;
begin
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values (a, e, 'bank', 'B01·20 · banco de prueba', 'ES6499990000000000002355') returning id into t;
  insert into _r values ('banco', t::text);
  for ext in select * from (values
      ('e1', date '2026-10-29', 'primero', null::numeric, 175.55::numeric),
      ('e2', date '2026-10-30', 'hueco',   3308.46,       75.55),
      ('e3', date '2026-11-03', 'hueco',   -50.00,        25.55),
      ('e4', date '2026-11-04', 'hueco',   50.00,         25.55),
      ('e5', date '2026-11-05', 'hueco',   30.00,         25.55),
      ('e6', date '2026-11-06', 'hueco',   21.16,         25.55)) x(clave, dia, cont, gap, cierre) loop
    insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
       opening_balance, closing_balance, movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity, continuity_gap)
    values (a, e, t, 'fichero', 'norma43', 'b01s-' || ext.clave || '.n43', ext.dia, ext.dia, 0, ext.cierre, 0, 0, 0, 0, true, null, ext.cont, ext.gap)
    returning id into s;
    insert into _r values (ext.clave, s::text);
  end loop;
  -- Los movimientos de cada extracto.
  for ext in select * from (values
      ('m2', 'e2', date '2026-10-30', -3308.46, 'por_aclarar'), ('m2b', 'e2', date '2026-10-30', -5.00, 'por_aclarar'),
      ('m4', 'e4', date '2026-11-04', -50.00, 'por_aclarar'),
      ('m5a', 'e5', date '2026-11-05', -10.00, 'por_aclarar'), ('m5b', 'e5', date '2026-11-05', -20.00, 'por_aclarar'), ('m5c', 'e5', date '2026-11-05', -30.00, 'por_aclarar'),
      ('m6', 'e6', date '2026-11-06', -21.16, 'casado')) x(clave, ext, dia, importe, estado) loop
    k := k + 1;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status, reason)
    values (a, e, t, (select v::uuid from _r where clave = ext.ext), ext.dia, ext.dia, ext.importe, 'B01S ' || upper(ext.clave), 'b01s-' || k, 'b01s-s' || k, ext.estado,
            case when ext.estado = 'por_aclarar' then 'Prueba B01·20' end)
    returning id into m;
    insert into _r values (ext.clave, m::text);
  end loop;
  insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who)
  values (a, e, (select v::uuid from _r where clave = 'm6'), 'cuenta', null, false, -21.16, 'probable', 'Prueba B01·20: casado a mano', 'persona')
  returning id into m;
  insert into _r values ('match6', m::text);
end $$;

-- 1 · Lo que ve el administrador; lo que ve otra cuenta.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa'); t uuid := (select v::uuid from _r where clave = 'banco');
  j jsonb; a2 jsonb; a6 jsonb;
begin
  select coalesce(jsonb_agg(x), '[]') into j from jsonb_array_elements(public.bank_cargos_anulados(e)) x where x->>'banco' = t::text;
  if jsonb_array_length(j) <> 2 then raise exception 'PRUEBA B01·20 · 1: se esperaban 2 avisos (e2 y e6) y salen %: %.', jsonb_array_length(j), j; end if;
  select x into a2 from jsonb_array_elements(j) x where x->>'extracto' = (select v from _r where clave = 'e2');
  select x into a6 from jsonb_array_elements(j) x where x->>'extracto' = (select v from _r where clave = 'e6');
  if a2 is null or a6 is null then raise exception 'PRUEBA B01·20 · 1: los avisos no son los de e2 y e6: %.', j; end if;
  if (a2->>'saldo_banco')::numeric <> 75.55 or (a2->>'hueco')::numeric <> 3308.46 or a2->>'dia' <> '2026-10-30'
     or jsonb_array_length(a2->'cargos') <> 1 or a2->'cargos'->0->>'id' <> (select v from _r where clave = 'm2') or (a2->'cargos'->0->>'esta_casado')::boolean then
    raise exception 'PRUEBA B01·20 · 1: el aviso de e2 no es el que se espera: %.', a2;
  end if;
  if a6->'cargos'->0->>'id' <> (select v from _r where clave = 'm6') or not (a6->'cargos'->0->>'esta_casado')::boolean then
    raise exception 'PRUEBA B01·20 · 1: el aviso de e6 no dice que está casado: %.', a6;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'otra'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare parado boolean := false;
begin
  begin
    perform public.bank_cargos_anulados((select v::uuid from _r where clave = 'empresa'));
  exception when insufficient_privilege then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·20 · 1: alguien de otra cuenta ve los avisos de D.'; end if;
  parado := false;
  begin
    perform public.bank_anulado_quitar((select v::uuid from _r where clave = 'empresa'), (select v::uuid from _r where clave = 'e2'));
  exception when insufficient_privilege then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·20 · 1: alguien de otra cuenta quita un cargo de D.'; end if;
end $$;
reset role;

-- 2 · «Quitarlo».
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa'); t uuid := (select v::uuid from _r where clave = 'banco');
  mo text := (select v from _r where clave = 'motivo'); q jsonb; parado boolean := false; m2 public.bank_movement;
begin
  q := public.bank_anulado_quitar(e, (select v::uuid from _r where clave = 'e2'));
  if (q->>'n')::int <> 1 or (q->>'suma')::numeric <> 3308.46 or (q->>'saldo_banco')::numeric <> 75.55 or q->>'dia' <> '2026-10-30' or (q->>'deshechos')::int <> 0 then
    raise exception 'PRUEBA B01·20 · 2: «Quitarlo» devuelve %.', q;
  end if;
  select * into m2 from public.bank_movement where id = (select v::uuid from _r where clave = 'm2');
  if m2.status <> 'ignorado' or m2.ignored_reason <> mo then raise exception 'PRUEBA B01·20 · 2: el cargo no queda apartado con su motivo (% · %).', m2.status, m2.ignored_reason; end if;
  if (select status from public.bank_movement where id = (select v::uuid from _r where clave = 'm2b')) <> 'por_aclarar' then
    raise exception 'PRUEBA B01·20 · 2: «Quitarlo» ha tocado el otro cargo del día.';
  end if;
  if not exists (select 1 from public.bank_activity_log l where l.movement_id = m2.id and l.action = 'ignorado' and l.by_who = 'persona' and l.summary = 'Ignorado: ' || mo) then
    raise exception 'PRUEBA B01·20 · 2: falta su línea en el historial.';
  end if;
  if exists (select 1 from jsonb_array_elements(public.bank_cargos_anulados(e)) x where x->>'extracto' = (select v from _r where clave = 'e2')) then
    raise exception 'PRUEBA B01·20 · 2: el aviso de e2 sigue después de quitarlo.';
  end if;
  begin
    perform public.bank_anulado_quitar(e, (select v::uuid from _r where clave = 'e2'));
  exception when no_data_found then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·20 · 2: quitar dos veces no para.'; end if;
  -- El casado: se deshace y se aparta.
  q := public.bank_anulado_quitar(e, (select v::uuid from _r where clave = 'e6'));
  if (q->>'deshechos')::int <> 1 then raise exception 'PRUEBA B01·20 · 2: con el casado, «Quitarlo» devuelve %.', q; end if;
  if (select status from public.bank_match where id = (select v::uuid from _r where clave = 'match6')) <> 'deshecho'
     or (select status from public.bank_movement where id = (select v::uuid from _r where clave = 'm6')) <> 'ignorado' then
    raise exception 'PRUEBA B01·20 · 2: el casado no se deshace o el cargo no queda apartado.';
  end if;
end $$;

-- 3 · «Deshacer» el apartado.
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa'); m2 uuid := (select v::uuid from _r where clave = 'm2'); parado boolean := false;
begin
  perform public.bank_desapartar(m2);
  if (select status from public.bank_movement where id = m2) <> 'pendiente' or (select ignored_reason from public.bank_movement where id = m2) is not null then
    raise exception 'PRUEBA B01·20 · 3: deshacer no lo deja pendiente.';
  end if;
  if not exists (select 1 from public.bank_activity_log l where l.movement_id = m2 and l.action = 'deshecho' and l.summary like 'Deshecho el «Apartado»: Anulado por el banco%') then
    raise exception 'PRUEBA B01·20 · 3: deshacer no deja su línea en el historial.';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.bank_cargos_anulados(e)) x where x->>'extracto' = (select v from _r where clave = 'e2')) then
    raise exception 'PRUEBA B01·20 · 3: deshecho, el aviso de e2 no vuelve.';
  end if;
  begin
    perform public.bank_desapartar(m2);
  exception when check_violation then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·20 · 3: deshacer lo que no está apartado no para.'; end if;
end $$;

-- 4 · «No, es bueno».
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa'); q jsonb;
begin
  q := public.bank_anulado_es_bueno(e, (select v::uuid from _r where clave = 'e2'));
  if (q->>'n')::int <> 1 then raise exception 'PRUEBA B01·20 · 4: «No, es bueno» devuelve %.', q; end if;
  if (select not_cancelled_by from public.bank_movement where id = (select v::uuid from _r where clave = 'm2')) is distinct from (select v::uuid from _r where clave = 'admin') then
    raise exception 'PRUEBA B01·20 · 4: no queda quién lo dijo.';
  end if;
  if exists (select 1 from jsonb_array_elements(public.bank_cargos_anulados(e)) x where x->>'banco' = (select v from _r where clave = 'banco')) then
    raise exception 'PRUEBA B01·20 · 4: después de «No, es bueno» aún hay avisos en el banco: %.', public.bank_cargos_anulados(e);
  end if;
end $$;
reset role;

-- 5 · La vuelta atrás, y la 0055 otra vez.
\i supabase/vuelta-atras/20261107T0055_b01s_cargo_anulado.down.sql
do $$ begin
  if to_regprocedure('public.bank_desapartar(uuid)') is not null or exists (select 1 from information_schema.columns where table_name = 'bank_movement' and column_name = 'not_cancelled_by') then
    raise exception 'PRUEBA B01·20 · 5: la vuelta atrás no lo quita todo.';
  end if;
  if (select status from public.bank_movement where id = (select v::uuid from _r where clave = 'm6')) <> 'ignorado' then
    raise exception 'PRUEBA B01·20 · 5: la vuelta atrás ha tocado lo apartado.';
  end if;
end $$;
\i supabase/migrations/20261107T0055_b01s_cargo_anulado.sql
do $$ begin
  if to_regprocedure('public.bank_cargos_anulados(uuid)') is null then raise exception 'PRUEBA B01·20 · 5: la 0055 otra vez no deja las funciones.'; end if;
end $$;

select 'PRUEBA B01·20 · El cargo que el banco anula: todo en verde' as resultado;
rollback;
