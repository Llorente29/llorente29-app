-- supabase/staging/sql/20261021_d01_aprendido_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0250 (D01 R2 punto 3): public.conta_gasto_aprendido
-- dice de dónde vino lo aprendido de verdad. En una transacción con ROLLBACK.
--
--   1. Una factura apuntada en Folvy: «aprendido de tus facturas».
--   2. Después, una traída de Diez (más reciente) a la misma cuenta: «aprendido
--      de Diez» — sale la más reciente.
--   3. Otra en Folvy, más reciente aún: «aprendido de tus facturas» otra vez.
-- La traída de Diez se mete como la mete conta_diez_importar (borrador
-- 'migrated' y validada con su número y su huella), con el propietario de la
-- base: un usuario no puede escribir asientos traídos.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 aprendido: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
-- Una factura de Folvy, propuesta y validada: la función que hace el libro.
create or replace function pg_temp.factura_folvy(p_prov uuid, p_sub text, p_num text, p_fecha date) returns uuid language plpgsql as $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_i uuid; r jsonb;
begin
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, p_prov, v_e, p_num, p_fecha, 'aprobada', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Origen Prueba D01 · ' || p_num, 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', p_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num,
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', p_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', p_num)),
    null, 'Prueba D01');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01');
  return (r->>'id')::uuid;
end $$;

do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; r jsonb; v_entry uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Origen Prueba D01', 'Origen Prueba D01, S.L.', 'B00000044', true, 'Prueba D01') returning id into v_p;
  r := public.company_account_add(v_e, '4000', 'Origen Prueba D01', null, 'supplier', v_p::text, 'Prueba D01');
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.sub', r->>'code', true);
  v_entry := pg_temp.factura_folvy(v_p, r->>'code', 'PD01-O-1', '2026-09-03');
  perform set_config('prueba.entry1', v_entry::text, true);
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de tus facturas' or (r->>'facturas')::int <> 1 then raise exception 'PRUEBA D01 aprendido · 1: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 1: % (%).', r->>'porque', r->>'origen';
end $$;
reset role;

-- 2 · una traída de Diez, más reciente (como conta_diez_importar)
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_id uuid; v_seq bigint; v_prev text; v_hash text;
  v_y uuid := (select fiscal_year_id from public.journal_entry where id = current_setting('prueba.entry1')::uuid);
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, reasons,
                                    external_program, external_year, external_series, external_number, external_hash, created_by_name)
  values (v_acc, v_e, v_y, 2, '2026-09-20', 'Factura traída de prueba', 'migrated', 'borrador', '[{"decision":"traido-de-diez","porque":"Prueba D01"}]',
          'diez', '2026', '2', '990001', repeat('d', 32), 'Diez (traído)') returning id into v_id;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept)
  values (v_acc, v_e, v_id, 1, (select id from public.company_account where company_id = v_e and code = '60000000'), 100, 0, 'Prueba'),
         (v_acc, v_e, v_id, 2, (select id from public.company_account where company_id = v_e and code = current_setting('prueba.sub')), 0, 100, 'Prueba');
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e, 0));
  select chain_seq, hash into v_seq, v_prev from public.journal_entry where company_id = v_e and chain_seq is not null order by chain_seq desc limit 1;
  update public.journal_entry set number = 990001, status = 'validado', validated_at = now(), validated_by_name = 'Diez (traído)',
         chain_seq = coalesce(v_seq, 0) + 1, prev_hash = v_prev, hash = 'pendiente' where id = v_id;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(v_id));
  perform set_config('folvy.journal_huella', v_id::text, true);
  update public.journal_entry set hash = v_hash where id = v_id;
  perform set_config('folvy.journal_huella', '', true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid := current_setting('prueba.p')::uuid; r jsonb;
begin
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de Diez' or (r->>'facturas')::int <> 2 or r->>'confianza' <> 'seguro' then raise exception 'PRUEBA D01 aprendido · 2: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 2: % (%; %).', r->>'porque', r->>'origen', r->>'confianza';
  perform pg_temp.factura_folvy(v_p, current_setting('prueba.sub'), 'PD01-O-3', '2026-09-28');
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de tus facturas' or (r->>'facturas')::int <> 3 then raise exception 'PRUEBA D01 aprendido · 3: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 3: % (%).', r->>'porque', r->>'origen';
end $$;
reset role;

rollback;
