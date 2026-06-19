-- supabase/migrations/20260619T0700_order_acceptance_config.sql
-- Aplicada: 2026-06-19 (en vivo vía SQL Editor; este fichero la versiona fiel).
--
-- AUTO-ACEPTACIÓN de pedidos por cuenta × canal × marca.
-- Baseline = auto-aceptar ON (estándar de integradores). Esta tabla guarda
-- EXCEPCIONES sobre ese baseline: una fila con auto_accept=false APAGA ese caso.
-- Resolución por especificidad (en la frontera del webhook): marca+canal > marca
-- > canal > defecto de cuenta. NULL en channel_id/brand_id = comodín (aplica a todos).
-- GENÉRICA: cada frontera (HubRise hoy, Otter/Last mañana) consulta la MISMA tabla.
--
-- `respect_hours` queda como guardarraíl horario DORMIDO hasta que exista Horarios.

create table if not exists public.order_acceptance_config (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id)      on delete cascade,
  channel_id    uuid          references public.sales_channel(id) on delete cascade,
  brand_id      uuid          references public.brand(id)         on delete cascade,
  auto_accept   boolean not null default true,
  respect_hours boolean not null default false,  -- guardarraíl horario (dormido hasta Horarios)
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- Una sola fila por combinación. COALESCE+centinela = único en cualquier versión
-- de PG (NULL tratado como valor). El uuid de ceros nunca es un id real.
create unique index if not exists order_acceptance_config_uniq
  on public.order_acceptance_config (
    account_id,
    coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(brand_id,   '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.order_acceptance_config enable row level security;

drop policy if exists oac_read  on public.order_acceptance_config;
drop policy if exists oac_write on public.order_acceptance_config;

create policy oac_read on public.order_acceptance_config
  for select to authenticated
  using (belongs_to_account(account_id));

create policy oac_write on public.order_acceptance_config
  for all to authenticated
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));
