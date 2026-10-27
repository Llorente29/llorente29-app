-- supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql
--
-- SOLO STAGING. Prueba de 20261027T1233_v04_iva_presentado_candado (el candado
-- del IVA), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Cambian en caliente, y aquí se prueban por su nombre: public._journal_entry_proponer,
-- y los disparadores nuevos de public.journal_entry, public.journal_line y
-- public.vat_book_entry. Datos inventados, en la empresa A (Taberna de Prueba
-- Norte, S.L.), con su 303 del 2T de 2026 apuntado como presentado el 20/07
-- dentro de la transacción.
--
-- Regla 10: por los CAMINOS (proponer, validar, anular, el libro).
--   0. Lo de antes: si el ensayo ya pasó la 1233, su vuelta atrás; y la huella
--      de _journal_entry_proponer, que es la de producción.
--   1. Antes de presentar el 2T: una recibida del 15/05 validada (en el libro
--      del 2T), una sin validar del 10/06, y una del 3T validada.
--   2. Con el 2T presentado, cada operación PARA con el mensaje de oficina
--      («El IVA del 2T de 2026 ya está presentado (20/07). No se puede
--      cambiar. …»): validar la del 10/06; anular la del 15/05; mover a junio
--      una del 3T sin validar; añadir o cambiar un apunte de IVA de la del
--      10/06; crear, cambiar o borrar una anotación del libro del 2T, y poner
--      «deducida en 2T» a la del 3T.
--   3. Lo que no es su IVA sí se completa (el número de la anotación), un
--      asiento sin IVA del 2T se valida, y la del 10/06 se puede sacar al 3T o
--      borrar (nunca llegó al libro).
--   4. La recibida que llega tarde (factura del 20/06, entrada el 05/07): se
--      propone sola en el 05/07 con el aviso «El 2T ya está presentado. Esta
--      factura se deduce en el 3T.», conserva su fecha de factura, y al
--      validarla el libro la registra el 05/07 (su IVA, al 3T).
--   5. Una expedida del 2T no se mueve: para.
--   6. Mensual: con julio, agosto y septiembre presentados (Importaciones de
--      Prueba Levante), «El IVA de agosto de 2026 ya está presentado».
--   7. Para las pantallas: conta_iva_presentados como A (el 2T, y a dónde va lo
--      tardío) y como B (no puede).
--   8. La vuelta atrás: _journal_entry_proponer con la huella de antes, sin
--      disparadores ni funciones nuevas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V04 candado: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261027T1233_v04_iva_presentado_candado') as candado_aplicado \gset
\if :candado_aplicado
\i supabase/vuelta-atras/20261027T1233_v04_iva_presentado_candado.down.sql
\endif
do $$ begin
  if md5(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) <> '7078efe93262f038dc888e1ca1c1cdd7' then
    raise exception 'PRUEBA V04 candado · 0: _journal_entry_proponer no es la de producción.';
  end if;
  if to_regprocedure('public.conta_iva_presentado(uuid,date)') is not null
     or exists (select 1 from pg_trigger where tgname in ('trg_journal_entry_0_iva_presentado', 'trg_journal_line_0_iva_presentado', 'trg_vat_book_entry_0_iva_presentado')) then
    raise exception 'PRUEBA V04 candado · 0: la base no está como antes de la 1233.';
  end if;
  raise notice 'PRUEBA V04 candado · 0: antes de la 1233, con _journal_entry_proponer como en producción.';
end $$;
\i supabase/migrations/20261027T1233_v04_iva_presentado_candado.sql

-- ── 1 · Antes de presentar el 2T ───────────────────────────────────────────
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_t constant text := '28f9a398-2c95-4a3c-aebe-66d8cf37154f';
  v_sup uuid; v_ca uuid; r jsonb; v_f uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  if exists (select 1 from public.tax_return where company_id = v_e and form_code = '303' and fiscal_year = 2026) then
    raise exception 'PRUEBA V04 candado · 1: la empresa A ya tiene un 303 de 2026; la prueba necesita los suyos.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Suministros inventados V04', 'Suministros Inventados SA', 'A00001233', true, 'Prueba V04') returning id into v_sup;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '41001233', '4100', 'Acreedores · Suministros inventados V04', 'own', 'manual', 'Prueba V04'
    from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41001233';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');

  -- Las facturas: cada una entra el día de su fecha, salvo la tardía.
  foreach r in array array[
      jsonb_build_object('n', 'V04-MAYO', 'f', '2026-05-15', 'c', '2026-05-15 10:00+02'),
      jsonb_build_object('n', 'V04-JUNIO', 'f', '2026-06-10', 'c', '2026-06-10 10:00+02'),
      jsonb_build_object('n', 'V04-JULIO', 'f', '2026-07-08', 'c', '2026-07-08 10:00+02'),
      jsonb_build_object('n', 'V04-AGOSTO', 'f', '2026-08-03', 'c', '2026-08-03 10:00+02'),
      jsonb_build_object('n', 'V04-TARDE', 'f', '2026-06-20', 'c', '2026-07-05 10:00+02')] loop
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, created_at)
    values (v_acc, v_e, v_sup, r->>'n', (r->>'f')::date, 121, 'aprobada', 'manual', 'Prueba V04', (r->>'c')::timestamptz) returning id into v_f;
    perform set_config('prueba.' || lower(replace(r->>'n', 'V04-', '')), v_f::text, true);
  end loop;
