-- supabase/vuelta-atras/20261109T2027_g05_apuntar_pendiente.down.sql
-- Vuelta atrás de la 2027: fuera las cuatro funciones. No toca datos: la cuenta de
-- Stripe que se haya puesto con ella se queda (es un ajuste de la 1822), y lo
-- apuntado con el botón es contabilidad.
drop function if exists public.conta_cobro_cuenta_stripe_leer(uuid);
drop function if exists public.conta_recibo_apuntar_pendiente(uuid);
drop function if exists public.conta_cobro_cuenta_stripe_poner(uuid, text);
drop function if exists public._conta_cobro_pendientes_stripe(uuid);
