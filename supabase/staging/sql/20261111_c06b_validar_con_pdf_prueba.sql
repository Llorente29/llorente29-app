-- supabase/staging/sql/20261111_c06b_validar_con_pdf_prueba.sql
--
-- SOLO STAGING. Prueba de 20261111T0720 (C06b, respuesta 8, pregunta 1):
-- validar y guardar el PDF van juntos. Todo en una transacción con ROLLBACK:
-- no cambia staging.
--
-- Por sus CAMINOS, como quien lo va a usar (regla 10), con un día de Glovo de
-- la empresa A (18/09, inventado; la plataforma con la contabilidad
-- configurada de A, la misma que la prueba de la 0700), como su administrador:
--   1. Validar a secas (el botón de antes): al cerrar la transacción el
--      disparador diferido lo deshace y lo dice. El asiento sigue propuesto y
--      el número no se gasta.
--   2. Con el PDF hecho para otro número: no se valida (40001).
--   3. Con el número bueno pero sin el PDF subido: no se valida (P0002), y el
--      número que le toca sigue siendo el mismo.
--   4. Con el número bueno y el PDF subido: validado, con ese número y su PDF,
--      y el disparador lo deja pasar.
--   5. Anularlo: el contraasiento se valida sin PDF (no es un resumen de
--      ventas) y el original queda anulado.
--   6. Un asiento que no es de una plataforma (manual, 629 / 572) se valida
--      como siempre, sin PDF.
--   7. Como administrador de B: ni el número previsto ni validar lo de A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b validar con PDF: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo que crea la migración ───────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.conta_numero_previsto(uuid)') is null then raise exception 'PRUEBA C06b · 0: falta conta_numero_previsto.'; end if;
  if to_regprocedure('public.journal_entry_validar_con_documento(uuid, integer, text, text, text, integer, text)') is null then raise exception 'PRUEBA C06b · 0: falta journal_entry_validar_con_documento.'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_journal_entry_valida_con_pdf' and tgrelid = 'public.journal_entry'::regclass and tgdeferrable and tginitdeferred) then
    raise exception 'PRUEBA C06b · 0: falta el disparador diferido trg_journal_entry_valida_con_pdf.';
  end if;
  raise notice 'PRUEBA C06b · 0: dos funciones y el disparador diferido: ok.';
end $$;

-- ── Un día de Glovo de A, propuesto por el cierre del día ──────────────────
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
              and (sold_at at time zone 'Europe/Madrid')::date = '2026-09-18') then
    raise exception 'PRUEBA C06b · prep: A ya tiene ventas el 18/09 en ese local; la prueba no mediría lo que dice.';
  end if;
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_canal, ('2026-09-18'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 22.00, 20.00, 2.00, 'hubrise', 'C06B-1801', true)
  returning id into v_s;
  perform public.conta_proponer_dias(v_e, now());
  select d.entry_id into v_entry from public.sales_day_summary d where d.account_id = v_acc and d.company_id = v_e and v_s = any (d.sale_ids);
  if v_entry is null then raise exception 'PRUEBA C06b · prep: el cierre del día no ha propuesto el 18/09.'; end if;
  if (select status from public.journal_entry where id = v_entry) <> 'propuesto' then raise exception 'PRUEBA C06b · prep: el 18/09 no ha quedado propuesto.'; end if;
  perform set_config('prueba.entry', v_entry::text, true);
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.emp', v_e::text, true);
  raise notice 'PRUEBA C06b · prep: el 18/09 de Glovo de A, propuesto.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 · Validar a secas: el disparador diferido lo deshace ─────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; v_n int; v_falla text;
