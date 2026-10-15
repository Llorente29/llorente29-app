-- ============================================================================
-- D01 · Tarea 4 · LAS ENTRADAS: correo, subida y la factura que sale de lo leído
-- ----------------------------------------------------------------------------
-- Todo AÑADE (una tabla y funciones nuevas). Va detrás de la 0200 y la 0210.
--
--   1. inbound_email_log: cada correo que llega a una dirección de facturas,
--      también el que no es de nadie o llega a una dirección apagada. Solo lo
--      lee y escribe el servidor (no lleva política: la ausencia es la regla).
--      Un correo (email_id) se procesa una vez.
--   2. conta_entrada_destino / conta_entrada_correo / conta_entrada_llegada:
--      lo que llama la función conta-facturas-entrada (solo service_role).
--   3. conta_subida_registrar: lo que llama la pantalla al subir (PDF o foto,
--      también desde el móvil): administrador o encargado de la cuenta, con el
--      fichero ya en receipt-uploads, en la carpeta de SU cuenta.
--   4. conta_factura_desde_lectura: de la lectura (sesión de ocr-albaran con
--      el modo factura) a la factura, por cualquier camino:
--        · el proveedor por su NIF (en la cuenta, regla 9); si no está, la
--          factura queda sin proveedor y con lo leído para darlo de alta
--          («Traída de factura · por completar»), por aclarar;
--        · repetida (misma clave de número del mismo proveedor): no se crea
--          otra, la llegada queda «repetida» con la que ya estaba;
--        · si no, la factura (en_revision), su cuadro de impuestos y sus
--          líneas, con su confianza y su porqué, y lo hecho en la actividad.
--      Nunca la apunta: proponer el asiento es de la 0230.
--   5. conta_proveedor_desde_factura: «Dar de alta» el proveedor leído.
--
-- Vuelta atrás: supabase/vuelta-atras/20261021T0220_d01_entrada.down.sql
-- Prueba: supabase/staging/sql/20261021_d01_entrada_prueba.sql
-- ============================================================================

