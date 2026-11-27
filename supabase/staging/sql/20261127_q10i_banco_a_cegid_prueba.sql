-- supabase/staging/sql/20261127_q10i_banco_a_cegid_prueba.sql
--
-- SOLO STAGING. La 0730 del Q10 · respuesta 7 (lo cobrado por el banco y con tarjeta, a Cegid), en las cuentas A y B de
-- pruebas, con ROLLBACK:
--   1. Las dos, dos veces (la 0731 no hace nada sin la empresa de QBO); las columnas de conta_cegid_incidencia, la tabla conta_banco_decision y conta_banco_decidir existen.
--   2. La persona de A decide un cobro del banco suyo: «paga una factura», lo cambia a «facturar» (queda uno, con la
--      decisión de antes), y lo que no vale, no (sin concepto, sin cliente, un movimiento que no es un cobro, una clave
--      que no es de un cobro). Ya mandado a Cegid, no se vuelve a decidir. Desde la pantalla no se escribe la tabla.
--   3. La persona de B no decide en la empresa de A ni ve lo de A.
--   4. La vuelta atrás: con decisiones, deja la tabla; con incidencias del banco, las columnas; sin nada, lo quita todo.
--      Y otra vez la 0730.
-- Datos inventados (T11). Nada sale a Cegid.
-- cambia: conta_cegid_incidencia · conta_banco_decision · conta_banco_decidir · la 0731

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 BANCO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261127T0730_q10i_banco_a_cegid.sql
\i supabase/migrations/20261127T0730_q10i_banco_a_cegid.sql
\i supabase/migrations/20261127T0731_q10i_decisiones_julio.sql
\i supabase/migrations/20261127T0731_q10i_decisiones_julio.sql
do $$ begin
  if exists (select 1 from public.conta_banco_decision) then raise exception 'Q10 BANCO · 1: la 0731 ha decidido algo en una base sin QBO.'; end if;
end $$;
do $$ begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('movement_id', 'origen_clave', 'parte')) <> 3
     or to_regclass('public.conta_banco_decision') is null or to_regprocedure('public.conta_banco_decidir(uuid, text, text, text, int, text, text)') is null then
    raise exception 'Q10 BANCO · 1: falta algo de la 0730.';
  end if;
  raise notice 'Q10 BANCO · 1: la 0730 carga, dos veces. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid; v_t uuid; v_s uuid; v_m uuid;
begin
  select t.company_id, t.id into v_e, v_t from public.treasury_account t where t.account_id = v_acc order by t.created_at limit 1;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to, movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (v_acc, v_e, v_t, 'fichero', 'n43', date '2026-11-01', date '2026-11-30', 1, 1, 0, 'sin_saldo', 'prueba Q10') returning id into v_s;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint)
  values (v_acc, v_e, v_t, v_s, date '2026-11-12', date '2026-11-12', 242.00, 'TRANSFER INMEDIATA, CLIENTE DE PRUEBA', 'prueba-q10i', 'prueba-q10i') returning id into v_m;
  insert into public.conta_banco_cobro (movement_id, account_id, company_id, fecha, importe, via, estado, porque, recargo, cobro, mes, decidido_ninguno, motor, calculado_en)
  values (v_m, v_acc, v_e, date '2026-11-12', 242.00, 'transferencia', 'sin_cliente', 'prueba', 0, 0, date '2026-11-01', false, 'prueba', now());
  insert into _c values ('empresa', v_e::text), ('clave', 'mov:' || v_m::text), ('mov', v_m::text);
end $$;

