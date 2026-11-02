-- ============================================================================
-- PRUEBA (staging) · B01 · Cola 2 (1300 y 1310): Olimpo. Todo en una
-- transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999, T11), en la
-- cuenta D. Necesita la 2030 (si la base no la tiene, la carga aquí dentro).
--
--   0. La 1300 (el arreglo de Olimpo) en una base sin Foodint: no hace nada.
--      El núcleo de casar parte de la huella de producción (246d303a).
--   1. ANTES = DESPUÉS: el mismo casado normal (un pago con su factura aprobada)
--      con el núcleo de antes (el movimiento 5) y con la 1310 (el 1), el mismo camino:
--      lo que devuelve, la factura pagada, el casado y el asiento, iguales.
--   2. Casar con una factura anulada, o descartada, PARA con su porqué.
--   3. Anular una factura casada (asiento propuesto): el casado se deshace, el
--      asiento propuesto se quita y el movimiento vuelve a «Por aclarar» con su
--      motivo. Con el asiento validado: se anula con su contraasiento.
--   4. Descartar una factura casada hace lo mismo.
--   5. Nadie de fuera llama a la función del disparador.
--   6. La vuelta atrás deja el núcleo de producción byte a byte y quita el
--      disparador; y la 1310 otra vez.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01 cola 2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

select to_regprocedure('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)') is not null as ya_esta_la_2030 \gset
\if :ya_esta_la_2030
\else
\i supabase/migrations/20261101T2030_b01n_nucleos_casar.sql
\endif
select to_regprocedure('public._tg_factura_anulada_descasa()') is not null as ya_esta_la_1310 \gset
\if :ya_esta_la_1310
\i supabase/vuelta-atras/20261102T1310_b01o_casar_sin_anuladas.down.sql
\endif

-- 0 · La 1300 sin Foodint, y el núcleo de partida.
\i supabase/migrations/20261102T1300_b01o_olimpo_recasar.sql
do $$ begin
  if md5(pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) <> '246d303a4d2540f8d997b3e5f4a8a26a' then
    raise exception 'PRUEBA B01 cola 2 · 0: el núcleo de casar no es el de producción (246d303a).';
  end if;
end $$;

create temp table _o (clave text primary key, v text) on commit drop;
grant all on _o to authenticated, service_role;
insert into _o values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'), ('admin', 'c01d0000-0000-4000-8000-0000000000d1');

do $$
declare a uuid := (select v::uuid from _o where clave = 'cuenta'); e uuid := (select v::uuid from _o where clave = 'empresa');
        s uuid; b uuid; c572 uuid; r jsonb;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select a, e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = e and date '2026-10-26' between starts_on and ends_on);
  insert into public.supplier (account_id, name, legal_name, iban) values (a, 'Proveedor Cola 2 Prueba', 'Proveedor Cola 2 Prueba S.L.', 'ES0599990000000000001310') returning id into s;
  update public.supplier set iban_verified_at = now() where id = s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (a, e, 'pymes', '40009932', '4000', 'Proveedores · Cola 2', 'own', 'manual');
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '40009932';
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, s, 'C2-1', '2026-10-01', 100.00, 'en_revision'), (a, e, s, 'C2-2', '2026-10-02', 50.00, 'en_revision'),
    (a, e, s, 'C2-3', '2026-10-03', 30.00, 'en_revision'), (a, e, s, 'C2-4', '2026-10-04', 20.00, 'en_revision'),
    (a, e, s, 'C2-5', '2026-10-05', 10.00, 'en_revision');
  insert into _o select 'f' || substr(invoice_number, 4), id from public.supplier_invoice where account_id = a and invoice_number like 'C2-_';
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba cola 2 · BBVA', 'ES2299990000000000001311', '572', true) returning id into b;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (a, e, 'pymes', '57209932', '572', 'Bancos · Prueba cola 2', 'own', 'manual') returning id into c572;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a, e, c572, 'bank_account', b::text, 'principal', 'manual');
  insert into _o values ('banco', b);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _o where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _o where clave in ('f1', 'f2', 'f3', 'f4', 'f5'));
