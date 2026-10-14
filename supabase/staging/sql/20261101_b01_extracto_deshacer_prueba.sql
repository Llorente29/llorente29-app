-- ============================================================================
-- PRUEBA (staging) · B01 · deshacer un extracto entero (20261101T0180).
-- Todo en una transacción con ROLLBACK: no deja nada. Fichero entero y como
-- USUARIO (el administrador de A con su rol «authenticated»); lo que hay que
-- poner a propósito (un casado, un ticket) lo pone el dueño. Datos inventados,
-- en el banco «B01 · Mercado» de la semilla B01.
--
--   1. Sin porqué, no.
--   2. Con un movimiento casado (casado vivo), PARA y dice cuántos.
--   3. Con un ticket subido, PARA.
--   4. Otra cuenta (el administrador de B) no puede.
--   5. Sin casados: quita el extracto, sus 3 movimientos (también el posible
--      repetido) y sus casados ya deshechos; lo dice en «Lo que ha hecho Folvy»;
--      los demás extractos del banco no se tocan; el mismo fichero se puede
--      volver a subir (su huella queda libre).
-- ============================================================================

begin;

create temp table _r (que text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- ── 0 · Siembra (como el dueño): un extracto de prueba con 3 movimientos ────
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
        merc constant uuid := 'b0100000-0000-4000-8000-0000000000b3'; s uuid; m1 uuid; m2 uuid; m3 uuid; b uuid;
begin
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, file_sha256, period_from, period_to,
     movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity)
  values (a, emp, merc, 'fichero', 'norma43', 'prueba-deshacer.n43', repeat('d', 64), date '2026-09-01', date '2026-09-03', 3, 2, 0, 1, null, 'prueba', 'sin_saldo')
  returning id into s;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-01', date '2026-09-01', -10.00, 'PRUEBA DESHACER 1', 'prueba-deshacer-1', 'prueba-deshacer-s1', 'pendiente') returning id into m1;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-02', date '2026-09-02', -20.00, 'PRUEBA DESHACER 2', 'prueba-deshacer-2', 'prueba-deshacer-s2', 'posible_repetido') returning id into m2;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-03', date '2026-09-03', 30.00, 'PRUEBA DESHACER 3', 'prueba-deshacer-3', 'prueba-deshacer-s3', 'pendiente') returning id into m3;
  -- Un casado vivo en m1 (para el paso 2) y uno ya deshecho en m3 (historia que se va con él).
  insert into public.bank_match (account_id, company_id, movement_id, kind, entry_created, amount, confidence, reason, by_who)
  values (a, emp, m1, 'cuenta', false, -10.00, 'seguro', 'prueba', 'persona') returning id into b;
  insert into public.bank_match (account_id, company_id, movement_id, kind, entry_created, amount, confidence, reason, by_who, status, undone_at, undo_reason)
  values (a, emp, m3, 'cuenta', false, 30.00, 'seguro', 'prueba', 'persona', 'deshecho', now(), 'prueba');
  insert into _r values ('extracto', s), ('m1', m1), ('m3', m3), ('casado', b);
  insert into _r select 'otros', null;
  raise notice '0 · extracto de prueba con 3 movimientos (1 posible repetido), un casado vivo y uno deshecho';
end $$;

-- Cuántos extractos tiene Mercado aparte del de prueba (no se tienen que mover).
create temp table _antes on commit drop as
select count(*) n from public.bank_statement where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3' and id <> (select id from _r where que = 'extracto');
grant select on _antes to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 y 2 · Sin porqué, no; con un casado, PARA ─────────────────────────────
do $$
declare s uuid := (select id from _r where que = 'extracto'); v text;
begin
  begin perform public.bank_extracto_deshacer(s, '  '); exception when others then v := sqlerrm; end;
  if v is distinct from 'Para deshacer un extracto hay que decir por qué.' then raise exception 'PRUEBA B01 · 1: sin porqué dijo «%».', v; end if;
  v := null;
  begin perform public.bank_extracto_deshacer(s, 'prueba'); exception when others then v := sqlerrm; end;
  if v not like 'Este extracto tiene 1 movimiento(s) casado(s).%' then raise exception 'PRUEBA B01 · 2: con un casado dijo «%».', v; end if;
  if not exists (select 1 from public.bank_statement where id = s) then raise exception 'PRUEBA B01 · 2: con un casado, el extracto se fue.'; end if;
  raise notice '1 · sin porqué, no · 2 · con un casado vivo, PARA: «%»', v;
