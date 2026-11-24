-- supabase/migrations/20261113T1805_b01r26_conta_pdf.sql
--
-- B01r·26 (13/11) · EL ENLACE PERMANENTE DEL PDF, CON LLAVE POR DOCUMENTO.
-- Lo decidido por Julio el 24/10 (docs/conta/c12/traspaso-completo.md, «La URL
-- del PDF»): las facturas van a Diez por Excel con la columna «Url documento», y
-- Diez descarga el PDF de esa dirección. La dirección es
-- https://…/functions/v1/conta-pdf/<llave>:
--   · la llave es aleatoria, de 128 bits (32 hex), una por documento, y no lleva
--     ni cuenta, ni empresa, ni número de factura;
--   · solo hay llave para un documento que ha ido en un traspaso CONFIRMADO;
--   · se puede retirar (una, o todas las de una empresa); retirada, el PDF deja
--     de servirse;
--   · cada acceso queda apuntado (cuándo, un hash de la IP y qué se contestó), y
--     hay un tope de peticiones por llave y hora.
-- Lo sirve la función conta-pdf (verify_jwt = false: quien llama es el servidor
-- de Diez), que solo habla con la base a través de conta_pdf_servir.
--
-- SOLO AÑADE: dos tablas y cuatro funciones nuevas. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261113T1805_b01r26_conta_pdf.down.sql

create table if not exists public.conta_pdf_llave (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  document_id uuid not null references public.journal_entry_document(id) on delete restrict,
  traspaso_id uuid not null references public.conta_diez_traspaso(id) on delete restrict,
  llave text not null unique check (llave ~ '^[0-9a-f]{32}$'),
  creada_en timestamptz not null default now(),
  retirada_en timestamptz,
  retirada_por uuid,
  retirada_por_nombre text,
  retirada_motivo text,
  accesos integer not null default 0,
  ultimo_acceso timestamptz,
  check ((retirada_en is null) = (retirada_motivo is null))
);
comment on table public.conta_pdf_llave is
  'B01r26 · La llave del enlace permanente de un PDF de Sumied que Diez descarga (functions/v1/conta-pdf/<llave>): una por documento, solo para lo que ha ido en un traspaso confirmado, retirable. Ver 20261113T1805.';
-- Una llave viva por documento (la retirada se queda como historia).
create unique index if not exists conta_pdf_llave_viva_uq on public.conta_pdf_llave (document_id) where retirada_en is null;
create index if not exists conta_pdf_llave_traspaso_idx on public.conta_pdf_llave (traspaso_id);
alter table public.conta_pdf_llave enable row level security;
revoke all on table public.conta_pdf_llave from public, anon, authenticated;
grant all on table public.conta_pdf_llave to service_role;

create table if not exists public.conta_pdf_acceso (
  id bigint generated always as identity primary key,
  llave_id uuid references public.conta_pdf_llave(id) on delete cascade,
  en timestamptz not null default now(),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{16,64}$'),
  resultado text not null check (resultado in ('servido', 'retirada', 'anulado', 'tope', 'no_existe'))
);
comment on table public.conta_pdf_acceso is
  'B01r26 · Cada petición al enlace de un PDF (conta-pdf): cuándo, un hash de la IP (no la IP) y qué se contestó. Las de una llave que no existe se apuntan sin llave.';
create index if not exists conta_pdf_acceso_llave_idx on public.conta_pdf_acceso (llave_id, en desc);
alter table public.conta_pdf_acceso enable row level security;
revoke all on table public.conta_pdf_acceso from public, anon, authenticated;
grant all on table public.conta_pdf_acceso to service_role;

-- Las llaves del traspaso de un mes: una por cada documento de las facturas
-- (ventas, recibidas y expedidas a mano) que van en él. Si ya tiene una viva, la
-- misma. Solo con el traspaso confirmado. Devuelve el asiento y su llave.
create or replace function public.conta_pdf_llaves_del_traspaso(p_traspaso uuid)
returns table (entry_id uuid, document_id uuid, llave text)
language plpgsql security definer set search_path = public as $$
declare
  t public.conta_diez_traspaso;
begin
  select * into t from public.conta_diez_traspaso where id = p_traspaso;
  if t.id is null then raise exception 'Ese traspaso no existe.' using errcode = 'P0002'; end if;
  if t.estado not in ('confirmado', 'traspasando', 'terminado') then
    raise exception 'Solo hay enlaces de PDF para un traspaso confirmado.' using errcode = '23514';
  end if;
  insert into public.conta_pdf_llave (account_id, company_id, entry_id, document_id, traspaso_id, llave)
  select t.account_id, t.company_id, d.entry_id, d.id, t.id, encode(extensions.gen_random_bytes(16), 'hex')
    from public.conta_traspaso_lista(t.company_id, t.mes) z
    join public.journal_entry_document d on d.entry_id = z.entry_id and d.account_id = t.account_id
     and d.kind in ('resumen_ventas', 'factura_recibida', 'factura_expedida')
   where not exists (select 1 from public.conta_pdf_llave k where k.document_id = d.id and k.retirada_en is null)
  on conflict do nothing;
  return query
    select k.entry_id, k.document_id, k.llave
      from public.conta_pdf_llave k
     where k.company_id = t.company_id and k.retirada_en is null
       and k.entry_id in (select z.entry_id from public.conta_traspaso_lista(t.company_id, t.mes) z);
