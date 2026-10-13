-- supabase/staging/sql/20261021_d01_recibida_envio_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0270 (D01, lo que el envío lee de una
-- recibida): el fichero entero y su prueba en UNA transacción que acaba en ROLLBACK.

begin;
-- ============================================================================
-- D01 · Tarea 5 · Lo que el envío a Diez lee de una FACTURA RECIBIDA. AÑADE
-- una función nueva; va detrás de la 0260.
--
-- conta_recibida_envio(asiento): el asiento validado de una factura recibida
-- (source_type 'supplier_invoice'), sus líneas con el tipo y la base del IVA,
-- la factura (número y fecha), el proveedor (nombre y NIF de su ficha) y su
-- documento (kind 'factura_recibida'). Es para las recibidas lo que
-- conta_resumen_ventas es para las ventas: lo lee conta-diez-enviar CON EL JWT
-- de quien pulsa (si no es de su cuenta, no está), y enviarRecibidaADiez
-- (_shared/diezEnviar.ts) decide con ello.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0270_d01_recibida_envio.down.sql
-- ============================================================================

create or replace function public.conta_recibida_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_i public.supplier_invoice;
  v_s public.supplier;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.source_type <> 'supplier_invoice' then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  select * into v_i from public.supplier_invoice where id = v_e.source_id and account_id = v_e.account_id;
  if v_i.id is null then raise exception 'La factura de ese asiento no está.' using errcode = 'P0002'; end if;
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_s.legal_name), ''), v_s.name), 'nif', nullif(trim(v_s.tax_id), '')),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;
comment on function public.conta_recibida_envio(uuid) is
  'D01 · Lo que el envío a Diez (serie 2) lee de una factura recibida: asiento, líneas con tipo y base del IVA, factura, proveedor y su documento. Solo para los de la cuenta.';
revoke all on function public.conta_recibida_envio(uuid) from public, anon;
grant execute on function public.conta_recibida_envio(uuid) to authenticated;

-- ── La prueba ──
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 recibida envío: esta base tiene cuentas de producción. No se toca nada.';
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
  v_p uuid; v_sub text; v_i uuid; r jsonb; v_entry uuid; v_ruta text; v_otro uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Envío Prueba D01', 'Envío Prueba D01, S.L.', 'B00000055', true, 'Prueba D01') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Envío Prueba D01', null, 'supplier', v_p::text, 'Prueba D01')->>'code';
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_p, v_e, 'PD01-E-1', '2026-09-29', 'aprobada', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-30', 'concepto', 'Factura Envío Prueba D01 · PD01-E-1', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', 'PD01-E-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-E-1'),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-E-1',
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', 'PD01-E-1')),
    null, 'Prueba D01');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba D01');
  perform set_config('prueba.entry', v_entry::text, true);

  -- 1
  r := public.conta_recibida_envio(v_entry);
  if r->>'estado' <> 'validado' or r->'factura'->>'numero' <> 'PD01-E-1' or r->'factura'->>'fecha' <> '2026-09-29' or r->>'fecha' <> '2026-09-30'
     or r->'proveedor'->>'nombre' <> 'Envío Prueba D01, S.L.' or r->'proveedor'->>'nif' <> 'B00000055' or r->'documento' <> 'null'::jsonb
     or jsonb_array_length(r->'lineas') <> 3
     or not exists (select 1 from jsonb_array_elements(r->'lineas') l where l->>'cuenta' = '47200010' and (l->>'tipoIva')::numeric = 10 and (l->>'baseIva')::numeric = 100 and (l->>'debe')::numeric = 10)
     or not exists (select 1 from jsonb_array_elements(r->'lineas') l where l->>'cuenta' = v_sub and (l->>'haber')::numeric = 110) then
    raise exception 'PRUEBA D01 recibida envío · 1: %', r;
  end if;
  raise notice 'PRUEBA D01 recibida envío · 1: % líneas, la 472 al % %% con base %, proveedor con NIF, sin documento.',
    jsonb_array_length(r->'lineas'), (select l->>'tipoIva' from jsonb_array_elements(r->'lineas') l where l->>'cuenta' = '47200010'), (select l->>'baseIva' from jsonb_array_elements(r->'lineas') l where l->>'cuenta' = '47200010');

  -- 2
  v_ruta := v_acc::text || '/' || v_entry::text || '/0123456789abcdef.pdf';
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 2048, "mimetype": "application/pdf"}');
  perform public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-E-1.pdf', repeat('cd', 32), 2048, 'Prueba D01');
  r := public.conta_recibida_envio(v_entry);
  if r->'documento'->>'ruta' <> v_ruta or r->'documento'->>'sha256' <> repeat('cd', 32) then raise exception 'PRUEBA D01 recibida envío · 2: %', r->'documento'; end if;
  raise notice 'PRUEBA D01 recibida envío · 2: con su PDF guardado, lo trae (factura_recibida).';

  -- 3
  select id into v_otro from public.journal_entry where account_id = v_acc and source_type <> 'supplier_invoice' limit 1;
  if v_otro is not null then
    begin
      perform public.conta_recibida_envio(v_otro);
      raise exception 'PRUEBA D01 recibida envío · 3: ha leído un asiento que no es de factura recibida.';
    exception when sqlstate '22023' then null; end;
  end if;
  raise notice 'PRUEBA D01 recibida envío · 3: un asiento de otra cosa, no (%).', case when v_otro is null then 'no había ninguno' else 'probado' end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_recibida_envio(current_setting('prueba.entry')::uuid);
    raise exception 'PRUEBA D01 recibida envío · 4: B ha leído la recibida de A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA D01 recibida envío · 4: B ni la ve.';
end $$;
reset role;

rollback;
