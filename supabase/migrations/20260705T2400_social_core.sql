-- 20260705T2400_social_core.sql
-- SISTEMA RRSS · TR1 núcleo (05/07/2026, diseño en docs/folvy_rrss_diseno.md).
-- Marca-agnóstico y red-agnóstico: sirve al perfil paraguas FOODINT de Llorente29 hoy
-- y a cualquier cliente mañana (extra de producto). Patrón calcado de la cola de
-- ofertas (promo_push_job): propuesta del agente → aprobación humana (payload queda
-- INMUTABLE) → publicación (brazo API o asistida) → medición.
-- Tokens JAMÁS en tabla (Vault); config jsonb solo para lo no sensible.

begin;

create table if not exists social_account (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  network text not null check (network in ('instagram','tiktok','facebook')),
  handle text not null,                       -- @foodint
  display_name text,                          -- "Foodint — Food Hall Virtual"
  link_status text not null default 'unlinked'
    check (link_status in ('unlinked','linked','error')),
  config jsonb not null default '{}'::jsonb,  -- ids de página/cuenta IG, NUNCA tokens
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, network, handle)
);

create table if not exists social_post (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  social_account_id uuid references social_account(id) on delete set null,
  network text not null check (network in ('instagram','tiktok','facebook')),
  status text not null default 'draft'
    check (status in ('draft','approved','scheduled','published','discarded','error')),
  -- payload: copy, hashtags[], image_url, link (Shop con UTM), brand_id protagonista,
  -- format (feed|story|reel). INMUTABLE una vez approved (regla de la casa).
  payload jsonb not null,
  reason text,                                -- el PORQUÉ del agente (auditable, se pinta en pantalla)
  origin text not null default 'agent' check (origin in ('agent','manual')),
  brand_id uuid references brand(id) on delete set null,  -- marca protagonista (rotación justa)
  scheduled_at timestamptz,
  published_at timestamptz,
  external_ref text,                          -- id del post en la red (cuando haya brazo)
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_post_account_status on social_post(account_id, status);
create index if not exists idx_social_post_brand_pub on social_post(account_id, brand_id, published_at desc);
create index if not exists idx_social_post_day on social_post(account_id, network, created_at);

alter table social_account enable row level security;
alter table social_post enable row level security;

drop policy if exists social_account_rls on social_account;
create policy social_account_rls on social_account
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));

drop policy if exists social_post_rls on social_post;
create policy social_post_rls on social_post
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));

-- Siembra: el perfil paraguas de Llorente29 (deberes de Julio: crear las cuentas reales;
-- handle provisional, se corrige al enlazar)
insert into social_account (account_id, network, handle, display_name)
values
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'instagram', 'foodint', 'Foodint'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'tiktok',    'foodint', 'Foodint')
on conflict (account_id, network, handle) do nothing;

commit;
