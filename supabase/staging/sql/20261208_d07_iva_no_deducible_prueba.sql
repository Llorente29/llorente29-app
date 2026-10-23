-- supabase/staging/sql/20261208_d07_iva_no_deducible_prueba.sql
--
-- SOLO STAGING. Prueba de 20261208T0850_d07_iva_no_deducible_y_periodo_cerrado,
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. Datos
-- inventados, en la empresa A. Cambian en caliente, y aquí se prueban por su
-- nombre: public.conta_impuesto_303_cajas y public.conta_vat_book_desde_asiento.
--
--   0. Lo de antes: las dos funciones son las de producción (md5 del cuerpo).
--   1. Como administrador de A: marcar el IVA de una recibida como no
--      deducible pide motivo; «Otro» pide su texto; con «ticket sin NIF» se
--      guarda, lo dice en palabras y queda en su historial. B no lo marca.
--   2. Su CAMINO (regla 10): el asiento con la cuota en su propia línea, en la
--      cuenta de gasto, con IVA no deducible, se propone y se valida; el libro
--      de recibidas la lleva con su cuota y deducible 0, y el 303 no la cuenta
--      (sin casillas). Una recibida normal sigue en la [28]/[29].
--   3. Una recibida de un periodo cerrado (factura del 06/08, entrada el
--      06/08), asentada el 15/09 (el primer día abierto): el libro conserva su
--      fecha de factura y la registra el 15/09 (su IVA va a ese periodo).
--   4. La vuelta atrás: las dos funciones como en producción, sin la de marcar
--      ni las dos columnas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D07 no deducible: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/vuelta-atras/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.down.sql

-- 0 · Lo de antes.
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_vat_book_desde_asiento(uuid)'::regprocedure) <> '2a2b8594c58d568dfc4bf37478306bfd' then
    raise exception 'PRUEBA D07 no deducible · 0: conta_vat_book_desde_asiento no es la de producción.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure) <> 'd15814822393969b4336775f74f96644' then
    raise exception 'PRUEBA D07 no deducible · 0: conta_impuesto_303_cajas no es la de producción.';
  end if;
end $$;
\i supabase/migrations/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.sql

-- Preparar (como postgres): un proveedor con NIF y su 4100, y tres recibidas.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_sup uuid; v_ca uuid; v_nd uuid; v_normal uuid; v_cerrado uuid;
begin
  if not exists (select 1 from public.company_account where company_id = v_e and code = '62400000') then
    raise exception 'PRUEBA D07 no deducible · 0: falta la 62400000 en el plan de A.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Telefonía inventada D07', 'Telefonía Inventada SA', 'A00000850', true, 'Prueba D07') returning id into v_sup;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '41000850', '4100', 'Acreedores · Telefonía inventada D07', 'own', 'manual', 'Prueba D07'
    from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41000850';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'D07-ND-1', '2026-09-15', 12.1, 'en_revision', 'manual', 'Prueba D07') returning id into v_nd;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'D07-NORMAL-1', '2026-09-15', 12.1, 'aprobada', 'manual', 'Prueba D07') returning id into v_normal;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, created_at)
  values (v_acc, v_e, v_sup, 'D07-CERRADO-1', '2026-08-06', 12.1, 'aprobada', 'manual', 'Prueba D07', timestamptz '2026-08-06 10:00+02') returning id into v_cerrado;
  perform set_config('prueba.nd', v_nd::text, true);
  perform set_config('prueba.normal', v_normal::text, true);
  perform set_config('prueba.cerrado', v_cerrado::text, true);
end $$;

-- 1 · Como administrador de A: marcarlo.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_ok boolean; v_f public.supplier_invoice;
begin
  v_ok := false;
  begin perform public.conta_recibida_iva_no_deducible(current_setting('prueba.nd')::uuid, true, null, null, 'Prueba D07');
  exception when others then if sqlerrm like 'Di por qué no se deduce%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'PRUEBA D07 no deducible · 1: se marca sin motivo.'; end if;
  v_ok := false;
  begin perform public.conta_recibida_iva_no_deducible(current_setting('prueba.nd')::uuid, true, 'otro', '  ', 'Prueba D07');
  exception when others then if sqlerrm like 'Con «Otro motivo», escribe cuál.%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'PRUEBA D07 no deducible · 1: «Otro» sin texto se guarda.'; end if;
  r := public.conta_recibida_iva_no_deducible(current_setting('prueba.nd')::uuid, true, 'ticket_sin_nif', null, 'Prueba D07');
  select * into v_f from public.supplier_invoice where id = current_setting('prueba.nd')::uuid;
  if not v_f.vat_non_deductible or v_f.vat_non_deductible_reason <> 'ticket_sin_nif' or v_f.vat_non_deductible_note is not null
     or r->>'texto' not like 'Guardado: su IVA no se deduce (es un ticket sin NIF). Va a su gasto, sale en el libro de recibidas como no deducible y no entra en el 303.%' then
    raise exception 'PRUEBA D07 no deducible · 1: %', r;
  end if;
  if not exists (select 1 from public.supplier_invoice_change c where c.supplier_invoice_id = v_f.id and c.cambios @> '[{"campo": "iva_no_deducible"}]') then
    raise exception 'PRUEBA D07 no deducible · 1: no queda en su historial.';
  end if;
  raise notice 'PRUEBA D07 no deducible · 1: %', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin perform public.conta_recibida_iva_no_deducible(current_setting('prueba.nd')::uuid, false, null, null, 'Prueba D07');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA D07 no deducible · 1: B marca las de A.'; end if;
  raise notice 'PRUEBA D07 no deducible · 1: B no marca las de A.';
