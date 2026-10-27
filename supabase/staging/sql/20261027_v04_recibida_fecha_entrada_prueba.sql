-- supabase/staging/sql/20261027_v04_recibida_fecha_entrada_prueba.sql
--
-- SOLO STAGING. Prueba de 20261027T1350_v04_recibida_fecha_entrada, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. Cambia en caliente, y
-- aquí se prueba por su nombre: public._journal_entry_proponer. Datos
-- inventados, en la empresa A (Taberna de Prueba Norte, S.L.).
--
-- Regla 10: por los CAMINOS (proponer y validar, y su libro).
--   0. Lo de antes: si el ensayo ya pasó la 1350, su vuelta atrás; y la huella
--      de _journal_entry_proponer, la de producción (la de la 1233).
--   1. Una recibida del 24/09 que entró el 01/10, propuesta con la fecha de su
--      factura: se asienta el 01/10, con «Esta factura entró el 01/10: se
--      contabiliza el 01/10.», conserva su fecha de factura, y al validarla su
--      libro la registra el 01/10 (asiento e IVA, en el 4T).
--   2. Propuesta ya en el día de entrada o después: no cambia, sin aviso.
--   3. Con el mes de entrada cerrado: el primer día abierto, y lo dice.
--   4. Con el periodo de la factura presentado: el candado (1233) y esta regla
--      a la vez; los dos avisos juntos y una sola fecha.
--   5. Lo que no es una recibida (un asiento a mano) no cambia.
--   6. La vuelta atrás: _journal_entry_proponer con la huella de la 1233.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V04 fecha de entrada: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261027T1350_v04_recibida_fecha_entrada') as entrada_aplicada \gset
\if :entrada_aplicada
\i supabase/vuelta-atras/20261027T1350_v04_recibida_fecha_entrada.down.sql
\endif
do $$ begin
  if md5(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) <> '7d7680b983cd2d5fd846fd2890ed139d' then
    raise exception 'PRUEBA V04 fecha de entrada · 0: _journal_entry_proponer no es la de producción (la de la 1233).';
  end if;
  if to_regprocedure('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)') is not null then
    raise exception 'PRUEBA V04 fecha de entrada · 0: la base no está como antes de la 1350.';
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 0: antes de la 1350, con _journal_entry_proponer como en producción.';
end $$;
\i supabase/migrations/20261027T1350_v04_recibida_fecha_entrada.sql

-- Preparar: un proveedor con su 4100 y cuatro recibidas, cada una con su día de entrada.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_sup uuid; v_ca uuid; r jsonb; v_f uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Suministros inventados V04b', 'Suministros Inventados B SA', 'A00001350', true, 'Prueba V04b') returning id into v_sup;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '41001350', '4100', 'Acreedores · Suministros inventados V04b', 'own', 'manual', 'Prueba V04b'
    from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41001350';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');
  foreach r in array array[
      jsonb_build_object('n', 'V04B-ENTRO-TARDE', 'f', '2026-09-24', 'c', '2026-10-01 09:30+02'),
      jsonb_build_object('n', 'V04B-AL-DIA', 'f', '2026-10-02', 'c', '2026-10-02 09:30+02'),
      jsonb_build_object('n', 'V04B-MES-CERRADO', 'f', '2026-07-20', 'c', '2026-08-10 09:30+02'),
      jsonb_build_object('n', 'V04B-PRESENTADO', 'f', '2026-05-20', 'c', '2026-07-03 09:30+02')] loop
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, created_at)
    values (v_acc, v_e, v_sup, r->>'n', (r->>'f')::date, 121, 'aprobada', 'manual', 'Prueba V04b', (r->>'c')::timestamptz) returning id into v_f;
    perform set_config('prueba.' || lower(replace(replace(r->>'n', 'V04B-', ''), '-', '_')), v_f::text, true);
  end loop;
end $$;

create or replace function pg_temp.recibida(p_n text, p_fecha date) returns jsonb language plpgsql as $$
begin
  return public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Suministros inventados V04b · ' || p_n, 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.' || lower(replace(replace(p_n, 'V04B-', ''), '-', '_')))::uuid, 'confianza', 'seguro', 'porque', 'Prueba V04b',
                       'documento', p_n, 'fecha_documento', p_fecha),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 100, 'haber', 0, 'comun', true, 'documento', p_n),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', p_n,
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41001350', 'debe', 0, 'haber', 121, 'comun', true, 'documento', p_n)),
    null, 'Prueba V04b');
end $$;

