-- supabase/staging/sql/20261021_conta_documentos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0100 (R15): el bucket conta-documentos,
-- public.journal_entry_document, public.conta_resumen_ventas,
-- public.conta_documento_guardar y las columnas document_* de
-- public.external_send. Todo en una transacción con ROLLBACK.
--
-- Por sus CAMINOS, como la persona que lo va a usar (regla 10):
--   1. Un día de Glovo de la empresa A (17/09: 24,20 con base 22,00 y 13,20
--      sin base, de Casa Lola), propuesto por el cierre del día.
--   2. Como administrador de A: conta_resumen_ventas devuelve el asiento,
--      sus líneas (con la 430), la plataforma, la empresa y los 2 pedidos.
--   3. Guardar el documento de un asiento PROPUESTO: no.
--   4. Se valida (journal_entry_validar, como administrador).
--   5. Guardar sin fichero subido: no. Subir a la carpeta de OTRA cuenta: no
--      (RLS de storage). Subir a la suya: sí.
--   6. Guardar con otro tamaño, con otra ruta: no. Bien: sí. Otra vez lo
--      mismo: devuelve el que hay (ya_estaba). Otro documento: no.
--   7. Escribir en journal_entry_document directamente: no.
--   8. Como administrador de B (otra cuenta): ni el resumen, ni la fila, ni
--      el fichero.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R15: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · Lo que crea la migración ───────────────────────────────────────────
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'conta-documentos' and public is false) then
    raise exception 'PRUEBA R15 · 0: falta el bucket conta-documentos privado.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('conta_documentos_select', 'conta_documentos_insert')) <> 2 then
    raise exception 'PRUEBA R15 · 0: faltan las políticas de storage.objects.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'external_send'
       and column_name in ('document_id', 'document_status', 'document_error', 'document_attached_at')) <> 4 then
    raise exception 'PRUEBA R15 · 0: faltan columnas document_* en external_send.';
  end if;
  raise notice 'PRUEBA R15 · 0: bucket privado, 2 políticas, journal_entry_document y external_send.document_*: ok.';
end $$;

-- ── 1 · Un día de Glovo de A, propuesto ────────────────────────────────────
do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  h       constant interval := interval '13 hours';
  v_e uuid; v_s uuid; v_entry uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if exists (select 1 from public.sale where account_id = v_acc and location_id = v_loc
              and (sold_at at time zone 'Europe/Madrid')::date = '2026-09-17') then
    raise exception 'PRUEBA R15 · 1: A ya tiene ventas el 17/09 en ese local; la prueba no mediría lo que dice.';
  end if;
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_glovo, ('2026-09-17'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 24.20, 22.00, 2.20, 'hubrise', 'R15-1701', true);
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_glovo, ('2026-09-17'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 13.20, null, null, 'hubrise', 'R15-1702', true)
  returning id into v_s;
  perform public.conta_proponer_dias(v_e, now());
  select d.entry_id into v_entry from public.sales_day_summary d
   where d.account_id = v_acc and d.company_id = v_e and v_s = any (d.sale_ids);
  if v_entry is null then raise exception 'PRUEBA R15 · 1: el cierre del día no ha propuesto el 17/09 de Glovo.'; end if;
  perform set_config('prueba.entry', v_entry::text, true);
  perform set_config('prueba.acc', v_acc::text, true);
  raise notice 'PRUEBA R15 · 1: el 17/09 de Glovo de A, propuesto (asiento %).', v_entry;
end $$;

-- ── 2 y 3 · Como administrador de A: el resumen; guardar sin validar, no ───
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_entry uuid := current_setting('prueba.entry')::uuid;
  r jsonb;
begin
  r := public.conta_resumen_ventas(v_entry);
  if r->>'estado' <> 'propuesto' or jsonb_array_length(r->'pedidos') <> 2 or r->'canal'->>'slug' is null
     or not exists (select 1 from jsonb_array_elements(r->'lineas') l where l->>'cuenta' like '430%' and (l->>'debe')::numeric = 37.40)
     or r->'empresa'->>'nombre' is null or r->'documento' <> 'null'::jsonb then
    raise exception 'PRUEBA R15 · 2: el resumen no es el esperado: %', r;
  end if;
  raise notice 'PRUEBA R15 · 2: resumen de A como su administrador: % pedidos, % líneas, canal %, cobro 430 al debe 37,40.',
    jsonb_array_length(r->'pedidos'), jsonb_array_length(r->'lineas'), r->'canal'->>'slug';
  begin
    perform public.conta_documento_guardar(v_entry, 'x', 'x.pdf', repeat('a', 64), 10, 'Prueba');
    raise exception 'PRUEBA R15 · 3: ha dejado guardar el documento de un asiento propuesto.';
  exception when sqlstate '23514' then
    raise notice 'PRUEBA R15 · 3: guardar el documento de un propuesto: no (%).', sqlerrm;
  end;
end $$;

