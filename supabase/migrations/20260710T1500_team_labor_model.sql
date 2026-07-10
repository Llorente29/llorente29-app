-- Fase A del sistema de turnos: MODELO DE TRABAJO (volumen → personal necesario/hora/rol).
-- Cimiento interválico (por HORA y ROL) compartido por: Opción 1 (redimensionar bloques),
-- Opción 2 (turnos dinámicos, destino principal) y la cobertura verde/rojo (Fase C).
-- Reutiliza team_demand_forecast + team_demand_profile. Arranque en frío = prior por tipo de negocio.

-- 1) PRIOR de modelo de trabajo por tipo de negocio (gemelo de demand_prior; arranque en frío)
create table if not exists public.labor_model_prior (
  business_type    text not null,
  role_kind        text not null,
  driver           text not null default 'platos',   -- platos | tickets | fixed
  per_person_hour  numeric not null default 30,       -- unidades del driver por persona-hora
  min_on_open      int not null default 0,            -- mínimo mientras el local está abierto
  open_close_extra int not null default 0,            -- +N en la primera y última hora (montaje/cierre)
  updated_at       timestamptz not null default now(),
  primary key (business_type, role_kind)
);

-- Semilla dark_kitchen: SOLO cocina la dirige la demanda (platos); el resto arranca en 0.
insert into public.labor_model_prior (business_type, role_kind, driver, per_person_hour, min_on_open, open_close_extra) values
  ('dark_kitchen','cocina',  'platos', 30, 1, 0),
  ('dark_kitchen','servicio','fixed',   0, 0, 0),
  ('dark_kitchen','reparto', 'fixed',   0, 0, 0),
  ('dark_kitchen','otro',    'fixed',   0, 0, 0)
on conflict (business_type, role_kind) do nothing;

-- 2) MODELO de la cuenta (editable; location_id null = default de la cuenta, con override por local)
create table if not exists public.team_labor_model (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null,
  location_id      uuid,
  role_kind        text not null,
  driver           text not null default 'platos',
  per_person_hour  numeric not null default 30,
  min_on_open      int not null default 0,
  open_close_extra int not null default 0,
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create unique index if not exists team_labor_model_uq
  on public.team_labor_model (account_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), role_kind);

-- 3) Intensidad (holgado/normal/ajustado) en la config de team ya existente
alter table public.team_demand_config add column if not exists labor_intensity text not null default 'normal';

-- 4) RLS
alter table public.labor_model_prior enable row level security;
alter table public.team_labor_model  enable row level security;
drop policy if exists lmp_read on public.labor_model_prior;
create policy lmp_read on public.labor_model_prior for select using (true);
drop policy if exists tlm_read on public.team_labor_model;
create policy tlm_read on public.team_labor_model for select using (true);
drop policy if exists tlm_write on public.team_labor_model;
create policy tlm_write on public.team_labor_model for all to authenticated using (true) with check (true);
grant select on public.labor_model_prior to anon, authenticated;
grant select, insert, update, delete on public.team_labor_model to authenticated;

-- 5) RPC: personal necesario por (fecha, hora, rol) para la semana.
create or replace function public.team_labor_requirement(
  p_account uuid, p_location uuid, p_week_start date
)
returns table(
  fecha date, dow int, hora int, role_kind text,
  driver text, volumen numeric, per_person_hour numeric,
  required int, is_estimate boolean
)
language sql
stable
as $function$
  with biz as (
    select coalesce((select business_type from public.accounts where id = p_account), 'dark_kitchen') as bt
  ),
  intensity as (
    select case coalesce((select labor_intensity from public.team_demand_config where account_id = p_account), 'normal')
             when 'holgado' then 1.15 when 'ajustado' then 0.90 else 1.0 end as m
  ),
  -- Modelo por rol: override de local → default de cuenta → prior por tipo de negocio.
  kinds as (
    select k.role_kind,
      coalesce(mp.driver, m.driver, pr.driver, 'platos')                as driver,
      coalesce(mp.per_person_hour, m.per_person_hour, pr.per_person_hour, 30) as pph,
      coalesce(mp.min_on_open, m.min_on_open, pr.min_on_open, 0)         as min_open,
      coalesce(mp.open_close_extra, m.open_close_extra, pr.open_close_extra, 0) as oc_extra,
      (mp.role_kind is null and m.role_kind is null)                    as is_estimate
    from (select distinct kind as role_kind from public.staff_role where account_id = p_account and active) k
    left join public.team_labor_model mp on mp.account_id = p_account and mp.location_id = p_location and mp.role_kind = k.role_kind and mp.active
    left join public.team_labor_model m  on m.account_id = p_account and m.location_id is null and m.role_kind = k.role_kind and m.active
    left join public.labor_model_prior pr on pr.business_type = (select bt from biz) and pr.role_kind = k.role_kind
  ),
  ppt as (  -- platos por ticket del local (driver 'tickets')
    select coalesce(sum(sl.quantity) / nullif(count(distinct s.id), 0), 2.1) as r
    from public.sale s
    join public.sale_line sl on sl.sale_id = s.id
    join public.menu_item mi on mi.id = sl.menu_item_id
    join public.menu_category mc on mc.id = mi.menu_category_id
    where s.account_id = p_account and s.location_id = p_location and coalesce(s.is_active, true)
      and mc.demand_kind = any (coalesce((select counted_kinds from public.team_demand_config where account_id = p_account), array['cocina']))
      and s.sold_at >= now() - interval '63 days'
  ),
  prof as (
    select dow, hour_of_day as h, sum(units) as u
    from public.team_demand_profile(p_account, now() - interval '63 days', now())
    where location_id = p_location
    group by 1, 2
  ),
  shape as (select dow, h, u, sum(u) over (partition by dow) as tot from prof where u > 0),
  openh as (select dow, min(h) as h0, max(h) as h1 from shape group by dow),
  fc as (select fecha, dow, prevision from public.team_demand_forecast(p_account, p_location, p_week_start)),
  hourly as (
    select fc.fecha, fc.dow, s.h, fc.prevision * s.u / nullif(s.tot, 0) as platos_hora
    from fc join shape s on s.dow = fc.dow
  )
  select
    h.fecha, h.dow, h.h as hora, k.role_kind, k.driver,
    round(case k.driver when 'tickets' then h.platos_hora / (select r from ppt)
                        when 'fixed'   then 0
                        else h.platos_hora end, 1) as volumen,
    k.pph,
    ( greatest(
        k.min_open,
        case when k.driver = 'fixed' then k.min_open
             else ceil( (case k.driver when 'tickets' then h.platos_hora / (select r from ppt) else h.platos_hora end)
                        / nullif(k.pph, 0) * (select m from intensity) )
        end
      )
      + case when h.h = o.h0 or h.h = o.h1 then k.oc_extra else 0 end
    )::int as required,
    k.is_estimate
  from hourly h
  cross join kinds k
  join openh o on o.dow = h.dow
  order by h.fecha, h.h, k.role_kind;
$function$;

grant execute on function public.team_labor_requirement(uuid, uuid, date) to anon, authenticated;
