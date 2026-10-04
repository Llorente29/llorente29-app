-- ============================================================================
-- R02 · APARTE (1) · SANEADO DE LOS PEDIDOS ABIERTOS AL DESPLEGAR
-- ----------------------------------------------------------------------------
-- Respuesta 1 de Julio: «al desplegar, la misma tanda los sanea (lista de qué
-- pedidos cambia y a qué, en el informe de la migración)».
--
-- VA APARTE porque ESCRIBE en `sale`, una tabla del pedido: el workflow de
-- producción para ante un update sobre una tabla de Cocina y Julio tiene que
-- darle el visto bueno por separado. Va DESPUÉS de los cuatro del R02
-- (0100–0130), que son los que dejan la resolución nueva en su sitio.
--
-- A QUÉ PEDIDOS: los VIVOS de HubRise y Last (status 'open' y order_status
-- que no sea ya un final: completed, cancelled, rejected, delivery_failed),
-- con marca, canal y modalidad de reparto. Las 72 ventas «abiertas» que ya
-- terminaron (pendiente aparte) no se tocan.
--
-- QUÉ LES HACE
--   1. Si su modalidad no es la que da hoy «Quién reparte», se le pone la de
--      «Quién reparte» (con la migración es lo mismo que decidía antes, así
--      que solo cambia lo que estaba mal puesto: un «propio» que se paraba por
--      el interruptor pasa a «la reparte la plataforma»).
--   2. La alarma roja «no_despachado» de un pedido que ya no repartimos, o
--      de un «propio» sin dirección, se quita: con el R02 eso es la etiqueta
--      gris o la ámbar, nunca rojo. El motivo (dispatch_error) se borra con
--      ella.
-- Lo de antes de cada pedido queda en r02_saneado_registro, y la vuelta atrás
-- (supabase/vuelta-atras/20261005T0210_r02_saneado_pedidos_abiertos.down.sql)
-- lo devuelve tal cual.
--
-- La lista de lo que cambia sale al final, en la salida del fichero.
-- ============================================================================

create table if not exists public.r02_saneado_registro (
  sale_id     uuid primary key,
  account_id  uuid not null,
  antes       jsonb not null,
  despues     jsonb,
  saneado_at  timestamptz not null default now()
);
comment on table public.r02_saneado_registro is
  'R02 · Lo que tenía cada pedido abierto antes del saneado del despliegue (para la vuelta atrás). Solo service_role.';
alter table public.r02_saneado_registro enable row level security;
revoke all on table public.r02_saneado_registro from anon, authenticated;

create temp table r02_saneado on commit drop as
select s.id as sale_id, s.account_id, s.platform_order_code as codigo, b.name as marca, sc.slug as canal,
       s.service_type as st_antes,
       case r.delivery_by when 'own' then 'own_delivery' else 'platform_delivery' end as st_despues,
       coalesce(btrim(s.delivery_address), '') <> '' as con_dir,
       s.dispatch_error, s.delivery_alarm_at, s.delivery_alarm_kind, s.delivery_alarm_ack_at
  from public.sale s
  join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
  join public.sales_channel sc on sc.id = s.channel_id and sc.account_id = s.account_id
 cross join lateral public.resolve_delivery_by(s.account_id, s.brand_id, sc.slug, s.location_id) r
 where s.status = 'open'
   and s.order_status not in ('completed', 'cancelled', 'rejected', 'delivery_failed')
   and s.source in ('hubrise', 'lastapp')
   and s.service_type in ('own_delivery', 'platform_delivery');

-- Solo los que cambian algo.
delete from r02_saneado t
 where t.st_antes = t.st_despues
   and not (t.delivery_alarm_kind = 'no_despachado'
            and (t.st_despues = 'platform_delivery' or not t.con_dir));

insert into public.r02_saneado_registro (sale_id, account_id, antes)
select t.sale_id, t.account_id,
       jsonb_build_object('service_type', t.st_antes, 'dispatch_error', t.dispatch_error,
                          'delivery_alarm_at', t.delivery_alarm_at, 'delivery_alarm_kind', t.delivery_alarm_kind,
                          'delivery_alarm_ack_at', t.delivery_alarm_ack_at)
  from r02_saneado t
on conflict (sale_id) do nothing;

-- El disparador de entrada solo recoloca un pedido abierto si se le pide.
select set_config('folvy.reparto_recalcular', 'on', true);

update public.sale s
   set updated_at = now(),
       dispatch_error = case when t.delivery_alarm_kind = 'no_despachado' then null else s.dispatch_error end,
       delivery_alarm_at = case when t.delivery_alarm_kind = 'no_despachado' then null else s.delivery_alarm_at end,
       delivery_alarm_kind = case when t.delivery_alarm_kind = 'no_despachado' then null else s.delivery_alarm_kind end,
       delivery_alarm_ack_at = case when t.delivery_alarm_kind = 'no_despachado' then null else s.delivery_alarm_ack_at end
  from r02_saneado t
 where s.id = t.sale_id;

select set_config('folvy.reparto_recalcular', '', true);

update public.r02_saneado_registro g
   set despues = jsonb_build_object('service_type', s.service_type, 'dispatch_error', s.dispatch_error,
                                    'delivery_alarm_kind', s.delivery_alarm_kind)
  from public.sale s, r02_saneado t
 where g.sale_id = s.id and t.sale_id = s.id;

select t.codigo, t.marca, t.canal, t.st_antes, s.service_type as st_despues, t.con_dir,
       coalesce(t.delivery_alarm_kind, '—') as alarma_antes, coalesce(s.delivery_alarm_kind, '—') as alarma_despues
  from r02_saneado t join public.sale s on s.id = t.sale_id
 order by t.marca, t.codigo;