-- ── 4 · Se valida ───────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.journal_entry_validar(current_setting('prueba.entry')::uuid, 'Prueba R15');
  raise notice 'PRUEBA R15 · 4: validado: %', v;
end $$;

-- ── 5 · Subir: a otra cuenta no, a la suya sí ──────────────────────────────
do $$
declare
  v_entry uuid := current_setting('prueba.entry')::uuid;
  v_acc text := current_setting('prueba.acc');
  v_ruta text := v_acc || '/' || v_entry || '/0123456789abcdef.pdf';
begin
  begin
    perform public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas.pdf', repeat('a', 64), 1234, 'Prueba');
    raise exception 'PRUEBA R15 · 5: ha enlazado un documento que no está subido.';
  exception when sqlstate 'P0002' then
    raise notice 'PRUEBA R15 · 5: enlazar sin fichero subido: no (%).', sqlerrm;
  end;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('conta-documentos', 'c01b0000-0000-4000-8000-00000000000b/' || v_entry || '/0123456789abcdef.pdf', '{"size": 1234, "mimetype": "application/pdf"}');
    raise exception 'PRUEBA R15 · 5: ha dejado subir a la carpeta de otra cuenta.';
  exception when insufficient_privilege then
    raise notice 'PRUEBA R15 · 5: subir a la carpeta de otra cuenta: no (%).', sqlerrm;
  end;
  insert into storage.objects (bucket_id, name, metadata)
  values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  raise notice 'PRUEBA R15 · 5: subir a la suya: sí.';
end $$;

-- ── 6 y 7 · Enlazar: mal no, bien sí, dos veces no ─────────────────────────
do $$
declare
  v_entry uuid := current_setting('prueba.entry')::uuid;
  v_acc text := current_setting('prueba.acc');
  v_ruta text := v_acc || '/' || v_entry || '/0123456789abcdef.pdf';
  v_sha text := repeat('ab', 32);
  r jsonb;
begin
  begin
    perform public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas.pdf', v_sha, 999, 'Prueba');
    raise exception 'PRUEBA R15 · 6: ha enlazado con otro tamaño.';
  exception when sqlstate '22023' then raise notice 'PRUEBA R15 · 6: con otro tamaño: no (%).', sqlerrm; end;
  begin
    perform public.conta_documento_guardar(v_entry, 'c01b0000-0000-4000-8000-00000000000b/' || v_entry || '/0123456789abcdef.pdf', 'ResumenDeVentas.pdf', v_sha, 1234, 'Prueba');
    raise exception 'PRUEBA R15 · 6: ha enlazado una ruta de otra cuenta.';
  exception when sqlstate '22023' then raise notice 'PRUEBA R15 · 6: con la ruta de otra cuenta: no (%).', sqlerrm; end;
  r := public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas.pdf', v_sha, 1234, 'Prueba');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA R15 · 6: el primero dice que ya estaba.'; end if;
  r := public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas.pdf', v_sha, 1234, 'Prueba');
  if not (r->>'ya_estaba')::boolean then raise exception 'PRUEBA R15 · 6: el mismo dos veces no dice que ya estaba.'; end if;
  begin
    perform public.conta_documento_guardar(v_entry, v_ruta, 'ResumenDeVentas.pdf', repeat('cd', 32), 1234, 'Prueba');
    raise exception 'PRUEBA R15 · 6: ha cambiado el documento de un asiento.';
  exception when unique_violation then raise notice 'PRUEBA R15 · 6: otro documento para el mismo asiento: no (%).', sqlerrm; end;
  if (public.conta_resumen_ventas(v_entry)->'documento'->>'ruta') is distinct from v_ruta then
    raise exception 'PRUEBA R15 · 6: el resumen no trae el documento enlazado.';
  end if;
  raise notice 'PRUEBA R15 · 6: enlazado una vez; el mismo otra vez devuelve el que hay; el resumen lo trae.';
  begin
    insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes)
    select account_id, company_id, id, 'resumen_ventas', 'x/y.pdf', 'y.pdf', repeat('ef', 32), 1 from public.journal_entry where id = v_entry;
    raise exception 'PRUEBA R15 · 7: ha dejado escribir en journal_entry_document directamente.';
  exception when insufficient_privilege then raise notice 'PRUEBA R15 · 7: escribir en la tabla directamente: no (%).', sqlerrm; end;
end $$;
reset role;

-- ── 8 · Como administrador de B: nada de A ─────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_entry uuid := current_setting('prueba.entry')::uuid;
begin
  begin
    perform public.conta_resumen_ventas(v_entry);
    raise exception 'PRUEBA R15 · 8: B ha leído el resumen de A.';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.journal_entry_document where entry_id = v_entry) then raise exception 'PRUEBA R15 · 8: B ve la fila del documento de A.'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'conta-documentos') then raise exception 'PRUEBA R15 · 8: B ve ficheros de A en el bucket.'; end if;
  raise notice 'PRUEBA R15 · 8: B no lee el resumen, ni la fila, ni el fichero de A.';
end $$;
reset role;

rollback;
