-- supabase/staging/sql/20261021_d01_documentos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0280 (D01, N22): conta_documentos_recibidos.
-- En una transacción con ROLLBACK, como administrador de A y como el de B. Datos
-- inventados, en un mes sin nada (noviembre de 2026), para contar exacto.
--
--   1. Una de cada: para mirar (leída «seguro», sin asiento), por aclarar (sin
--      proveedor), apuntada (con su asiento validado) y una llegada sin factura
--      (falta el PDF). Las cuatro salen en las filas (regla 7: nada se esconde)
--      y cada cifra cuenta la suya.
--   2. Lo que Folvy ha entendido de la apuntada: su cuenta de gasto del asiento,
--      como nombre · código.
--   3. El correo apagado: la barra no enseña «Por correo».
--   4. B: ni la ve.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 documentos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- La llegada sin factura la mete el servidor (la bandeja no se escribe a mano).
insert into public.document_inbox (account_id, company_id, channel, status, email_id, link_url, reason, created_at)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'correo', 'falta_pdf', 'prueba-d01-docs-1', 'https://portal.ejemplo.test/f/1',
        'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.', '2026-11-12 10:00+01');

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_sub text; v_i uuid; r jsonb; f jsonb;
begin
  if jsonb_array_length(public.conta_documentos_recibidos(v_e, '2026-11-01', '2026-11-30')->'filas') <> 1 then
    raise exception 'PRUEBA D01 documentos · 0: noviembre de 2026 ya tiene facturas en staging; la prueba no contaría exacto.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Docs Prueba D01', 'Docs Prueba D01, S.L.', 'B00000066', true, 'Prueba D01') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Docs Prueba D01', null, 'supplier', v_p::text, 'Prueba D01')->>'code';

  -- Para mirar: leída «seguro», sin asiento.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel, reading_confidence, reading)
  values (v_acc, v_p, v_e, 'PD01-D-1', '2026-11-10', 'en_revision', 'ocr', 110, 'Prueba D01', 'correo', 'seguro', '{"porque":["Todo cuadra y trae lo que pide la norma."]}');
  -- Por aclarar: no se sabe de quién es.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel, reading_confidence)
  values (v_acc, null, v_e, null, '2026-11-11', 'en_revision', 'ocr', 47.07, 'Prueba D01', 'subida', 'duda');
  -- Apuntada: aprobada, propuesta y validada.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name, arrival_channel)
  values (v_acc, v_p, v_e, 'PD01-D-3', '2026-11-05', 'aprobada', 'manual', 110, 100, 10, 'Prueba D01', 'subida') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-11-05', 'concepto', 'Factura Docs Prueba D01 · PD01-D-3', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', 'PD01-D-3'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-D-3'),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-D-3',
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-D-3')),
    null, 'Prueba D01');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01');

  r := public.conta_documentos_recibidos(v_e, '2026-11-01', '2026-11-30');
  -- 1
  if jsonb_array_length(r->'filas') <> 4 then raise exception 'PRUEBA D01 documentos · 1: % filas, no 4: %', jsonb_array_length(r->'filas'), r->'filas'; end if;
  if (r->'cifras'->>'para_mirar')::int <> 1 or (r->'cifras'->>'por_aclarar')::int <> 2 or (r->'cifras'->>'apuntadas')::int <> 1 or (r->'cifras'->>'apuntadas_solas')::int <> 0 then
    raise exception 'PRUEBA D01 documentos · 1: las cifras no cuentan cada una la suya: %', r->'cifras';
  end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PD01-D-1';
  if f->>'estado' <> 'para_mirar' or f->>'porque' <> 'Todo cuadra y trae lo que pide la norma.' or f->>'canal' <> 'correo' then raise exception 'PRUEBA D01 documentos · 1: la para mirar: %', f; end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'tipo' = 'llegada';
  if f->>'estado' <> 'por_aclarar' or f->>'porque' not like 'Falta el PDF%' then raise exception 'PRUEBA D01 documentos · 1: la llegada sin factura: %', f; end if;
  raise notice 'PRUEBA D01 documentos · 1: 4 filas (para mirar 1, por aclarar 2, apuntada 1): las cifras cuentan cada una la suya y ninguna fila se esconde.';
  -- 2
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PD01-D-3';
  if f->>'estado' <> 'apuntada' or f->'entendido'->>'cuenta' <> '60000000' or f->'entendido'->>'origen' <> 'del asiento' or f->'entendido'->>'nombre' is null then
    raise exception 'PRUEBA D01 documentos · 2: lo entendido de la apuntada: %', f;
  end if;
  raise notice 'PRUEBA D01 documentos · 2: la apuntada: % · % (%).', f->'entendido'->>'nombre', f->'entendido'->>'cuenta', f->'entendido'->>'origen';
  -- 3
  if (r->'correo'->>'activo')::boolean then raise exception 'PRUEBA D01 documentos · 3: el correo sale encendido sin estarlo.'; end if;
  raise notice 'PRUEBA D01 documentos · 3: correo apagado (la barra no enseña «Por correo»); recibe mercancía: %.', r->>'recibe_mercancia';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_documentos_recibidos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-11-01', '2026-11-30');
    raise exception 'PRUEBA D01 documentos · 4: B ha leído los documentos de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 documentos · 4: B ni los ve.';
end $$;
reset role;

rollback;