end $$;
comment on function public.conta_pdf_llaves_del_traspaso(uuid) is
  'B01r26 · Las llaves de los PDF de las facturas de un traspaso confirmado (las crea si faltan). Solo el servidor (conta-diez-traspaso).';
revoke all on function public.conta_pdf_llaves_del_traspaso(uuid) from public, anon, authenticated;
grant execute on function public.conta_pdf_llaves_del_traspaso(uuid) to service_role;

-- Servir: qué documento es, si se puede, y el apunte del acceso. Tope: 30 por
-- llave y hora (Diez descarga cada PDF una vez por importación).
create or replace function public.conta_pdf_servir(p_llave text, p_ip_hash text)
returns table (resultado text, storage_path text, file_name text, sha256 text)
language plpgsql security definer set search_path = public as $$
declare
  k public.conta_pdf_llave; d public.journal_entry_document; v_anulado boolean; v_res text; v_n int;
  v_ip text := case when p_ip_hash ~ '^[0-9a-f]{16,64}$' then p_ip_hash end;
begin
  if p_llave is null or p_llave !~ '^[0-9a-f]{32}$' then
    insert into public.conta_pdf_acceso (llave_id, ip_hash, resultado) values (null, v_ip, 'no_existe');
    return query select 'no_existe'::text, null::text, null::text, null::text; return;
  end if;
  select * into k from public.conta_pdf_llave where llave = p_llave for update;
  if k.id is null then
    insert into public.conta_pdf_acceso (llave_id, ip_hash, resultado) values (null, v_ip, 'no_existe');
    return query select 'no_existe'::text, null::text, null::text, null::text; return;
  end if;
  select e.voided_at is not null or e.status = 'anulado' into v_anulado from public.journal_entry e where e.id = k.entry_id;
  select count(*) into v_n from public.conta_pdf_acceso a where a.llave_id = k.id and a.resultado = 'servido' and a.en > now() - interval '1 hour';
  v_res := case when k.retirada_en is not null then 'retirada' when v_anulado then 'anulado' when v_n >= 30 then 'tope' else 'servido' end;
  insert into public.conta_pdf_acceso (llave_id, ip_hash, resultado) values (k.id, v_ip, v_res);
  if v_res <> 'servido' then
    return query select v_res, null::text, null::text, null::text; return;
  end if;
  update public.conta_pdf_llave set accesos = accesos + 1, ultimo_acceso = now() where id = k.id;
  select * into d from public.journal_entry_document where id = k.document_id;
  return query select 'servido'::text, d.storage_path, d.file_name, d.sha256;
end $$;
comment on function public.conta_pdf_servir(text, text) is
  'B01r26 · Lo que conta-pdf necesita para servir un PDF por su llave (o por qué no), y el apunte del acceso. Solo el servidor.';
revoke all on function public.conta_pdf_servir(text, text) from public, anon, authenticated;
grant execute on function public.conta_pdf_servir(text, text) to service_role;

-- Retirar: las llaves de un asiento, o todas las de una empresa. Un administrador.
create or replace function public.conta_pdf_retirar(p_company uuid, p_entry uuid, p_motivo text)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_n int; v_nombre text;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.current_user_is_admin_of(v_acc) then
    raise exception 'Solo un administrador de la cuenta puede retirar los enlaces de los PDF.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Hace falta el motivo.' using errcode = '23514'; end if;
  select coalesce(up.display_name, 'administrador') into v_nombre from public.user_profiles up where up.user_id = auth.uid() and up.account_id = v_acc limit 1;
  update public.conta_pdf_llave
     set retirada_en = now(), retirada_por = auth.uid(), retirada_por_nombre = v_nombre, retirada_motivo = btrim(p_motivo)
   where company_id = p_company and account_id = v_acc and retirada_en is null
     and (p_entry is null or entry_id = p_entry);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public.conta_pdf_retirar(uuid, uuid, text) is
  'B01r26 · Retira los enlaces de PDF de un asiento (p_entry) o de toda la empresa (p_entry nulo), con su motivo. Un administrador de la cuenta. Devuelve cuántas.';
revoke all on function public.conta_pdf_retirar(uuid, uuid, text) from public, anon;
grant execute on function public.conta_pdf_retirar(uuid, uuid, text) to authenticated, service_role;
