-- supabase/staging/sql/20261021_d01_asiento_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0240 (D01, el asiento de la factura
-- recibida): conta_gasto_aprendido y conta_documento_factura_guardar. Todo en
-- una transacción con ROLLBACK, como administrador de A y de B. Datos inventados.
--
--   1. Un proveedor nuevo de A con su subcuenta 400: sin historia, no aprende.
--   2. Dos facturas suyas a la 600, propuestas y validadas: «Las 2 facturas
--      anteriores de este proveedor fueron a … · 60000000», seguro.
--   3. Una tercera, más reciente, a la 629: probable (nunca seguro), y propone
--      la de la más reciente, con el reparto.
--   4. El documento: de un asiento que no es de factura recibida, no; sin el
--      fichero, no; con el fichero, sí, y la segunda vez el mismo.
--   5. B: ni aprende de A ni le guarda documentos.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 asiento: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_t10 constant uuid := '5bbab66f-a022-44a6-b146-ac577a2988d3';
  v_p uuid; v_sub text; r jsonb; v_ids uuid[] := '{}'; v_i uuid; f record;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Aprende Prueba D01', 'Aprende Prueba D01, S.L.', 'B00000033', true, 'Prueba D01') returning id into v_p;
  r := public.company_account_add(v_e, '4000', 'Aprende Prueba D01', null, 'supplier', v_p::text, 'Prueba D01');
  v_sub := r->>'code';
  perform set_config('prueba.p', v_p::text, true);

  -- 1 · sin historia
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'cuenta' is not null or (r->>'facturas')::int <> 0 then raise exception 'PRUEBA D01 asiento · 1: sin historia ha aprendido algo: %', r; end if;
  raise notice 'PRUEBA D01 asiento · 1: subcuenta %; sin historia: %', v_sub, r->>'porque';

  -- 2 y 3 · tres facturas validadas: dos a la 600 y la más reciente a la 629
  for f in select * from (values ('PD01-A-1', '2026-09-03'::date, '60000000'), ('PD01-A-2', '2026-09-10'::date, '60000000'), ('PD01-A-3', '2026-09-24'::date, '62900000')) x(num, fecha, gasto) loop
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
    values (v_acc, v_p, v_e, f.num, f.fecha, 'aprobada', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i;
    r := public.journal_entry_proponer(v_e,
      jsonb_build_object('series', 2, 'fecha', f.fecha, 'concepto', 'Factura Aprende Prueba D01 · ' || f.num, 'source_type', 'supplier_invoice', 'source_id', v_i,
                         'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', f.num),
      jsonb_build_array(
        jsonb_build_object('cuenta', f.gasto, 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', f.num),
        jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', f.num,
                           'iva', jsonb_build_object('tipo_id', v_t10, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
        jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', f.num)),
      null, 'Prueba D01');
    perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01');
    v_ids := v_ids || (r->>'id')::uuid;
    if f.num = 'PD01-A-2' then
      r := public.conta_gasto_aprendido(v_e, v_p);
      if r->>'cuenta' <> '60000000' or r->>'confianza' <> 'seguro' or (r->>'facturas')::int <> 2 or r->>'porque' not like 'Las 2 facturas anteriores de este proveedor fueron a % · 60000000.' then
        raise exception 'PRUEBA D01 asiento · 2: no aprende la 600 segura de dos facturas: %', r;
      end if;
      raise notice 'PRUEBA D01 asiento · 2: % (%; %).', r->>'porque', r->>'confianza', r->>'origen';
    end if;
  end loop;
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'cuenta' <> '62900000' or r->>'confianza' <> 'probable' or jsonb_array_length(r->'reparto') <> 2 then
    raise exception 'PRUEBA D01 asiento · 3: con dos cuentas no propone la más reciente como probable: %', r;
  end if;
  raise notice 'PRUEBA D01 asiento · 3: % (%).', r->>'porque', r->>'confianza';
  perform set_config('prueba.entry', v_ids[3]::text, true);
end $$;

-- 4 · el documento
do $$
declare
  v_acc constant text := 'c01a0000-0000-4000-8000-00000000000a';
  v_entry uuid := current_setting('prueba.entry')::uuid;
  v_ruta text := v_acc || '/' || current_setting('prueba.entry') || '/0123456789abcdef.pdf';
  v_otro uuid;
  r jsonb;
begin
  -- Un asiento validado que no es de factura recibida (si staging tiene alguno de A).
  select id into v_otro from public.journal_entry where account_id = v_acc::uuid and status = 'validado' and source_type <> 'supplier_invoice' limit 1;
  if v_otro is not null then
    begin
      perform public.conta_documento_factura_guardar(v_otro, v_acc || '/' || v_otro || '/0123456789abcdef.pdf', 'f.pdf', repeat('ab', 32), 1234, 'Prueba');
      raise exception 'PRUEBA D01 asiento · 4: ha guardado una factura en un asiento que no es de factura recibida.';
    exception when sqlstate '22023' then null; end;
  end if;
  begin
    perform public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
    raise exception 'PRUEBA D01 asiento · 4: ha enlazado una factura que no está subida.';
  exception when sqlstate 'P0002' then null; end;
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 asiento · 4: la primera vez dice que ya estaba.'; end if;
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
  if not (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 asiento · 4: la segunda vez ha hecho otro.'; end if;
  if (select kind from public.journal_entry_document where entry_id = v_entry) <> 'factura_recibida' then raise exception 'PRUEBA D01 asiento · 4: no es kind factura_recibida.'; end if;
  raise notice 'PRUEBA D01 asiento · 4: otro tipo de asiento no (%); sin fichero no; con fichero sí (factura_recibida), y la segunda vez el mismo.', case when v_otro is null then 'no había ninguno que probar' else 'probado' end;
end $$;
reset role;

-- 5 · B
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_gasto_aprendido('3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.p')::uuid);
    raise exception 'PRUEBA D01 asiento · 5: B ha aprendido de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conta_documento_factura_guardar(current_setting('prueba.entry')::uuid, 'x', 'x.pdf', repeat('ab', 32), 1, 'B');
    raise exception 'PRUEBA D01 asiento · 5: B ha guardado en A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA D01 asiento · 5: B ni aprende de A ni le guarda documentos.';
end $$;
reset role;

rollback;
