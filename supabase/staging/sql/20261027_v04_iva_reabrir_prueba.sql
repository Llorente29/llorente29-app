-- supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
--
-- SOLO STAGING. Prueba de 20261027T1408_v04_iva_reabrir («Reabrir para
-- corregir»), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Cambian en caliente, y aquí se prueban por su nombre: public.conta_iva_presentado,
-- public.conta_iva_presentados, y los disparadores nuevos de public.tax_return,
-- public.journal_entry, public.journal_line y public.vat_book_entry. Datos
-- inventados, en la empresa A, con su 303 del 2T de 2026 presentado el 20/07
-- dentro de la transacción.
--
-- Regla 10: por los CAMINOS (proponer, validar, anular, el libro, presentar).
--   0. Lo de antes: si el ensayo ya pasó la 1408, su vuelta atrás; y las dos
--      huellas, las de producción (la 1233).
--   1. Quién reabre: B no, el encargado de A no; el administrador de A, sin
--      motivo no; con motivo sí. La presentación original se queda como estaba
--      y nace la nueva (nº 2, complementaria, replaces → la original). Dos
--      veces no.
--   2. Reabierto: se propone, se valida y se anula en el 2T, y cada asiento
--      queda marcado (creado, validado, libro, anulado) con quién.
--   3. Las pantallas: conta_iva_presentados dice «reabierto»;
--      conta_iva_reaperturas, la original y la nueva juntas.
--   4. Apuntar la nueva presentación: con un CSV malo no; con el bueno, la nº 2
--      queda presentada, la reapertura se cierra sola y el 2T vuelve a estar
--      cerrado (con la fecha de la nueva en el mensaje).
--   5. A los 30 días sin presentar: el aviso, una vez cada 7 días.
--   6. La vuelta atrás: PARA con reaperturas; sin ellas, las dos funciones con
--      la huella de producción, y nada de la 1408.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V04 reabrir: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261027T1408_v04_iva_reabrir') as reabrir_aplicada \gset
\if :reabrir_aplicada
\i supabase/vuelta-atras/20261027T1408_v04_iva_reabrir.down.sql
\endif
do $$ begin
  if md5(pg_get_functiondef('public.conta_iva_presentado(uuid,date)'::regprocedure)) <> '5129d8c98a3d27705b1788b2793a56aa'
     or md5(pg_get_functiondef('public.conta_iva_presentados(uuid,int)'::regprocedure)) <> '1a16cde23b1c19c1c36161204c655a83' then
    raise exception 'PRUEBA V04 reabrir · 0: conta_iva_presentado o conta_iva_presentados no son las de producción (la 1233).';
  end if;
  if to_regclass('public.vat_reopening') is not null then raise exception 'PRUEBA V04 reabrir · 0: la base no está como antes de la 1408.'; end if;
  raise notice 'PRUEBA V04 reabrir · 0: antes de la 1408, con las dos funciones como en producción.';
end $$;
\i supabase/migrations/20261027T1408_v04_iva_reabrir.sql

-- Preparar: un proveedor y tres recibidas del 2T; la del 15/05, validada antes de presentar.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_sup uuid; v_ca uuid; r jsonb; v_f uuid;
begin
  if exists (select 1 from public.tax_return where company_id = v_e and form_code = '303' and fiscal_year = 2026 and period = '2T') then
    raise exception 'PRUEBA V04 reabrir · preparar: la empresa A ya tiene un 303 del 2T de 2026.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Suministros inventados V04r', 'Suministros Inventados R SA', 'A00001408', true, 'Prueba V04r') returning id into v_sup;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '41001408', '4100', 'Acreedores · Suministros inventados V04r', 'own', 'manual', 'Prueba V04r'
    from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41001408';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');
  foreach r in array array[
      jsonb_build_object('n', 'V04R-MAYO', 'f', '2026-05-15'),
      jsonb_build_object('n', 'V04R-JUNIO', 'f', '2026-06-15'),
      jsonb_build_object('n', 'V04R-OTRA', 'f', '2026-06-20')] loop
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, created_at)
    values (v_acc, v_e, v_sup, r->>'n', (r->>'f')::date, 121, 'aprobada', 'manual', 'Prueba V04r', ((r->>'f') || ' 10:00+02')::timestamptz) returning id into v_f;
    perform set_config('prueba.' || lower(replace(r->>'n', 'V04R-', '')), v_f::text, true);
  end loop;
end $$;