-- 2 · La persona de A decide.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa'); v_k text := (select v from _c where clave = 'clave'); r jsonb;
begin
  r := public.conta_banco_decidir(v_e, v_k, 'paga_factura', null, null, null);
  if r->>'frase' <> 'Apuntado: paga una factura que ya existe. No se manda a Cegid.' then raise exception 'Q10 BANCO · 2: la frase es «%».', r->>'frase'; end if;
  r := public.conta_banco_decidir(v_e, v_k, 'paga_factura', null, null, null, '1/2745');
  if r->>'frase' <> 'Apuntado: paga la factura 1/2745, que ya existe. No se manda a Cegid.' or (select factura from public.conta_banco_decision where company_id = v_e) <> '1/2745' then
    raise exception 'Q10 BANCO · 2: con su factura, la frase es «%».', r->>'frase';
  end if;
  begin perform public.conta_banco_decidir(v_e, v_k, 'facturar', '0039', 900001, null, '1/2745'); raise exception 'Q10 BANCO · 2: se factura con una factura que ya existe.';
  exception when invalid_parameter_value then null; end;
  r := public.conta_banco_decidir(v_e, v_k, 'facturar', '0039', 900001, 'Trámite de prueba');
  if r->>'frase' <> 'Apuntado: se factura al cliente 900001 de Cegid con el concepto 0039.' then raise exception 'Q10 BANCO · 2: la frase es «%».', r->>'frase'; end if;
  if (select count(*) from public.conta_banco_decision where company_id = v_e) <> 1
      or (select decision || '/' || concepto || '/' || cliente || '/' || (antes->>'decision') || '/' || coalesce(factura, '-') from public.conta_banco_decision where company_id = v_e) <> 'facturar/0039/900001/paga_factura/-' then
    raise exception 'Q10 BANCO · 2: cambiar la decisión no deja una sola, la última, con la de antes.';
  end if;
  begin perform public.conta_banco_decidir(v_e, v_k, 'facturar', null, 900001, null); raise exception 'Q10 BANCO · 2: se factura sin concepto.';
  exception when invalid_parameter_value then null; end;
  begin perform public.conta_banco_decidir(v_e, v_k, 'facturar', '0039', null, null); raise exception 'Q10 BANCO · 2: se factura sin cliente.';
  exception when invalid_parameter_value then null; end;
  begin perform public.conta_banco_decidir(v_e, 'mov:00000000-0000-4000-8000-000000000000', 'no_es_cobro', null, null, null); raise exception 'Q10 BANCO · 2: se decide un movimiento que no es un cobro.';
  exception when no_data_found then null; end;
  begin perform public.conta_banco_decidir(v_e, 'otra:cosa', 'no_es_cobro', null, null, null); raise exception 'Q10 BANCO · 2: se decide con una clave que no es de un cobro.';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.conta_banco_decision (company_id, account_id, clave, decision) values (v_e, 'c01a0000-0000-4000-8000-00000000000a', v_k, 'no_es_cobro');
    raise exception 'Q10 BANCO · 2: desde la pantalla se ha escrito una decisión.';
  exception when insufficient_privilege then null; end;
  raise notice 'Q10 BANCO · 2: A decide y cambia; lo que no vale, no. OK';
end $$;
reset role;

-- 2 · Ya mandado a Cegid, no se vuelve a decidir.
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa');
begin
  insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, incidencia, concepto, serie, texto, base, total, estado, movement_id, origen_clave, parte)
  values (v_e, 'c01a0000-0000-4000-8000-00000000000a', (select v from _c where clave = 'clave'), '2026-11', 900001, 1, '0039', '1', 'Trámite de prueba', 200, 242, 'mandada',
          (select v::uuid from _c where clave = 'mov'), (select v from _c where clave = 'clave'), 'decision');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_banco_decidir((select v::uuid from _c where clave = 'empresa'), (select v from _c where clave = 'clave'), 'no_es_cobro', null, null, null);
    raise exception 'Q10 BANCO · 2: se ha vuelto a decidir un cobro ya mandado.';
  exception when object_not_in_prerequisite_state then null; end;
  raise notice 'Q10 BANCO · 2: ya mandado, no se vuelve a decidir. OK';
end $$;
reset role;

-- 3 · La persona de B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_banco_decidir((select v::uuid from _c where clave = 'empresa'), (select v from _c where clave = 'clave'), 'no_es_cobro', null, null, null);
    raise exception 'Q10 BANCO · 3: la cuenta B ha decidido en la empresa de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.conta_banco_decision) then raise exception 'Q10 BANCO · 3: la cuenta B ve lo decidido de A.'; end if;
  raise notice 'Q10 BANCO · 3: B ni decide ni ve lo de A. OK';
end $$;
reset role;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261127T0731_q10i_decisiones_julio.down.sql
do $$ begin
  if not exists (select 1 from public.conta_banco_decision) then raise exception 'Q10 BANCO · 4: la vuelta atrás de la 0731 ha quitado una decisión que no es suya.'; end if;
end $$;
\i supabase/vuelta-atras/20261127T0730_q10i_banco_a_cegid.down.sql
do $$ begin
  if to_regclass('public.conta_banco_decision') is null then raise exception 'Q10 BANCO · 4: con decisiones, la vuelta atrás ha quitado la tabla.'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('movement_id', 'origen_clave', 'parte')) <> 3 then
    raise exception 'Q10 BANCO · 4: con incidencias del banco, la vuelta atrás ha quitado las columnas.';
  end if;
end $$;
delete from public.conta_banco_decision;
delete from public.conta_cegid_incidencia where origen_clave is not null;
\i supabase/vuelta-atras/20261127T0730_q10i_banco_a_cegid.down.sql
do $$ begin
  if to_regclass('public.conta_banco_decision') is not null or to_regprocedure('public.conta_banco_decidir(uuid, text, text, text, int, text, text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('movement_id', 'origen_clave', 'parte')) then
    raise exception 'Q10 BANCO · 4: sin nada apuntado, la vuelta atrás no lo quita todo.';
  end if;
  raise notice 'Q10 BANCO · 4: la vuelta atrás respeta lo apuntado y lo deja todo como estaba. OK';
end $$;
\i supabase/migrations/20261127T0730_q10i_banco_a_cegid.sql
\echo 'Q10 BANCO · 4: y otra vez la 0730. OK'

rollback;
