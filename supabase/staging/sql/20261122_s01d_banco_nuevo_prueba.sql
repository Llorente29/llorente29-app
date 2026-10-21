-- supabase/staging/sql/20261122_s01d_banco_nuevo_prueba.sql
--
-- SOLO STAGING. La 0170 del S01d (dar de alta un banco que aún no está en el
-- plan), por sus caminos:
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. COMO USUARIO de A (administrador de A), en una empresa con el plan
--      activado: sin nombre no; un banco sin IBAN no (lo dice bank_cuenta_alta);
--      con todo, crea la subcuenta 572 siguiente («Bancos · <nombre>»), el
--      banco y su enlace, y lo dice. Dos seguidos no se pisan la subcuenta.
--   3. Una empresa SIN plan activado (si staging tiene alguna de A): el banco,
--      sin subcuenta, y dice por qué.
--   4. COMO USUARIO de B: no da de alta bancos en la empresa de A.
--   5. La vuelta atrás, de verdad: sin la función; los bancos y sus
--      subcuentas se quedan (son datos). Y se vuelve a aplicar.
--
-- Cambia: la función nueva bank_cuenta_nueva. Todo acaba en ROLLBACK: staging
-- no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01d 0170: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0170, si falta.
select to_regprocedure('public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text)') is null as falta_0170 \gset
\if :falta_0170
\echo '>>> Staging aún no tiene la 0170 del S01d: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261122T0170_s01d_banco_nuevo.sql
\endif

-- 2 y 3 · Como A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; r2 jsonb; v_sin uuid; n int;
begin
  if not exists (select 1 from public.company_account where company_id = v_e) then
    raise exception 'PRUEBA S01d 0170 · 2: la empresa de A no tiene el plan activado; la prueba no mide lo que dice.';
  end if;
  begin
    perform public.bank_cuenta_nueva(v_e, 'bank', '  ', 'ES9121000418450200051332', null, true, 'Prueba');
    raise exception 'PRUEBA S01d 0170 · 2: ha dado de alta un banco sin nombre.';
  exception when check_violation then null; end;
  begin
    perform public.bank_cuenta_nueva(v_e, 'bank', 'Banco Sin IBAN Prueba S01d', null, null, true, 'Prueba');
    raise exception 'PRUEBA S01d 0170 · 2: ha dado de alta un banco sin IBAN.';
  exception when check_violation then null; end;

  r := public.bank_cuenta_nueva(v_e, 'bank', 'Banco Nuevo Prueba S01d', 'ES91 2100 0418 4502 0005 1332', null, true, 'Prueba');
  if r->>'cuenta' not like '572%' or r->>'porque' not like 'Nueva subcuenta 572% · Bancos · Banco Nuevo Prueba S01d, enlazada al banco.' then
    raise exception 'PRUEBA S01d 0170 · 2: no dice la subcuenta nueva: %', r;
  end if;
  select count(*) into n from public.company_account a
    join public.company_account_link l on l.company_account_id = a.id and l.entity = 'bank_account' and l.entity_id = r->>'banco'
   where a.company_id = v_e and a.code = r->>'cuenta' and a.name = 'Bancos · Banco Nuevo Prueba S01d' and a.kind = 'own' and a.template_code = '572';
  if n <> 1 then raise exception 'PRUEBA S01d 0170 · 2: la subcuenta % no está enlazada al banco %.', r->>'cuenta', r->>'banco'; end if;
  if not exists (select 1 from public.treasury_account where id = (r->>'banco')::uuid and iban = 'ES9121000418450200051332' and kind = 'bank') then
    raise exception 'PRUEBA S01d 0170 · 2: el banco no está, o sin su IBAN limpio.';
  end if;
  r2 := public.bank_cuenta_nueva(v_e, 'card', 'Tarjeta Prueba S01d', null, null, true, 'Prueba');
  if r2->>'cuenta' = r->>'cuenta' or r2->>'cuenta' not like '572%' then
    raise exception 'PRUEBA S01d 0170 · 2: el segundo pisa la subcuenta del primero: % y %', r->>'cuenta', r2->>'cuenta';
  end if;
  raise notice 'PRUEBA S01d 0170 · 2: sin nombre no, sin IBAN no; «%» y «%».', r->>'porque', r2->>'porque';

  -- 3 · Sin plan.
  select c.id into v_sin from public.company c
   where c.account_id = 'c01a0000-0000-4000-8000-00000000000a' and not exists (select 1 from public.company_account a where a.company_id = c.id) limit 1;
  if v_sin is null then
    raise notice 'PRUEBA S01d 0170 · 3: staging no tiene ninguna empresa de A sin plan: no hay nada que probar aquí.';
  else
    r := public.bank_cuenta_nueva(v_sin, 'bank', 'Banco Sin Plan Prueba S01d', 'ES9121000418450200051332', null, true, 'Prueba');
    if r->>'cuenta' is not null or r->>'banco' is null then raise exception 'PRUEBA S01d 0170 · 3: sin plan no da el banco solo: %', r; end if;
    raise notice 'PRUEBA S01d 0170 · 3: sin plan, el banco solo: %', r->>'porque';
  end if;
end $$;
reset role;

-- 4 · Como B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.bank_cuenta_nueva('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'bank', 'Banco de B en A', 'ES9121000418450200051332', null, true, 'B');
    raise exception 'PRUEBA S01d 0170 · 4: B ha dado de alta un banco en A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA S01d 0170 · 4: B no da de alta bancos en A.';
end $$;
reset role;

-- 5 · La vuelta atrás, de verdad.
\i supabase/vuelta-atras/20261122T0170_s01d_banco_nuevo.down.sql
do $$ begin
  if to_regprocedure('public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text)') is not null then
    raise exception 'PRUEBA S01d 0170 · 5: la función sigue.';
  end if;
  if not exists (select 1 from public.treasury_account where name = 'Banco Nuevo Prueba S01d') then
    raise exception 'PRUEBA S01d 0170 · 5: la vuelta atrás se ha llevado el banco.';
  end if;
  raise notice 'PRUEBA S01d 0170 · 5: sin la función; el banco y su subcuenta se quedan.';
end $$;
\i supabase/migrations/20261122T0170_s01d_banco_nuevo.sql
do $$ begin
  if to_regprocedure('public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text)') is null then
    raise exception 'PRUEBA S01d 0170 · 5: no se ha podido volver a aplicar.';
  end if;
  raise notice 'PRUEBA S01d 0170 · 5: se vuelve a aplicar.';
end $$;

rollback;