end $$;

-- La propuesta de una recibida de 100 + 21 de IVA (como la del núcleo).
create or replace function pg_temp.recibida(p_n text, p_fecha date) returns jsonb language plpgsql as $$
begin
  return public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Suministros inventados V04 · ' || p_n, 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.' || lower(replace(p_n, 'V04-', '')))::uuid, 'confianza', 'seguro', 'porque', 'Prueba V04',
                       'documento', p_n, 'fecha_documento', p_fecha),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 100, 'haber', 0, 'comun', true, 'documento', p_n),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', p_n,
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41001233', 'debe', 0, 'haber', 121, 'comun', true, 'documento', p_n)),
    null, 'Prueba V04');
end $$;

-- ¿Para con el mensaje del candado? Devuelve el mensaje (o falla la prueba).
create or replace function pg_temp.para(p_que text, p_sql text, p_espera text) returns text language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like p_espera then
      raise notice 'PRUEBA V04 candado · 2: % → «%»', p_que, v_msg;
      return v_msg;
    end if;
    raise exception 'PRUEBA V04 candado · 2: % para, pero con otro mensaje: «%»', p_que, v_msg;
  end;
  raise exception 'PRUEBA V04 candado · 2: % NO para.', p_que;
end $$;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := pg_temp.recibida('V04-MAYO', '2026-05-15');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba V04');
  perform set_config('prueba.e_mayo', r->>'id', true);
  r := pg_temp.recibida('V04-JUNIO', '2026-06-10');
  perform set_config('prueba.e_junio', r->>'id', true);
  r := pg_temp.recibida('V04-JULIO', '2026-07-08');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba V04');
  perform set_config('prueba.e_julio', r->>'id', true);
  r := pg_temp.recibida('V04-AGOSTO', '2026-08-03');
  perform set_config('prueba.e_agosto', r->>'id', true);
  if (select count(*) from public.vat_book_entry where entry_id in (current_setting('prueba.e_mayo')::uuid, current_setting('prueba.e_julio')::uuid)) <> 2 then
    raise exception 'PRUEBA V04 candado · 1: las dos validadas no están en el libro.';
  end if;
  raise notice 'PRUEBA V04 candado · 1: la del 15/05 y la del 08/07 validadas y en el libro; la del 10/06 y la del 03/08, propuestas.';
end $$;

-- El 303 del 2T, presentado el 20/07 (como lo apunta Presentados).
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, sequence, kind, due_date, status,
                               result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', '303', 2026, 'quarterly', '2T', 1, 'normal', '2026-07-20', 'filed',
        'zero', 0, timestamptz '2026-07-20 10:06:28+02', 'outside', 'PRUEBAV04CANDADO', 'Prueba V04');

