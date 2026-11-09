-- supabase/vuelta-atras/20261109T1822_g05_portal_pagos.down.sql
-- Vuelta atrás de la 1822: fuera las funciones y la tabla de los pagos desde el
-- portal, las marcas «portal_…» de «Cobrado por otra vía» (el CHECK como antes)
-- y la columna de la puente de Stripe. La 57200003 de la demo se queda en su
-- plan (es una subcuenta con su registro; se oculta desde la pantalla del plan).
drop function if exists public.conta_cobro_cuenta_cambiada(uuid, uuid, text, text, text[], text);
drop function if exists public.conta_recibo_pagado_portal(uuid, text, numeric, text);
drop function if exists public._conta_cobro_facturar_portal(uuid, date, text, text, text);
drop function if exists public._conta_cobro_puente(uuid, text, text, text, text);
drop table if exists public.conta_recibo_pago_portal;
delete from public.conta_gc_cobro_otra_via where via in ('portal_banco', 'portal_tarjeta');
alter table public.conta_gc_cobro_otra_via drop constraint if exists conta_gc_cobro_otra_via_via_check;
alter table public.conta_gc_cobro_otra_via add constraint conta_gc_cobro_otra_via_via_check check (via = any (array['transferencia'::text, 'efectivo'::text]));
alter table public.conta_gestoria_ajustes drop column if exists cuenta_stripe;