select public.bank_importar((select v::uuid from _o where clave = 'banco'), 'fichero', 'csv:bbva', 'prueba-cola2.xlsx', repeat('2', 64), date '2026-10-26', date '2026-10-26', null, null, 'prueba', null,
  jsonb_build_array(
    jsonb_build_object('fecha', '2026-10-26', 'importe', -100.00, 'concepto_banco', 'FACT: C2-1 UNO', 'concepto_limpio', 'Fact c2-1', 'huella', 'c2-1', 'huella_suave', 'c2-s1'),
    jsonb_build_object('fecha', '2026-10-26', 'importe', -50.00, 'concepto_banco', 'FACT: C2-2 DOS', 'concepto_limpio', 'Fact c2-2', 'huella', 'c2-2', 'huella_suave', 'c2-s2'),
    jsonb_build_object('fecha', '2026-10-26', 'importe', -30.00, 'concepto_banco', 'FACT: C2-3 TRES', 'concepto_limpio', 'Fact c2-3', 'huella', 'c2-3', 'huella_suave', 'c2-s3'),
    jsonb_build_object('fecha', '2026-10-26', 'importe', -20.00, 'concepto_banco', 'FACT: C2-4 CUATRO', 'concepto_limpio', 'Fact c2-4', 'huella', 'c2-4', 'huella_suave', 'c2-s4'),
    jsonb_build_object('fecha', '2026-10-26', 'importe', -10.00, 'concepto_banco', 'FACT: C2-5 CINCO', 'concepto_limpio', 'Fact c2-5', 'huella', 'c2-5', 'huella_suave', 'c2-s5')));
reset role;
insert into _o select 'm' || substr(bank_concept, 10, 1), id from public.bank_movement
 where treasury_account_id = (select v::uuid from _o where clave = 'banco') and bank_concept like 'FACT: C2-%';

-- Casar el movimiento N con la factura N, como la pantalla.
create function pg_temp.casar(n int) returns jsonb language plpgsql as $$
begin
  return public.bank_casar((select v::uuid from _o where clave = 'm' || n),
    jsonb_build_object('tipo', 'factura_recibida', 'cuenta_tercero', '40009932', 'concepto', 'Pago C2-' || n, 'metodo', 'transfer',
      'facturas', jsonb_build_array(jsonb_build_object('id', (select v::uuid from _o where clave = 'f' || n), 'importe', (select grand_total from public.supplier_invoice where id = (select v::uuid from _o where clave = 'f' || n))))),
    'seguro', 'Es el pago de C2-' || n || '.', '[]'::jsonb, 'persona', null);
end $$;
-- Lo que queda escrito de un casado, con los ids tapados.
create function pg_temp.foto(n int) returns jsonb language plpgsql as $$
declare f public.supplier_invoice; b public.bank_match; j public.journal_entry; mv public.bank_movement;
begin
  select * into f from public.supplier_invoice where id = (select v::uuid from _o where clave = 'f' || n);
  select * into mv from public.bank_movement where id = (select v::uuid from _o where clave = 'm' || n);
  select * into b from public.bank_match where movement_id = mv.id and status = 'vivo';
  select * into j from public.journal_entry where id = b.journal_entry_id;
  return jsonb_build_object('factura', jsonb_build_object('estado', f.status, 'pagada', f.paid_at, 'metodo', f.paid_method, 'quien', f.paid_by_name, 'con_asiento_pago', f.payment_entry_id is not null),
    'movimiento', mv.status, 'casado', jsonb_build_object('tipo', b.kind, 'por', b.by_who, 'confianza', b.confidence, 'porque', b.reason, 'creado', b.entry_created, 'importe', b.amount),
    'asiento', jsonb_build_object('estado', j.status, 'concepto', j.concept, 'fecha', j.entry_date,
      'lineas', (select jsonb_agg(jsonb_build_object('cuenta', ca.code, 'debe', l.debit, 'haber', l.credit, 'tercero', l.party_id is not null) order by l.position)
                   from public.journal_line l join public.company_account ca on ca.id = l.company_account_id where l.entry_id = j.id)));
end $$;
grant execute on function pg_temp.casar(int), pg_temp.foto(int) to authenticated;

