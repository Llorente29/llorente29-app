-- supabase/vuelta-atras/20261027T1121_pc01e4_enlace_pago.down.sql
--
-- Vuelta atrás de la 1121 (PC01 · E4 · cobrar con tarjeta y Bizum), que solo
-- añade: se quita todo lo que crea, en orden inverso. Las tablas se van con sus
-- filas (las cuentas de Stripe de las empresas y los enlaces de pago). Lo que
-- ya está en otras tablas se queda, porque es verdad con o sin la 1121: los
-- cobros apuntados (customer_invoice_payment, del motor de la E1) y las frases
-- del historial de cada factura. Las cuentas en Stripe siguen en Stripe: se
-- cierran allí, no aquí.
-- Se puede pasar dos veces (todo «if exists»).

drop function if exists public.conta_enlaces_pago_resumen(uuid);
drop function if exists public.conta_enlace_pago_cobrado(text, text, text, numeric, text, date);
drop function if exists public.conta_enlace_pago_sesion(text, text);
drop function if exists public.conta_enlace_pago_datos(text);
drop function if exists public.conta_enlace_pago_ver(text);
drop function if exists public.conta_enlace_pago_para(uuid);
drop function if exists public.conta_cobro_stripe_de_empresa(uuid);
drop function if exists public.conta_cobro_stripe_de(text);
drop function if exists public.conta_cobro_stripe_apuntar(uuid, text, text, text, boolean, integer, text);
drop function if exists public.conta_cobro_stripe_leer(uuid);
drop table if exists public.conta_enlace_pago;
drop table if exists public.conta_cobro_stripe;
