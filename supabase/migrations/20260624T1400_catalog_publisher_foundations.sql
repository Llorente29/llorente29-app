-- 20260624T1400_catalog_publisher_foundations.sql
-- ============================================================================
-- PUBLICADOR · T1 Fundamentos.
--   1) brand.catalog_source: quién manda la carta (folvy publica / pos espeja).
--      Cierra la deuda de KitchenMenuPage:451 (hoy se usa ownership_type como
--      proxy). Default derivado: own→folvy, licensed→pos.
--   2) catalog_publish / catalog_publish_target: estado e historial de
--      publicación POR canal (nunca un "publicado" ciego).
-- Aditivo, idempotente. La Edge publicará con service_role (salta RLS); las
-- políticas son para que el front lea el estado de publicación.
-- Aplicada: 2026-06-24
-- ============================================================================

-- ── 1) catalog_source en brand ──────────────────────────────────────────────
alter table public.brand add column if not exists catalog_source text not null default 'folvy';
update public.brand
   set catalog_source = case when ownership_type = 'licensed' then 'pos' else 'folvy' end;
alter table public.brand drop constraint if exists brand_catalog_source_chk;
alter table public.brand add constraint brand_catalog_source_chk check (catalog_source in ('folvy','pos'));
comment on column public.brand.catalog_source is
  'Quién manda la carta: folvy=Folvy publica a las plataformas; pos=el TPV/cedente manda y Folvy espeja. El publicador solo actúa sobre folvy.';

-- ── 2) catalog_publish: un trabajo de publicación por marca ──────────────────
create table if not exists public.catalog_publish (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  brand_id      uuid not null references public.brand(id)    on delete cascade,
  requested_by  uuid,
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','done','partial','failed')),
  note          text
);
create index if not exists idx_catalog_publish_account_brand
  on public.catalog_publish(account_id, brand_id, requested_at desc);

-- ── 3) catalog_publish_target: resultado POR canal/conexión ──────────────────
create table if not exists public.catalog_publish_target (
  id                  uuid primary key default gen_random_uuid(),
  publish_id          uuid not null references public.catalog_publish(id) on delete cascade,
  channel_id          uuid,
  external_catalog_id text,
  connection_name     text,
  status              text not null default 'pending' check (status in ('pending','ok','error')),
  error_text          text,
  published_at        timestamptz
);
create index if not exists idx_catalog_publish_target_publish
  on public.catalog_publish_target(publish_id);

-- ── 4) RLS (patrón cuenta) ───────────────────────────────────────────────────
alter table public.catalog_publish        enable row level security;
alter table public.catalog_publish_target enable row level security;

drop policy if exists catalog_publish_rw on public.catalog_publish;
create policy catalog_publish_rw on public.catalog_publish
  for all
  using      (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(account_id))
  with check (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(account_id));

drop policy if exists catalog_publish_target_rw on public.catalog_publish_target;
create policy catalog_publish_target_rw on public.catalog_publish_target
  for all
  using (exists (select 1 from public.catalog_publish cp
                  where cp.id = publish_id
                    and (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(cp.account_id))))
  with check (exists (select 1 from public.catalog_publish cp
                  where cp.id = publish_id
                    and (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(cp.account_id))));
