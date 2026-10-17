-- supabase/staging/sql/20261120_c06b_nombre_documento_prueba.sql
--
-- SOLO STAGING. Prueba de 20261120T0100_c06b_nombre_documento (el disparador
-- que limpia journal_entry_document.file_name y guarda el original, y
-- conta_nombre_fichero). La migración se aplica DENTRO de la transacción (\i)
-- y todo acaba en ROLLBACK: staging es compartido y no cambia. Datos
-- inventados en la cuenta A.
--
--   1. El camino del 3174, como administrador de A: una factura recibida de
--      «Panadería Ñandú, S.A.» con número «Nº 24/048.027», propuesta y
--      validada; conta_documento_factura_guardar con el nombre que arma el
--      front («Panadería Ñandú S.A. Nº-24-048.027.pdf», con espacios, tildes,
--      «ñ», «º» y puntos) la ENLAZA. file_name sale limpio y cumple; el
--      original, en original_name.
--   2. La misma llamada otra vez: «ya_estaba», con el nombre limpio.
--   3. Antes de la migración, ese mismo nombre NO se enlazaba (23514): es el
--      fallo del 16/10, medido con la misma vara.
--   4. Un nombre que ya cumple no cambia (y su original es él mismo).
--   5. El resumen de ventas (el otro que escribe ahí) también se limpia: una
--      fila insertada a mano con «Resumen ventas Glovo · Alcalá.pdf».
--   6. Cambiar file_name a uno sucio: sale limpio y el original es el nuevo.
--   7. La red: con el disparador apagado, el CHECK de antes sigue parando un
--      nombre con espacios.
--   8. conta_nombre_fichero con casos de borde: el de Europastry, sin nada,
--      «.PDF» en mayúsculas, puntas raras y uno de 300 caracteres.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b nombre: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Una factura recibida de A, validada, con su PDF subido (inventado).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_sub text; v_i uuid; r jsonb; v_entry uuid; v_ruta text;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Panadería Ñandú, S.A.', 'Panadería Ñandú, S.A.', 'A00000066', true, 'Prueba C06b') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Panadería Ñandú, S.A.', null, 'supplier', v_p::text, 'Prueba C06b')->>'code';
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_p, v_e, 'Nº 24/048.027', '2026-09-29', 'aprobada', 'manual', 110, 100, 10, 'Prueba C06b') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-30', 'concepto', 'Factura Panadería Ñandú, S.A. · Nº 24/048.027', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba C06b', 'documento', 'Nº 24/048.027'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false,
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false)),
    null, 'Prueba C06b');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba C06b');
  v_ruta := v_acc::text || '/' || v_entry::text || '/0123456789abcdef.pdf';
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 2048, "mimetype": "application/pdf"}');
  perform set_config('prueba.entry', v_entry::text, true);
  perform set_config('prueba.ruta', v_ruta, true);

  -- 3 · Antes de la migración, el nombre que arma el front no se enlaza.
  begin
    perform public.conta_documento_factura_guardar(v_entry, v_ruta, 'Panadería Ñandú S.A. Nº-24-048.027.pdf', repeat('cd', 32), 2048, 'Prueba C06b');
    raise exception 'PRUEBA C06b nombre · 3: sin la migración, el nombre con espacios se ha enlazado (¿ya estaba aplicada?).';
  exception when sqlstate '23514' then null; end;
  raise notice 'PRUEBA C06b nombre · 3: antes de la migración, «Panadería Ñandú S.A. Nº-24-048.027.pdf» no se enlaza (23514), como el 3174.';
end $$;
reset role;

\i supabase/migrations/20261120T0100_c06b_nombre_documento.sql

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_entry constant uuid := current_setting('prueba.entry')::uuid;
  v_ruta  constant text := current_setting('prueba.ruta');
  r jsonb; d record;
begin
  -- 1
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'Panadería Ñandú S.A. Nº-24-048.027.pdf', repeat('cd', 32), 2048, 'Prueba C06b');
  select file_name, original_name into d from public.journal_entry_document where entry_id = v_entry and kind = 'factura_recibida';
  if d.file_name is distinct from 'Panaderia-Nandu-S.A.-N-24-048.027.pdf' or d.file_name !~ '^[A-Za-z0-9._-]+\.pdf$'
     or d.original_name is distinct from 'Panadería Ñandú S.A. Nº-24-048.027.pdf' or r->>'nombre' is distinct from d.file_name or (r->>'ya_estaba')::boolean then
    raise exception 'PRUEBA C06b nombre · 1: % · % · %', r, d.file_name, d.original_name;
  end if;
  raise notice 'PRUEBA C06b nombre · 1: enlazado como «%», el original «%» aparte.', d.file_name, d.original_name;

  -- 2
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'Panadería Ñandú S.A. Nº-24-048.027.pdf', repeat('cd', 32), 2048, 'Prueba C06b');
  if not (r->>'ya_estaba')::boolean or r->>'nombre' <> 'Panaderia-Nandu-S.A.-N-24-048.027.pdf'
     or (select count(*) from public.journal_entry_document where entry_id = v_entry) <> 1 then
    raise exception 'PRUEBA C06b nombre · 2: %', r;
  end if;
  raise notice 'PRUEBA C06b nombre · 2: otra vez, «ya_estaba» y una sola fila.';
