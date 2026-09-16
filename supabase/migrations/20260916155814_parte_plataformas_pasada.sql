-- ============================================================================
-- §3.3 — LA PASADA QUE LLENA EL CRUCE, UNA VEZ AL DÍA.
--
-- APLICADA el 16/09 a las 15:58:14 UTC = 17:58 de Madrid, en TRES trozos,
--     porque la prueba contra el día real encontró dos cosas. Este fichero
--     lleva el estado final; en producción quedaron registradas así:
--       · 20260916155814  parte_plataformas_pasada            (lo primero)
--       · 20260916155908  parte_plataformas_propias_null_no_es_false
--       · 20260916160031  parte_plataformas_solo_escribe_si_algo_cambia
--     Los dos últimos están también como fichero, para que una base virgen
--     reproduzca la misma secuencia.
--
--     Lo probado: pasada sobre el 15/09 y el 14/09 → 145 filas, 145 claves
--     distintas. Pasada otra vez → 0 y 0: no escribe de nuevo. Y el cruce ve
--     lo que tiene que ver: U977 del 14/09, anulado en Last y vivo en Folvy.
--
-- Dos funciones, una por plataforma, SIN una línea compartida (§3.3: ninguna
-- relación entre las dos ni en código ni en pantalla), y una tercera que las
-- llama para un día y una cuenta.
--
-- De momento llenan con `origen='aviso'`: lo que ya está dentro de la base.
--   · Cedidas: `lastapp_webhook_log` con note='frontera-tab-cancelled',
--     casando `payload->'data'->>'name'` con `sale.platform_order_code`.
--     Medido el 16/09: de 85 tab:cancelled de 30 días, 79 existen en Folvy y
--     29 siguen vivos (751,33 €). El aviso llega; lo que falla es aplicarlo, y
--     eso es de la otra sesión.
--   · Propias: `external_webhook_log` con source='hubrise',
--     note='frontera-order-create' y '-update', casando `payload->>'order_id'`
--     con `sale.external_ref`. El 15/09: 24 de 24.
--
-- Lo que NO hace todavía, y por eso el parte lo dice en el pie: pedir el
-- LISTADO del día a cada plataforma. Es lo único que ve un pedido cuyo aviso
-- nunca llegó. Last se pide con
-- GET https://api.last.app/v2/bills?locationId=…&startDate=…&endDate=…&limit=100
-- (ojo al techo de 100 por día y local: hay que paginar o cantar el
-- desbordamiento). HubRise necesita `orders.read`, que hoy no está en la lista
-- blanca de scopes.
--
-- Idempotente: se puede pasar dos veces el mismo día sin escribir dos veces.
-- ============================================================================