-- 1. El registro de los correos ---------------------------------------------------
create table if not exists public.inbound_email_log (
  id uuid primary key default gen_random_uuid(),
  email_id text not null unique,
  to_address text not null,
  from_address text,
  subject text,
  company_id uuid references public.company(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  outcome text not null check (outcome in ('recibido', 'sin_facturas', 'sin_destino', 'apagada', 'error')),
  detail jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
comment on table public.inbound_email_log is
  'D01 · Cada correo que llega a una dirección de facturas, también el que no es de nadie: nada se pierde sin rastro. Solo el servidor.';
alter table public.inbound_email_log enable row level security;
revoke all on public.inbound_email_log from anon, authenticated;

-- 2. Lo que llama la función de entrada (solo el servidor) ------------------------
create or replace function public.conta_entrada_destino(p_local_part text, p_domain text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_id', a.company_id, 'account_id', a.account_id, 'activa', a.active)
    from public.company_inbound_address a
   where lower(a.local_part) = lower(p_local_part) and lower(a.domain) = lower(p_domain) and a.kind = 'facturas'
$$;
revoke all on function public.conta_entrada_destino(text, text) from public, anon, authenticated;
grant execute on function public.conta_entrada_destino(text, text) to service_role;

create or replace function public.conta_entrada_correo(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail)
  values (p->>'email_id', p->>'to', p->>'from', left(p->>'subject', 500), nullif(p->>'company_id', '')::uuid,
          (select account_id from public.company where id = nullif(p->>'company_id', '')::uuid), p->>'resultado', coalesce(p->'detalle', '{}'::jsonb))
  on conflict (email_id) do update set outcome = excluded.outcome, detail = excluded.detail;
end $$;
revoke all on function public.conta_entrada_correo(jsonb) from public, anon, authenticated;
grant execute on function public.conta_entrada_correo(jsonb) to service_role;

-- Una llegada en la bandeja. El mismo fichero (huella) en la misma cuenta, o el
-- mismo adjunto del mismo correo, devuelve la que ya estaba.
create or replace function public.conta_entrada_llegada(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid := (p->>'account_id')::uuid;
  v_emp uuid := (p->>'company_id')::uuid;
  v_id uuid; v_ya uuid;
begin
  if (select account_id from public.company where id = v_emp) is distinct from v_acc then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '22023';
  end if;
  select id into v_ya from public.document_inbox
   where (p->>'sha256' is not null and account_id = v_acc and sha256 = p->>'sha256' and status <> 'descartado')
      or (email_id = p->>'email_id' and coalesce(file_name, '') = coalesce(p->>'nombre', '') and coalesce(link_url, '') = coalesce(p->>'enlace', ''))
   limit 1;
  if v_ya is not null then return jsonb_build_object('id', v_ya, 'ya_estaba', true); end if;
  insert into public.document_inbox (account_id, company_id, channel, status, email_id, email_to, email_from, email_subject, email_received_at,
                                     link_url, file_path, file_name, mime_type, size_bytes, sha256, reason)
  values (v_acc, v_emp, coalesce(p->>'canal', 'correo'),
          case when p->>'ruta' is null and p->>'enlace' is not null then 'falta_pdf' else 'recibido' end,
          p->>'email_id', p->>'to', p->>'from', left(p->>'subject', 500), nullif(p->>'recibido', '')::timestamptz,
          p->>'enlace', p->>'ruta', p->>'nombre', p->>'tipo', nullif(p->>'bytes', '')::int, p->>'sha256',
          case when p->>'ruta' is null and p->>'enlace' is not null then 'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.' end)
  returning id into v_id;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, action, text, detail)
  values (v_acc, v_emp, v_id, 'folvy', 'recibida',
          case when p->>'ruta' is null then 'Ha llegado un correo con un enlace y sin el PDF.' else 'Ha llegado ' || coalesce(p->>'nombre', 'un documento') || ' por correo.' end,
          jsonb_build_object('de', p->>'from', 'asunto', left(p->>'subject', 200)));
  return jsonb_build_object('id', v_id, 'ya_estaba', false);
end $$;
revoke all on function public.conta_entrada_llegada(jsonb) from public, anon, authenticated;
grant execute on function public.conta_entrada_llegada(jsonb) to service_role;

-- 3. La subida desde la pantalla ---------------------------------------------------
create or replace function public.conta_subida_registrar(p_company uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes integer, p_sha256 text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare v_acc uuid; v_id uuid; v_ya uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta sube facturas.' using errcode = '42501';
  end if;
  if p_tipo not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'Solo PDF o fotos (jpg, png, webp).' using errcode = '22023'; end if;
  if p_ruta is null or left(p_ruta, 37) <> v_acc::text || '/' then raise exception 'La ruta no es de la carpeta de esta cuenta.' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'La huella del fichero no es un sha256.' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipt-uploads' and o.name = p_ruta) then
    raise exception 'El fichero no está subido (%).', p_ruta using errcode = 'P0002';
  end if;
  select id into v_ya from public.document_inbox where account_id = v_acc and sha256 = p_sha256 and status <> 'descartado' limit 1;
  if v_ya is not null then return jsonb_build_object('id', v_ya, 'ya_estaba', true); end if;
  insert into public.document_inbox (account_id, company_id, channel, file_path, file_name, mime_type, size_bytes, sha256, created_by, created_by_name)
  values (v_acc, p_company, 'subida', p_ruta, p_nombre, p_tipo, p_bytes, p_sha256, auth.uid(), p_quien_nombre)
  returning id into v_id;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, actor_name, action, text)
  values (v_acc, p_company, v_id, 'persona', coalesce(p_quien_nombre, 'Alguien de la cuenta'), 'recibida', coalesce(p_quien_nombre, 'Alguien') || ' ha subido ' || coalesce(p_nombre, 'un documento') || '.');
  return jsonb_build_object('id', v_id, 'ya_estaba', false);
end $$;
revoke all on function public.conta_subida_registrar(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.conta_subida_registrar(uuid, text, text, text, integer, text, text) to authenticated;

-- 4. De lo leído a la factura --------------------------------------------------------
create or replace function public.conta_factura_desde_lectura(p_inbox uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_in public.document_inbox;
  v_s record;
  l jsonb; f jsonb;
  v_nif text; v_prov uuid; v_rep record; v_fac uuid; v_conf text; v_texto text;
begin
  select * into v_in from public.document_inbox where id = p_inbox for update;
  if v_in.id is null then raise exception 'Esa llegada no está.' using errcode = 'P0002'; end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.current_user_is_admin_or_manager_of(v_in.account_id)) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if v_in.supplier_invoice_id is not null then
    return jsonb_build_object('estado', 'factura', 'factura_id', v_in.supplier_invoice_id, 'texto', 'Ya tenía su factura.');
  end if;
  select s.id, s.validation, s.parsed_result into v_s from public.goods_receipt_ai_session s where s.id = p_session and s.account_id = v_in.account_id;
  if v_s.id is null then raise exception 'Esa lectura no es de esta cuenta.' using errcode = 'P0002'; end if;
  l := v_s.validation->'factura';
  if l is null then raise exception 'La lectura no se hizo con el modo factura.' using errcode = '22023'; end if;
  f := l->'factura';

  -- ¿Es una factura? Sin número, ni total, ni bases, no lo es.
  if f->>'numero' is null and f->>'total' is null and coalesce(jsonb_array_length(f->'tipos'), 0) = 0 then
    update public.document_inbox set status = 'no_es_factura', ai_session_id = p_session, reason = 'No he leído número, total ni bases: no parece una factura.', updated_at = now() where id = p_inbox;
    return jsonb_build_object('estado', 'no_es_factura', 'texto', 'No parece una factura: no trae número, total ni bases.');
  end if;

  -- El proveedor, por su NIF, en la cuenta.
  v_nif := f->'proveedor'->>'nif';
  select s.id into v_prov from public.supplier s
   where s.account_id = v_in.account_id and s.archived_at is null and v_nif is not null
     and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif
   order by s.created_at limit 1;

  -- ¿Repetida?
  select * into v_rep from public.supplier_invoice_repetida(v_in.account_id, v_prov, v_nif, f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'total', '')::numeric) limit 1;
  if v_rep.nivel = 'repetida' then
    update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
           reason = 'Ya está: el mismo proveedor y el mismo número (' || coalesce(v_rep.invoice_number, '') || '). No la apunto dos veces.', updated_at = now()
     where id = p_inbox;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'repetida', 'Repetida: ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || '. No la he apuntado dos veces.');
    return jsonb_build_object('estado', 'repetida', 'factura_id', v_rep.invoice_id, 'texto', 'Ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || ': no se apunta dos veces.');
  end if;

  v_conf := case when v_prov is null then 'duda' else l->>'confianza' end;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source, ai_session_id,
                                       raw_document_url, tax_base_total, tax_total, surcharge_total, grand_total, withholding_amount,
                                       needs_review, notes, created_by_name, arrival_channel, reading, reading_confidence, inbox_id)
  values (v_in.account_id, v_in.company_id, v_prov,
          case when f->>'clase' = 'rectificativa' or nullif(f->>'total', '')::numeric < 0 then 'credit_note' else 'invoice' end,
          f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'vencimiento', '')::date, 'en_revision', 'ocr', p_session,
          v_in.file_path, nullif(f->>'base', '')::numeric, nullif(f->>'cuota', '')::numeric, nullif(f->>'recargo', '')::numeric, nullif(f->>'total', '')::numeric,
          nullif(f->'retencion'->>'importe', '')::numeric,
          v_conf <> 'seguro',
          case when v_rep.nivel = 'posible' then '¿Repetida? El mismo proveedor, la misma fecha y el mismo total que la ' || coalesce(v_rep.invoice_number, 'sin número') || '.' end,
          'Folvy', v_in.channel, l, v_conf, p_inbox)
  returning id into v_fac;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
  select v_in.account_id, v_fac, (t->>'tipo')::numeric, (t->>'base')::numeric, (t->>'cuota')::numeric, nullif(t->>'recargoTipo', '')::numeric, coalesce(nullif(t->>'recargo', '')::numeric, 0)
    from jsonb_array_elements(coalesce(f->'tipos', '[]'::jsonb)) t;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select v_fac, coalesce(x->>'raw_text', '—'), nullif(x->>'quantity', '')::numeric, nullif(x->>'unit_price_net', '')::numeric,
         nullif(x->>'line_amount', '')::numeric, nullif(x->>'vat_pct', '')::numeric, o::int
    from jsonb_array_elements(coalesce(v_s.parsed_result->'lines', '[]'::jsonb)) with ordinality as e(x, o);

  update public.document_inbox set status = 'factura', ai_session_id = p_session, supplier_invoice_id = v_fac,
         reason = case when v_prov is null then 'No tengo a este proveedor: lo doy de alta con lo leído si me dices que sí.' end, updated_at = now()
   where id = p_inbox;
  v_texto := 'He leído la ' || coalesce(f->>'numero', 'factura') || coalesce(' de ' || (f->'proveedor'->>'nombre'), '') ||
             case v_conf when 'seguro' then ': todo cuadra.' when 'probable' then ': cuadra, pero hay algo que mirar.' else ': hay algo que aclarar.' end;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
  values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'leida', v_texto, jsonb_build_object('confianza', v_conf, 'porque', l->'porque'));
  if v_prov is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'proveedor_propuesto',
            'No tengo a ' || coalesce(f->'proveedor'->>'nombre', 'este proveedor') || coalesce(' (NIF ' || v_nif || ')', '') || ': lo doy de alta con lo leído si me dices que sí.');
  end if;
  return jsonb_build_object('estado', 'factura', 'factura_id', v_fac, 'confianza', v_conf, 'texto', v_texto, 'proveedor_nuevo', v_prov is null, 'posible_repetida', v_rep.nivel = 'posible');