end $$;
reset role;

-- 4 a 7, como dueño de la tabla (filas a mano, dentro del ROLLBACK).
do $$
declare
  v_entry constant uuid := current_setting('prueba.entry')::uuid;
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  d record;
begin
  -- 4
  update public.journal_entry_document set file_name = 'PD01-E-1.pdf' where entry_id = v_entry and kind = 'factura_recibida';
  select file_name, original_name into d from public.journal_entry_document where entry_id = v_entry and kind = 'factura_recibida';
  if d.file_name <> 'PD01-E-1.pdf' or d.original_name <> 'PD01-E-1.pdf' then raise exception 'PRUEBA C06b nombre · 4: % · %', d.file_name, d.original_name; end if;
  raise notice 'PRUEBA C06b nombre · 4: un nombre que ya cumple no cambia («%»).', d.file_name;

  -- 5
  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by_name)
  values (v_acc, v_e, v_entry, 'resumen_ventas', v_acc::text || '/' || v_entry::text || '/fedcba9876543210.pdf', 'Resumen ventas Glovo · Alcalá.pdf', repeat('ab', 32), 1024, 'Prueba C06b');
  select file_name, original_name into d from public.journal_entry_document where entry_id = v_entry and kind = 'resumen_ventas';
  if d.file_name <> 'Resumen-ventas-Glovo-Alcala.pdf' or d.original_name <> 'Resumen ventas Glovo · Alcalá.pdf' then
    raise exception 'PRUEBA C06b nombre · 5: % · %', d.file_name, d.original_name;
  end if;
  raise notice 'PRUEBA C06b nombre · 5: el resumen de ventas también: «%».', d.file_name;

  -- 6
  update public.journal_entry_document set file_name = 'Factura Ñu 7.pdf' where entry_id = v_entry and kind = 'factura_recibida';
  select file_name, original_name into d from public.journal_entry_document where entry_id = v_entry and kind = 'factura_recibida';
  if d.file_name <> 'Factura-Nu-7.pdf' or d.original_name <> 'Factura Ñu 7.pdf' then raise exception 'PRUEBA C06b nombre · 6: % · %', d.file_name, d.original_name; end if;
  raise notice 'PRUEBA C06b nombre · 6: cambiado a uno sucio, sale «%» con su original.', d.file_name;

  -- 7
  alter table public.journal_entry_document disable trigger trg_journal_entry_document_nombre_limpio;
  begin
    update public.journal_entry_document set file_name = 'Con espacios.pdf' where entry_id = v_entry and kind = 'factura_recibida';
    raise exception 'PRUEBA C06b nombre · 7: sin el disparador, el CHECK no ha parado un nombre con espacios.';
  exception when check_violation then null; end;
  alter table public.journal_entry_document enable trigger trg_journal_entry_document_nombre_limpio;
  raise notice 'PRUEBA C06b nombre · 7: sin el disparador, el CHECK de antes sigue parando «Con espacios.pdf».';
end $$;

-- 8
do $$
declare
  c record;
begin
  for c in select * from (values
      ('EUROPASTRY S.A. 24048027.pdf', 'EUROPASTRY-S.A.-24048027.pdf'),
      (null, 'documento.pdf'), ('', 'documento.pdf'), ('¿?.PDF', 'documento.pdf'),
      ('  Café   Ölé  .pdf', 'Cafe-Ole.pdf'), ('..hola..', 'hola.pdf'),
      ('resumen_ventas_glovo_2026-10-16.pdf', 'resumen_ventas_glovo_2026-10-16.pdf')) v(entra, sale)
  loop
    if public.conta_nombre_fichero(c.entra) is distinct from c.sale then
      raise exception 'PRUEBA C06b nombre · 8: «%» da «%» y debía dar «%».', c.entra, public.conta_nombre_fichero(c.entra), c.sale;
    end if;
  end loop;
  if length(public.conta_nombre_fichero(repeat('Ñandú ', 50))) > 154 or public.conta_nombre_fichero(repeat('Ñandú ', 50)) !~ '^[A-Za-z0-9._-]+\.pdf$' then
    raise exception 'PRUEBA C06b nombre · 8: uno largo da «%».', public.conta_nombre_fichero(repeat('Ñandú ', 50));
  end if;
  raise notice 'PRUEBA C06b nombre · 8: los 7 de borde y uno de 300 caracteres (sale de %).', length(public.conta_nombre_fichero(repeat('Ñandú ', 50)));
end $$;

rollback;
