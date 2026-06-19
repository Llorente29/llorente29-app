-- supabase/migrations/20260619T0900_sale_canonical_fields.sql
-- Aplicada: 2026-06-19
--
-- CAMPOS CANÓNICOS DE PEDIDO (agnósticos de canal).
-- El feed de Orders muestra cliente, dirección, hora prometida y nota del cliente.
-- Hoy esos datos viven solo dentro de raw_tab (JSON con la forma de CADA canal:
-- HubRise una, Otter otra...). Leerlos en caliente ataría la pantalla al formato
-- de cada canal. En su lugar, CADA ADAPTADOR de entrada (HubRise hoy, Otter/Last
-- mañana) extrae estos datos de SU JSON a estas columnas canónicas, y la pantalla
-- (RPC orders_feed) las lee iguales para todos. raw_tab se conserva intacto como
-- respaldo/auditoría (raw event store). Principio: frontera única + canónico.
--
-- Aditiva e idempotente. No toca datos existentes (el backfill va aparte).

alter table public.sale add column if not exists customer_name    text;
alter table public.sale add column if not exists customer_phone   text;
alter table public.sale add column if not exists delivery_address text;
alter table public.sale add column if not exists expected_time    timestamptz;  -- hora prometida (entrega o recogida)
alter table public.sale add column if not exists customer_note    text;          -- nota del cliente a nivel pedido

comment on column public.sale.customer_name    is 'Canónico. Nombre del cliente. Lo rellena el adaptador de canal desde su raw_tab.';
comment on column public.sale.customer_phone   is 'Canónico. Teléfono del cliente. Lo rellena el adaptador de canal.';
comment on column public.sale.delivery_address is 'Canónico. Dirección de entrega (texto compuesto). NULL en recogida. Lo rellena el adaptador.';
comment on column public.sale.expected_time    is 'Canónico. Hora prometida (entrega si delivery, recogida si collection). Lo rellena el adaptador.';
comment on column public.sale.customer_note    is 'Canónico. Nota del cliente a nivel pedido. Lo rellena el adaptador (HubRise: customer_notes).';
