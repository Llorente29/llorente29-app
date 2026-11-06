-- ============================================================================
-- PRUEBA (staging) · B01 · Respuesta 19 (2350): los cargos que el banco anuló
-- dejan de contar con bank_ignorar, como la persona, con su motivo. Todo en una
-- transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999, T11), en la
-- cuenta D. Los tres movimientos sembrados llevan los MISMOS id que los de
-- Foodint, para que la vuelta atrás (que va por esos id) se pruebe de verdad.
--
--   0. Sin la 2350 (vuelta atrás delante): la función no está. Con la 2350:
--      está, nadie más que el dueño la llama (tampoco el administrador con su
--      sesión), y sin Foodint no toca nada.
--   1. Para y no deja nada: con un importe o una fecha que no cuadran, con una
--      empresa que no existe, con uno casado, y con alguien de otra cuenta.
--   2. Con el administrador de D: los tres, ignorados con su motivo y su línea
--      en el historial a su nombre; el otro por aclarar sigue igual; la sesión
--      vuelve a ser la de antes. Otra vez, para: ya no están por aclarar.
--   3. La vuelta atrás: los tres vuelven a «por aclarar», con su línea, y la
--      función no está. La 2350 otra vez delante: vuelve a estar.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01·19: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

create temp table _r (clave text primary key, v text) on commit drop;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1'),
  ('m1', '9d7826af-32b0-4f45-9368-45f98a030d47'), ('m2', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4'), ('m3', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918'),
  ('motivo', 'Anulado por el banco: no había saldo');

-- 0 · Sin la 2350, y con ella.
\i supabase/vuelta-atras/20261106T2350_b01r_cargos_anulados.down.sql
do $$ begin
  if to_regprocedure('public._b01r_ignorar_anulados(uuid,uuid,text,jsonb)') is not null then
    raise exception 'PRUEBA B01·19 · 0: la vuelta atrás no quita la función.';
  end if;
end $$;
\i supabase/migrations/20261106T2350_b01r_cargos_anulados.sql
do $$
declare f constant text := 'public._b01r_ignorar_anulados(uuid,uuid,text,jsonb)'; q text;
begin
  if to_regprocedure(f) is null then raise exception 'PRUEBA B01·19 · 0: la 2350 no deja la función.'; end if;
  foreach q in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(q, f, 'execute') then raise exception 'PRUEBA B01·19 · 0: % puede llamar a la función de la tanda.', q; end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then
    raise exception 'PRUEBA B01·19 · 0: PUBLIC puede llamar a la función de la tanda.';
  end if;
end $$;

-- Como usuario (el administrador de D, con su sesión): no la puede llamar.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare parado boolean := false;
begin
  begin
    perform public._b01r_ignorar_anulados(gen_random_uuid(), gen_random_uuid(), 'x', '[]'::jsonb);
  exception when insufficient_privilege then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·19 · 0: un usuario con sesión llama a la función de la tanda.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- La siembra (como el dueño): un banco de D, su extracto y cinco movimientos.
do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa'); t uuid; s uuid;
begin
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values (a, e, 'bank', 'B01·19 · banco de prueba', 'ES6499990000000000002350') returning id into t;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
     opening_balance, closing_balance, movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity)
  values (a, e, t, 'fichero', 'norma43', 'b01r-anulados.n43', date '2026-10-29', date '2026-10-30', 100, 28, 5, 5, 0, 0, true, null, 'primero')
  returning id into s;
  insert into public.bank_movement (id, account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status, reason)
  values ((select v::uuid from _r where clave = 'm1'), a, e, t, s, date '2026-10-30', date '2026-10-30', -30.00, 'B01R TGSS PRUEBA 1', 'b01r-1', 'b01r-s1', 'por_aclarar', 'Prueba B01·19'),
         ((select v::uuid from _r where clave = 'm2'), a, e, t, s, date '2026-10-30', date '2026-10-30', -20.00, 'B01R TGSS PRUEBA 2', 'b01r-2', 'b01r-s2', 'por_aclarar', 'Prueba B01·19'),
         ((select v::uuid from _r where clave = 'm3'), a, e, t, s, date '2026-10-30', date '2026-10-30', -10.00, 'B01R TGSS PRUEBA 3', 'b01r-3', 'b01r-s3', 'por_aclarar', 'Prueba B01·19'),
         (gen_random_uuid(), a, e, t, s, date '2026-10-30', date '2026-10-30', -5.00, 'B01R OTRO POR ACLARAR', 'b01r-4', 'b01r-s4', 'por_aclarar', 'Prueba B01·19');
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, e, t, s, date '2026-10-29', date '2026-10-29', -7.00, 'B01R CASADO', 'b01r-5', 'b01r-s5', 'casado');
  insert into _r values ('banco', t::text);