-- 1 · ANTES = DESPUÉS: el mismo camino (un pago con su factura aprobada, por su importe exacto)
-- con el núcleo de antes (el 5) y con la 1310 (el 1).
create temp table _cmp (lado text primary key, r jsonb, foto jsonb) on commit drop;
grant all on _cmp to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _o where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _cmp select 'antes', pg_temp.casar(5) - 'match' - 'asiento' - 'entry' - 'movimiento', pg_temp.foto(5);
reset role;
\i supabase/migrations/20261102T1310_b01o_casar_sin_anuladas.sql
select set_config('request.jwt.claims', json_build_object('sub', (select v from _o where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _cmp select 'despues', pg_temp.casar(1) - 'match' - 'asiento' - 'entry' - 'movimiento', pg_temp.foto(1);
reset role;
do $$
declare a jsonb := (select r from _cmp where lado = 'antes'); fa jsonb := (select foto from _cmp where lado = 'antes');
        d jsonb := (select r from _cmp where lado = 'despues'); fd jsonb := (select foto from _cmp where lado = 'despues');
        tapa text := '(C2-)\d';
begin
  -- El 1 (con la 1310) y el 5 (con el de antes): mismo camino; se tapan el número y el importe.
  a := regexp_replace(a::text, tapa, '\1N', 'g')::jsonb; d := regexp_replace(d::text, tapa, '\1N', 'g')::jsonb;
  fa := regexp_replace(regexp_replace(fa::text, tapa, '\1N', 'g'), '"(debe|haber|importe)": -?[0-9.]+', '"\1": "X"', 'g')::jsonb;
  fd := regexp_replace(regexp_replace(fd::text, tapa, '\1N', 'g'), '"(debe|haber|importe)": -?[0-9.]+', '"\1": "X"', 'g')::jsonb;
  if a is distinct from d then raise exception 'PRUEBA B01 cola 2 · 1: lo que devuelve casar ha cambiado: antes % y ahora %.', a, d; end if;
  if fa is distinct from fd then raise exception 'PRUEBA B01 cola 2 · 1: lo que deja escrito casar ha cambiado: antes % y ahora %.', fa, fd; end if;
  if fd->'factura'->>'estado' <> 'pagada' then raise exception 'PRUEBA B01 cola 2 · 1: la factura no ha quedado pagada (%).', fd; end if;
  raise notice 'PRUEBA B01 cola 2 · 1: casar un pago con su factura, igual con el núcleo de antes y con la 1310.';
end $$;

-- 2 · Con una factura anulada o descartada, para.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _o where clave = 'admin'), 'role', 'authenticated')::text, true);
update public.supplier_invoice set status = 'anulada' where id = (select v::uuid from _o where clave = 'f4');
set local role authenticated;
do $$ begin
  begin
    perform pg_temp.casar(4);
    raise exception 'PRUEBA B01 cola 2 · 2: se ha casado un pago con una factura anulada.';
  exception when check_violation then
    if sqlerrm not like 'La factura C2-4 está anulada%' then raise exception 'PRUEBA B01 cola 2 · 2: para, pero no lo dice (%).', sqlerrm; end if;
  end;
end $$;
reset role;
update public.supplier_invoice set status = 'aprobada' where id = (select v::uuid from _o where clave = 'f4');
update public.supplier_invoice set discarded_at = now() where id = (select v::uuid from _o where clave = 'f4');
set local role authenticated;
do $$ begin
  begin
    perform pg_temp.casar(4);
    raise exception 'PRUEBA B01 cola 2 · 2: se ha casado un pago con una factura descartada.';
  exception when check_violation then
    if sqlerrm not like 'La factura C2-4 está descartada%' then raise exception 'PRUEBA B01 cola 2 · 2: para, pero no lo dice (%).', sqlerrm; end if;
  end;
end $$;
reset role;

