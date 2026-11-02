-- ============================================================================
-- PRUEBA (staging) · B01 · Cola 1b (1205, solo añade): el registro de cada
-- lectura del banco. Todo en una transacción con ROLLBACK. Datos INVENTADOS
-- (IBAN del banco 9999, T11), en la cuenta D.
--
--   0. La vuelta atrás quita la tabla y la función, y la 1205 las vuelve a poner
--      (y se puede pasar dos veces).
--   1. Solo la clave de servicio apunta una lectura; un administrador no.
--   2. Lo apuntado: los pendientes que no entran y lo que llegó tarde, con su
--      importe, de la cuenta y la empresa del banco.
--   3. Lo lee el administrador de la cuenta; nadie lo escribe desde la app.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

\i supabase/vuelta-atras/20261102T1205_b01q_lecturas_banco.down.sql
do $$ begin
  if to_regclass('public.bank_aggregator_lectura') is not null
     or to_regprocedure('public.bank_agregador_lectura_apuntar(uuid,text,text,text,date,date,date,integer,integer,integer,integer,numeric,integer,numeric,text,numeric,numeric)') is not null then
    raise exception 'PRUEBA B01 cola 1b · 0: la vuelta atrás no quita la tabla o la función.';
  end if;
end $$;
\i supabase/migrations/20261102T1205_b01q_lecturas_banco.sql
\i supabase/migrations/20261102T1205_b01q_lecturas_banco.sql

create temp table _q (clave text primary key, v text) on commit drop;
grant all on _q to authenticated, service_role;
insert into _q values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'), ('ana', 'c01d0000-0000-4000-8000-0000000000d1');

do $$
declare a uuid := (select v::uuid from _q where clave = 'cuenta'); e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid;
begin
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba 1b · BBVA', 'ES6099990000000000001840', '572', true) returning id into b;
  insert into _q values ('banco', b);
end $$;

-- 1 · Un administrador no apunta lecturas.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.bank_agregador_lectura_apuntar((select v::uuid from _q where clave = 'banco'), 'open-banking-io', 'al_dia', 'x', null, null, null, 0, 0, 0, 0, 0, 0, 0, null, null, null);
    raise exception 'PRUEBA B01 cola 1b · 1: un administrador ha podido apuntar una lectura.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.bank_aggregator_lectura (account_id, company_id, treasury_account_id, provider, status)
    values ((select v::uuid from _q where clave = 'cuenta'), (select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'banco'), 'x', 'x');
    raise exception 'PRUEBA B01 cola 1b · 1: un administrador ha podido escribir el registro.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2 · La clave de servicio, sí: los pendientes y lo que llegó tarde.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select public.bank_agregador_lectura_apuntar((select v::uuid from _q where clave = 'banco'), 'open-banking-io', 'al_dia',
  '1 nuevos y 0 que ya estaban. Al releer desde el 2026-10-26, han llegado tarde 1 (3308,46 €). Hay 1 movimiento pendiente en el banco (-5,00 €) que aún no entra.',
  '2026-10-31', '2026-11-01', '2026-10-26', 1, 1, 0, 1, -5.00, 1, 3308.46, 'sigue', null, 65.55);
reset role;
do $$
declare l public.bank_aggregator_lectura;
begin
  select * into l from public.bank_aggregator_lectura where treasury_account_id = (select v::uuid from _q where clave = 'banco');
  if l.id is null then raise exception 'PRUEBA B01 cola 1b · 2: no ha quedado la lectura.'; end if;
  if l.account_id <> (select v::uuid from _q where clave = 'cuenta') or l.company_id <> (select v::uuid from _q where clave = 'empresa') then
    raise exception 'PRUEBA B01 cola 1b · 2: la lectura no es de la cuenta y la empresa del banco.';
  end if;
  if (l.provider, l.pending_count, l.pending_amount, l.late_count, l.late_amount, l.reread_from, l.bank_balance)
     is distinct from ('open_banking_io', 1, -5.00::numeric, 1, 3308.46::numeric, '2026-10-26'::date, 65.55::numeric) then
    raise exception 'PRUEBA B01 cola 1b · 2: lo apuntado no es lo que se mandó (%).', row_to_json(l);
  end if;
end $$;

-- 3 · Lo lee el administrador de la cuenta.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.bank_aggregator_lectura where treasury_account_id = (select v::uuid from _q where clave = 'banco')) <> 1 then
    raise exception 'PRUEBA B01 cola 1b · 3: el administrador no ve la lectura de su banco.';
  end if;
end $$;
reset role;

select 'PRUEBA B01 cola 1b · el registro de cada lectura: todo en verde' as resultado;
rollback;
