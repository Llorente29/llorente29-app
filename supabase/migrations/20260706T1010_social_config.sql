-- 20260706T1010_social_config.sql
-- Tramo 0 · Migración B — RRSS
--
-- Config por cuenta del sistema RRSS. launch_phase es el interruptor de fase del plan
-- de lanzamiento: en 'apetito'/'comunidad' el agente NO anuncia ofertas (R1 gateada);
-- 'conversion' abre la venta (Fase 3).
-- El agente corre con service_role (salta RLS); las policies son para la app con sesión
-- (módulo Social) leyendo/escribiendo la fase.

begin;

create table if not exists public.social_config (
  account_id   uuid primary key references accounts(id) on delete cascade,
  launch_phase text not null default 'apetito'
               check (launch_phase in ('apetito','comunidad','conversion')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);

comment on table public.social_config is
  'Config por cuenta del sistema RRSS. launch_phase gatea el agente: en apetito/comunidad NO se anuncian ofertas (R1 gateada); conversion abre la venta.';

alter table public.social_config enable row level security;

-- Lectura: cualquiera de la cuenta. Escritura: admin/manager de la cuenta.
drop policy if exists social_config_select on public.social_config;
create policy social_config_select on public.social_config
  for select using (belongs_to_account(account_id));

drop policy if exists social_config_write on public.social_config;
create policy social_config_write on public.social_config
  for all using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

-- Arranque: Foodint (Llorente29) nace en FASE APETITO (no vende).
insert into public.social_config (account_id, launch_phase)
values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'apetito')
on conflict (account_id) do nothing;

commit;
