-- supabase/vuelta-atras/20261123T0920_k10c_varios_pagos.down.sql
--
-- K10c · vuelta atrás de la 0920: quita las cinco funciones. Los pagos y asientos hechos con ellas se quedan como están
-- (son pagos con su asiento, como los del K06); su historial queda en supplier_invoice_change.
drop function if exists public.conta_recibida_pago_borrar(uuid, text, text);
drop function if exists public.conta_recibida_pago_cambiar(uuid, text, date, numeric, text, text);
drop function if exists public.conta_recibida_pago_se_puede_cambiar(uuid);
drop function if exists public.conta_recibida_pago_apuntar(uuid, uuid, text, date, numeric, text, text);
drop function if exists public._conta_k10c_estado(uuid, text);
drop function if exists public._conta_k10c_en_erp10(uuid);
