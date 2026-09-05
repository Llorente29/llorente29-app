-- B74 · `sales_dashboard` restaba el descuento DOS VECES.
--
-- Calculaba `net = total - refund_amount - discount_amount`, y eso solo seria
-- correcto si `total` fuese bruto. No lo es: `sale.total` YA lleva el descuento
-- restado. Medido sobre los 415 pedidos con descuento de dos semanas: 263
-- cumplen `total + descuento = suma de lineas` al centimo y CERO cumplen
-- `total = suma de lineas`. No hay lectura en la que `total` sea bruto.
--
-- CUANTO: en 30 dias la pantalla enseñaba 55.941,15 € donde se facturaron
-- 66.350,76 €. Un 18,6 % de menos. Y no solo en Ventas: `ventasDelPeriodo.ts`
-- llama a esta misma funcion para el Inicio, asi que el «Ticket medio» de ayer
-- salia 15,79 € cuando era 21,35 €.
--
-- SEGUNDO DEFECTO, que suma en direccion contraria: filtraba `is_active` pero
-- NO `status <> 'cancelled'`, asi que contaba como venta 11 pedidos cancelados
-- (216,33 € en 30 dias). Se arreglan los dos a la vez porque, arreglando solo
-- el descuento, esta pantalla y el generador de informes se quedarian a 119,13 €
-- de distancia en la semana 24->30/08 — y el encargo exige que cuadren.
--
-- El `refund_amount` SE MANTIENE aunque hoy sea 0,00 en el 100 % de las ventas:
-- una devolucion debe restar, y quitarlo seria cambiar la semantica aprovechando
-- que el dato esta vacio.
--
-- CREATE OR REPLACE y no DROP + CREATE: ni la firma ni el tipo de retorno
-- cambian, asi que no se crea sobrecarga (regla 2).
--
-- LO QUE NO SE TOCA, y queda declarado: agrupa `by_location` y `by_brand` por
-- NOMBRE en vez de por id (hoy no cambia ninguna cifra, Foodint no tiene dos
-- locales homonimos), y su espejo `p_from - (p_to - p_from)` desalinea una hora
-- la semana del cambio de hora, que dura `7 days 01:00:00`.
create or replace function public.sales_dashboard(
  p_account_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location_id uuid default null,
  p_brand_id uuid default null,
  p_ownership text default null,
  p_channel text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
  v_result jsonb;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_prev jsonb;
begin
  if not (p_account_id = any(current_user_account_ids())) then
    raise exception 'Sin acceso a la cuenta %', p_account_id;
  end if;

  select coalesce(timezone, 'Europe/Madrid') into v_tz
  from accounts where id = p_account_id;

  -- Periodo anterior de igual duración (para el "vs ayer / vs periodo").
  if p_from is not null and p_to is not null then
    v_prev_from := p_from - (p_to - p_from);
    v_prev_to   := p_from;
  end if;

  with base as (
    select
      s.id,
      (s.sold_at at time zone v_tz) as sold_local,
      -- B74: `total` YA lleva el descuento restado. Restarlo otra vez enseñaba
      -- un 18,6 % de menos.
      coalesce(s.total,0) - coalesce(s.refund_amount,0) as net,
      s.brand_id, s.location_id,
      lower(coalesce(s.external_channel_text,'desconocido')) as canal,
      b.name as brand_name, b.ownership_type, l.name as local_name
    from sale s
    left join brand b on b.id = s.brand_id
    left join locations l on l.id = s.location_id
    where s.account_id = p_account_id
      and s.is_active = true
      -- B74: un pedido cancelado no es una venta.
      and coalesce(s.status,'') <> 'cancelled'
      and (p_from is null or s.sold_at >= p_from)
      and (p_to   is null or s.sold_at <  p_to)
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_brand_id    is null or s.brand_id = p_brand_id)
      and (p_ownership is null or b.ownership_type = p_ownership)
      and (p_channel   is null or lower(s.external_channel_text) = p_channel)
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'net', coalesce(round(sum(net),2),0),
        'orders', count(*),
        'aov', case when count(*)>0 then round(sum(net)/count(*),2) else 0 end
      ) from base
    ),
    'by_channel', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select canal as name, round(sum(net),2) as net, count(*) as orders
        from base group by canal) x
    ),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select brand_name as name, ownership_type, round(sum(net),2) as net, count(*) as orders
        from base where brand_id is not null group by brand_name, ownership_type) x
    ),
    'by_ownership', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select coalesce(ownership_type,'desconocido') as ownership,
               round(sum(net),2) as net, count(*) as orders
        from base group by ownership_type) x
    ),
    'by_location', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select local_name as name, round(sum(net),2) as net, count(*) as orders
        from base where location_id is not null group by local_name) x
    ),
    'by_hour', (
      select coalesce(jsonb_agg(x order by x.hour),'[]'::jsonb) from (
        select extract(hour from sold_local)::int as hour,
               round(sum(net),2) as net, count(*) as orders
        from base group by extract(hour from sold_local)) x
    )
  ) into v_result;

  -- Bloque del periodo anterior. MISMA regla que arriba, a los dos lados.
  if v_prev_from is not null then
    select jsonb_build_object(
      'net', coalesce(round(sum(
        coalesce(s.total,0)-coalesce(s.refund_amount,0)
      ),2),0),
      'orders', count(*)
    ) into v_prev
    from sale s
    left join brand b on b.id = s.brand_id
    where s.account_id = p_account_id
      and s.is_active = true
      and coalesce(s.status,'') <> 'cancelled'
      and s.sold_at >= v_prev_from and s.sold_at < v_prev_to
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_brand_id    is null or s.brand_id = p_brand_id)
      and (p_ownership is null or b.ownership_type = p_ownership)
      and (p_channel   is null or lower(s.external_channel_text) = p_channel);
  else
    v_prev := jsonb_build_object('net', 0, 'orders', 0);
  end if;

  v_result := v_result || jsonb_build_object('prev', v_prev);
  return v_result;
end;
$function$;