end $$;

-- El dueño deshace el casado y pone un ticket en m3.
reset role;
update public.bank_match set status = 'deshecho', undone_at = now(), undo_reason = 'prueba' where id = (select id from _r where que = 'casado');
update public.bank_movement set receipt_path = 'prueba/ticket.jpg' where id = (select id from _r where que = 'm3');
set local role authenticated;

-- ── 3 · Con un ticket, PARA ─────────────────────────────────────────────────
do $$
declare v text;
begin
  begin perform public.bank_extracto_deshacer((select id from _r where que = 'extracto'), 'prueba'); exception when others then v := sqlerrm; end;
  if v not like 'Este extracto tiene 1 ticket(s) subido(s)%' then raise exception 'PRUEBA B01 · 3: con un ticket dijo «%».', v; end if;
  raise notice '3 · con un ticket, PARA';
end $$;

reset role;
update public.bank_movement set receipt_path = null where id = (select id from _r where que = 'm3');

-- ── 4 · Otra cuenta, no ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v text; c text;
begin
  begin perform public.bank_extracto_deshacer((select id from _r where que = 'extracto'), 'prueba'); exception when others then v := sqlerrm; c := sqlstate; end;
  if c is distinct from '42501' then raise exception 'PRUEBA B01 · 4: el administrador de B no recibió 42501 (% · %).', c, v; end if;
  raise notice '4 · otra cuenta: 42501';
end $$;
reset role;

-- ── 5 · Sin casados ni tickets: se deshace entero ───────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare s uuid := (select id from _r where que = 'extracto'); r jsonb; n int;
begin
  r := public.bank_extracto_deshacer(s, 'Es el de «extracto»; subo el de Firmas');
  if (r->>'movimientos')::int <> 3 or (r->>'posibles_repetidos')::int <> 1 or (r->>'casados_deshechos')::int <> 2 then
    raise exception 'PRUEBA B01 · 5: devolvió %.', r;
  end if;
  if exists (select 1 from public.bank_statement where id = s) then raise exception 'PRUEBA B01 · 5: el extracto sigue.'; end if;
  if exists (select 1 from public.bank_movement where statement_id = s) then raise exception 'PRUEBA B01 · 5: quedan movimientos.'; end if;
  if exists (select 1 from public.bank_match where id = (select id from _r where que = 'casado')) then raise exception 'PRUEBA B01 · 5: queda su casado deshecho.'; end if;
  select count(*) into n from public.bank_activity_log
   where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and action = 'deshecho' and statement_id is null
     and summary like 'Deshecho el extracto prueba-deshacer.n43 de % quitados 3 movimientos, 1 de ellos como «¿es el mismo?». Por qué: Es el de «extracto»; subo el de Firmas'
     and detail->>'extracto' = s::text;
  if n <> 1 then raise exception 'PRUEBA B01 · 5: «Lo que ha hecho Folvy» no lo dice (% apuntes).', n; end if;
  if (select count(*) from public.bank_statement where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3') <> (select n from _antes) then
    raise exception 'PRUEBA B01 · 5: se han movido otros extractos del banco.';
  end if;
  raise notice '5 · deshecho: %', r;
end $$;
reset role;

-- El mismo fichero (la misma huella) se puede volver a subir.
do $$
begin
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, file_sha256, period_from, period_to,
     movements_count, new_count, repeated_count, balanced, unchecked_reason, continuity)
  values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'b0100000-0000-4000-8000-0000000000b3', 'fichero', 'norma43',
          'prueba-deshacer.n43', repeat('d', 64), date '2026-09-01', date '2026-09-03', 0, 0, 0, null, 'prueba', 'sin_saldo');
  raise notice '5 · el mismo fichero vuelve a entrar';
end $$;

rollback;
