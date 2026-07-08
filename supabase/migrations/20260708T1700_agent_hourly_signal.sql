-- 20260708T1700_agent_hourly_signal.sql
--
-- Señal horaria del agente (v3 · pieza 2): por marca, detecta el VALLE de la tarde
-- (la ventana de 2h más floja entre las 15 y las 21, hora Madrid) sobre 60 días de
-- ventas de TODOS los canales — el valle es el patrón de demanda del negocio, y es
-- justo cuando conviene empujar el Shop con una Happy Hour.
--
-- Devuelve por marca: la ventana [valley_from, valley_to), sus pedidos, y los del día
-- completo (para que el agente juzgue si la señal es fiable). El agente decide si crea
-- la Happy Hour y con qué profundidad (cascada de margen + aprendizaje).
--
-- La llama el offers-agent con service_role. SECURITY DEFINER, sin guard de sesión
-- (como el resto de señales del agente). GRANT a service_role.

create or replace function public.agent_hourly_signal(p_account_id uuid)
returns table (
  brand_id       uuid,
  valley_from    int,
  valley_to      int,
  valley_orders  bigint,
  day_orders     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with h as (
    select s.brand_id,
           extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::int as hr,
           count(*) as n
    from sale s
    where s.account_id = p_account_id
      and s.sold_at >= now() - interval '60 days'
      and coalesce(s.status, '') <> 'cancelled'
      and s.brand_id is not null
    group by 1, 2
  ),
  brands as (select distinct brand_id from h),
  -- Ventanas candidatas de 2h: inicio en 15..19 → (15-17) .. (19-21).
  win as (
    select b.brand_id,
           w.hr            as vfrom,
           w.hr + 2        as vto,
           coalesce((select sum(n) from h
                     where h.brand_id = b.brand_id and h.hr in (w.hr, w.hr + 1)), 0) as vorders
    from brands b
    cross join (select generate_series(15, 19) as hr) w
  ),
  best as (
    select distinct on (brand_id)
           brand_id, vfrom, vto, vorders
    from win
    order by brand_id, vorders asc, vfrom asc   -- la más floja; empate → más temprana
  )
  select bst.brand_id,
         bst.vfrom as valley_from,
         bst.vto   as valley_to,
         bst.vorders as valley_orders,
         coalesce((select sum(n) from h where h.brand_id = bst.brand_id), 0) as day_orders
  from best bst;
$$;

revoke all on function public.agent_hourly_signal(uuid) from public;
grant execute on function public.agent_hourly_signal(uuid) to service_role;