create or replace function pg_temp.recibida(p_n text, p_fecha date) returns jsonb language plpgsql as $$
begin
  return public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Suministros inventados V04r · ' || p_n, 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.' || lower(replace(p_n, 'V04R-', '')))::uuid, 'confianza', 'seguro', 'porque', 'Prueba V04r',
                       'documento', p_n, 'fecha_documento', p_fecha),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 100, 'haber', 0, 'comun', true, 'documento', p_n),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', p_n,
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41001408', 'debe', 0, 'haber', 121, 'comun', true, 'documento', p_n)),
    null, 'Prueba V04r');
end $$;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := pg_temp.recibida('V04R-MAYO', '2026-05-15');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba V04r');
  perform set_config('prueba.e_mayo', r->>'id', true);
end $$;
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, sequence, kind, due_date, status,
                               result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', '303', 2026, 'quarterly', '2T', 1, 'normal', '2026-07-20', 'filed',
        'to_pay', 21, timestamptz '2026-07-20 10:06:28+02', 'outside', 'PRUEBAV04REABRIR', 'Prueba V04r');
select set_config('prueba.original', (select id::text from public.tax_return where aeat_csv = 'PRUEBAV04REABRIR'), true);
do $$
declare v_msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform pg_temp.recibida('V04R-JUNIO', '2026-06-15');
  -- Con el 2T presentado, la del 15/06 va al 3T (el candado), no al 2T.
  if (select entry_date from public.journal_entry where document_ref = 'V04R-JUNIO' order by created_at desc limit 1) < date '2026-07-01' then
    raise exception 'PRUEBA V04 reabrir · preparar: con el 2T presentado, la del 15/06 entra en el 2T.';
  end if;
  delete from public.journal_entry where document_ref = 'V04R-JUNIO' and status in ('propuesto', 'borrador');
  raise notice 'PRUEBA V04 reabrir · preparar: el 2T presentado; la del 15/06 se va al 3T (el candado).';
end $$;

-- ── 1 · Quién reabre ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform public.conta_iva_reabrir(current_setting('prueba.original')::uuid, 'Una factura de mayo mal leída', 'complementary', 'B');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 1: B reabre el 2T de A.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a6', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform public.conta_iva_reabrir(current_setting('prueba.original')::uuid, 'Una factura de mayo mal leída', 'complementary', 'Encargado');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 1: el encargado de A reabre el 2T.'; end if;
  if public.conta_iva_puede_reabrir('3b34403a-a7d6-4a48-a8d7-737e8cababdc') then raise exception 'PRUEBA V04 reabrir · 1: al encargado se le ofrece reabrir.'; end if;
  raise notice 'PRUEBA V04 reabrir · 1: B y el encargado de A no reabren.';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_ok boolean := false; o public.tax_return; n public.tax_return;
begin
  begin perform public.conta_iva_reabrir(current_setting('prueba.original')::uuid, '  corto ', 'complementary', 'Admin Norte');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 1: se reabre sin motivo.'; end if;
  r := public.conta_iva_reabrir(current_setting('prueba.original')::uuid, 'Falta una factura de junio de Suministros', 'complementary', 'Admin Norte');
  if r->>'texto' <> 'Reabierto el 2T de 2026 para corregir. La presentación del 20/07 se queda como estaba: lo que cambies irá en la complementaria nº 2.' then
    raise exception 'PRUEBA V04 reabrir · 1: %', r;
  end if;
  perform set_config('prueba.reapertura', r->>'id', true);
  perform set_config('prueba.nueva', r->>'nueva', true);
  raise notice 'PRUEBA V04 reabrir · 1: «%»', r->>'texto';
  v_ok := false;
  begin perform public.conta_iva_reabrir(current_setting('prueba.original')::uuid, 'Otra vez el mismo trimestre', 'complementary', 'Admin Norte');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 1: se reabre dos veces.'; end if;
end $$;
reset role;
do $$
declare o public.tax_return; n public.tax_return;
begin
  select * into o from public.tax_return where id = current_setting('prueba.original')::uuid;
  select * into n from public.tax_return where id = current_setting('prueba.nueva')::uuid;
  if o.status <> 'filed' or o.aeat_csv <> 'PRUEBAV04REABRIR' or o.filed_at <> timestamptz '2026-07-20 10:06:28+02' or o.amount <> 21 then
    raise exception 'PRUEBA V04 reabrir · 1: la presentación original ha cambiado: %', to_jsonb(o);
  end if;
  if n.sequence <> 2 or n.kind <> 'complementary' or n.replaces_return_id <> o.id or n.status <> 'draft' or n.period <> '2T' then
    raise exception 'PRUEBA V04 reabrir · 1: la nueva no es la nº 2 complementaria que sustituye a la original: %', to_jsonb(n);
  end if;
  raise notice 'PRUEBA V04 reabrir · 1: la original, como estaba; la nueva, nº 2 complementaria en borrador.';
