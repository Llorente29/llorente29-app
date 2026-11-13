-- supabase/migrations/20261113T1504_s01p_correo_por_aclarar.sql
--
-- S01p·20 · 1 · El lector de correos no descarta en silencio (regla 8; Julio, 13/11).
--
-- El 01/11 entraron por facturas-foodint@ 11 correos «Just-eat invoice» que el lector
-- de aquella mañana no entendió (los de saldo negativo, que aprendió el #428 a las
-- 16:22, y tres de antes de que existiera la ruta de Just Eat por facturas@): quedaron
-- en inbound_email_log como «sin_facturas», con «tomados: 0», y ninguna pantalla lo dijo.
--
-- Desde ahora, un correo de una plataforma (Just Eat, Uber, Glovo, Deliveroo) del que
-- no sale ni una factura ni una liquidación deja una fila en la bandeja: sale en
-- Documentos › «Por aclarar», con el asunto y el porqué («No he encontrado la factura
-- en el correo.»), y con «Volver a leer» y «Subir el PDF a mano».
--
-- SOLO AÑADE tres funciones. No cambia ninguna que exista, ni la lista de Documentos
-- (la fila ya sale por ser de la bandeja sin factura, y el asunto lo lee la pantalla).
--
--   1. conta_entrada_sin_factura(p): la fila «por aclarar» de un correo (la llama la
--      función de entrada con la clave de servicio). Una sola por correo: si ya está,
--      la devuelve. Lo que no traiga p (asunto, remitente, cuándo) lo toma del
--      registro de entrada de ese correo.
--   2. conta_entrada_sin_factura_resuelta(empresa, correo): al volver a leer el correo
--      y entrar, su fila sale de «Por aclarar» (pasa a descartada, con su porqué y su
--      actividad). No borra nada.
--   3. conta_correo_sin_factura_pdf(…): «Subir el PDF a mano» de esa fila; el fichero
--      va a la misma fila y queda recibido, para leerlo (como «Subir el PDF» de la que
--      traía un enlace, conta_llegada_pdf_subido, que no se toca).
--
-- La fila usa el estado 'error' de document_inbox (ya admitido), sin fichero ni enlace.

create or replace function public.conta_entrada_sin_factura(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p->>'company_id')::uuid;
  v_acc uuid;
  v_correo text := nullif(btrim(p->>'email_id'), '');
  v_porque text := coalesce(nullif(btrim(p->>'porque'), ''), 'No he encontrado la factura en el correo.');
  v_log public.inbound_email_log;
  v_id uuid;
begin
  select account_id into v_acc from public.company where id = v_emp;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if p ? 'account_id' and (p->>'account_id')::uuid is distinct from v_acc then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '22023';
  end if;
  if v_correo is null then raise exception 'Falta el correo.' using errcode = '22023'; end if;

  -- Una por correo: la que ya está (sin fichero, sin enlace y sin factura) se devuelve.
  select id into v_id from public.document_inbox
   where account_id = v_acc and email_id = v_correo and status = 'error' and file_path is null and link_url is null
   limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'ya_estaba', true); end if;

  select * into v_log from public.inbound_email_log
   where email_id = v_correo and (company_id = v_emp or account_id = v_acc)
   order by received_at desc limit 1;

  insert into public.document_inbox (account_id, company_id, channel, status, email_id, email_to, email_from, email_subject, email_received_at, reason)
  values (v_acc, v_emp, 'correo', 'error', v_correo,
          coalesce(p->>'to', v_log.to_address), coalesce(p->>'from', v_log.from_address),
          left(coalesce(p->>'subject', v_log.subject), 500),
          coalesce(nullif(p->>'recibido', '')::timestamptz, v_log.received_at),
          v_porque)
  returning id into v_id;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, action, text, detail)
  values (v_acc, v_emp, v_id, 'folvy', 'recibida',
          'Ha llegado un correo del que no he sacado ninguna factura: ' || v_porque,
          jsonb_build_object('de', coalesce(p->>'from', v_log.from_address), 'asunto', left(coalesce(p->>'subject', v_log.subject), 200), 'email_id', v_correo));
  return jsonb_build_object('id', v_id, 'ya_estaba', false);
end $$;
revoke all on function public.conta_entrada_sin_factura(jsonb) from public, anon, authenticated;
grant execute on function public.conta_entrada_sin_factura(jsonb) to service_role;
comment on function public.conta_entrada_sin_factura(jsonb) is
  'S01p·20 · 1. La fila «por aclarar» de un correo de plataforma del que no salió nada (regla 8): una por correo.';

create or replace function public.conta_entrada_sin_factura_resuelta(p_company uuid, p_email_id text, p_texto text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_n integer := 0; v_id uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  for v_id in
    update public.document_inbox
       set status = 'descartado', reason = 'Resuelta: el correo se ha vuelto a leer y ha entrado.', updated_at = now()
     where account_id = v_acc and email_id = p_email_id and status = 'error' and file_path is null and link_url is null
    returning id
  loop
    v_n := v_n + 1;
    insert into public.document_activity (account_id, company_id, inbox_id, actor, action, text, detail)
    values (v_acc, p_company, v_id, 'folvy', 'descartada',
            coalesce(nullif(btrim(p_texto), ''), 'Se ha vuelto a leer el correo y ha entrado.') ,
            jsonb_build_object('email_id', p_email_id));
  end loop;
  return v_n;
end $$;
revoke all on function public.conta_entrada_sin_factura_resuelta(uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_entrada_sin_factura_resuelta(uuid, text, text) to service_role;
comment on function public.conta_entrada_sin_factura_resuelta(uuid, text, text) is
  'S01p·20 · 1. Al volver a leer el correo y entrar, su fila sale de «Por aclarar» (descartada, con su actividad). No borra nada.';

create or replace function public.conta_correo_sin_factura_pdf(p_inbox uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes integer, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.document_inbox;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado sube el PDF de un documento.' using errcode = '42501';
  end if;
  if v_d.status <> 'error' or v_d.file_path is not null or v_d.link_url is not null or v_d.email_id is null then
    raise exception 'Ese documento no es un correo sin factura.' using errcode = '22023';
  end if;
  if coalesce(p_ruta, '') not like v_d.account_id::text || '/%' then raise exception 'El fichero no es de esta cuenta.' using errcode = '22023'; end if;
  update public.document_inbox set file_bucket = 'receipt-uploads', file_path = p_ruta, file_name = p_nombre, mime_type = p_tipo,
         size_bytes = p_bytes, sha256 = p_sha256, status = 'recibido', reason = null, updated_at = now()
   where id = p_inbox;
  return jsonb_build_object('id', p_inbox, 'ruta', p_ruta, 'mensaje', format('Subido «%s»: lo leo ahora.', p_nombre));
end $$;
revoke all on function public.conta_correo_sin_factura_pdf(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_correo_sin_factura_pdf(uuid, text, text, text, integer, text) to authenticated;
comment on function public.conta_correo_sin_factura_pdf(uuid, text, text, text, integer, text) is
  'S01p·20 · 1. «Subir el PDF a mano» de un correo sin factura: el fichero va a la misma fila y queda recibido, para leerlo.';
