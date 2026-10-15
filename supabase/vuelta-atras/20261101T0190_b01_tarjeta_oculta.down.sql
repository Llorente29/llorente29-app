-- Vuelta atrás de B01 · 0190: quita el disparador y sus funciones. Lo que ya se
-- guardó con las 4 últimas se queda así (no hay número entero que devolver).
drop trigger if exists bank_movement_sin_tarjetas on public.bank_movement;
drop function if exists public._bank_movimiento_sin_tarjetas();
drop function if exists public._bank_ocultar_tarjetas(text);
drop function if exists public._bank_pasa_luhn(text);