create or replace function public._parte_plataformas_cedidas(
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
    select s.id, s.location_id, s.platform_order_code, s.pos_short_code, s.total,
           (coalesce(s.status,'') = 'cancelled'
            or coalesce(s.order_status,'') in ('cancelled','rejected')) as anulada
    from sale s
    where s.account_id = p_account_id and s.source = 'lastapp'
      and s.sold_at >= v_ini and s.sold_at < v_fin
      and s.platform_order_code is not null
  ),
  -- El aviso de anulación puede llegar de madrugada: se mira hasta dos días.
  anuladas_en_last as (
    select distinct wl.payload->'data'->>'name' as code
    from lastapp_webhook_log wl
    where wl.note = 'frontera-tab-cancelled'
      and wl.received_at >= v_ini and wl.received_at < v_fin + interval '2 days'
  ),
  filas as (
    select p_account_id as account_id, p_dia as dia, 'last'::text as plataforma,
           v.platform_order_code as pedido_ref, v.location_id, v.id as sale_id,
           v.pos_short_code as pedido_corto,
           (a.code is not null) as en_plataforma,   -- del aviso solo sabemos de los anulados
           true as en_folvy,
           (a.code is not null) as anulado_plataforma,
           v.anulada as anulado_folvy,
           null::numeric as importe_plataforma, v.total as importe_folvy,
           'aviso'::text as origen,
           case when a.code is not null then 'aviso de anulación de Last' else 'solo lo que dice Folvy' end as visto_en
    from ventas v left join anuladas_en_last a on a.code = v.platform_order_code
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
    -- una fila que ya venía del listado NO baja a 'aviso'
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

comment on function public._parte_plataformas_cedidas(uuid, date) is
'Llena el cruce de las CEDIDAS (Last) de un día, con lo que ya está en la base. Casa por platform_order_code. No toca nada de las propias. §3.3.';

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

comment on function public._parte_plataformas_propias(uuid, date) is
'Llena el cruce de las PROPIAS (HubRise) de un día, con los avisos que ya están en la base. Casa por external_ref contra el order_id del aviso. No toca nada de las cedidas. §3.3.';

create or replace function public.parte_plataformas_refresh(
  p_account_id uuid, p_dia date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_ced integer; v_pro integer;
begin
  v_ced := public._parte_plataformas_cedidas(p_account_id, p_dia);
  v_pro := public._parte_plataformas_propias(p_account_id, p_dia);
  return jsonb_build_object('dia', p_dia, 'cedidas', v_ced, 'propias', v_pro);
end;
$fn$;

comment on function public.parte_plataformas_refresh(uuid, date) is
'Rehace el cruce de un día para una cuenta. Idempotente. §3.3.';

-- La pasada de cada mañana: ayer y anteayer, solo cuentas vivas y no internas.
-- Dos días a propósito: un aviso de anulación puede llegar de madrugada.
create or replace function public.cron_parte_plataformas(p_days integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cuentas integer := 0; v_dias integer := 0;
  v_ced integer := 0; v_pro integer := 0;
  r record; d date; j jsonb;
begin
  for r in
    select a.id from public.accounts a
    where a.status = 'active' and coalesce(a.is_internal, false) = false
  loop
    v_cuentas := v_cuentas + 1;
    for i in 1..greatest(coalesce(p_days,2),1) loop
      d := ((now() at time zone 'Europe/Madrid')::date - i);
      j := public.parte_plataformas_refresh(r.id, d);
      v_ced := v_ced + coalesce((j->>'cedidas')::int, 0);
      v_pro := v_pro + coalesce((j->>'propias')::int, 0);
      v_dias := v_dias + 1;
    end loop;
  end loop;

  -- Regla 8: una pasada que no cuenta lo que ha hecho es una pasada que no se
  -- puede creer. pg_cron guarda este NOTICE.
  raise notice 'cron_parte_plataformas: % cuentas, % días, % cedidas, % propias',
    v_cuentas, v_dias, v_ced, v_pro;

  return jsonb_build_object('cuentas', v_cuentas, 'dias', v_dias,
                            'cedidas', v_ced, 'propias', v_pro);
end;
$fn$;

comment on function public.cron_parte_plataformas(integer) is
'La pasada de cada mañana del cruce con las plataformas: ayer y anteayer, solo cuentas activas y no internas. §3.3.';

revoke all on function public._parte_plataformas_cedidas(uuid, date) from public, anon, authenticated;
revoke all on function public._parte_plataformas_propias(uuid, date) from public, anon, authenticated;
revoke all on function public.parte_plataformas_refresh(uuid, date) from public, anon;
revoke all on function public.cron_parte_plataformas(integer) from public, anon, authenticated;
grant execute on function public._parte_plataformas_cedidas(uuid, date) to service_role;
grant execute on function public._parte_plataformas_propias(uuid, date) to service_role;
grant execute on function public.parte_plataformas_refresh(uuid, date) to service_role;
grant execute on function public.cron_parte_plataformas(integer) to service_role;

-- El cron. 06:00 de Madrid = 04:00 UTC. Va antes del aviso de las 08:30.
select cron.schedule('parte-plataformas-diario', '0 4 * * *',
                     $cron$select public.cron_parte_plataformas(2)$cron$);
