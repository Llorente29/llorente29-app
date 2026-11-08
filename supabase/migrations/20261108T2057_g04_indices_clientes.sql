-- supabase/migrations/20261108T2057_g04_indices_clientes.sql
--
-- G04 · URGENTE (Julio, nº 17, 08/11/2026) · Clientes y Tarifa no cargan en
-- producción: «No se ha podido leer cliente empresa: Está tardando más de lo
-- normal». conta_consulta_cliente_empresa, leída como authenticated (con RLS
-- y security_invoker), roza o pasa los 8 s del statement_timeout: 7,7 s
-- medidos el 08/11 con las 1.661 filas de QBO. Por cada fila, sus subconsultas
-- recorren el mandato y las suscripciones de toda la empresa y las 619
-- diferencias vigentes, y la RLS se evalúa en cada fila descartada.
--
-- SOLO AÑADE: siete índices, sobre tablas pequeñas (de 864 a 11.453 filas) y
-- fuera del camino del pedido. No cambia ninguna vista, función ni dato.
--   · conta_consulta_cliente_empresa: el mandato y las suscripciones de un
--     cliente de GoCardless; las diferencias vigentes de un cliente.
--   · conta_consulta_que_hacer (mandatos por firmar): las suscripciones de un
--     mandato.
--   · conta_consulta_cargo_devuelto: los clientes de un cliente de GoCardless
--     y si se cobró después en la misma suscripción.
--   · conta_consulta_tarifa_precio: los tramos de un precio (hoy vacía).
--
-- Lo mide la cuenta de la tanda (scripts/conta/produccion/cuentas/g04-indices.sql):
-- cada vista de la pantalla como authenticated, con un usuario de QBO.
-- Vuelta atrás: supabase/vuelta-atras/20261108T2057_g04_indices_clientes.down.sql

create index if not exists conta_gc_mandato_cliente_idx on public.conta_gc_mandato (company_id, gc_cliente_id);
create index if not exists conta_gc_suscripcion_cliente_idx on public.conta_gc_suscripcion (company_id, gc_cliente_id, estado);
create index if not exists conta_gc_suscripcion_mandato_idx on public.conta_gc_suscripcion (company_id, mandato_gc_id);
create index if not exists conta_gestoria_diferencia_cliente_idx on public.conta_gestoria_diferencia (party_id) where vigente;
create index if not exists conta_cobro_cliente_gc_idx on public.conta_cobro_cliente (company_id, gc_cliente_id);
create index if not exists conta_gc_cobro_suscripcion_idx on public.conta_gc_cobro (company_id, suscripcion_gc_id, fecha);
create index if not exists conta_precio_tramo_precio_idx on public.conta_precio_tramo (precio_id);
