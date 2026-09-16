-- ============================================================================
-- APLICADA el 16/09 a las 15:59:08 UTC = 17:59 de Madrid.
--
-- Un pedido de HubRise sin ningún aviso de estado dejaba `anulado_plataforma`
-- en NULL, porque `null in ('cancelled','rejected')` es NULL, no false. La
-- columna es NOT NULL y abortó la pasada entera del 15/09 (G800, `3qq6pj3`).
--
-- Lo cazó la prueba contra el día de verdad; con ejemplos inventados habría
-- pasado en verde (regla 31). Y el NOT NULL hizo su trabajo: la pasada abortó
-- ENTERA y dejó la tabla a cero filas, no a medias.
--
-- El fichero de la pasada (20260916155814) lleva ya este arreglo dentro. Este
-- queda para que una base virgen reproduzca la misma secuencia.
-- ============================================================================

create or replace function public._parte_plataformas_propias(
  p_account_id uuid, p_dia date
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ini timestamptz := (p_dia::timestamp at time zone 'Europe/Madrid');
  v_fin timestamptz := ((p_dia+1)::timestamp at time zone 'Europe/Madrid');
  v_n   integer;
begin
  with ventas as (
    select s.id, s.location_id, s.external_ref, s.pos_short_code, s.total,
           (coalesce(s.status,'') = 'cancelled'
            or coalesce(s.order_status,'') in ('cancelled','rejected')) as anulada
    from sale s
    where s.account_id = p_account_id and s.source = 'hubrise'
      and s.sold_at >= v_ini and s.sold_at < v_fin
      and s.external_ref is not null
  ),
  avisos as (
    select distinct ew.payload->>'order_id' as oid
    from external_webhook_log ew
    where ew.source = 'hubrise' and ew.note = 'frontera-order-create'
      and ew.created_at >= v_ini and ew.created_at < v_fin
  ),
  estados as (
    select ew.payload->>'order_id' as oid,
           (array_agg(ew.payload->'new_state'->>'status' order by ew.created_at desc))[1] as ultimo
    from external_webhook_log ew
    where ew.source = 'hubrise' and ew.note = 'frontera-order-update'
      and ew.created_at >= v_ini and ew.created_at < v_fin + interval '6 hours'
    group by 1
  ),
  -- Las dos caras: la venta que tenemos, y el aviso que llegó. Un aviso sin
  -- venta también es una fila: es justo lo que hay que ver.
  claves as (
    select v.external_ref as ref from ventas v
    union
    select a.oid from avisos a
  ),
  filas as (
    select p_account_id as account_id, p_dia as dia, 'hubrise'::text as plataforma,
           k.ref as pedido_ref, v.location_id, v.id as sale_id, v.pos_short_code as pedido_corto,
           (a.oid is not null) as en_plataforma,
           (v.id is not null) as en_folvy,
           -- coalesce OBLIGATORIO: `e.ultimo` es null cuando ese pedido no tiene
           -- ningún aviso de estado, y `null in (...)` es NULL, no false. Lo cazó
           -- el NOT NULL de la columna al probar contra el 15/09 de verdad
           -- (G800, 3qq6pj3): con ejemplos inventados habría pasado (regla 31).
           coalesce(e.ultimo in ('cancelled','rejected'), false) as anulado_plataforma,
           coalesce(v.anulada, false) as anulado_folvy,
           null::numeric as importe_plataforma, v.total as importe_folvy,
           'aviso'::text as origen,
           case when a.oid is null then 'solo lo que dice Folvy: no hay aviso de creación'
                when v.id is null then 'solo el aviso: la venta no está en Folvy'
                else 'aviso y venta' end as visto_en
    from claves k
    left join ventas  v on v.external_ref = k.ref
    left join avisos  a on a.oid = k.ref
    left join estados e on e.oid = k.ref
  )
  insert into public.parte_plataformas as t (
    account_id, dia, plataforma, pedido_ref, location_id, sale_id, pedido_corto,
    en_plataforma, en_folvy, anulado_plataforma, anulado_folvy,
    importe_plataforma, importe_folvy, origen, visto_en)
  select * from filas
  on conflict (account_id, dia, plataforma, pedido_ref) do update set
    location_id = excluded.location_id, sale_id = excluded.sale_id,
    pedido_corto = excluded.pedido_corto,
    en_plataforma = excluded.en_plataforma or t.en_plataforma,
    en_folvy = excluded.en_folvy,
    anulado_plataforma = excluded.anulado_plataforma or t.anulado_plataforma,
    anulado_folvy = excluded.anulado_folvy,
    importe_folvy = excluded.importe_folvy,
    origen = case when t.origen = 'listado' then 'listado' else excluded.origen end,
    visto_en = excluded.visto_en,
    updated_at = now()
  -- Solo escribe si algo CAMBIA. Sin esto, una segunda pasada del mismo día
  -- reescribía las 145 filas para dejarlas igual, y el número que devuelve no
  -- significaba nada. Con esto, un recuento distinto de cero en una pasada
  -- posterior dice que de verdad ha cambiado algo (regla 8: lo que informa,
  -- informa de algo).
  where (t.location_id, t.sale_id, t.pedido_corto, t.en_plataforma, t.en_folvy,
         t.anulado_plataforma, t.anulado_folvy, t.importe_folvy, t.origen, t.visto_en)
        is distinct from
        (excluded.location_id, excluded.sale_id, excluded.pedido_corto,
         excluded.en_plataforma or t.en_plataforma, excluded.en_folvy,
         excluded.anulado_plataforma or t.anulado_plataforma, excluded.anulado_folvy,
         excluded.importe_folvy,
         case when t.origen = 'listado' then 'listado' else excluded.origen end,
         excluded.visto_en);

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public._parte_plataformas_propias(uuid, date) from public, anon, authenticated;
grant execute on function public._parte_plataformas_propias(uuid, date) to service_role;
