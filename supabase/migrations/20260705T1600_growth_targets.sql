-- 20260705T1600_growth_targets.sql
-- MOTOR DE OFERTAS — ETAPA CRECIMIENTO (05/07/2026, decisión Julio):
-- El agente v1 medía contra el PICO HISTÓRICO (recuperación) y tenía 3 fallos estructurales
-- verificados hoy con datos: (1) el pico del backfill nov-2025 es una vara FALSA (Meraki
-- "recuperada al 106%" de un pico que es la sombra de su potencial); (2) el umbral
-- peak>=0.1 confunde "sin historia" con "sin futuro" (Urban Kebab excluida); (3) una marca
-- con 0 ventas en 28d NO GENERA FILA en la señal -> el caso más urgente (Dirty Burger
-- 0-0-0-0) era INVISIBLE por construcción.
-- La vara nueva: OBJETIVO por marca×canal×LOCAL puesto por el operador. La propia tabla
-- de objetivos define el universo del agente: si hay objetivo, hay fila, aunque lleve
-- meses a cero. El pico baja a dato informativo.

begin;

-- ── 1. Objetivos por marca × canal × local (pedidos/día que el operador quiere)
create table if not exists public.brand_channel_target (
  id           uuid        not null primary key default gen_random_uuid(),
  account_id   uuid        not null references public.accounts(id),
  brand_id     uuid        not null references public.brand(id),
  channel_id   uuid        not null references public.sales_channel(id),
  location_id  uuid        not null references public.locations(id),
  target_daily numeric     not null check (target_daily >= 0),
  updated_at   timestamptz not null default now(),
  unique (account_id, brand_id, channel_id, location_id)
);
alter table public.brand_channel_target enable row level security;
drop policy if exists bct_account on public.brand_channel_target;
create policy bct_account on public.brand_channel_target
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── 2. Pista del POS de Glovo por local (para que el robot publique la promo
--       del local X SOLO en el establecimiento del local X)
alter table public.locations add column if not exists glovo_pos_hint text;

update public.locations set glovo_pos_hint = 'florencio' where id = '38158159-cd71-4056-950b-53425afac1ce' and glovo_pos_hint is null; -- Alcalá (C. de Florencio Llorente)
update public.locations set glovo_pos_hint = 'cañaveral' where id = '629f9154-b888-48ed-9b8c-ffae77620615' and glovo_pos_hint is null; -- Plaza Castilla (C. Cañaveral)
update public.locations set glovo_pos_hint = 'camichi'   where id = '92d7656e-082e-452a-8ebc-236b2d6ebf5f' and glovo_pos_hint is null; -- Carabanchel (Camichi 4)

-- ── 3. Señal v2: el universo son LOS OBJETIVOS (LEFT JOIN a ventas: el cero es una fila)
create or replace function public.agent_sales_signal_v2(p_account_id uuid)
 returns table(brand_id uuid, channel_name text, location_id uuid, location_name text,
               target_daily numeric, sales_7d numeric, avg_28d numeric, peak_daily numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select t.brand_id, sc.name as channel_name, t.location_id, l.name as location_name,
           t.target_daily
    from brand_channel_target t
    join sales_channel sc on sc.id = t.channel_id
    join locations l on l.id = t.location_id
    join brand b on b.id = t.brand_id and b.is_active
    where t.account_id = p_account_id
      and t.target_daily > 0
  ),
  rec as (
    select s.brand_id, sc.name as channel_name, s.location_id,
      count(*) filter (where s.created_at >= now() - interval '7 days') / 7.0  as s7,
      count(*) filter (where s.created_at >= now() - interval '28 days') / 28.0 as s28
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '28 days'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, s.location_id
  ),
  daily as (
    select s.brand_id, sc.name as channel_name, s.location_id,
           date_trunc('month', s.created_at) as mes,
           count(*) / greatest(extract(day from
             least(date_trunc('month', s.created_at) + interval '1 month', now())
             - date_trunc('month', s.created_at))::numeric, 1) as ventas_dia
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '12 months'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, s.location_id, date_trunc('month', s.created_at)
  ),
  peak as (
    select brand_id, channel_name, location_id, max(ventas_dia) as peak_daily
    from daily group by brand_id, channel_name, location_id
  )
  select b.brand_id, b.channel_name, b.location_id, b.location_name, b.target_daily,
         round(coalesce(r.s7, 0), 2), round(coalesce(r.s28, 0), 2),
         round(coalesce(p.peak_daily, 0), 2)
  from base b
  left join rec r  on r.brand_id = b.brand_id and r.channel_name = b.channel_name and r.location_id = b.location_id
  left join peak p on p.brand_id = b.brand_id and p.channel_name = b.channel_name and p.location_id = b.location_id;
$function$;

revoke all on function public.agent_sales_signal_v2(uuid) from public, anon;
grant execute on function public.agent_sales_signal_v2(uuid) to authenticated, service_role;

-- ── 4. SIEMBRA de objetivos (números de Julio 05/07, POR LOCAL, marcas propias × Glovo/Uber).
--       Uber queda sembrado pero DORMIDO (ARMED_PLATFORMS del agente no lo incluye aún).
--       Idempotente (ON CONFLICT DO NOTHING). Editables; UI de edición = encargo a Code aparte.
with objetivos(marca, canal, objetivo) as (
  values
    ('Meraki Pita',            'Glovo', 10), ('Meraki Pita',            'Uber', 15),
    ('Dirty Burger',           'Glovo',  3), ('Dirty Burger',           'Uber',  3),
    ('The Urban Kebab',        'Glovo',  5), ('The Urban Kebab',        'Uber',  5),
    ('Bendito Burrito',        'Glovo', 10), ('Bendito Burrito',        'Uber', 15),
    ('Milanesa House',         'Glovo', 10), ('Milanesa House',         'Uber', 15),
    ('Mila''s Sandwiches',     'Glovo',  3), ('Mila''s Sandwiches',     'Uber',  3),
    ('Scandal Burgers',        'Glovo', 10), ('Scandal Burgers',        'Uber', 15),
    ('Smash Brothers Burgers', 'Glovo', 10), ('Smash Brothers Burgers', 'Uber', 15)
)
insert into public.brand_channel_target (account_id, brand_id, channel_id, location_id, target_daily)
select b.account_id, b.id, sc.id, l.id, o.objetivo
from objetivos o
join brand b on b.name = o.marca
  and b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and b.ownership_type <> 'licensed' and b.is_active
join sales_channel sc on sc.name = o.canal and sc.account_id = b.account_id
join locations l on l.account_id = b.account_id
on conflict (account_id, brand_id, channel_id, location_id) do nothing;

commit;