end $$;
revoke all on function public.conta_factura_desde_lectura(uuid, uuid) from public, anon;
grant execute on function public.conta_factura_desde_lectura(uuid, uuid) to authenticated, service_role;

-- 5. «Dar de alta» el proveedor leído ---------------------------------------------------
create or replace function public.conta_proveedor_desde_factura(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_i public.supplier_invoice; p jsonb; v_s uuid; v_nif text;
begin
  select * into v_i from public.supplier_invoice where id = p_invoice for update;
  if v_i.id is null or not public.current_user_is_admin_or_manager_of(v_i.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if v_i.supplier_id is not null then return jsonb_build_object('supplier_id', v_i.supplier_id, 'ya_estaba', true); end if;
  p := v_i.reading->'factura'->'proveedor';
  v_nif := p->>'nif';
  if coalesce(p->>'nombre', '') = '' then raise exception 'No leí el nombre del proveedor: dalo de alta a mano.' using errcode = '22023'; end if;
  -- Si entretanto alguien lo dio de alta con ese NIF, se usa ese.
  select id into v_s from public.supplier s where s.account_id = v_i.account_id and s.archived_at is null and v_nif is not null
     and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif limit 1;
  if v_s is null then
    insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_from, created_by, created_by_name)
    values (v_i.account_id, p->>'nombre', p->>'nombre', v_nif, true, 'factura', auth.uid(), p_quien_nombre)
    returning id into v_s;
  end if;
  update public.supplier_invoice set supplier_id = v_s where id = p_invoice;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
  values (v_i.account_id, v_i.company_id, v_i.inbox_id, p_invoice, 'persona', coalesce(p_quien_nombre, 'Alguien de la cuenta'), 'corregida',
          coalesce(p_quien_nombre, 'Alguien') || ' ha dado de alta a ' || (p->>'nombre') || ' con lo leído en la factura (por completar).');
  return jsonb_build_object('supplier_id', v_s, 'ya_estaba', false);
end $$;
revoke all on function public.conta_proveedor_desde_factura(uuid, text) from public, anon;
grant execute on function public.conta_proveedor_desde_factura(uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.inbound_email_log to conta_lectura; end if;
end $$;
