-- supabase/staging/sql/20261111_c06b_diez_pdf_pendiente_prueba.sql
--
-- SOLO STAGING. Prueba de 20261111T0700 (C06b, respuesta 7): «PDF pendiente
-- en Diez» en public.external_send, quién lo adjuntó y cómo,
-- public.conta_diez_autorizo y public.conta_diez_adjunto_a_mano. Todo en una
-- transacción con ROLLBACK: no cambia staging.
--
-- Por sus CAMINOS, como quien lo va a usar (regla 10):
--   1. Un día de Glovo de la empresa A (19/09, inventado; la plataforma con
--      la que A tiene su contabilidad configurada, la misma que R15), propuesto por el
--      cierre del día, validado como su administrador y con su PDF guardado.
--   2. El envío lo apunta el servidor (service_role, como conta-diez-enviar):
--      en Diez (1/9901) SIN su PDF → document_status 'pendiente_diez'.
--   3. Como administrador de A: «Ya está adjunto» → adjunto, a mano, con su
--      nombre; otra vez → «ya estaba», sin cambiar nada.
--   4. Lo que no está pendiente no se marca: un envío sin llegar a Diez no.
--   5. Como administrador de B: ni lo ve ni lo marca.
--   6. conta_diez_autorizo: un usuario ni la lee ni la escribe; el servidor
--      sí; un asiento solo una vez; la empresa entera en una base, una vez;
--      C0001, nunca.
--   7. El CHECK sigue cerrando: un estado que no existe, no.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b PDF pendiente: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo que crea la migración ───────────────────────────────────────────
do $$
begin
  if to_regclass('public.conta_diez_autorizo') is null then raise exception 'PRUEBA C06b · 0: falta conta_diez_autorizo.'; end if;
  if to_regprocedure('public.conta_diez_adjunto_a_mano(uuid, text)') is null then raise exception 'PRUEBA C06b · 0: falta conta_diez_adjunto_a_mano.'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'external_send'
       and column_name in ('document_attached_via', 'document_attached_by', 'document_attached_by_name')) <> 3 then
    raise exception 'PRUEBA C06b · 0: faltan columnas document_attached_* en external_send.';
  end if;
  raise notice 'PRUEBA C06b · 0: tabla, función y columnas: ok.';
end $$;

-- ── 1 · Un día de Glovo de A, validado y con su PDF ──────────────────────────
do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  h       constant interval := interval '13 hours';
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';  -- Glovo de A
  v_e uuid; v_s uuid; v_entry uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if exists (select 1 from public.sale where account_id = v_acc and location_id = v_loc
              and (sold_at at time zone 'Europe/Madrid')::date = '2026-09-19') then
    raise exception 'PRUEBA C06b · 1: A ya tiene ventas el 19/09 en ese local; la prueba no mediría lo que dice.';
  end if;
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_canal, ('2026-09-19'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 33.00, 30.00, 3.00, 'hubrise', 'C06B-1901', true)
  returning id into v_s;
  perform public.conta_proponer_dias(v_e, now());
  select d.entry_id into v_entry from public.sales_day_summary d where d.account_id = v_acc and d.company_id = v_e and v_s = any (d.sale_ids);
  if v_entry is null then raise exception 'PRUEBA C06b · 1: el cierre del día no ha propuesto el 19/09.'; end if;
  perform set_config('prueba.entry', v_entry::text, true);
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.emp', v_e::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_entry uuid := current_setting('prueba.entry')::uuid;
  v_ruta text := current_setting('prueba.acc') || '/' || v_entry || '/0123456789abcdef.pdf';
begin
  perform public.journal_entry_validar(v_entry, 'Prueba C06b');
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  perform public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas_C06B.pdf', repeat('ab', 32), 1234, 'Prueba C06b');
  raise notice 'PRUEBA C06b · 1: el 19/09 de A, validado y con su PDF guardado en Folvy.';
end $$;
reset role;

-- ── 2 · El servidor apunta el envío: en Diez SIN su PDF ─────────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; v_doc uuid;
begin
  select id into v_doc from public.journal_entry_document where entry_id = v_entry;
  insert into public.external_send (account_id, company_id, entry_id, kind, ext_year, ext_series, ext_number, ext_invoice_number, payload_hash, status, attempts, sent_at, document_id, document_status)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.emp')::uuid, v_entry, 'factura', '2026', '1', 9901, 'C06B-PRUEBA-0919', repeat('0', 64), 'enviado', 1, now(), v_doc, 'pendiente_diez');
  raise notice 'PRUEBA C06b · 2: en Diez 1/9901 con document_status pendiente_diez: el CHECK lo admite.';
end $$;