-- ── 2 · Con el 2T presentado, cada operación PARA ──────────────────────────
do $$
declare
  c constant text := 'El IVA del 2T de 2026 ya está presentado (20/07). No se puede cambiar.%';
  v_mayo uuid := current_setting('prueba.e_mayo')::uuid; v_junio uuid := current_setting('prueba.e_junio')::uuid;
  v_julio uuid := current_setting('prueba.e_julio')::uuid; v_agosto uuid := current_setting('prueba.e_agosto')::uuid;
  v_msg text; v_vb uuid; v_vb3 uuid; v_472 uuid; v_linea uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  select id into v_vb from public.vat_book_entry where entry_id = v_mayo;
  select id into v_vb3 from public.vat_book_entry where entry_id = v_julio;
  select id into v_472 from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '47200021';
  select id into v_linea from public.journal_line where entry_id = v_junio and vat_book is not null;

  v_msg := pg_temp.para('validar la del 10/06', format('select public.journal_entry_validar(%L, %L)', v_junio, 'Prueba V04'),
                        c || ' Esta factura va al 3T.');
  perform pg_temp.para('anular la del 15/05', format('select public.journal_entry_anular(%L, %L, %L, %L)', v_mayo, 'Prueba V04', date '2026-10-27', 'Prueba V04'),
                       c || ' Lo que haya que corregir va al 3T.');
  perform pg_temp.para('mover a junio la del 03/08 sin validar', format('update public.journal_entry set entry_date = %L where id = %L', date '2026-06-30', v_agosto), c);
  perform pg_temp.para('cambiar el concepto de la del 10/06', format('update public.journal_entry set concept = %L where id = %L', 'Otro concepto', v_junio), c);
  perform pg_temp.para('añadir un apunte de IVA a la del 10/06',
    format('insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values (%L, %L, %L, 9, %L, 1, 0)',
           'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', v_junio, v_472), c);
  perform pg_temp.para('cambiar el apunte de IVA de la del 10/06', format('update public.journal_line set debit = 22 where id = %L', v_linea), c);
  perform pg_temp.para('cambiar la cuota de una anotación del 2T', format('update public.vat_book_entry set tax_amount = 22 where id = %L', v_vb), c);
  perform pg_temp.para('quitar del 2T una anotación (registrada en julio)', format('update public.vat_book_entry set received_date = %L where id = %L', date '2026-07-01', v_vb), c);
  perform pg_temp.para('borrar una anotación del 2T', format('delete from public.vat_book_entry where id = %L', v_vb), c);
  perform pg_temp.para('crear una anotación del 2T',
    format($q$insert into public.vat_book_entry (account_id, company_id, book, invoice_type, issue_date, received_date, tax_base, tax_rate, tax_amount, total, deductible_amount, reverse_charge, investment_good, source_type)
              values (%L, %L, 'received', 'F1', %L, %L, 100, 21, 21, 121, 21, false, false, 'manual')$q$,
           'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-06-01', date '2026-06-01'), c);
  perform pg_temp.para('«deducida en 2T» a una del 3T',
    format('update public.vat_book_entry set deduction_year = 2026, deduction_period = %L, deduction_reason = %L where id = %L', '2T', 'Prueba V04', v_vb3), c);
  raise notice 'PRUEBA V04 candado · 2: el mensaje, entero: «%»', v_msg;
end $$;

-- ── 3 · Lo que sí se puede ─────────────────────────────────────────────────
do $$
declare v_vb uuid; r jsonb; v_junio uuid := current_setting('prueba.e_junio')::uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  select id into v_vb from public.vat_book_entry where entry_id = current_setting('prueba.e_mayo')::uuid;
  update public.vat_book_entry set number = 'V04-MAYO (número completado)', updated_at = now() where id = v_vb;
  -- Un asiento sin IVA del 2T (un pago por banco) se propone y se valida.
  r := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('series', 4, 'fecha', '2026-06-12', 'concepto', 'Pago inventado V04', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba V04'),
    jsonb_build_array(jsonb_build_object('cuenta', '41001233', 'debe', 121, 'haber', 0, 'comun', true),
                      jsonb_build_object('cuenta', '57200001', 'debe', 0, 'haber', 121, 'comun', true)),
    null, 'Prueba V04');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba V04');
  -- La del 10/06 sin validar: sacarla al 3T sí se puede, y borrarla también.
  update public.journal_entry set entry_date = date '2026-07-01' where id = v_junio;
  delete from public.journal_entry where id = v_junio;
  raise notice 'PRUEBA V04 candado · 3: el número se completa, un asiento sin IVA del 2T se valida, y una sin validar del 2T se saca al 3T o se borra.';
end $$;

-- ── 4 · La recibida que llega tarde va al periodo abierto ──────────────────
do $$
declare r jsonb; v_e public.journal_entry; v public.vat_book_entry;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := pg_temp.recibida('V04-TARDE', '2026-06-20');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.entry_date <> date '2026-07-05' or v_e.document_date <> date '2026-06-20'
     or r->>'aviso' is distinct from 'El 2T ya está presentado. Esta factura se deduce en el 3T.'
     or not v_e.reasons @> jsonb_build_array('El 2T ya está presentado. Esta factura se deduce en el 3T.') then
    raise exception 'PRUEBA V04 candado · 4: la tardía no va al 3T con su aviso: asiento %, factura %, %', v_e.entry_date, v_e.document_date, r;
  end if;
  perform public.journal_entry_validar(v_e.id, 'Prueba V04');
  select * into v from public.vat_book_entry where entry_id = v_e.id;
  if v.issue_date <> date '2026-06-20' or v.received_date <> date '2026-07-05' then
    raise exception 'PRUEBA V04 candado · 4: el libro no la registra el 05/07 con su fecha de factura: expedida %, recibida %', v.issue_date, v.received_date;
  end if;
  raise notice 'PRUEBA V04 candado · 4: factura del 20/06 que entra el 05/07: asiento el 05/07, «%», y su libro en el 3T (expedida 20/06, registrada 05/07).', r->>'aviso';
