-- 20260708T2700_sale_rider_extra.sql
--
-- Reparto Catcher: guardar lo que el webhook HOY tira (visto en los payloads reales de
-- Abdul, 07/07). Additivo, no rompe nada. Para que cocina vea lo mismo que el dispatcher
-- de Catcher: repartidor + teléfono (ya) + TIPO de vehículo + última posición + hora.
--
--   rider_transport_type : 'moto' | 'bici' | 'coche' ... (courier.transportType)
--   rider_lat / rider_lng: posición del rider EN EL ÚLTIMO CAMBIO DE ESTADO (no es
--                          streaming en vivo; el contrato de Catcher manda posición por
--                          evento, no continua → "última posición vista").
--   rider_seen_at        : cuándo se recibió esa posición/estado (para "visto a las HH:MM").
--   has_courier          : booleano limpio "¿ya hay repartidor asignado?" (courier.hasCourier).

alter table public.sale
  add column if not exists rider_transport_type text,
  add column if not exists rider_lat numeric,
  add column if not exists rider_lng numeric,
  add column if not exists rider_seen_at timestamptz,
  add column if not exists has_courier boolean;
