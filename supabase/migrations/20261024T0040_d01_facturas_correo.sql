-- supabase/migrations/20261024T0040_d01_facturas_correo.sql
--
-- D01 · Las facturas de los proveedores entran solas por correo (Julio, 16/10).
-- La entrada ya existe (la 0220 del 21 y la función conta-facturas-entrada):
-- esto le añade lo que hace falta para que cada proveedor reenvíe la suya.
--
--   1. LOS REMITENTES QUE NO MANDAN FACTURAS. Un proveedor puede mandar desde
--      otra dirección papeles que no son facturas (sus justificantes de
--      entrega). Si llegan reenviados, no se leen como factura: se apunta el
--      correo y se dice por qué. La dirección se guarda por su HUELLA
--      (sha256 de la dirección en minúsculas), nunca en claro: el
--      repositorio es público y las tandas viven en él.
--      company_inbound_sender (solo el servidor) y conta_entrada_remitente
--      (la llama la función con la clave de servicio).
--   2. LA REPETIDA DEJA RASTRO. El mismo fichero que vuelve a llegar por
--      correo ya se reconocía por su huella y no se leía otra vez, pero no
--      quedaba escrito en ningún sitio: ahora la llegada que ya estaba lo dice
--      en su actividad («Ha vuelto a llegar por correo… ya estaba»). Misma
--      firma; solo añade esa línea.
--
-- cambia: public.conta_entrada_llegada · prueba: supabase/staging/sql/20261119_d01_facturas_correo_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261024T0040_d01_facturas_correo.down.sql

-- 1 · Los remitentes que no mandan facturas -----------------------------------------
create table if not exists public.company_inbound_sender (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  sender_sha256 text not null check (sender_sha256 ~ '^[0-9a-f]{64}$'),
  decision text not null default 'no_facturas' check (decision in ('no_facturas')),
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  created_by_name text,
  unique (company_id, sender_sha256)
);
comment on table public.company_inbound_sender is
  'D01 · Remitentes cuyos correos, aunque lleguen a la dirección de facturas de la empresa, no son facturas (p. ej. los justificantes de entrega de un proveedor). La dirección, por su huella: sha256 de la dirección en minúsculas. Solo el servidor.';
alter table public.company_inbound_sender enable row level security;
revoke all on public.company_inbound_sender from public, anon, authenticated;

-- El remitente de un correo, para una empresa: lo que se sabe de él, o null.
-- p_from puede venir con nombre («Nombre <a@b>»): se toma la dirección.
create or replace function public.conta_entrada_remitente(p_company uuid, p_from text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('decision', s.decision, 'motivo', s.reason)
    from public.company_inbound_sender s
   where s.company_id = p_company
     and s.sender_sha256 = encode(sha256(convert_to(lower(btrim(coalesce(substring(p_from from '<([^>]+)>'), p_from, ''))), 'UTF8')), 'hex')
$$;
revoke all on function public.conta_entrada_remitente(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_entrada_remitente(uuid, text) to service_role;

-- 2 · La repetida deja rastro ---------------------------------------------------------
-- El texto de la 0220, con la línea de actividad en la que ya estaba cuando
-- el mismo fichero vuelve a llegar en OTRO correo.
create or replace function public.conta_entrada_llegada(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid := (p->>'account_id')::uuid;
  v_emp uuid := (p->>'company_id')::uuid;
  v_id uuid; v_ya uuid; v_ya_correo text;
begin
  if (select account_id from public.company where id = v_emp) is distinct from v_acc then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '22023';
  end if;
  select id, email_id into v_ya, v_ya_correo from public.document_inbox
   where (p->>'sha256' is not null and account_id = v_acc and sha256 = p->>'sha256' and status <> 'descartado')
      or (email_id = p->>'email_id' and coalesce(file_name, '') = coalesce(p->>'nombre', '') and coalesce(link_url, '') = coalesce(p->>'enlace', ''))
   limit 1;
  if v_ya is not null then
    if coalesce(p->>'canal', 'correo') = 'correo' and p->>'email_id' is not null and v_ya_correo is distinct from p->>'email_id' then
      insert into public.document_activity (account_id, company_id, inbox_id, actor, action, text, detail)
      values (v_acc, v_emp, v_ya, 'folvy', 'repetida',
              'Ha vuelto a llegar por correo el ' || to_char(coalesce(nullif(p->>'recibido', '')::timestamptz, now()) at time zone 'Europe/Madrid', 'DD/MM/YYYY') ||
              ' el mismo fichero (' || coalesce(p->>'nombre', 'sin nombre') || '): ya estaba, no lo apunto dos veces.',
              jsonb_build_object('de', p->>'from', 'asunto', left(p->>'subject', 200), 'email_id', p->>'email_id'));
    end if;
    return jsonb_build_object('id', v_ya, 'ya_estaba', true);
  end if;
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
