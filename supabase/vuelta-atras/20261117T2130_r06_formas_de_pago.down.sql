-- supabase/vuelta-atras/20261117T2130_r06_formas_de_pago.down.sql
--
-- Vuelta atrás de la 2130 (R06): quita las cinco funciones de las formas de pago.
-- Las cuentas que se hayan guardado con ellas se quedan en conta_tpv_forma_cuenta
-- (la tabla es del R03 y ya se escribía por fila).

drop function if exists public.conta_tpv_formas_guardar(uuid, jsonb, text);
drop function if exists public.conta_tpv_asiento_ejemplo(uuid, jsonb);
drop function if exists public.conta_tpv_formas(uuid, uuid);
drop function if exists public._conta_tpv_cuenta_de(uuid, text, text);
drop function if exists public._conta_tpv_formas_de(uuid, uuid[]);