-- ── 3 y 4 · Como administrador de A: «Ya está adjunto» ─────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; r jsonb; v_s record;
begin
  if not exists (select 1 from public.external_send where entry_id = v_entry and document_status = 'pendiente_diez') then
    raise exception 'PRUEBA C06b · 3: el administrador de A no ve su factura pendiente.';
  end if;
  r := public.conta_diez_adjunto_a_mano(v_entry, 'Prueba C06b');
  if (r->>'ya_estaba')::boolean or r->>'serie' <> '1' or (r->>'numero')::int <> 9901 then raise exception 'PRUEBA C06b · 3: respuesta inesperada: %', r; end if;
  select document_status, document_attached_via, document_attached_by_name, document_attached_at into v_s from public.external_send where entry_id = v_entry;
  if v_s.document_status <> 'adjunto' or v_s.document_attached_via <> 'a_mano' or v_s.document_attached_by_name <> 'Prueba C06b' or v_s.document_attached_at is null then
    raise exception 'PRUEBA C06b · 3: no ha quedado adjunto a mano con su nombre: %', row_to_json(v_s);
  end if;
  r := public.conta_diez_adjunto_a_mano(v_entry, 'Otra persona');
  if not (r->>'ya_estaba')::boolean or r->>'quien' <> 'Prueba C06b' then raise exception 'PRUEBA C06b · 3: la segunda vez no dice que ya estaba: %', r; end if;
  raise notice 'PRUEBA C06b · 3: «Ya está adjunto»: adjunto, a mano, por quien lo marcó; la segunda vez, «ya estaba» y no cambia.';
  begin
    update public.external_send set document_status = 'pendiente_diez' where entry_id = v_entry;
    if found then raise exception 'PRUEBA C06b · 4: un usuario ha escrito en external_send.'; end if;
    raise notice 'PRUEBA C06b · 4: un usuario no escribe en external_send (0 filas).';
  exception when insufficient_privilege then raise notice 'PRUEBA C06b · 4: un usuario no escribe en external_send (%).', sqlerrm; end;
end $$;
reset role;

do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid;
begin
  update public.external_send set status = 'pendiente', ext_year = null, ext_series = null, ext_number = null, document_status = 'pendiente', document_attached_via = null where entry_id = v_entry;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_diez_adjunto_a_mano(current_setting('prueba.entry')::uuid, 'Prueba C06b');
    raise exception 'PRUEBA C06b · 4: ha marcado adjunto algo que no está en Diez.';
  exception when sqlstate 'P0002' then raise notice 'PRUEBA C06b · 4: lo que no ha llegado a Diez no se marca (%).', sqlerrm; end;
end $$;
reset role;

-- ── 5 · Como administrador de B: ni lo ve ni lo marca ───────────────────────
do $$ begin
  update public.external_send set status = 'enviado', ext_year = '2026', ext_series = '1', ext_number = 9901, document_status = 'pendiente_diez' where entry_id = current_setting('prueba.entry')::uuid;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.external_send where entry_id = current_setting('prueba.entry')::uuid) then raise exception 'PRUEBA C06b · 5: B ve el envío de A.'; end if;
  begin
    perform public.conta_diez_adjunto_a_mano(current_setting('prueba.entry')::uuid, 'B');
    raise exception 'PRUEBA C06b · 5: B ha marcado el PDF de A.';
  exception when sqlstate 'P0002' then raise notice 'PRUEBA C06b · 5: B ni ve ni marca lo de A (%).', sqlerrm; end;
end $$;

-- ── 6 · conta_diez_autorizo ────────────────────────────────────────────────
do $$
begin
  begin
    perform 1 from public.conta_diez_autorizo limit 1;
    raise exception 'PRUEBA C06b · 6: un usuario lee conta_diez_autorizo.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
    values (current_setting('prueba.acc')::uuid, current_setting('prueba.emp')::uuid, 'asiento', current_setting('prueba.entry')::uuid, 'C0008', 'B', 'x');
    raise exception 'PRUEBA C06b · 6: un usuario se ha autorizado a escribir en Diez real.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA C06b · 6: un usuario ni lee ni escribe conta_diez_autorizo.';
end $$;
reset role;

do $$
declare v_acc uuid := current_setting('prueba.acc')::uuid; v_e uuid := current_setting('prueba.emp')::uuid; v_entry uuid := current_setting('prueba.entry')::uuid;
begin
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
  values (v_acc, v_e, 'asiento', v_entry, 'C0008', 'Prueba C06b', 'el primero, para mirarlo en Diez');
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo) values (v_acc, v_e, 'asiento', v_entry, 'C0008', 'Prueba', 'otra vez');
    raise exception 'PRUEBA C06b · 6: el mismo asiento autorizado dos veces.';
  exception when unique_violation then null; end;
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo) values (v_acc, v_e, 'empresa', v_entry, 'C0008', 'Prueba', 'mezcla');
    raise exception 'PRUEBA C06b · 6: «empresa» con asiento.';
  exception when check_violation then null; end;
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, nombre_bd, autorizado_por, motivo) values (v_acc, v_e, 'empresa', 'C0008', 'Prueba C06b', 'el resto');
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, nombre_bd, autorizado_por, motivo) values (v_acc, v_e, 'empresa', 'C0008', 'Prueba', 'otra vez');
    raise exception 'PRUEBA C06b · 6: la empresa autorizada dos veces en la misma base.';
  exception when unique_violation then null; end;
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, nombre_bd, autorizado_por, motivo) values (v_acc, v_e, 'empresa', 'c0001', 'Prueba', 'vetada');
    raise exception 'PRUEBA C06b · 6: C0001 autorizada.';
  exception when check_violation then null; end;
  raise notice 'PRUEBA C06b · 6: el servidor autoriza un asiento una vez y la empresa una vez por base; C0001, nunca.';
end $$;

-- ── 7 · El CHECK sigue cerrando ─────────────────────────────────────────────
do $$
begin
  begin
    update public.external_send set document_status = 'cualquiera' where entry_id = current_setting('prueba.entry')::uuid;
    raise exception 'PRUEBA C06b · 7: el CHECK admite cualquier cosa.';
  exception when check_violation then raise notice 'PRUEBA C06b · 7: un estado que no existe, no (%).', sqlerrm; end;
end $$;

rollback;