end $$;

-- ── 5 · Una expedida del 2T no se mueve ────────────────────────────────────
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform pg_temp.para('proponer una expedida del 20/06',
    $q$select public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
         jsonb_build_object('series', 1, 'fecha', '2026-06-20', 'concepto', 'Factura inventada V04', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba V04'),
         jsonb_build_array(jsonb_build_object('cuenta', '43000000', 'debe', 121, 'haber', 0, 'comun', true),
                           jsonb_build_object('cuenta', '70000000', 'debe', 0, 'haber', 100, 'comun', true),
                           jsonb_build_object('cuenta', '47700021', 'debe', 0, 'haber', 21, 'comun', true,
                                              'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 100, 'libro', 'issued', 'facturas', 1))),
         null, 'Prueba V04')$q$,
    'El IVA del 2T de 2026 ya está presentado (20/07). No se puede cambiar. Lo que haya que corregir va al 3T.');
end $$;

-- ── 6 · Mensual ────────────────────────────────────────────────────────────
do $$
declare v_p jsonb := public.conta_iva_presentado('d5ac0000-0000-4000-8000-00000000c05e', date '2026-08-15'); v_m text;
begin
  if v_p is null or v_p->>'periodo' <> '08' then raise exception 'PRUEBA V04 candado · 6: agosto de Levante no sale presentado: %', v_p; end if;
  v_m := public.conta_iva_presentado_mensaje('d5ac0000-0000-4000-8000-00000000c05e', v_p);
  if v_m not like 'El IVA de agosto de 2026 ya está presentado (__/__). No se puede cambiar.%' then
    raise exception 'PRUEBA V04 candado · 6: el mensaje mensual: «%»', v_m;
  end if;
  if public.conta_iva_periodo_frase('en', '10', 2026, false) <> 'en octubre' or public.conta_iva_periodo_frase('a', '4T', 2026, false) <> 'al 4T'
     or public.conta_iva_periodo_frase('el', '09', 2026, false) <> 'Septiembre' then
    raise exception 'PRUEBA V04 candado · 6: las frases de los periodos.';
  end if;
  raise notice 'PRUEBA V04 candado · 6: mensual: «%»', v_m;
end $$;

-- ── 7 · Para las pantallas ─────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v jsonb := public.conta_iva_presentados('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026);
begin
  if jsonb_array_length(v) <> 1 or v->0->>'periodo' <> '2T' or v->0->>'siguiente' <> '3T' or (v->0->>'hasta')::date <> date '2026-06-30' then
    raise exception 'PRUEBA V04 candado · 7: A no ve su 2T presentado: %', v;
  end if;
  raise notice 'PRUEBA V04 candado · 7: A ve %', v;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform public.conta_iva_presentados('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 candado · 7: B ve los periodos de A.'; end if;
  begin perform public.conta_iva_presentado('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-05-01'); v_ok := false;
  exception when insufficient_privilege then null; end;
  if not v_ok then raise exception 'PRUEBA V04 candado · 7: conta_iva_presentado se puede llamar desde fuera.'; end if;
  raise notice 'PRUEBA V04 candado · 7: B no ve los de A, y el candado no se llama desde fuera.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 8 · La vuelta atrás ────────────────────────────────────────────────────
-- Antes, lo que la prueba dejó en el 2T presentado se quita (la vuelta atrás
-- no toca datos): el 303 vuelve a no estar.
delete from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and aeat_csv = 'PRUEBAV04CANDADO';
\i supabase/vuelta-atras/20261027T1233_v04_iva_presentado_candado.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) <> '7078efe93262f038dc888e1ca1c1cdd7' then
    raise exception 'PRUEBA V04 candado · 8: la vuelta atrás no deja _journal_entry_proponer como en producción.';
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_journal_entry_0_iva_presentado', 'trg_journal_line_0_iva_presentado', 'trg_vat_book_entry_0_iva_presentado'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like any (array['conta_iva_%', '_conta_iva_%', 'conta_primer_dia_iva_abierto'])) then
    raise exception 'PRUEBA V04 candado · 8: la vuelta atrás deja disparadores o funciones.';
  end if;
  raise notice 'PRUEBA V04 candado · 8: la vuelta atrás, como en producción.';
end $$;

rollback;
