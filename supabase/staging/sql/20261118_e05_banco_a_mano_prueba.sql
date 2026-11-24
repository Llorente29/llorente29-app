-- supabase/staging/sql/20261118_e05_banco_a_mano_prueba.sql
--
-- SOLO STAGING. Prueba del E05 (20261118T2248_e05_banco_a_mano), que el ensayo de
-- staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK:
-- staging no cambia. Lo que crea: public.conta_banco_a_mano.
--
-- En la cuenta D de staging (su plan de verdad), con un banco inventado (IBAN del
-- banco 9999) y su 572 propia, su ejercicio y su corte si no los tiene:
--   1. Lo que crea y sus permisos (anon no; authenticated sí).
--   2. Un pago a mano, con el usuario de D: queda VALIDADO al momento, serie 3,
--      con número, la 572 del banco al haber y la cuenta al debe, y su frase.
--   3. Un ingreso a mano: la 572 al debe.
--   4. Cuando llegue en el extracto, se casa con él: los dos salen en
--      bank_asientos_sin_movimiento (lo que mira el motor, paso 1), con su banco,
--      su importe con signo y origen «otro»; al llegar el pago, bank_casar con el
--      destino «asiento» (lo que hace nucleo.confirmar) lo casa sin crear otro
--      asiento, y deja de salir: no se duplica.
--   5. Lo que no deja: importe 0, una cuenta que no está en el plan, la 572 del
--      propio banco, un banco sin su 572 y un banco de otra cuenta (el usuario de A).
--   6. La vuelta atrás quita la función.
--
-- Como el cliente: el usuario de D (o el de A) en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _p where _p.k = $1 $$;

-- 0 · Preparar (inventado): el ejercicio y el corte si no están, un banco con su 572 y otro sin ella.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_b uuid; v_sin uuid; v_c uuid; v_corte date;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-10-21' between starts_on and ends_on);
  if public._conta_corte(v_e) is null then
    insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-07-01')
    on conflict (company_id) do update set cutover_date = date '2026-07-01';
  end if;
  v_corte := public._conta_corte(v_e);
  if v_corte is null or v_corte > date '2026-10-21' then
    raise exception 'PRUEBA E05: el corte de la cuenta D (%) no deja probar.', v_corte;
  end if;
  update public.conta_eje_analitico set activo = false where company_id = v_e and eje = 'local';
  insert into public.treasury_account (account_id, company_id, kind, name, short_name, iban, pgc_hint, is_active)
  values (v_acc, v_e, 'bank', 'Prueba E05 · Banco a mano', 'Banco E05', 'ES0099990000000000000505', '572', true) returning id into v_b;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (v_acc, v_e, 'bank', 'Prueba E05 · Sin cuenta', 'ES0099990000000000000506', '572', true) returning id into v_sin;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '57200505', '572', 'Banco E05', 'own', 'manual') returning id into v_c;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_c, 'bank_account', v_b::text, 'principal', 'manual');
  if not exists (select 1 from public.company_account where company_id = v_e and code = '62600000')
     or not exists (select 1 from public.company_account where company_id = v_e and code = '57000000') then
    raise exception 'PRUEBA E05: la cuenta D no tiene la 626 o la 570 en su plan.';
  end if;
  insert into _p values ('acc', v_acc), ('e', v_e), ('banco', v_b), ('sin', v_sin);
end $$;

-- 1 · Lo que crea y sus permisos --------------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)') is null then
    raise exception 'PRUEBA E05 · 1: no está conta_banco_a_mano.';
  end if;
  if has_function_privilege('anon', 'public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', 'execute') then
    raise exception 'PRUEBA E05 · 1: los permisos no son los suyos.';
  end if;
  raise notice '1 OK: la función está; anon no la ejecuta y authenticated sí.';
end $$;

-- 2 y 3 · Un pago y un ingreso a mano, con el usuario de D: validados al momento.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; i jsonb;
begin
  r := public.conta_banco_a_mano(pg_temp.p('banco')::uuid, date '2026-10-21', '62600000', 'Comisión mantenimiento', -12.5, null);
  i := public.conta_banco_a_mano(pg_temp.p('banco')::uuid, date '2026-10-22', '57000000', 'Ingreso de caja', 300, 'Prueba E05');
  insert into _p values ('pago', r->>'asiento_id'), ('ingreso', i->>'asiento_id'), ('texto', r->>'texto');
