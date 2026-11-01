-- supabase/vuelta-atras/20261101T1234_b01p_pagos_base.down.sql
--
-- Vuelta atrás de la 1234 (B01 Revolut · PR 2a): quita las funciones y las
-- tablas del «Pagar» común. Solo añadía: nada de lo de antes cambia. Si ya
-- hubiera pagos aprobados, se van con sus tablas (en el 2a no sale ninguno: el
-- envío al banco es del 2b).
--
-- Los cierres, todos de entrada y en un solo orden (como la S1b de D, 01/11).
-- Quitar una clave ajena pide cierre exclusivo también sobre la tabla a la que
-- apunta. Primero esas, de la madre a la hija (accounts, company, supplier,
-- treasury_account, supplier_invoice y las remesas); después las de la 1234,
-- de la hija a la madre. Cogerlas a medias dio 40P01 en staging (run
-- 41309002393): teníamos unas y esperábamos otras, y quien escribía en ellas, al
-- revés. Si alguna no se puede coger en 5 s, para sin quitar nada. Una a una y
-- en ese orden (como hace «lock table» con una lista), y solo las que existen:
-- la vuelta atrás también se pasa sin la 1234 puesta (la prueba de staging
-- empieza así).
set local lock_timeout = '5s';
do $$
declare t text;
begin
  foreach t in array array['accounts', 'company', 'supplier', 'treasury_account', 'supplier_invoice', 'conta_pago_remesa', 'conta_pago_remesa_linea',
                           'conta_pago_pin', 'conta_pago_reto', 'conta_pago_evento', 'conta_pago_salida',
                           'conta_llave', 'conta_pago_lote', 'conta_pago_ajustes', 'conta_pago_permiso'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
    end if;
  end loop;
end $$;

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