end $$;

-- ── 2 · Reabierto: proponer, validar y anular en el 2T, y quedan marcados ──
do $$
declare r jsonb; v_e public.journal_entry; v_anul jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  if public.conta_iva_presentado('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-05-01') is not null then
    raise exception 'PRUEBA V04 reabrir · 2: reabierto, el 2T sigue cerrado.';
  end if;
  r := pg_temp.recibida('V04R-OTRA', '2026-06-20');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.entry_date <> date '2026-06-20' then raise exception 'PRUEBA V04 reabrir · 2: reabierto, la del 20/06 no entra en el 2T: %', v_e.entry_date; end if;
  perform public.journal_entry_validar(v_e.id, 'Prueba V04r');
  perform public.journal_entry_anular(current_setting('prueba.e_mayo')::uuid, 'Prueba V04r: mal leída', date '2026-06-30', 'Prueba V04r');
  if not (select array_agg(action) from public.vat_reopening_entry where entry_id = v_e.id) @> array['creado', 'libro', 'validado']
     or not exists (select 1 from public.vat_reopening_entry where entry_id = current_setting('prueba.e_mayo')::uuid and action = 'anulado' and by_user = 'c01a0000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vat_reopening_entry where reopening_id <> current_setting('prueba.reapertura')::uuid) then
    raise exception 'PRUEBA V04 reabrir · 2: las marcas: %', (select jsonb_agg(to_jsonb(m)) from public.vat_reopening_entry m);
  end if;
  raise notice 'PRUEBA V04 reabrir · 2: reabierto, la del 20/06 se valida en el 2T y la del 15/05 se anula; marcadas (creado, validado, libro y anulado).';
end $$;

-- ── 3 · Las pantallas ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare p jsonb := public.conta_iva_presentados('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026);
        a jsonb := public.conta_iva_reaperturas('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026);
begin
  if jsonb_array_length(p) <> 1 or p->0->'reabierto' is null or (p->0->'reabierto'->>'secuencia')::int <> 2 or p->0->'reabierto'->>'motivo' <> 'Falta una factura de junio de Suministros' then
    raise exception 'PRUEBA V04 reabrir · 3: conta_iva_presentados: %', p;
  end if;
  if jsonb_array_length(a) <> 1 or (a->0->'original'->>'secuencia')::int <> 1 or (a->0->'nueva'->>'secuencia')::int <> 2
     or a->0->'nueva'->>'estado' <> 'draft' or (a->0->>'asientos')::int <> 3 then
    raise exception 'PRUEBA V04 reabrir · 3: conta_iva_reaperturas: %', a;
  end if;
  raise notice 'PRUEBA V04 reabrir · 3: las pantallas ven el 2T reabierto, con la nº 1 y la nº 2 juntas y 3 asientos marcados (la nueva, la anulada y su contraasiento).';
end $$;

-- ── 4 · Apuntar la nueva presentación ──────────────────────────────────────
do $$
declare r jsonb; v_ok boolean := false; v_msg text;
begin
  begin perform public.conta_iva_reapertura_presentada(current_setting('prueba.reapertura')::uuid, 'CORTO', now(), 'to_pay', 21, 'Admin Norte');
  exception when invalid_parameter_value then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 4: se apunta con un CSV malo.'; end if;
  r := public.conta_iva_reapertura_presentada(current_setting('prueba.reapertura')::uuid, 'PRUEBAV04NUEVA02', timestamptz '2026-10-27 12:00+01', 'to_pay', 21, 'Admin Norte');
  if r->>'texto' <> 'Apuntada la complementaria nº 2 del 2T de 2026 (CSV PRUEBAV04NUEVA02). El periodo vuelve a estar cerrado.' then
    raise exception 'PRUEBA V04 reabrir · 4: %', r;
  end if;
  raise notice 'PRUEBA V04 reabrir · 4: «%»', r->>'texto';
end $$;
reset role;
do $$
declare v_msg text;
begin
  if (select closed_at from public.vat_reopening where id = current_setting('prueba.reapertura')::uuid) is null then
    raise exception 'PRUEBA V04 reabrir · 4: la reapertura no se cierra al presentar la nueva.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  begin
    perform public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
      jsonb_build_object('series', 1, 'fecha', '2026-06-25', 'concepto', 'Factura inventada V04r', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba V04r'),
      jsonb_build_array(jsonb_build_object('cuenta', '43000000', 'debe', 121, 'haber', 0, 'comun', true),
                        jsonb_build_object('cuenta', '70000000', 'debe', 0, 'haber', 100, 'comun', true),
                        jsonb_build_object('cuenta', '47700021', 'debe', 0, 'haber', 21, 'comun', true,
                                           'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 100, 'libro', 'issued', 'facturas', 1))),
      null, 'Prueba V04r');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'El IVA del 2T de 2026 ya está presentado (27/10). No se puede cambiar.%' then
    raise exception 'PRUEBA V04 reabrir · 4: con la nº 2 presentada, el 2T no vuelve a estar cerrado (o no con su fecha): %', v_msg;
  end if;
  raise notice 'PRUEBA V04 reabrir · 4: cerrado otra vez, con la fecha de la nueva: «%»', v_msg;
end $$;

-- ── 5 · El aviso a los 30 días ─────────────────────────────────────────────
do $$
declare r jsonb; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := public.conta_iva_reabrir((select id from public.tax_return where aeat_csv = 'PRUEBAV04NUEVA02'), 'Segunda corrección del trimestre', 'substitutive', 'Admin Norte');
  if (r->>'secuencia')::int <> 3 or r->>'texto' not like '%sustitutiva nº 3.' then raise exception 'PRUEBA V04 reabrir · 5: %', r; end if;
  if public.conta_iva_reaperturas_recordar() <> 0 then raise exception 'PRUEBA V04 reabrir · 5: avisa antes de los 30 días.'; end if;
  update public.vat_reopening set opened_at = now() - interval '31 days' where id = (r->>'id')::uuid;
  n := public.conta_iva_reaperturas_recordar();
  if n <> 1 or (select reminded_at from public.vat_reopening where id = (r->>'id')::uuid) is null then raise exception 'PRUEBA V04 reabrir · 5: no avisa a los 31 días (%).', n; end if;
  if public.conta_iva_reaperturas_recordar() <> 0 then raise exception 'PRUEBA V04 reabrir · 5: avisa dos veces el mismo día.'; end if;
  if not exists (select 1 from cron.job where jobname = 'iva-reabierto-recordar') then raise exception 'PRUEBA V04 reabrir · 5: falta el cron.'; end if;
  raise notice 'PRUEBA V04 reabrir · 5: a los 31 días sin presentar, un aviso; el mismo día, no otro; cron iva-reabierto-recordar.';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── 6 · La vuelta atrás ────────────────────────────────────────────────────
do $$
declare v_ok boolean := false;
begin
  begin perform public._conta_iva_reabrir_se_puede_deshacer();
  exception when raise_exception then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA V04 reabrir · 6: la guarda de la vuelta atrás no para con reaperturas.'; end if;
  raise notice 'PRUEBA V04 reabrir · 6: con reaperturas, la vuelta atrás PARA.';
end $$;
-- Sin reaperturas (y sin sus nuevas presentaciones), la vuelta atrás en limpio.
delete from public.vat_reopening;
delete from public.tax_return_event where tax_return_id in (select id from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and fiscal_year = 2026 and period = '2T' and sequence > 1);
delete from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and fiscal_year = 2026 and period = '2T' and sequence = 3;
delete from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and fiscal_year = 2026 and period = '2T' and sequence = 2;
\i supabase/vuelta-atras/20261027T1408_v04_iva_reabrir.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_iva_presentado(uuid,date)'::regprocedure)) <> '5129d8c98a3d27705b1788b2793a56aa'
     or md5(pg_get_functiondef('public.conta_iva_presentados(uuid,int)'::regprocedure)) <> '1a16cde23b1c19c1c36161204c655a83' then
    raise exception 'PRUEBA V04 reabrir · 6: la vuelta atrás no deja las dos funciones como en producción.';
  end if;
  if to_regclass('public.vat_reopening') is not null or to_regprocedure('public.conta_iva_reabrir(uuid,text,text,text)') is not null
     or exists (select 1 from pg_trigger where tgname in ('trg_tax_return_reapertura_cerrar', 'trg_journal_entry_iva_reabierto', 'trg_journal_line_iva_reabierto', 'trg_vat_book_entry_iva_reabierto'))
     or exists (select 1 from cron.job where jobname = 'iva-reabierto-recordar') then
    raise exception 'PRUEBA V04 reabrir · 6: la vuelta atrás deja algo de la 1408.';
  end if;
  raise notice 'PRUEBA V04 reabrir · 6: la vuelta atrás, como en producción.';
end $$;

rollback;
