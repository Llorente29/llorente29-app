-- supabase/vuelta-atras/20261119T0100_d01_facturas_correo.down.sql
--
-- Deshace la 0100 del 19 (las facturas por correo): conta_entrada_llegada
-- vuelve al texto de la 0220 del 21 (sin la línea de «ha vuelto a llegar»), y
-- se quitan conta_entrada_remitente y company_inbound_sender.
-- Freno: si company_inbound_sender tiene alguna fila (la 0110 del 19 pone la de
-- Foodint), no se toca nada: primero va la vuelta atrás de la 0110.

do $$ begin
  if to_regclass('public.company_inbound_sender') is not null and exists (select 1 from public.company_inbound_sender) then
    raise exception 'VUELTA ATRÁS 0100 (facturas por correo) PARADA: company_inbound_sender tiene filas; primero la vuelta atrás de la 0110. No se toca nada.' using errcode = 'P0001';
  end if;
end $$;

drop function if exists public.conta_entrada_remitente(uuid, text);
drop table if exists public.company_inbound_sender;

-- El texto de la 0220 del 21, tal cual.
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
