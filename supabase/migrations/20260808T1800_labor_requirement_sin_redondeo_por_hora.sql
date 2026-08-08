-- Aplicada: 2026-08-08 por MCP.
-- FIX MEDIDO: team_labor_requirement redondeaba al alza CADA hora (ceil por celda).
-- Efecto: pedia 79 personas-hora/semana cuando la produccion real necesita 39,4 (+101%).
-- Causa: ceil(volumen/pph) por hora. Si una hora pide 23 platos y el ritmo es 20,
-- ceil da 2 personas = capacidad 40 para demanda 23. Repetido en 14 horas, dobla el total.
--
-- REGLA (aprendida hoy a base de equivocarse 3 veces): el dimensionado se calcula sobre el
-- TOTAL del periodo, nunca sumando percentiles/redondeos celda a celda. El redondeo se
-- aplica UNA vez, al montar el turno.
--
-- Se anade required_exact (numeric, sin redondear). Se MANTIENE required (int) para no
-- romper el frontend que ya lo consume. min_on_open se respeta en ambos: si el local esta
-- abierto hace falta al menos esa gente, y eso si es legitimo.
--
-- ⚠️ CORRECCION PARCIAL, VERIFICADA (08/08): esta migracion solo toca
-- team_labor_requirement. generate_week_schedule (20260808T1500..T1550) SIGUE leyendo
-- la columna `required` (ahora redondeada al entero mas proximo, antes con ceil — mejor
-- pero no exacta), no la nueva `required_exact`. Confirmado en vivo con
-- pg_get_functiondef: el generador no referencia required_exact en ningun punto.
-- El generador de turnos sigue sobredimensionado, en menor medida que antes de este
-- fix pero sin corregir de raiz. F10 sigue 🟡.

DROP FUNCTION IF EXISTS public.team_labor_requirement(uuid, uuid, date);

CREATE FUNCTION public.team_labor_requirement(p_account uuid, p_location uuid, p_week_start date)
RETURNS TABLE(fecha date, dow integer, hora integer, role_kind text, driver text,
              volumen numeric, per_person_hour numeric, required integer,
              required_exact numeric, is_estimate boolean)
LANGUAGE sql STABLE
AS $function$
  with biz as (
    select coalesce((select business_type from public.accounts where id = p_account), 'dark_kitchen') as bt
  ),
  intensity as (
    select case coalesce((select labor_intensity from public.team_demand_config where account_id = p_account), 'normal')
             when 'holgado' then 1.15 when 'ajustado' then 0.90 else 1.0 end as m
  ),
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
  ppt as (
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
  ),
  calc as (
    select h.fecha, h.dow, h.h, k.role_kind, k.driver, k.pph, k.min_open, k.oc_extra, k.is_estimate,
           case k.driver when 'tickets' then h.platos_hora / (select r from ppt)
                         when 'fixed'   then 0
                         else h.platos_hora end as vol,
           o.h0, o.h1
    from hourly h cross join kinds k join openh o on o.dow = h.dow
  )
  select c.fecha, c.dow, c.h as hora, c.role_kind, c.driver,
         round(c.vol, 1) as volumen,
         c.pph,
         -- required (int): se conserva por compatibilidad, ahora al ENTERO MAS PROXIMO
         ( greatest(c.min_open,
             case when c.driver = 'fixed' then c.min_open
                  else round(c.vol / nullif(c.pph,0) * (select m from intensity)) end)
           + case when c.h = c.h0 or c.h = c.h1 then c.oc_extra else 0 end )::int as required,
         -- required_exact: SIN redondear. Es el que debe usar el generador.
         round( greatest(c.min_open::numeric,
                  case when c.driver = 'fixed' then c.min_open::numeric
                       else c.vol / nullif(c.pph,0) * (select m from intensity) end)
                + case when c.h = c.h0 or c.h = c.h1 then c.oc_extra else 0 end , 3) as required_exact,
         c.is_estimate
  from calc c
  order by c.fecha, c.h, c.role_kind;
$function$;

DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='team_labor_requirement') THEN
    RAISE EXCEPTION 'team_labor_requirement no quedo'; END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