end $$;
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

do $$
declare e record; l text; v_t text := pg_temp.p('texto');
begin
  select * into e from public.journal_entry where id = pg_temp.p('pago')::uuid;
  if e.status <> 'validado' or e.series <> 3 or e.number is null or e.source_type <> 'manual' or e.entry_date <> date '2026-10-21'
     or e.account_id <> pg_temp.p('acc')::uuid or e.company_id <> pg_temp.p('e')::uuid then
    raise exception 'PRUEBA E05 · 2: el pago no ha quedado validado en la serie 3 (% · % · % · %).', e.status, e.series, e.number, e.source_type;
  end if;
  select string_agg(a.code || ' ' || jl.debit || '/' || jl.credit, ', ' order by a.code) into l
    from public.journal_line jl join public.company_account a on a.id = jl.company_account_id where jl.entry_id = e.id;
  if l <> '57200505 0.00/12.50, 62600000 12.50/0.00' then raise exception 'PRUEBA E05 · 2: sus líneas no son las de un pago: %.', l; end if;
  if v_t not like 'Apuntado y validado: asiento % pago de 12,50 € en 62600000 (Comisión mantenimiento).%' then
    raise exception 'PRUEBA E05 · 2: la frase no dice lo que ha hecho: %.', v_t;
  end if;
  raise notice '2 OK: el pago queda validado, serie 3 n.º %, %; «%».', e.number, l, v_t;
  select string_agg(a.code || ' ' || jl.debit || '/' || jl.credit, ', ' order by a.code) into l
    from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
    join public.journal_entry je on je.id = jl.entry_id where je.id = pg_temp.p('ingreso')::uuid and je.status = 'validado';
  if l is distinct from '57000000 0.00/300.00, 57200505 300.00/0.00' then raise exception 'PRUEBA E05 · 3: el ingreso no es un ingreso validado: %.', l; end if;
  raise notice '3 OK: el ingreso queda validado, %.', l;
end $$;

-- 4 · Lo que mira el motor (paso 1, «un pago o cobro ya apuntado»): salen los dos. Llega el pago
--     en el extracto y se casa con su asiento por bank_casar (lo que hace nucleo.confirmar con el
--     destino «asiento»): no crea otro asiento y el de a mano deja de salir.
do $$
declare n int; m uuid; st uuid; r jsonb; antes int;
begin
  select count(*) into n from public.bank_asientos_sin_movimiento(pg_temp.p('e')::uuid, date '2026-10-01', date '2026-10-31') s
   where s.treasury_account_id = pg_temp.p('banco')::uuid and s.origen = 'otro'
     and ((s.entry_id = pg_temp.p('pago')::uuid and s.importe = -12.5 and s.fecha = date '2026-10-21')
       or (s.entry_id = pg_temp.p('ingreso')::uuid and s.importe = 300 and s.fecha = date '2026-10-22'));
  if n <> 2 then raise exception 'PRUEBA E05 · 4: el motor no los ve como asientos sin movimiento (% de 2).', n; end if;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to,
                                     movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('banco')::uuid, 'fichero', 'n43', date '2026-10-21', date '2026-10-21',
          1, 1, 0, 'sin_saldo', 'Prueba E05') returning id into st;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept,
                                    fingerprint, soft_fingerprint, status, reason)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('banco')::uuid, st, date '2026-10-21', date '2026-10-21', -12.5,
          'COMISION MANTENIMIENTO', 'e05-prueba-a-mano', 'e05-prueba-a-mano', 'propuesto', 'Prueba E05: el pago ya apuntado.')
  returning id into m;
  select count(*) into antes from public.journal_entry where company_id = pg_temp.p('e')::uuid;
  insert into _p values ('mov', m), ('asientos', antes);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.bank_casar(pg_temp.p('mov')::uuid, jsonb_build_object('tipo', 'asiento', 'entry_id', pg_temp.p('pago')), 'seguro',
                         'Es el pago que ya está apuntado.', '[]'::jsonb, 'folvy', null);
  insert into _p values ('casar', r::text);
