-- 20260705T2100_dow_signal.sql
-- MOTOR DE OFERTAS v2.1 · T4 — SEÑAL POR DÍA DE SEMANA (05/07/2026).
-- Restricción de diseño (fijada en el mapa v2.1): el panel de Glovo solo admite promos
-- por RANGO de fechas, no recurrencia semanal -> el día de semana NO crea promos "solo
-- lunes": informa el CUÁNDO lanzar y con QUÉ profundidad. El agente v1.5 usa esta señal
-- así: si los ~3 días por delante concentran la semana de la marca (jueves con finde
-- fuerte delante), prioriza y profundiza (+5); si vienen días históricamente muertos,
-- suaviza (-5) y ahorra margen. Todo visible en el razonamiento.
-- Reparto por marca×canal (12 semanas, hora de Madrid). Por-local sería dato demasiado
-- fino/ruidoso con el volumen actual — se declara y queda para cuando el volumen lo aguante.

begin;

create or replace function public.agent_dow_signal(p_account_id uuid)
 returns table(brand_id uuid, channel_name text, dow integer, pct_share numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  with cnt as (
    select s.brand_id, sc.name as channel_name,
           extract(isodow from s.created_at at time zone 'Europe/Madrid')::int as dow,
           count(*)::numeric as n
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '84 days'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, extract(isodow from s.created_at at time zone 'Europe/Madrid')
  )
  select c.brand_id, c.channel_name, c.dow,
         round(100 * c.n / sum(c.n) over (partition by c.brand_id, c.channel_name), 1) as pct_share
  from cnt c
  order by c.brand_id, c.channel_name, c.dow;
$function$;

revoke all on function public.agent_dow_signal(uuid) from public, anon;
grant execute on function public.agent_dow_signal(uuid) to authenticated, service_role;

commit;