begin
  v_n := public.conta_numero_previsto(v_entry);
  begin
    perform public.journal_entry_validar(v_entry, 'Prueba C06b');
    -- Lo que hará el COMMIT, aquí mismo: comprobar lo diferido.
    set constraints public.trg_journal_entry_valida_con_pdf immediate;
    v_falla := null;
  exception when sqlstate '23514' then v_falla := sqlerrm; end;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  if v_falla is null or v_falla not like '%se valida con su PDF%' then
    raise exception 'PRUEBA C06b · 1: validar sin PDF dio «%» (espero que no se valide).', coalesce(v_falla, 'validado');
  end if;
  if (select status from public.journal_entry where id = v_entry) <> 'propuesto' then raise exception 'PRUEBA C06b · 1: el asiento no ha vuelto a propuesto.'; end if;
  if public.conta_numero_previsto(v_entry) <> v_n then raise exception 'PRUEBA C06b · 1: el número se ha gastado.'; end if;
  perform set_config('prueba.n', v_n::text, true);
  raise notice 'PRUEBA C06b · 1: validar a secas no valida («%»); sigue propuesto y le toca el nº %.', left(v_falla, 110), v_n;
end $$;

-- ── 2 · El PDF se hizo con otro número ─────────────────────────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; v_n int := current_setting('prueba.n')::int;
  v_ruta text := current_setting('prueba.acc') || '/' || current_setting('prueba.entry') || '/0123456789abcdef.pdf'; v_falla text;
begin
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  begin
    perform public.journal_entry_validar_con_documento(v_entry, v_n + 1, v_ruta, 'ResumenDeVentas_C06B.pdf', repeat('ab', 32), 1234, 'Prueba C06b');
    v_falla := null;
  exception when sqlstate '40001' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b · 2: con el PDF de otro número se ha validado.'; end if;
  if (select status from public.journal_entry where id = v_entry) <> 'propuesto' then raise exception 'PRUEBA C06b · 2: el asiento no sigue propuesto.'; end if;
  if exists (select 1 from public.journal_entry_document where entry_id = v_entry) then raise exception 'PRUEBA C06b · 2: ha quedado un documento enlazado.'; end if;
  raise notice 'PRUEBA C06b · 2: PDF de otro número → no se valida («%»).', left(v_falla, 120);
end $$;

-- ── 3 · El número bueno, sin el PDF subido ─────────────────────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; v_n int := current_setting('prueba.n')::int;
  v_ruta text := current_setting('prueba.acc') || '/' || current_setting('prueba.entry') || '/fedcba9876543210.pdf'; v_falla text;
begin
  begin
    perform public.journal_entry_validar_con_documento(v_entry, v_n, v_ruta, 'ResumenDeVentas_C06B.pdf', repeat('cd', 32), 1234, 'Prueba C06b');
    v_falla := null;
  exception when sqlstate 'P0002' then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%no está subido%' then raise exception 'PRUEBA C06b · 3: sin el PDF subido dio «%».', coalesce(v_falla, 'validado'); end if;
  if (select status from public.journal_entry where id = v_entry) <> 'propuesto' then raise exception 'PRUEBA C06b · 3: el asiento no sigue propuesto.'; end if;
  if public.conta_numero_previsto(v_entry) <> v_n then raise exception 'PRUEBA C06b · 3: el número se ha gastado.'; end if;
  raise notice 'PRUEBA C06b · 3: sin el PDF subido → no se valida («%») y le sigue tocando el nº %.', left(v_falla, 100), v_n;
end $$;

-- ── 4 · El número bueno y el PDF subido ────────────────────────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; v_n int := current_setting('prueba.n')::int;
  v_ruta text := current_setting('prueba.acc') || '/' || current_setting('prueba.entry') || '/0123456789abcdef.pdf'; r jsonb; v_x record;
begin
  r := public.journal_entry_validar_con_documento(v_entry, v_n, v_ruta, 'ResumenDeVentas_C06B.pdf', repeat('ab', 32), 1234, 'Prueba C06b');
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  select e.status, e.number, d.storage_path, d.sha256 into v_x from public.journal_entry e
    left join public.journal_entry_document d on d.entry_id = e.id and d.kind = 'resumen_ventas' where e.id = v_entry;
  if v_x.status <> 'validado' or v_x.number <> v_n or v_x.storage_path <> v_ruta or v_x.sha256 <> repeat('ab', 32) then
    raise exception 'PRUEBA C06b · 4: no ha quedado validado con su número y su PDF: %', row_to_json(v_x);
  end if;
  if (r->>'numero')::int <> v_n or (r->'documento'->>'ruta') <> v_ruta then raise exception 'PRUEBA C06b · 4: la respuesta no dice número y documento: %', r; end if;
  raise notice 'PRUEBA C06b · 4: validado nº % con su PDF en la misma transacción; el disparador lo deja pasar.', v_n;
