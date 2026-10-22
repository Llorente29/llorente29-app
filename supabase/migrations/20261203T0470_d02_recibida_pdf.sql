-- supabase/migrations/20261203T0470_d02_recibida_pdf.sql
-- cambia: public.conta_documento_factura_guardar · prueba: supabase/staging/sql/20261203_d02_recibida_pdf_prueba.sql
--
-- D02 · TODA FACTURA RECIBIDA TIENE SU PDF DESDE QUE ENTRA (Julio, 22/10).
--
-- Hoy una recibida que llega como foto (JPG o PNG) solo tiene PDF si alguien
-- pulsa «Apuntar» en la revisión de facturas: es la pantalla la que convierte
-- la foto. Validada desde el libro, o sin pantalla abierta, se queda sin PDF y
-- Diez no la recibe («falta el documento»): EUROPASTRY 24048027. Con esto el
-- PDF lo hace el servidor cuando entra la foto, venga por donde venga (correo,
-- OCR, subida o la foto de la recepción), tenga la empresa «Enviar a Diez» o no:
--
--   1. conta_recibida_pdf, una fila por recibida: dónde está su PDF (en
--      conta-documentos, <cuenta>/recibidas/<factura>/<huella>.pdf), o por qué
--      no se ha podido hacer todavía y cuándo se reintenta (a los 15 minutos,
--      como mucho 3 veces). Nada se pierde en silencio.
--   2. Lo que falta por convertir: las recibidas no descartadas cuyo original
--      es una foto y no tienen PDF (conta_recibida_pdf_por_hacer), y cómo se
--      cogen sin que las coja otra pasada (conta_recibida_pdf_reclamar).
--      Con varias páginas en la lectura, todas, en su orden.
--   3. Apuntar lo hecho (conta_recibida_pdf_hecho: comprueba que el PDF está
--      subido donde debe, con su huella y su tamaño) o lo que ha fallado
--      (conta_recibida_pdf_fallo).
--   4. Enlazar el PDF al asiento validado de la recibida, que es lo que lee el
--      envío a Diez (conta_recibida_pdf_por_enlazar y _enlazar): el PDF hecho
--      en el paso 1 o, si el original ya era un PDF, ese. Al enlazarlo, si su
--      envío a Diez esperaba por el documento, se le despierta (next_try_at
--      ahora): EUROPASTRY sale sola.
--   5. Para que el servidor pueda enlazar, conta_documento_factura_guardar
--      admite también la clave de servicio (auth.role() = 'service_role'), la
--      misma condición que la 0450 puso en conta_resumen_ventas y
--      conta_recibida_envio. Nada más cambia en ella: el cuerpo es el de
--      producción (md5 dbc3443e…, medido el 22/10) con esa condición en sus dos
--      comprobaciones de quién llama. La vuelta atrás la devuelve byte a byte.
--   6. conta_recibida_pdf_despertar y su cron de un minuto: solo llama a la
--      función conta-recibida-pdf si hay algo que hacer. Solo en producción
--      (necesita el cron_secret del Vault, que staging no tiene).
--
-- La primera pasada hace también las que ya hay: las 8 fotos de Foodint sin PDF
-- (medido el 22/10, solo lectura; ninguna en otras cuentas) y enlaza la única
-- con asiento validado, EUROPASTRY.
--
-- Solo añade, salvo esa función (misma firma). No toca ninguna fila al
-- aplicarse. Nada del camino del pedido: supplier_invoice, journal_entry y
-- los documentos no los toca ningún pedido. No toca coste ni stock (regla 10:
-- sin sus cuatro caminos).

