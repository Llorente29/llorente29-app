-- ============================================================================
-- R02 · 1/4 · QUIÉN REPARTE, POR MARCA × PLATAFORMA: la fuente y la resolución
-- ----------------------------------------------------------------------------
-- Encargo R02 (docs/reparto/encargo_R02_quien_reparte.md) y respuesta 1 de
-- Julio (docs/reparto/R02_respuesta_1.md).
--
-- SOLO AÑADE. Crea la tabla `brand_delivery_policy` y la función
-- `resolve_delivery_by`. Nada de lo que existe la lee todavía: los lectores
-- (disparador de entrada, resolve_dispatch, vigía, rejilla de precios) se
-- cambian en el fichero 3/4, DESPUÉS de que el 2/4 haya escrito las filas
-- migradas. Si este fichero entrase solo, no cambiaría nada.
--
-- MODELO (respuesta 1, punto 5)
--   · Una fila por celda marca × plataforma × local. `location_id` NO es nulo:
--     la fila de la marca para todos los locales lleva el UUID cero, y solo
--     hay filas por local cuando una tienda se separa. Así el único es un
--     índice normal, sin parciales, y el ON CONFLICT casa siempre (el R01 era
--     un ON CONFLICT contra dos índices parciales).
--   · `source` guarda solo lo que alguien decidió: manual, migrated,
--     ai_accepted (punto 7). «Hereda» no se guarda: se deduce cuando no hay
--     fila y la resolución lo devuelve como `inherited`.
--
-- RESOLUCIÓN, en este orden y en UN sitio (`resolve_delivery_by`):
--   1. celda de la marca en ESE local;
--   2. celda de la marca para todos los locales (UUID cero);
--   3. herencia por tipo de marca en ESE local (channel_delivery_policy con
--      location_id = el local);
--   4. herencia por tipo de marca de la cuenta (location_id nulo);
--   5. `platform` (`source = 'default'`): no despachar es recuperable;
--      despachar de más cuesta dinero real.
-- ============================================================================

create table if not exists public.brand_delivery_policy (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  brand_id         uuid not null references public.brand(id) on delete cascade,
  -- El mismo slug que sales_channel.slug y que channelSlug() de los webhooks.
  channel_slug     text not null check (channel_slug ~ '^[a-z][a-z0-9_-]*$'),
  -- UUID cero = todos los locales. No lleva clave ajena a locations por eso;
  -- el disparador de abajo comprueba que, si no es cero, es un local de la
  -- misma cuenta.
  location_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  delivery_by      text not null check (delivery_by in ('platform', 'own')),
  source           text not null check (source in ('manual', 'migrated', 'ai_accepted')),
  decided_by       uuid,
  decided_by_name  text,
  decided_at       timestamptz not null default now(),
  note             text,
  constraint brand_delivery_policy_celda_uk unique (account_id, brand_id, channel_slug, location_id)
);

comment on table public.brand_delivery_policy is
  'R02 · Quién reparte cada marca en cada plataforma (y, si una tienda se separa, en cada local). '
  'Sin fila = hereda de channel_delivery_policy por tipo de marca. location_id = UUID cero: todos los locales.';
comment on column public.brand_delivery_policy.source is
  'manual = lo decidió una persona en «Quién reparte»; migrated = escrita por la migración R02 desde el interruptor antiguo; '
  'ai_accepted = una persona aceptó la sugerencia de Folvy. «Hereda» no se guarda.';

create index if not exists brand_delivery_policy_marca_idx
  on public.brand_delivery_policy (account_id, brand_id);

-- La marca y el local, de la misma cuenta que la fila (regla 9: una fila no
-- puede colgar de la ficha de otra cuenta).
create or replace function public.tg_brand_delivery_policy_misma_cuenta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.brand b where b.id = new.brand_id and b.account_id = new.account_id) then
    raise exception 'brand_delivery_policy: la marca % no es de la cuenta %', new.brand_id, new.account_id
      using errcode = '23514';
  end if;
  if new.location_id <> '00000000-0000-0000-0000-000000000000'::uuid
     and not exists (select 1 from public.locations l where l.id = new.location_id and l.account_id = new.account_id) then
    raise exception 'brand_delivery_policy: el local % no es de la cuenta %', new.location_id, new.account_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists brand_delivery_policy_misma_cuenta on public.brand_delivery_policy;
create trigger brand_delivery_policy_misma_cuenta
  before insert or update on public.brand_delivery_policy
  for each row execute function public.tg_brand_delivery_policy_misma_cuenta();

-- RLS: como channel_delivery_policy. Leen los de la cuenta; escriben admin y
-- encargado. Sin permisos para anon.
alter table public.brand_delivery_policy enable row level security;

drop policy if exists bdp_select on public.brand_delivery_policy;
create policy bdp_select on public.brand_delivery_policy
  for select to authenticated using (belongs_to_account(account_id));

drop policy if exists bdp_write on public.brand_delivery_policy;
create policy bdp_write on public.brand_delivery_policy
  for all to authenticated
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

revoke all on table public.brand_delivery_policy from anon;
grant select, insert, update, delete on table public.brand_delivery_policy to authenticated, service_role;

-- ── La resolución ──────────────────────────────────────────────────────────
-- SECURITY INVOKER a propósito: quien la llama desde la web solo ve las filas
-- de su cuenta (RLS); los disparadores y resolve_dispatch la llaman con los
-- permisos de quien escribe el pedido.
create or replace function public.resolve_delivery_by(
  p_account_id   uuid,
  p_brand_id     uuid,
  p_channel_slug text,
  p_location_id  uuid default null
)
returns table (delivery_by text, source text, decided_at timestamptz)
language sql
stable
set search_path = public
as $$
  with marca as (
    select b.ownership_type
      from public.brand b
     where b.id = p_brand_id and b.account_id = p_account_id
  ),
  candidatas as (
    -- 1 y 2: la celda de la marca, primero la del local.
    select p.delivery_by, p.source, p.decided_at,
           case when p.location_id = p_location_id then 1 else 2 end as orden
      from public.brand_delivery_policy p
     where p.account_id = p_account_id
       and p.brand_id = p_brand_id
       and p.channel_slug = p_channel_slug
       and (p.location_id = '00000000-0000-0000-0000-000000000000'::uuid
            or p.location_id = p_location_id)
    union all
    -- 3 y 4: la herencia por tipo de marca, primero la del local.
    select case pol.service_type when 'own_delivery' then 'own' else 'platform' end,
           'inherited', pol.updated_at,
           case when pol.location_id is not null then 3 else 4 end
      from public.channel_delivery_policy pol
      join marca m on m.ownership_type = pol.ownership_type
     where pol.account_id = p_account_id
       and pol.channel_slug = p_channel_slug
       and (pol.location_id is null or pol.location_id = p_location_id)
    union all
    -- 5: nadie ha dicho nada.
    select 'platform', 'default', null::timestamptz, 5
  )
  select c.delivery_by, c.source, c.decided_at
    from candidatas c
   order by c.orden
   limit 1
$$;

comment on function public.resolve_delivery_by(uuid, uuid, text, uuid) is
  'R02 · Quién reparte esta marca en esta plataforma (y local): own | platform, y de dónde sale '
  '(manual | migrated | ai_accepted | inherited | default). Orden: celda del local, celda de la marca, '
  'herencia del local, herencia de la cuenta, platform. Es el ÚNICO sitio que decide.';

grant execute on function public.resolve_delivery_by(uuid, uuid, text, uuid) to authenticated, service_role;
revoke execute on function public.resolve_delivery_by(uuid, uuid, text, uuid) from anon, public;
