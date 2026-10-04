-- ============================================================================
-- VUELTA ATRÁS de 20261005T0210_r02_saneado_pedidos_abiertos.sql
-- Devuelve a cada pedido saneado su modalidad, su motivo y su alarma de antes,
-- tal como quedaron en r02_saneado_registro. Solo los que siguen abiertos: un
-- pedido que ya se cerró no se reabre ni se le pinta una alarma vieja.
-- ============================================================================
select set_config('folvy.reparto_tal_cual', 'on', true);

update public.sale s
   set service_type          = g.antes->>'service_type',
       dispatch_error        = g.antes->>'dispatch_error',
       delivery_alarm_at     = (g.antes->>'delivery_alarm_at')::timestamptz,
       delivery_alarm_kind   = g.antes->>'delivery_alarm_kind',
       delivery_alarm_ack_at = (g.antes->>'delivery_alarm_ack_at')::timestamptz,
       updated_at            = now()
  from public.r02_saneado_registro g
 where g.sale_id = s.id
   and s.status = 'open';

select set_config('folvy.reparto_tal_cual', '', true);

select count(*) as pedidos_devueltos from public.r02_saneado_registro g
  join public.sale s on s.id = g.sale_id and s.status = 'open';