end $$;

create temp table _lista (clave text primary key, v jsonb) on commit drop;
insert into _lista values
  ('buena', jsonb_build_array(
     jsonb_build_object('id', (select v from _r where clave = 'm1'), 'importe', -30.00, 'fecha', '2026-10-30'),
     jsonb_build_object('id', (select v from _r where clave = 'm2'), 'importe', -20.00, 'fecha', '2026-10-30'),
     jsonb_build_object('id', (select v from _r where clave = 'm3'), 'importe', -10.00, 'fecha', '2026-10-30'))),
  ('importe', jsonb_build_array(
     jsonb_build_object('id', (select v from _r where clave = 'm1'), 'importe', -30.00, 'fecha', '2026-10-30'),
     jsonb_build_object('id', (select v from _r where clave = 'm2'), 'importe', -21.00, 'fecha', '2026-10-30'))),
  ('fecha', jsonb_build_array(
     jsonb_build_object('id', (select v from _r where clave = 'm1'), 'importe', -30.00, 'fecha', '2026-10-31'))),
  ('casado', jsonb_build_array(
     jsonb_build_object('id', (select v from _r where clave = 'm1'), 'importe', -30.00, 'fecha', '2026-10-30'),
     jsonb_build_object('id', (select m.id::text from public.bank_movement m where m.fingerprint = 'b01r-5' and m.treasury_account_id = (select v::uuid from _r where clave = 'banco')),
                        'importe', -7.00, 'fecha', '2026-10-29')));

-- Lo de antes, para ver que lo que para no deja nada.
create temp table _antes on commit drop as
  select m.id, m.status, m.ignored_reason from public.bank_movement m where m.treasury_account_id = (select v::uuid from _r where clave = 'banco');

-- 1 · Para y no deja nada.
do $$
declare
  e uuid := (select v::uuid from _r where clave = 'empresa'); ad uuid := (select v::uuid from _r where clave = 'admin');
  ot uuid := (select v::uuid from _r where clave = 'otra'); mo text := (select v from _r where clave = 'motivo');
  c record; parado boolean; msg text;
begin
  for c in select * from (values
      ('un importe que no cuadra', e, ad, 'importe', 'se esperaba'),
      ('una fecha que no cuadra', e, ad, 'fecha', 'se esperaba'),
      ('una empresa que no existe', gen_random_uuid(), ad, 'buena', 'esa empresa no está'),
      ('uno casado', e, ad, 'casado', 'ya no está por aclarar'),
      ('alguien de otra cuenta', e, ot, 'buena', 'Solo un administrador o un encargado')) x(que, emp, actor, lista, espera) loop
    parado := false;
    begin
      perform public._b01r_ignorar_anulados(c.emp, c.actor, mo, (select v from _lista where clave = c.lista));
    exception when others then
      parado := true; msg := sqlerrm;
    end;
    if not parado then raise exception 'PRUEBA B01·19 · 1: con %, no para.', c.que; end if;
    if position(c.espera in msg) = 0 then raise exception 'PRUEBA B01·19 · 1: con %, para por otra cosa: «%».', c.que, msg; end if;
    if exists (select 1 from public.bank_movement m join _antes a on a.id = m.id
                where m.status is distinct from a.status or m.ignored_reason is distinct from a.ignored_reason) then
      raise exception 'PRUEBA B01·19 · 1: con %, deja algo cambiado.', c.que;
    end if;
    if exists (select 1 from public.bank_activity_log l where l.movement_id in (select id from _antes) and l.action = 'ignorado') then
      raise exception 'PRUEBA B01·19 · 1: con %, deja una línea en el historial.', c.que;
    end if;
  end loop;
