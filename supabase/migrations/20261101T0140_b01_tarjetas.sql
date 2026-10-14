-- ============================================================================
-- B01 · 5 · TARJETAS DE DÉBITO, LOS IBAN RECORDADOS Y EL TICKET POR FOTO
-- ----------------------------------------------------------------------------
-- Respuesta 3, punto 1 (Julio, 13/10): Foodint tiene varias tarjetas de
-- empresa, todas de débito; sus pagos salen en el Norma 43 de su cuenta. Todo
-- NUEVO. (El local de la tarjeta en las líneas del casado lo pone bank_casar,
-- de la 0110 de esta misma tanda, con el «local_id» del destino.)
--
--   bank_card            la tarjeta como medio de pago de una cuenta del banco:
--                        los ÚLTIMOS 4 dígitos (nunca el número entero: el
--                        CHECK solo admite cuatro cifras), quién la lleva y su
--                        local (o «común»).
--   bank_account_iban    «se recuerda a qué cuenta va cada IBAN» (respuesta 3,
--                        punto 2): el IBAN que trae un extracto y la cuenta de
--                        Folvy a la que la persona dijo que va. La siguiente
--                        subida empareja sola.
--   bank_movement        + card_id (qué tarjeta pagó, si se sabe) y el ticket:
--                        receipt_path / receipt_at.
--   bucket banco-tickets PRIVADO, fotos y PDF; la ruta empieza por la cuenta.
--   funciones            bank_tarjeta_guardar, bank_tarjeta_baja,
--                        bank_iban_recordar, bank_ticket_guardar.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0140_b01_tarjetas.down.sql
-- Prueba: supabase/staging/sql/20261101_b01_tarjetas_prueba.sql
-- ============================================================================

create table if not exists public.bank_card (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete restrict,
  last4               text not null check (last4 ~ '^[0-9]{4}$'),
  holder_name         text not null check (length(trim(holder_name)) > 0),
  location_id         uuid references public.locations(id) on delete set null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  created_by_name     text,
  deactivated_at      timestamptz
);
create unique index if not exists bank_card_una_viva on public.bank_card (treasury_account_id, last4) where is_active;
comment on table public.bank_card is
  'B01 (respuesta 3). Una tarjeta de débito de la empresa como medio de pago de su cuenta del banco: solo los últimos 4 dígitos (nunca el número entero), quién la lleva y su local. El motor reconoce por esos dígitos qué tarjeta pagó.';

create table if not exists public.bank_account_iban (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete cascade,
  iban                text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  created_by_name     text,
  unique (company_id, iban)
);
comment on table public.bank_account_iban is
  'B01 (respuesta 3). El IBAN que trajo un extracto y la cuenta de Folvy a la que la persona dijo que va: la siguiente subida de ese IBAN se empareja sola.';

alter table public.bank_movement add column if not exists card_id uuid references public.bank_card(id) on delete set null;
alter table public.bank_movement add column if not exists receipt_path text;
alter table public.bank_movement add column if not exists receipt_at timestamptz;
comment on column public.bank_movement.receipt_path is 'B01. El ticket (foto o PDF) de un pago con tarjeta, en el bucket banco-tickets: <cuenta>/<movimiento>/<huella>.<ext>.';

alter table public.bank_card enable row level security;
drop policy if exists bank_card_select on public.bank_card;
create policy bank_card_select on public.bank_card for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_account_iban enable row level security;
drop policy if exists bank_account_iban_select on public.bank_account_iban;
create policy bank_account_iban_select on public.bank_account_iban for select using ((select public.belongs_to_account(account_id)));

-- ── El bucket de los tickets ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banco-tickets', 'banco-tickets', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'banco_tickets_select') then
    create policy banco_tickets_select on storage.objects for select to authenticated
      using (bucket_id = 'banco-tickets'
             and (storage.foldername(name))[1] = any (select a::text from unnest(public.current_user_account_ids()) a));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'banco_tickets_insert') then
    create policy banco_tickets_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'banco-tickets'
                  and exists (select 1 from unnest(public.current_user_account_ids()) a
                               where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)));
  end if;
end $$;

