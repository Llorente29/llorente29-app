-- supabase/vuelta-atras/20261101T1234_b01p_pagos_base.down.sql
--
-- Vuelta atrás de la 1234 (B01 Revolut · PR 2a): quita las funciones y las
-- tablas del «Pagar» común. Solo añadía: nada de lo de antes cambia. Si ya
-- hubiera pagos aprobados, se van con sus tablas (en el 2a no sale ninguno: el
-- envío al banco es del 2b).

drop function if exists public.conta_llave_usada(uuid, bigint);
drop function if exists public.conta_llaves_de(uuid, text);
drop function if exists public.conta_llave_de(uuid, text, text);
drop function if exists public.conta_llave_guardar(uuid, uuid, text, text, text, integer, bigint, text, text, text[]);
drop function if exists public.conta_pago_pin_mio();
drop function if exists public.conta_pago_pin_confirmar(uuid, uuid, text, text, text);
drop function if exists public.conta_pago_pin_guardar(uuid, text, text);
drop function if exists public.conta_pago_pin_sal(uuid);
drop function if exists public._conta_pago_segunda_dar(uuid, uuid, text, text, text, uuid);
drop function if exists public.conta_pago_reto_usar(uuid, uuid, text, text);
drop function if exists public.conta_pago_reto_crear(uuid, text, text, text, uuid, text);
drop function if exists public.conta_llave_quitar(uuid);
drop function if exists public.conta_llaves_mias();
drop function if exists public.conta_pago_para_mi(uuid);
drop function if exists public.conta_pago_lote_ver(uuid);
drop function if exists public.conta_pago_cancelar(uuid, text);
drop function if exists public.conta_pago_aprobar(uuid, uuid, jsonb);
drop function if exists public.conta_pago_preparar(uuid, uuid, uuid);
drop function if exists public.conta_pago_topes_poner(uuid, numeric, numeric);
drop function if exists public.conta_pago_topes(uuid);
drop function if exists public.conta_pago_permiso_quitar(uuid, uuid);
drop function if exists public.conta_pago_permiso_dar(uuid, uuid);
drop function if exists public.conta_pago_quien(uuid);
drop function if exists public._conta_pago_motivo(text);
drop function if exists public._conta_pago_factura(uuid, uuid, numeric, text);
drop function if exists public._conta_pago_pendiente(uuid);
drop function if exists public._conta_pago_salida_de(uuid, uuid);
drop function if exists public._conta_pago_aprobado_hoy(uuid);
drop function if exists public._conta_pago_topes(uuid);
drop function if exists public._conta_pago_evento(uuid, uuid, uuid, text, text);
drop function if exists public._conta_pago_huella(uuid);
drop function if exists public._conta_pago_puede_dar(uuid, uuid);
drop function if exists public._conta_pago_pagadores(uuid);
drop function if exists public._conta_pago_puede(uuid, uuid);
drop function if exists public._conta_pago_nombre(uuid);
drop function if exists public._conta_pago_empresa(uuid);

drop table if exists public.conta_pago_pin;
drop table if exists public.conta_pago_reto;
drop table if exists public.conta_llave;
drop table if exists public.conta_pago_evento;
drop table if exists public.conta_pago_salida;
drop table if exists public.conta_pago_lote;
drop table if exists public.conta_pago_ajustes;
drop table if exists public.conta_pago_permiso;

drop function if exists public._conta_pago_de_la_cuenta(uuid);
