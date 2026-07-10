-- 20260709T2100_demand_model.sql
-- Folvy Team — Modelo de DEMANDA para el cuadrante, multi-cliente.
-- Cada categoría de carta lleva un "tipo de demanda" (cocina/barra/bebida/postre/otro);
-- cada CUENTA elige qué tipos cuentan como carga (dark kitchen=cocina; bar=cocina+barra;
-- cafetería=barra...). Nada cableado: el negocio manda.

begin;

-- 1) Tipo de demanda por categoría de carta.
alter table public.menu_category
  add column if not exists demand_kind text not null default 'cocina'
    check (demand_kind in ('cocina','barra','bebida','postre','otro'));

-- Semilla inteligente por nombre (idempotente: solo reclasifica bebidas/postres;
-- el resto queda en 'cocina' por defecto). Sin unaccent para no depender de extensión.
update public.menu_category set demand_kind = 'bebida'
  where demand_kind = 'cocina'
    and (lower(name) like '%bebida%' or lower(name) like '%drink%'
         or lower(name) like '%refresco%' or lower(name) like '%cerveza%'
         or lower(name) like '%vino%' or lower(name) like '%caf%');
update public.menu_category set demand_kind = 'postre'
  where demand_kind = 'cocina'
    and (lower(name) like '%postre%' or lower(name) like '%dessert%'
         or lower(name) like '%helado%' or lower(name) like '%dulce%');

-- 2) Config por cuenta: qué tipos de demanda cuentan como carga en el cuadrante.
create table if not exists public.team_demand_config (
  account_id   uuid primary key,
  counted_kinds text[] not null default array['cocina'],  -- dark kitchen por defecto
  updated_at   timestamptz not null default now()
);

alter table public.team_demand_config enable row level security;
drop policy if exists tdc_read  on public.team_demand_config;
drop policy if exists tdc_write on public.team_demand_config;
create policy tdc_read  on public.team_demand_config
  for select using (account_id = any (current_user_account_ids()));
create policy tdc_write on public.team_demand_config
  for all using (current_user_is_admin_of(account_id))
          with check (current_user_is_admin_of(account_id));

commit;