-- ── Funciones ──────────────────────────────────────────────────────────────
create or replace function public.bank_tarjeta_guardar(p_treasury uuid, p_id uuid, p_last4 text, p_titular text, p_local uuid, p_comun boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_id uuid := p_id; v_ultimos text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  if v_t.kind <> 'bank' then raise exception 'Una tarjeta de débito se da de alta en su cuenta del banco.' using errcode = '23514'; end if;
  -- Nunca el número entero: solo los cuatro últimos.
  if length(v_ultimos) <> 4 then raise exception 'De la tarjeta solo se guardan los 4 últimos dígitos: escribe esos cuatro.' using errcode = '23514'; end if;
  if coalesce(trim(p_titular), '') = '' then raise exception '¿Quién lleva esta tarjeta?' using errcode = '23514'; end if;
  if (p_local is null) = (coalesce(p_comun, false) = false) then
    raise exception '¿De qué local es esta tarjeta? Elige un local o «común».' using errcode = '23514';
  end if;
  if v_id is null then
    insert into public.bank_card (account_id, company_id, treasury_account_id, last4, holder_name, location_id, created_by, created_by_name)
    values (v_t.account_id, v_t.company_id, p_treasury, v_ultimos, trim(p_titular), p_local, auth.uid(), public.conta_nombre_actor())
    returning id into v_id;
  else
    update public.bank_card set last4 = v_ultimos, holder_name = trim(p_titular), location_id = p_local
     where id = v_id and treasury_account_id = p_treasury and is_active;
    if not found then raise exception 'Esa tarjeta no es de esta cuenta o está dada de baja.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
grant execute on function public.bank_tarjeta_guardar(uuid, uuid, text, text, uuid, boolean) to authenticated;

create or replace function public.bank_tarjeta_baja(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bank_card;
begin
  select * into v from public.bank_card where id = p_id for update;
  if v.id is null then raise exception 'Esa tarjeta no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v.company_id);
  update public.bank_card set is_active = false, deactivated_at = now() where id = p_id;
end $$;
grant execute on function public.bank_tarjeta_baja(uuid) to authenticated;

create or replace function public.bank_iban_recordar(p_treasury uuid, p_iban text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_iban text := upper(replace(coalesce(p_iban, ''), ' ', ''));
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  if v_iban = coalesce(v_t.iban, '') then return; end if;
  insert into public.bank_account_iban (account_id, company_id, treasury_account_id, iban, created_by, created_by_name)
  values (v_t.account_id, v_t.company_id, p_treasury, v_iban, auth.uid(), public.conta_nombre_actor())
  on conflict (company_id, iban) do update set treasury_account_id = excluded.treasury_account_id, created_at = now(),
     created_by = excluded.created_by, created_by_name = excluded.created_by_name;
end $$;
grant execute on function public.bank_iban_recordar(uuid, text) to authenticated;

create or replace function public.bank_ticket_guardar(p_movement uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  -- El fichero existe, en SU carpeta (cuenta/movimiento/…).
  if split_part(p_ruta, '/', 1) <> v_m.account_id::text or split_part(p_ruta, '/', 2) <> v_m.id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'banco-tickets' and o.name = p_ruta) then
    raise exception 'No encuentro esa foto del ticket.' using errcode = 'P0002';
  end if;
  update public.bank_movement set receipt_path = p_ruta, receipt_at = now(), updated_at = now() where id = p_movement;
  perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, 'propuesto', 'persona', 'Ticket subido', jsonb_build_object('ticket', p_ruta));
end $$;
grant execute on function public.bank_ticket_guardar(uuid, text) to authenticated;

/** Qué tarjeta pagó un movimiento (la decide el motor; la base solo comprueba que es de esa cuenta). */
create or replace function public.bank_tarjeta_del_movimiento(p_movement uuid, p_card uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if p_card is not null and not exists (select 1 from public.bank_card where id = p_card and treasury_account_id = v_m.treasury_account_id) then
    raise exception 'Esa tarjeta no es de la cuenta de este movimiento.' using errcode = '23514';
  end if;
  update public.bank_movement set card_id = p_card, updated_at = now() where id = p_movement;
end $$;
grant execute on function public.bank_tarjeta_del_movimiento(uuid, uuid) to authenticated;