end $$;
reset role;

-- 2 y 3 · Su camino: proponer y validar, el libro y el 303 (como postgres, con el usuario de A).
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_t constant text := '28f9a398-2c95-4a3c-aebe-66d8cf37154f';
  r jsonb; v_entry uuid; v public.vat_book_entry; x record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  update public.supplier_invoice set status = 'aprobada' where id = current_setting('prueba.nd')::uuid;
  -- 2 · La no deducible: la cuota en su propia línea de gasto, con IVA no deducible.
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-15', 'concepto', 'Factura Telefonía inventada D07 · D07-ND-1 (sin descontar el IVA)', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.nd')::uuid, 'confianza', 'seguro', 'porque', 'Prueba D07', 'documento', 'D07-ND-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 10, 'haber', 0, 'comun', true, 'documento', 'D07-ND-1'),
      jsonb_build_object('cuenta', '62400000', 'debe', 2.1, 'haber', 0, 'comun', true, 'documento', 'D07-ND-1', 'concepto', 'IVA no deducible 21 %',
                         'iva', jsonb_build_object('tipo_id', v_t, 'base', 10, 'libro', 'received', 'deducible', 'no', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000850', 'debe', 0, 'haber', 12.1, 'comun', true, 'documento', 'D07-ND-1')),
    null, 'Prueba D07');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba D07');
  select * into v from public.vat_book_entry b where b.entry_id = v_entry;
  if v.id is null or v.book <> 'received' or v.tax_amount <> 2.1 or v.tax_base <> 10 or coalesce(v.deductible_amount, -1) <> 0 then
    raise exception 'PRUEBA D07 no deducible · 2: el libro no la lleva como no deducible: %', to_jsonb(v);
  end if;
  select * into x from public.conta_impuesto_303_cajas(v);
  if x.cajas <> '{}'::text[] or x.no_sabe is not null then raise exception 'PRUEBA D07 no deducible · 2: el 303 la cuenta: % %', x.cajas, x.no_sabe; end if;
  raise notice 'PRUEBA D07 no deducible · 2: validada, en el libro con cuota 2,10 y deducible 0, y fuera del 303.';
  -- La normal, en la [28]/[29].
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-15', 'concepto', 'Factura Telefonía inventada D07 · D07-NORMAL-1', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.normal')::uuid, 'confianza', 'seguro', 'porque', 'Prueba D07', 'documento', 'D07-NORMAL-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 10, 'haber', 0, 'comun', true, 'documento', 'D07-NORMAL-1'),
      jsonb_build_object('cuenta', '47200021', 'debe', 2.1, 'haber', 0, 'comun', true, 'documento', 'D07-NORMAL-1',
                         'iva', jsonb_build_object('tipo_id', v_t, 'base', 10, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000850', 'debe', 0, 'haber', 12.1, 'comun', true, 'documento', 'D07-NORMAL-1')),
    null, 'Prueba D07');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba D07');
  select * into v from public.vat_book_entry b where b.entry_id = v_entry;
  select * into x from public.conta_impuesto_303_cajas(v);
  if x.cajas <> array['28', '29'] or v.deductible_amount <> 2.1 then raise exception 'PRUEBA D07 no deducible · 2: la normal ya no va a la [28]/[29]: % %', x.cajas, to_jsonb(v); end if;
  raise notice 'PRUEBA D07 no deducible · 2: la normal sigue en la [28]/[29].';
  -- 3 · La del periodo cerrado, asentada el primer día abierto.
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-15', 'concepto', 'Factura Telefonía inventada D07 · D07-CERRADO-1', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.cerrado')::uuid, 'confianza', 'seguro', 'porque', 'Prueba D07', 'documento', 'D07-CERRADO-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 10, 'haber', 0, 'comun', true, 'documento', 'D07-CERRADO-1'),
      jsonb_build_object('cuenta', '47200021', 'debe', 2.1, 'haber', 0, 'comun', true, 'documento', 'D07-CERRADO-1',
                         'iva', jsonb_build_object('tipo_id', v_t, 'base', 10, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000850', 'debe', 0, 'haber', 12.1, 'comun', true, 'documento', 'D07-CERRADO-1')),
    null, 'Prueba D07');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba D07');
  select * into v from public.vat_book_entry b where b.entry_id = v_entry;
  if v.issue_date <> date '2026-08-06' or v.received_date <> date '2026-09-15' then
    raise exception 'PRUEBA D07 no deducible · 3: el libro no conserva su fecha de factura o no la registra el día del asiento: expedida %, recibida %', v.issue_date, v.received_date;
  end if;
  raise notice 'PRUEBA D07 no deducible · 3: factura del 06/08 asentada el 15/09: expedida el 06/08, registrada el 15/09 (su IVA, a ese periodo).';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_vat_book_desde_asiento(uuid)'::regprocedure) <> '2a2b8594c58d568dfc4bf37478306bfd'
     or (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure) <> 'd15814822393969b4336775f74f96644' then
    raise exception 'PRUEBA D07 no deducible · 4: la vuelta atrás no deja las dos funciones como en producción.';
  end if;
  if to_regprocedure('public.conta_recibida_iva_no_deducible(uuid,boolean,text,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name like 'vat_non_deductible_%') then
    raise exception 'PRUEBA D07 no deducible · 4: la vuelta atrás no quita la función o las columnas.';
  end if;
  raise notice 'PRUEBA D07 no deducible · 4: la vuelta atrás, como en producción.';
end $$;

rollback;
