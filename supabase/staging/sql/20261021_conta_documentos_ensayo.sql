-- supabase/staging/sql/20261021_conta_documentos_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0100 (R15) antes del real: el fichero
-- entero y su prueba (20261021_conta_documentos_prueba.sql) dentro de UNA
-- transacción que acaba en ROLLBACK. Va primero en el manifiesto: si falla, el
-- real no se aplica. Generado copiando los ficheros tal cual.

begin;
-- ============================================================================
-- C04b · R15 · EL DOCUMENTO DE CADA ASIENTO DE VENTAS, GUARDADO EN FOLVY
-- ----------------------------------------------------------------------------
-- Julio (R15, 13/10): «Mientras Cegid activa los documentos: guarda el PDF en
-- el storage de Folvy enlazado a su asiento, con «Ver documento» en el Libro,
-- y haz «Validar y enviar a Diez» con el freno de que sin documento adjunto no
-- se da por enviada.»
--
-- Todo es NUEVO: un bucket, una tabla, dos funciones y cuatro columnas que
-- admiten nulos en external_send. Ningún dato cambia y nada del camino del
-- pedido se toca.
--
--   1. Bucket «conta-documentos», PRIVADO y solo PDF. La ruta empieza por la
--      cuenta y el asiento: <account_id>/<entry_id>/<huella>.pdf. Lo leen los
--      de la cuenta (URL firmada, de vida corta, desde el Libro); lo sube un
--      administrador o encargado de la cuenta (los mismos que validan). No hay
--      política de UPDATE ni de DELETE: un documento subido no se cambia ni se
--      borra desde la pantalla. Cada intento lleva su huella en el nombre, así
--      que reintentar nunca pisa lo que había.
--   2. journal_entry_document: el documento de un asiento (hoy, el «Resumen de
--      ventas» de un asiento de ventas de una plataforma). Uno por asiento y
--      tipo, y solo de un asiento VALIDADO: el PDF lleva su número y lo
--      validado ya no cambia, así que el documento no puede quedar viejo.
--      Lectura: los de la cuenta. Escritura: solo conta_documento_guardar.
--   3. conta_resumen_ventas(asiento): lo que lleva el PDF, leído de la base
--      con la cuenta por delante (regla 9): el asiento y sus líneas, la
--      empresa, el local, la plataforma y los pedidos del resumen.
--   4. conta_documento_guardar(asiento, ruta, huella, tamaño): enlaza el PDF
--      ya subido. Comprueba que el fichero existe en el bucket, en la ruta de
--      SU cuenta y SU asiento, con ese tamaño; que el asiento está validado y
--      es de ventas de una plataforma; y que no tiene ya otro documento (si es
--      el mismo, devuelve el que hay: nunca dos veces).
--   5. external_send: el documento que acompaña al envío y si Diez lo tiene
--      (document_status «pendiente» / «adjunto» / «fallo»). Una factura no se
--      da por «En Diez» sin «adjunto».
--
-- Vuelta atrás: supabase/vuelta-atras/20261021T0100_conta_documentos.down.sql
-- Prueba: supabase/staging/sql/20261021_conta_documentos_prueba.sql
-- ============================================================================

-- 1. El bucket ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conta-documentos', 'conta-documentos', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- La cuenta se compara como TEXTO con la carpeta: sin «::uuid» sobre el nombre,
-- un fichero de otro bucket con otra forma de ruta no hace fallar la política.
drop policy if exists conta_documentos_select on storage.objects;
create policy conta_documentos_select on storage.objects for select to authenticated
  using (bucket_id = 'conta-documentos'
         and (storage.foldername(name))[1] = any (select a::text from unnest(public.current_user_account_ids()) a));

drop policy if exists conta_documentos_insert on storage.objects;
create policy conta_documentos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'conta-documentos'
              and exists (select 1 from unnest(public.current_user_account_ids()) a
                           where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)));

-- 2. El documento de un asiento -------------------------------------------------
create table if not exists public.journal_entry_document (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  kind text not null check (kind in ('resumen_ventas')),
  storage_path text not null unique,
  file_name text not null check (file_name ~ '^[A-Za-z0-9._-]+\.pdf$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  unique (entry_id, kind)
);
create index if not exists journal_entry_document_company_idx on public.journal_entry_document (company_id, created_at desc);
comment on table public.journal_entry_document is
  'El documento de un asiento validado (R15: el Resumen de ventas de un asiento de ventas de una plataforma), en el bucket conta-documentos. Uno por asiento y tipo; no se cambia.';

alter table public.journal_entry_document enable row level security;
drop policy if exists journal_entry_document_read on public.journal_entry_document;
create policy journal_entry_document_read on public.journal_entry_document for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.journal_entry_document from anon, authenticated;
grant select on public.journal_entry_document to authenticated;

-- 3. Lo que lleva el PDF --------------------------------------------------------
create or replace function public.conta_resumen_ventas(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_d public.sales_day_summary;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary
   where entry_id = v_e.id and account_id = v_e.account_id and company_id = v_e.company_id;
  if v_d.id is null or v_d.channel_id is null then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'estado', v_e.status, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_d.sales_day, 'validado_en', v_e.validated_at,
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = v_e.company_id and c.account_id = v_e.account_id),
    'local', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id),
    'canal', (select jsonb_build_object('id', ch.id, 'slug', ch.slug, 'nombre', ch.name)
                from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'),
               'codigo', coalesce(s.platform_order_code, left(s.id::text, 8)),
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.brand b on b.id = l.brand_id and b.account_id = v_e.account_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb),
    'documento', (
      select jsonb_build_object('id', x.id, 'ruta', x.storage_path, 'nombre', x.file_name, 'sha256', x.sha256,
                                'bytes', x.size_bytes, 'creado_en', x.created_at, 'creado_por', x.created_by_name)
        from public.journal_entry_document x
       where x.entry_id = v_e.id and x.account_id = v_e.account_id and x.kind = 'resumen_ventas'));
