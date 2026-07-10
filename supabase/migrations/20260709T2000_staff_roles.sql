-- 20260709T2000_staff_roles.sql
-- Folvy Team — Áreas/roles de personal configurables por cuenta.
-- Estándar de hostelería sembrado al crear la cuenta; cada negocio lo amplía o
-- ajusta (un bar añade "Terraza", un hotel "Recepción/Pisos"...). Da color a las
-- pastillas del cuadrante y `kind` para que la IA sepa qué área produce platos.
-- Multi-cliente: NUNCA taxonomía fija; la empresa manda.

begin;

create table if not exists public.staff_role (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null,
  name        text not null,                 -- Sala, Cocina, Barra, Reparto...
  color       text not null default 'gray',  -- clave de color (terracota/blue/teal/amber/green/purple/gray)
  kind        text not null default 'otro'
                check (kind in ('cocina','servicio','reparto','otro')),  -- para dotación por platos
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists ux_staff_role_name on public.staff_role(account_id, lower(name));
create index if not exists ix_staff_role_acct on public.staff_role(account_id, active);

alter table public.staff_role enable row level security;
drop policy if exists staff_role_read  on public.staff_role;
drop policy if exists staff_role_write on public.staff_role;
create policy staff_role_read  on public.staff_role
  for select using (account_id = any (current_user_account_ids()));
create policy staff_role_write on public.staff_role
  for all using (current_user_is_admin_of(account_id))
          with check (current_user_is_admin_of(account_id));

commit;
