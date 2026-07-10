-- 20260709T2200_demand_prior.sql
-- Folvy Team — Prior general de demanda por TIPO DE NEGOCIO (modelo jerárquico).
-- Cada cuenta aprende sus índices; cuando le falta histórico, se apoya en el patrón
-- general de su tipo de negocio. Multi-cliente: hoy poblamos dark_kitchen (estudio de
-- 3 años, 28.685 tickets); bar/restaurante/cafetería quedan preparados para cuando
-- haya datos. Deuda 0: la estructura ya contempla todos los tipos.

begin;

-- 1) Tipo de negocio por cuenta (editable; no cableado).
alter table public.accounts
  add column if not exists business_type text not null default 'dark_kitchen'
    check (business_type in ('dark_kitchen','bar','restaurante','cafeteria','hotel','otro'));

-- 2) Prior general: índices por tipo de negocio × dimensión (dow|month) × clave.
--    Índices normalizados a media 1,0. GLOBAL (sin account_id), solo lectura para todos.
create table if not exists public.demand_prior (
  business_type text not null,
  dim           text not null check (dim in ('dow','month')),  -- día de la semana | mes
  key           int  not null,                                  -- dow 0..6 | month 1..12
  idx           numeric not null,                               -- índice (media 1,0)
  sample_days   int not null default 0,                         -- días de la muestra
  updated_at    timestamptz not null default now(),
  primary key (business_type, dim, key)
);

alter table public.demand_prior enable row level security;
drop policy if exists demand_prior_read on public.demand_prior;
create policy demand_prior_read on public.demand_prior for select using (true);  -- prior público

-- 3) Semilla dark_kitchen desde el estudio (docs/folvy_prevision_demanda_estudio.md).
--    dow: 0=Lunes..6=Domingo · month: 1=Enero..12=Diciembre.
insert into public.demand_prior (business_type, dim, key, idx, sample_days) values
  ('dark_kitchen','dow',0,0.828,1035),
  ('dark_kitchen','dow',1,0.654,1035),
  ('dark_kitchen','dow',2,0.769,1035),
  ('dark_kitchen','dow',3,0.868,1035),
  ('dark_kitchen','dow',4,1.204,1035),
  ('dark_kitchen','dow',5,1.224,1035),
  ('dark_kitchen','dow',6,1.454,1035),
  ('dark_kitchen','month',1,0.920,1035),
  ('dark_kitchen','month',2,0.972,1035),
  ('dark_kitchen','month',3,1.205,1035),
  ('dark_kitchen','month',4,1.247,1035),
  ('dark_kitchen','month',5,1.242,1035),
  ('dark_kitchen','month',6,0.927,1035),
  ('dark_kitchen','month',7,0.742,1035),
  ('dark_kitchen','month',8,0.653,1035),
  ('dark_kitchen','month',9,0.975,1035),
  ('dark_kitchen','month',10,0.915,1035),
  ('dark_kitchen','month',11,1.148,1035),
  ('dark_kitchen','month',12,1.055,1035)
on conflict (business_type, dim, key) do update
  set idx = excluded.idx, sample_days = excluded.sample_days, updated_at = now();

commit;