end $$;

-- ── 5 · Anularlo: el contraasiento no lleva PDF y se valida ────────────────
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid; r jsonb; v_c uuid;
begin
  r := public.journal_entry_anular(v_entry, 'Prueba C06b: anular lo validado con PDF', null, 'Prueba C06b');
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  v_c := (r->>'contraasiento')::uuid;
  if (select status from public.journal_entry where id = v_entry) <> 'anulado' then raise exception 'PRUEBA C06b · 5: el original no ha quedado anulado.'; end if;
  if (select status from public.journal_entry where id = v_c) <> 'validado' then raise exception 'PRUEBA C06b · 5: el contraasiento no está validado.'; end if;
  raise notice 'PRUEBA C06b · 5: anulado; su contraasiento (nº %) validado sin PDF propio.', r->>'numero';
end $$;

-- ── 6 · Un asiento manual se valida como siempre ───────────────────────────
do $$
declare r jsonb; v_id uuid;
begin
  r := public.journal_entry_proponer(current_setting('prueba.emp')::uuid,
    jsonb_build_object('fecha', '2026-09-18', 'source_type', 'manual', 'series', 4, 'concepto', 'Manual (prueba C06b)', 'confianza', 'seguro', 'porque', 'Prueba C06b.'),
    '[{"cuenta": "62900000", "debe": 10, "comun": true}, {"cuenta": "57200001", "haber": 10, "comun": true}]'::jsonb, null, 'Prueba C06b');
  v_id := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_id, 'Prueba C06b');
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  if (select status from public.journal_entry where id = v_id) <> 'validado' then raise exception 'PRUEBA C06b · 6: el manual no se ha validado.'; end if;
  raise notice 'PRUEBA C06b · 6: un asiento manual se valida sin PDF, como siempre.';
end $$;
reset role;

-- ── 7 · Como administrador de B ────────────────────────────────────────────
-- Un día nuevo de A, propuesto, para que B no tropiece con «ya está validado».
do $$
declare v_acc uuid := current_setting('prueba.acc')::uuid; v_s uuid; v_entry uuid;
begin
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, 'c01a0000-0000-4000-8000-0000000000a2', '7e000000-0000-4000-8000-000000000b01', 'e0200000-0000-4000-8000-00000000a0c1',
     ('2026-09-17'::timestamp + interval '13 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 11.00, 10.00, 1.00, 'hubrise', 'C06B-1701', true)
  returning id into v_s;
  perform public.conta_proponer_dias(current_setting('prueba.emp')::uuid, now());
  select d.entry_id into v_entry from public.sales_day_summary d where d.account_id = v_acc and v_s = any (d.sale_ids);
  if v_entry is null then raise exception 'PRUEBA C06b · 7: el cierre del día no ha propuesto el 17/09.'; end if;
  perform set_config('prueba.entry2', v_entry::text, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_entry uuid := current_setting('prueba.entry2')::uuid; v_falla text;
begin
  begin perform public.conta_numero_previsto(v_entry); v_falla := null; exception when sqlstate 'P0002' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b · 7: B ve el número previsto de un asiento de A.'; end if;
  begin
    perform public.journal_entry_validar_con_documento(v_entry, 1, 'x', 'x', repeat('ab', 32), 1, 'B');
    v_falla := null;
  exception when sqlstate '42501' or sqlstate 'P0002' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b · 7: B ha validado un asiento de A.'; end if;
  raise notice 'PRUEBA C06b · 7: B ni ve el número previsto ni valida lo de A («%»).', left(v_falla, 90);
end $$;
reset role;

rollback;