-- 1. El PDF de cada recibida ------------------------------------------------------
create table if not exists public.conta_recibida_pdf (
  invoice_id uuid primary key references public.supplier_invoice(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  storage_path text,
  sha256 text,
  size_bytes integer,
  pages integer,
  made_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  next_try_at timestamptz,
  link_attempts integer not null default 0,
  link_error text,
  link_next_try_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conta_recibida_pdf_completo check ((storage_path is null) = (sha256 is null) and (storage_path is null) = (size_bytes is null) and (storage_path is null) = (made_at is null))
);
comment on table public.conta_recibida_pdf is
  'D02 · El PDF de cada factura recibida que llegó como foto, hecho por el servidor al entrar (conta-recibida-pdf): dónde está en conta-documentos, o por qué no se ha podido hacer y cuándo se reintenta. Y si no se ha podido enlazar a su asiento validado, por qué.';
alter table public.conta_recibida_pdf enable row level security;
revoke all on table public.conta_recibida_pdf from public, anon, authenticated;
grant select on table public.conta_recibida_pdf to authenticated;
drop policy if exists conta_recibida_pdf_leer on public.conta_recibida_pdf;
create policy conta_recibida_pdf_leer on public.conta_recibida_pdf for select to authenticated
  using (public.belongs_to_account(account_id));

-- 2. Lo que falta por convertir ---------------------------------------------------
-- El original es supplier_invoice.raw_document_url (en receipt-uploads) o, si no
-- lo tiene, el fichero de su entrada (document_inbox). Es una foto por su
-- extensión o por lo que dice el almacén. Si su lectura tiene varias páginas, y
-- todas son fotos y el original es una de ellas, van todas, en su orden.
create or replace function public.conta_recibida_pdf_por_hacer(p_limite integer default 20)
returns table (invoice_id uuid, account_id uuid, ficheros jsonb)
language sql stable security definer set search_path = public, storage as $$
  with base as (
    select i.id, i.account_id, i.created_at,
           coalesce(i.raw_document_url, d.file_path) as original,
           case when i.raw_document_url is not null then 'receipt-uploads' else d.file_bucket end as bucket,
           a.input_files
      from public.supplier_invoice i
      left join public.document_inbox d on d.id = i.inbox_id and d.account_id = i.account_id
      left join public.goods_receipt_ai_session a on a.id = i.ai_session_id
     where i.discarded_at is null
  ), fotos as (
    select b.id, b.account_id, b.created_at,
           case when jsonb_typeof(b.input_files) = 'array' and jsonb_array_length(b.input_files) > 1
                 and not exists (select 1 from jsonb_array_elements(b.input_files) f where coalesce(f ->> 'path', f #>> '{}') !~* '\.(jpe?g|png)$')
                 and exists (select 1 from jsonb_array_elements(b.input_files) f where coalesce(f ->> 'path', f #>> '{}') = b.original)
                then (select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'ruta', coalesce(t.f ->> 'path', t.f #>> '{}')) order by t.n)
                        from jsonb_array_elements(b.input_files) with ordinality as t(f, n))
                else jsonb_build_array(jsonb_build_object('bucket', b.bucket, 'ruta', b.original))
           end as ficheros
      from base b
     where b.original is not null and b.bucket is not null
       and (b.original ~* '\.(jpe?g|png)$'
            or exists (select 1 from storage.objects o where o.bucket_id = b.bucket and o.name = b.original and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png')))
  )
  select f.id, f.account_id, f.ficheros
    from fotos f
    left join public.conta_recibida_pdf r on r.invoice_id = f.id
   where r.storage_path is null
     and (r.invoice_id is null or (r.attempts < 3 and (r.next_try_at is null or r.next_try_at <= now())))
   order by f.created_at, f.id
   limit greatest(1, least(coalesce(p_limite, 20), 50))
$$;
comment on function public.conta_recibida_pdf_por_hacer(integer) is
  'D02 · Las recibidas no descartadas cuyo original es una foto (JPG o PNG) y aún no tienen PDF, con sus fotos en orden; sin las que ya fallaron 3 veces ni las que esperan su reintento. Solo el servidor.';
revoke all on function public.conta_recibida_pdf_por_hacer(integer) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_por_hacer(integer) to service_role;

-- Cogerlas para convertirlas: las aparta 10 minutos. Si la pasada se corta,
-- se vuelven a coger entonces; si acaba, _hecho o _fallo ponen lo bueno.
create or replace function public.conta_recibida_pdf_reclamar(p_limite integer default 20)
returns table (invoice_id uuid, account_id uuid, ficheros jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform pg_advisory_xact_lock(hashtext('conta_recibida_pdf_reclamar'));
  create temp table if not exists _d02_reclamo (invoice_id uuid, account_id uuid, ficheros jsonb) on commit drop;
  truncate _d02_reclamo;
  insert into _d02_reclamo select * from public.conta_recibida_pdf_por_hacer(p_limite);
  insert into public.conta_recibida_pdf as r (invoice_id, account_id, next_try_at)
  select c.invoice_id, c.account_id, now() + interval '10 minutes' from _d02_reclamo c
  on conflict (invoice_id) do update set next_try_at = now() + interval '10 minutes', updated_at = now();
  return query select c.invoice_id, c.account_id, c.ficheros from _d02_reclamo c;
end $$;
comment on function public.conta_recibida_pdf_reclamar(integer) is
  'D02 · Coge las fotos que faltan por convertir (conta_recibida_pdf_por_hacer) y las aparta 10 minutos para que no las coja otra pasada. Solo el servidor (conta-recibida-pdf).';
revoke all on function public.conta_recibida_pdf_reclamar(integer) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_reclamar(integer) to service_role;

-- 3. Lo hecho y lo que ha fallado -------------------------------------------------
create or replace function public.conta_recibida_pdf_hecho(p_invoice uuid, p_ruta text, p_sha256 text, p_bytes integer, p_paginas integer)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_i public.supplier_invoice;
  v_r public.conta_recibida_pdf;
  v_prefijo text;
  v_obj record;
begin
  select * into v_i from public.supplier_invoice where id = p_invoice;
  if v_i.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del PDF no es un sha256.' using errcode = '22023';
  end if;
  v_prefijo := v_i.account_id::text || '/recibidas/' || v_i.id::text || '/';
  if p_ruta is distinct from v_prefijo || left(p_sha256, 16) || '.pdf' then
    raise exception 'La ruta del PDF no es la de esta factura (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  if p_paginas is null or p_paginas < 1 then raise exception 'Un PDF tiene al menos una página.' using errcode = '22023'; end if;
  select o.name, (o.metadata ->> 'size')::bigint as bytes, o.metadata ->> 'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then raise exception 'El PDF no está subido (%): no se apunta nada.', p_ruta using errcode = 'P0002'; end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'El PDF subido tiene % bytes y se dijeron %: no se apunta.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'Lo subido no es un PDF (%).', v_obj.tipo using errcode = '22023';
  end if;
  select * into v_r from public.conta_recibida_pdf where invoice_id = v_i.id for update;
  if v_r.storage_path is not null then
    if v_r.storage_path = p_ruta then return jsonb_build_object('ruta', v_r.storage_path, 'ya_estaba', true); end if;
    raise exception 'Esa factura ya tiene su PDF: no se cambia.' using errcode = '23505';
  end if;
  insert into public.conta_recibida_pdf as r (invoice_id, account_id, storage_path, sha256, size_bytes, pages, made_at, last_error, next_try_at)
  values (v_i.id, v_i.account_id, p_ruta, p_sha256, p_bytes, p_paginas, now(), null, null)
  on conflict (invoice_id) do update
    set storage_path = excluded.storage_path, sha256 = excluded.sha256, size_bytes = excluded.size_bytes, pages = excluded.pages,
        made_at = excluded.made_at, last_error = null, next_try_at = null, updated_at = now();
  return jsonb_build_object('ruta', p_ruta, 'ya_estaba', false);
end $$;
comment on function public.conta_recibida_pdf_hecho(uuid, text, text, integer, integer) is
  'D02 · Apunta el PDF hecho de una recibida, si está subido en conta-documentos en <cuenta>/recibidas/<factura>/<huella>.pdf con ese tamaño. No cambia uno que ya tenga. Solo el servidor.';
revoke all on function public.conta_recibida_pdf_hecho(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_hecho(uuid, text, text, integer, integer) to service_role;

create or replace function public.conta_recibida_pdf_fallo(p_invoice uuid, p_motivo text, p_enlace boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_i public.supplier_invoice;
  v_m text := left(coalesce(nullif(trim(p_motivo), ''), 'sin motivo'), 300);
begin
  select * into v_i from public.supplier_invoice where id = p_invoice;
  if v_i.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if coalesce(p_enlace, false) then
    insert into public.conta_recibida_pdf as r (invoice_id, account_id, link_attempts, link_error, link_next_try_at)
    values (v_i.id, v_i.account_id, 1, v_m, now() + interval '15 minutes')
    on conflict (invoice_id) do update
      set link_attempts = r.link_attempts + 1, link_error = v_m, link_next_try_at = now() + interval '15 minutes', updated_at = now();
  else
    insert into public.conta_recibida_pdf as r (invoice_id, account_id, attempts, last_error, next_try_at)
    values (v_i.id, v_i.account_id, 1, v_m, now() + interval '15 minutes')
    on conflict (invoice_id) do update
      set attempts = r.attempts + 1, last_error = v_m, next_try_at = now() + interval '15 minutes', updated_at = now();
  end if;
end $$;
comment on function public.conta_recibida_pdf_fallo(uuid, text, boolean) is
  'D02 · Apunta por qué no se ha podido hacer (o enlazar, con p_enlace) el PDF de una recibida, y su reintento a los 15 minutos. Al tercer intento no se reintenta más: queda el motivo. Solo el servidor.';
revoke all on function public.conta_recibida_pdf_fallo(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_fallo(uuid, text, boolean) to service_role;

-- 4. Enlazarlo al asiento ---------------------------------------------------------
-- Los asientos validados de una recibida sin su PDF enlazado (validados hace
-- más de 2 minutos: si los valida «Apuntar», la pantalla guarda el suyo), con
-- el PDF de donde sale: el hecho aquí o el original, si ya era un PDF. El
-- nombre lo limpia journal_entry_document_nombre_limpio.
create or replace function public.conta_recibida_pdf_por_enlazar(p_limite integer default 20)
returns table (entry_id uuid, account_id uuid, invoice_id uuid, bucket text, ruta text, nombre text)
language sql stable security definer set search_path = public, storage as $$
  select e.id, e.account_id, i.id,
         case when r.storage_path is not null then 'conta-documentos' else src.bucket end,
         coalesce(r.storage_path, src.original),
         left(coalesce(nullif(trim(coalesce(s.name, i.issuer_name, '')), ''), 'factura') || coalesce(' ' || nullif(trim(i.invoice_number), ''), ''), 120) || '.pdf'
    from public.journal_entry e
    join public.supplier_invoice i on i.id = e.source_id and i.account_id = e.account_id
    left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
    left join public.document_inbox d on d.id = i.inbox_id and d.account_id = i.account_id
    left join public.conta_recibida_pdf r on r.invoice_id = i.id
    cross join lateral (
      select coalesce(i.raw_document_url, d.file_path) as original,
             case when i.raw_document_url is not null then 'receipt-uploads' else d.file_bucket end as bucket
    ) src
   where e.source_type = 'supplier_invoice' and e.status = 'validado'
     and e.validated_at < now() - interval '2 minutes'
     and not exists (select 1 from public.journal_entry_document x where x.entry_id = e.id and x.kind = 'factura_recibida')
     and (r.storage_path is not null
          or (src.original is not null and src.bucket is not null
              and (src.original ~* '\.pdf$'
                   or exists (select 1 from storage.objects o where o.bucket_id = src.bucket and o.name = src.original and o.metadata ->> 'mimetype' = 'application/pdf'))))
     and (r.invoice_id is null or (r.link_attempts < 3 and (r.link_next_try_at is null or r.link_next_try_at <= now())))
   order by e.validated_at, e.id
   limit greatest(1, least(coalesce(p_limite, 20), 50))
$$;
comment on function public.conta_recibida_pdf_por_enlazar(integer) is
  'D02 · Los asientos validados de una recibida que no tienen su PDF enlazado, con el PDF de donde sale (el hecho por el servidor, o el original si ya era un PDF). Solo el servidor.';
revoke all on function public.conta_recibida_pdf_por_enlazar(integer) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_por_enlazar(integer) to service_role;

create or replace function public.conta_recibida_pdf_enlazar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_e public.journal_entry;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el servidor enlaza el PDF de una recibida por aquí.' using errcode = '42501';
  end if;
  v := public.conta_documento_factura_guardar(p_entry, p_ruta, p_nombre, p_sha256, p_bytes, 'automático');
  select * into v_e from public.journal_entry where id = p_entry;
  update public.conta_recibida_pdf set link_error = null, link_next_try_at = null, updated_at = now()
   where invoice_id = v_e.source_id and account_id = v_e.account_id;
  -- Si su envío a Diez esperaba por el documento, que salga ya (EUROPASTRY).
  update public.external_send set next_try_at = now()
   where entry_id = p_entry and account_id = v_e.account_id and status = 'pendiente' and last_error = 'falta el documento';
  return v;
end $$;
comment on function public.conta_recibida_pdf_enlazar(uuid, text, text, text, integer) is
  'D02 · Enlaza el PDF de una recibida a su asiento validado (con conta_documento_factura_guardar, como el servidor) y, si su envío a Diez esperaba por el documento, lo despierta. Solo el servidor.';
revoke all on function public.conta_recibida_pdf_enlazar(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.conta_recibida_pdf_enlazar(uuid, text, text, text, integer) to service_role;

-- 5. conta_documento_factura_guardar, también para el servidor ---------------------
-- El cuerpo de producción (md5 dbc3443e…, 22/10) con «or auth.role() =
-- 'service_role'» en sus dos comprobaciones de quién llama. Nada más.
create or replace function public.conta_documento_factura_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'storage'
as $function$
declare
  v_e public.journal_entry;
  v_x public.journal_entry_document;
  v_obj record;
  v_prefijo text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if not (public.current_user_is_admin_or_manager_of(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el documento de un asiento.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'El documento se guarda con el asiento validado; este está %.', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type <> 'supplier_invoice' or not exists (select 1 from public.supplier_invoice i where i.id = v_e.source_id and i.account_id = v_e.account_id) then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'factura_recibida';
  if v_x.id is not null then
    if v_x.sha256 = p_sha256 and v_x.storage_path = p_ruta then
      return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', true);
    end if;
    raise exception 'Ese asiento ya tiene su factura (guardada el % por %): no se cambia.',
      to_char(v_x.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), coalesce(v_x.created_by_name, 'alguien') using errcode = '23505';
  end if;

  v_prefijo := v_e.account_id::text || '/' || v_e.id::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes, o.metadata->>'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then
    raise exception 'La factura no está subida (%): no se enlaza nada.', p_ruta using errcode = 'P0002';
  end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'La factura subida tiene % bytes y se dijeron %: no se enlaza.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'La factura subida no es un PDF (%): una foto se convierte a PDF antes.', v_obj.tipo using errcode = '22023';
  end if;

  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.id, 'factura_recibida', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $function$;

-- 6. Despertar al servidor cuando hay algo que hacer ------------------------------
create or replace function public.conta_recibida_pdf_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  if not exists (select 1 from public.conta_recibida_pdf_por_hacer(1))
     and not exists (select 1 from public.conta_recibida_pdf_por_enlazar(1)) then
    return;
  end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-recibida-pdf.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-recibida-pdf',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_recibida_pdf_despertar() is
  'D02 · Cada minuto (cron conta-recibida-pdf-despertar, solo en producción): si hay alguna foto de recibida sin PDF o algún PDF sin enlazar a su asiento, llama a conta-recibida-pdf. Si falta el secreto, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_recibida_pdf_despertar() from public, anon, authenticated;

-- Solo donde está el secreto de los vigías (producción); en staging se llama a la función a mano.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'conta-recibida-pdf-despertar') then
      perform cron.unschedule('conta-recibida-pdf-despertar');
    end if;
    perform cron.schedule('conta-recibida-pdf-despertar', '* * * * *', $cron$select public.conta_recibida_pdf_despertar()$cron$);
  end if;
end $$;

-- conta_lectura (los agentes) lee la tabla, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_recibida_pdf to conta_lectura;
  end if;
end $$;