-- 3 · Anular una factura casada.
set local role authenticated;
select pg_temp.casar(2);
select pg_temp.casar(3);
select public.journal_entry_validar((select journal_entry_id from public.bank_match where movement_id = (select v::uuid from _o where clave = 'm3') and status = 'vivo'), 'Prueba cola 2');
insert into _o select 'a3', journal_entry_id from public.bank_match where movement_id = (select v::uuid from _o where clave = 'm3') and status = 'vivo';
insert into _o select 'a2', journal_entry_id from public.bank_match where movement_id = (select v::uuid from _o where clave = 'm2') and status = 'vivo';
-- Una factura pagada se anula quitándole el pago (supplier_invoice_pagada_con_fecha), como en la pantalla.
update public.supplier_invoice set status = 'anulada', paid_at = null, paid_method = null where id in ((select v::uuid from _o where clave = 'f2'), (select v::uuid from _o where clave = 'f3'));
reset role;
do $$
declare mv public.bank_movement;
begin
  for mv in select * from public.bank_movement where id in ((select v::uuid from _o where clave = 'm2'), (select v::uuid from _o where clave = 'm3')) loop
    if exists (select 1 from public.bank_match where movement_id = mv.id and status = 'vivo') then
      raise exception 'PRUEBA B01 cola 2 · 3: el pago sigue casado con una factura anulada.';
    end if;
    if mv.status <> 'por_aclarar' or mv.reason not like 'Su factura C2-_ se anuló el %: este pago vuelve a estar por casar.%' then
      raise exception 'PRUEBA B01 cola 2 · 3: el movimiento no vuelve a «Por aclarar» con su motivo (%, %).', mv.status, mv.reason;
    end if;
  end loop;
  if exists (select 1 from public.journal_entry where id = (select v::uuid from _o where clave = 'a2')) then
    raise exception 'PRUEBA B01 cola 2 · 3: el asiento propuesto del pago sigue ahí.';
  end if;
  if (select status from public.journal_entry where id = (select v::uuid from _o where clave = 'a3')) <> 'anulado'
     or (select voided_by_entry_id from public.journal_entry where id = (select v::uuid from _o where clave = 'a3')) is null then
    raise exception 'PRUEBA B01 cola 2 · 3: el asiento validado no se ha anulado con su contraasiento.';
  end if;
  if exists (select 1 from public.supplier_invoice where id in ((select v::uuid from _o where clave = 'f2'), (select v::uuid from _o where clave = 'f3')) and payment_entry_id is not null) then
    raise exception 'PRUEBA B01 cola 2 · 3: la factura anulada sigue con su asiento de pago.';
  end if;
  raise notice 'PRUEBA B01 cola 2 · 3: anular una factura casada la descasa (propuesto: fuera; validado: contraasiento) y el pago vuelve a «Por aclarar».';
end $$;

-- 4 · Descartar hace lo mismo.
update public.supplier_invoice set discarded_at = null where id = (select v::uuid from _o where clave = 'f4');
set local role authenticated;
select pg_temp.casar(4);
update public.supplier_invoice set discarded_at = now(), status = 'aprobada', paid_at = null, paid_method = null where id = (select v::uuid from _o where clave = 'f4');
reset role;
do $$ begin
  if exists (select 1 from public.bank_match where movement_id = (select v::uuid from _o where clave = 'm4') and status = 'vivo')
     or (select reason from public.bank_movement where id = (select v::uuid from _o where clave = 'm4')) not like 'Su factura C2-4 se descartó el %' then
    raise exception 'PRUEBA B01 cola 2 · 4: descartar una factura casada no la descasa.';
  end if;
end $$;

-- 5 · Nadie de fuera llama a la función del disparador.
do $$ begin
  if has_function_privilege('authenticated', 'public._tg_factura_anulada_descasa()', 'execute') or has_function_privilege('anon', 'public._tg_factura_anulada_descasa()', 'execute')
     or has_function_privilege('authenticated', 'public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', 'execute') then
    raise exception 'PRUEBA B01 cola 2 · 5: alguien de fuera puede llamar al disparador o al núcleo.';
  end if;
end $$;

-- 6 · La vuelta atrás, y la 1310 otra vez.
\i supabase/vuelta-atras/20261102T1310_b01o_casar_sin_anuladas.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) <> '246d303a4d2540f8d997b3e5f4a8a26a' then
    raise exception 'PRUEBA B01 cola 2 · 6: la vuelta atrás no deja el núcleo de producción.';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'tg_factura_anulada_descasa') or to_regprocedure('public._tg_factura_anulada_descasa()') is not null then
    raise exception 'PRUEBA B01 cola 2 · 6: la vuelta atrás no quita el disparador.';
  end if;
end $$;
\i supabase/migrations/20261102T1310_b01o_casar_sin_anuladas.sql

select 'PRUEBA B01 cola 2 · Olimpo: todo en verde' as resultado;
rollback;