end $$;

-- 2 · Con el administrador de D.
do $$
declare
  e uuid := (select v::uuid from _r where clave = 'empresa'); ad uuid := (select v::uuid from _r where clave = 'admin');
  mo text := (select v from _r where clave = 'motivo'); n int; antes text := coalesce(current_setting('request.jwt.claims', true), ''); parado boolean := false;
begin
  n := public._b01r_ignorar_anulados(e, ad, mo, (select v from _lista where clave = 'buena'));
  if n <> 3 then raise exception 'PRUEBA B01·19 · 2: devuelve % y se esperaban 3.', n; end if;
  if (select count(*) from public.bank_movement where id in (select v::uuid from _r where clave in ('m1', 'm2', 'm3')) and status = 'ignorado' and ignored_reason = mo) <> 3 then
    raise exception 'PRUEBA B01·19 · 2: los tres no quedan ignorados con su motivo.';
  end if;
  if (select status from public.bank_movement where fingerprint = 'b01r-4' and treasury_account_id = (select v::uuid from _r where clave = 'banco')) <> 'por_aclarar' then
    raise exception 'PRUEBA B01·19 · 2: el otro por aclarar ha cambiado.';
  end if;
  if (select count(*) from public.bank_activity_log l where l.movement_id in (select v::uuid from _r where clave in ('m1', 'm2', 'm3'))
       and l.action = 'ignorado' and l.by_who = 'persona' and l.created_by = ad and l.summary = 'Ignorado: ' || mo) <> 3 then
    raise exception 'PRUEBA B01·19 · 2: faltan las tres líneas del historial a nombre del administrador.';
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') <> antes then
    raise exception 'PRUEBA B01·19 · 2: la sesión no vuelve a ser la de antes (%).', current_setting('request.jwt.claims', true);
  end if;
  begin
    perform public._b01r_ignorar_anulados(e, ad, mo, (select v from _lista where clave = 'buena'));
  exception when others then parado := true;
  end;
  if not parado then raise exception 'PRUEBA B01·19 · 2: una segunda vez no para.'; end if;
end $$;

-- 3 · La vuelta atrás, y la 2350 otra vez.
\i supabase/vuelta-atras/20261106T2350_b01r_cargos_anulados.down.sql
do $$ begin
  if (select count(*) from public.bank_movement where id in (select v::uuid from _r where clave in ('m1', 'm2', 'm3')) and status = 'por_aclarar' and ignored_reason is null) <> 3 then
    raise exception 'PRUEBA B01·19 · 3: la vuelta atrás no los deja por aclarar.';
  end if;
  if (select count(*) from public.bank_activity_log l where l.movement_id in (select v::uuid from _r where clave in ('m1', 'm2', 'm3')) and l.action = 'por_aclarar' and l.by_who = 'folvy') <> 3 then
    raise exception 'PRUEBA B01·19 · 3: la vuelta atrás no deja su línea en el historial.';
  end if;
  if to_regprocedure('public._b01r_ignorar_anulados(uuid,uuid,text,jsonb)') is not null then
    raise exception 'PRUEBA B01·19 · 3: la vuelta atrás no quita la función.';
  end if;
end $$;
\i supabase/migrations/20261106T2350_b01r_cargos_anulados.sql
do $$ begin
  if to_regprocedure('public._b01r_ignorar_anulados(uuid,uuid,text,jsonb)') is null then raise exception 'PRUEBA B01·19 · 3: la 2350 otra vez no deja la función.'; end if;
end $$;

select 'PRUEBA B01·19 · Cargos anulados por el banco, fuera con su motivo: todo en verde' as resultado;
rollback;