end $$;
comment on function public.conta_resumen_ventas(uuid) is
  'R15 · Lo que lleva el Resumen de ventas de un asiento de ventas de una plataforma: asiento, líneas, empresa, local, plataforma, pedidos y su documento si lo tiene. Solo para los de la cuenta.';
revoke all on function public.conta_resumen_ventas(uuid) from public, anon;
grant execute on function public.conta_resumen_ventas(uuid) to authenticated;

-- 4. Enlazar el PDF subido ------------------------------------------------------
create or replace function public.conta_documento_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_e public.journal_entry;
  v_x public.journal_entry_document;
  v_obj record;
  v_prefijo text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el documento de un asiento.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'El documento se guarda con el asiento validado (el PDF lleva su número); este está %.', v_e.status using errcode = '23514';
  end if;
  if not exists (select 1 from public.sales_day_summary d
                  where d.entry_id = v_e.id and d.account_id = v_e.account_id and d.channel_id is not null) then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  -- Si ya tiene documento: el mismo → se devuelve el que hay; otro → no se cambia.
  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'resumen_ventas';
  if v_x.id is not null then
    if v_x.sha256 = p_sha256 and v_x.storage_path = p_ruta then
      return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', true);
    end if;
    raise exception 'Ese asiento ya tiene su documento (guardado el % por %): no se cambia.',
      to_char(v_x.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), coalesce(v_x.created_by_name, 'alguien') using errcode = '23505';
  end if;

  -- La ruta es la de SU cuenta y SU asiento, y el fichero está subido con ese tamaño.
  v_prefijo := v_e.account_id::text || '/' || v_e.id::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes, o.metadata->>'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then
    raise exception 'El documento no está subido (%): no se enlaza nada.', p_ruta using errcode = 'P0002';
  end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'El documento subido tiene % bytes y se dijeron %: no se enlaza.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'El documento subido no es un PDF (%).', v_obj.tipo using errcode = '22023';
  end if;

  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.id, 'resumen_ventas', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $$;
comment on function public.conta_documento_guardar(uuid, text, text, text, integer, text) is
  'R15 · Enlaza a su asiento validado el Resumen de ventas ya subido a conta-documentos. Comprueba ruta, fichero y tamaño; uno por asiento, y no se cambia.';
revoke all on function public.conta_documento_guardar(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_documento_guardar(uuid, text, text, text, integer, text) to authenticated;

-- 5. El documento en el envío a Diez -------------------------------------------
alter table public.external_send add column if not exists document_id uuid references public.journal_entry_document(id) on delete restrict;
alter table public.external_send add column if not exists document_status text check (document_status in ('pendiente', 'adjunto', 'fallo'));
alter table public.external_send add column if not exists document_error text;
alter table public.external_send add column if not exists document_attached_at timestamptz;
comment on column public.external_send.document_status is
  'R15 · El documento en Diez: pendiente (aún no se ha subido), adjunto (Diez lo tiene) o fallo (con document_error). Sin «adjunto», la factura no está «En Diez».';

-- conta_lectura (los agentes) lee el documento, si existe el rol (en staging no).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.journal_entry_document to conta_lectura;
  end if;
end $$;

-- Comprobación: el bucket es privado y solo PDF, y la tabla nace vacía y con RLS.
do $verif$
declare v_n int;
begin
  select count(*) into v_n from storage.buckets where id = 'conta-documentos' and public is false and allowed_mime_types = array['application/pdf'];
  if v_n <> 1 then raise exception 'R15: el bucket conta-documentos no es privado y solo PDF.'; end if;
  select count(*) into v_n from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (qual ilike '%conta-documentos%' or with_check ilike '%conta-documentos%') and cmd in ('UPDATE', 'DELETE', 'ALL');
  if v_n > 0 then raise exception 'R15: hay % política(s) que dejan cambiar o borrar en conta-documentos.', v_n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.journal_entry_document'::regclass) then
    raise exception 'R15: journal_entry_document sin RLS.';
  end if;
  raise notice 'R15: bucket conta-documentos privado (solo PDF), journal_entry_document con RLS y % fila(s).', (select count(*) from public.journal_entry_document);
end
$verif$;

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