-- ── 1, 2 y 5 · Con los meses abiertos ──────────────────────────────────────
do $$
declare r jsonb; v_e public.journal_entry; v public.vat_book_entry;
  c constant text := 'Esta factura entró el 01/10: se contabiliza el 01/10.';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  -- 1 · Entró después de su fecha: se asienta el día que entró.
  r := pg_temp.recibida('V04B-ENTRO-TARDE', '2026-09-24');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.entry_date <> date '2026-10-01' or v_e.document_date <> date '2026-09-24' or r->>'aviso' is distinct from c
     or not v_e.reasons @> jsonb_build_array(jsonb_build_object('decision', c)) then
    raise exception 'PRUEBA V04 fecha de entrada · 1: asiento %, factura %, %', v_e.entry_date, v_e.document_date, r;
  end if;
  perform public.journal_entry_validar(v_e.id, 'Prueba V04b');
  select * into v from public.vat_book_entry where entry_id = v_e.id;
  if v.issue_date <> date '2026-09-24' or v.received_date <> date '2026-10-01' then
    raise exception 'PRUEBA V04 fecha de entrada · 1: el libro no la registra el 01/10 con su fecha de factura: expedida %, recibida %', v.issue_date, v.received_date;
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 1: factura del 24/09 que entró el 01/10 → asiento el 01/10, «%», libro el 01/10 (expedida 24/09): asiento e IVA en el 4T.', r->>'aviso';
  -- 2 · Al día: no cambia ni avisa.
  r := pg_temp.recibida('V04B-AL-DIA', '2026-10-02');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.entry_date <> date '2026-10-02' or r ? 'aviso' or v_e.reasons::text like '%entró el%' then
    raise exception 'PRUEBA V04 fecha de entrada · 2: la del día cambia o avisa: asiento %, %', v_e.entry_date, r;
  end if;
  -- 5 · Un asiento a mano no cambia.
  r := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('series', 4, 'fecha', '2026-09-24', 'concepto', 'Pago inventado V04b', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba V04b'),
    jsonb_build_array(jsonb_build_object('cuenta', '41001350', 'debe', 121, 'haber', 0, 'comun', true),
                      jsonb_build_object('cuenta', '57200001', 'debe', 0, 'haber', 121, 'comun', true)),
    null, 'Prueba V04b');
  if (select entry_date from public.journal_entry where id = (r->>'id')::uuid) <> date '2026-09-24' or r ? 'aviso' then
    raise exception 'PRUEBA V04 fecha de entrada · 5: un asiento a mano cambia: %', r;
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 2 y 5: la del día y un asiento a mano, como antes.';
end $$;

-- ── 3 · El mes de entrada cerrado: el primer día abierto ───────────────────
insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, locked_by_name)
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', y.id, date '2026-08-01', 'Prueba V04b'
  from public.fiscal_year y where y.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and date '2026-08-01' between y.starts_on and y.ends_on;
do $$
declare r jsonb; v_e public.journal_entry;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := pg_temp.recibida('V04B-MES-CERRADO', '2026-07-20');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.entry_date <> date '2026-09-01' or v_e.document_date <> date '2026-07-20'
     or r->>'aviso' is distinct from 'Esta factura entró el 10/08: se contabiliza el 01/09, el primer día abierto.' then
    raise exception 'PRUEBA V04 fecha de entrada · 3: asiento %, %', v_e.entry_date, r;
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 3: entró el 10/08 con agosto cerrado → «%»', r->>'aviso';
end $$;

-- ── 4 · Con el periodo de la factura presentado: los dos a la vez ──────────
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, sequence, kind, due_date, status,
                               result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', '303', 2026, 'quarterly', '2T', 1, 'normal', '2026-07-20', 'filed',
        'zero', 0, timestamptz '2026-07-20 10:06:28+02', 'outside', 'PRUEBAV04BENTRA', 'Prueba V04b');
do $$
declare r jsonb; v_e public.journal_entry;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := pg_temp.recibida('V04B-PRESENTADO', '2026-05-20');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  -- El candado la lleva al 03/07 (no antes del día en que entró, en UTC); esta regla, ya en el día de entrada, no la mueve más.
  if v_e.entry_date <> date '2026-07-03' or r->>'aviso' not like 'El 2T ya está presentado. Esta factura se deduce en el 3T.%' then
    raise exception 'PRUEBA V04 fecha de entrada · 4: asiento %, %', v_e.entry_date, r;
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 4: factura del 20/05 con el 2T presentado, entró el 03/07 → asiento el 03/07, «%»', r->>'aviso';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── 5b · Como usuario: A propone la suya con la regla; B no propone en A ────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  -- La del 24/09 ya está propuesta (y validada) arriba: la misma factura no se duplica.
  r := pg_temp.recibida('V04B-ENTRO-TARDE', '2026-09-24');
  if not coalesce((r->>'existente')::boolean, false) then raise exception 'PRUEBA V04 fecha de entrada · 5b: como A, se duplica: %', r; end if;
  if has_function_privilege('authenticated', 'public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', 'execute') then
    raise exception 'PRUEBA V04 fecha de entrada · 5b: la función de la fecha se puede llamar desde fuera.';
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 5b: como A, no se duplica; la función de la fecha no se llama desde fuera.';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform pg_temp.recibida('V04B-AL-DIA', '2026-10-02');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 fecha de entrada · 5b: B propone en A.'; end if;
  raise notice 'PRUEBA V04 fecha de entrada · 5b: B no propone en A.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 6 · La vuelta atrás ────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T1350_v04_recibida_fecha_entrada.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) <> '7d7680b983cd2d5fd846fd2890ed139d'
     or to_regprocedure('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)') is not null then
    raise exception 'PRUEBA V04 fecha de entrada · 6: la vuelta atrás no deja _journal_entry_proponer como en producción.';
  end if;
  raise notice 'PRUEBA V04 fecha de entrada · 6: la vuelta atrás, como en producción.';
end $$;

rollback;