end $$;
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare r jsonb := pg_temp.p('casar')::jsonb;
begin
  if (r->>'asiento')::uuid <> pg_temp.p('pago')::uuid or (r->>'creado')::boolean then
    raise exception 'PRUEBA E05 · 4: casarlo no ha usado el asiento de a mano: %.', r;
  end if;
  if (select count(*) from public.journal_entry where company_id = pg_temp.p('e')::uuid) <> pg_temp.p('asientos')::int then
    raise exception 'PRUEBA E05 · 4: casarlo ha escrito otro asiento.';
  end if;
  if not exists (select 1 from public.bank_match b where b.movement_id = pg_temp.p('mov')::uuid and b.journal_entry_id = pg_temp.p('pago')::uuid and b.status = 'vivo')
     or (select status from public.bank_movement where id = pg_temp.p('mov')::uuid) <> 'casado' then
    raise exception 'PRUEBA E05 · 4: el movimiento no ha quedado casado con su asiento.';
  end if;
  if exists (select 1 from public.bank_asientos_sin_movimiento(pg_temp.p('e')::uuid, date '2026-10-01', date '2026-10-31') s where s.entry_id = pg_temp.p('pago')::uuid)
     or not exists (select 1 from public.bank_asientos_sin_movimiento(pg_temp.p('e')::uuid, date '2026-10-01', date '2026-10-31') s where s.entry_id = pg_temp.p('ingreso')::uuid) then
    raise exception 'PRUEBA E05 · 4: casado, el pago sigue saliendo (o el ingreso ya no sale).';
  end if;
  raise notice '4 OK: los dos salen como asiento sin movimiento de su banco (origen «otro», su importe con signo); al llegar el pago, bank_casar lo casa con el de a mano (creado: no), los asientos siguen siendo %, y deja de salir.', pg_temp.p('asientos');
end $$;

-- 5 · Lo que no deja ------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_msg text; v_cod text; n int := 0;
  casos constant jsonb := jsonb_build_array(
    jsonb_build_array('banco', '62600000', 0, '22023', 'Pon el ingreso o el pago.'),
    jsonb_build_array('banco', '62999999', -5, '22023', 'La cuenta 62999999 no está en el plan de la empresa.'),
    jsonb_build_array('banco', '57200505', -5, '22023', 'La cuenta no puede ser la del propio banco (57200505).'),
    jsonb_build_array('sin', '62600000', -5, '22023', 'Este banco no tiene su cuenta (572) en el plan: dásela en Cuentas y extractos.'));
  c jsonb;
begin
  for c in select * from jsonb_array_elements(casos) loop
    begin
      perform public.conta_banco_a_mano(pg_temp.p(c->>0)::uuid, date '2026-10-21', c->>1, 'No debe quedar', (c->>2)::numeric, null);
      raise exception 'PRUEBA E05 · 5: ha dejado %.', c;
    exception when others then
      get stacked diagnostics v_msg = message_text, v_cod = returned_sqlstate;
      if v_cod <> c->>3 or v_msg <> c->>4 then raise exception 'PRUEBA E05 · 5: % dice «%» (%).', c, v_msg, v_cod; end if;
      n := n + 1;
    end;
  end loop;
  if exists (select 1 from public.journal_entry where company_id = pg_temp.p('e')::uuid and concept = 'No debe quedar') then
    raise exception 'PRUEBA E05 · 5: ha quedado un asiento de los que no deja.';
  end if;
  raise notice '5 OK: % de 4 no los deja, cada uno con su frase, y no queda nada.', n;
end $$;
-- Un banco de otra cuenta: el usuario de A no escribe en el banco de D.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_cod text;
begin
  perform public.conta_banco_a_mano(pg_temp.p('banco')::uuid, date '2026-10-21', '62600000', 'No debe quedar', -5, null);
  raise exception 'PRUEBA E05 · 5: el usuario de A ha escrito en el banco de D.';
exception when insufficient_privilege then
  raise notice '5 OK: el usuario de A no escribe en el banco de D (42501).';
end $$;
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 6 · La vuelta atrás -------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261118T2248_e05_banco_a_mano.down.sql
do $$ begin
  if to_regprocedure('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)') is not null then
    raise exception 'PRUEBA E05 · 6: la vuelta atrás dejó la función.';
  end if;
  raise notice '6 OK: la vuelta atrás quita la función.';
  raise notice 'PRUEBA E05: 6 de 6 bien.';
end $$;

rollback;
