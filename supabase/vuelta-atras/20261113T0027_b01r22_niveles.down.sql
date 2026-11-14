-- Vuelta atrás de 20261113T0027_b01r22_niveles.sql: quita las dos funciones, la tabla del veredicto
-- y las dos columnas de bank_settings. No toca ningún movimiento ni ningún casado.
drop function if exists public.bank_historial_validado(uuid, date);
drop function if exists public.bank_nivel_veredicto_apuntar(uuid, uuid, text, text, boolean, jsonb, jsonb, text);
drop table if exists public.bank_nivel_veredicto;
alter table public.bank_settings drop column if exists seguro_limite;
alter table public.bank_settings drop column if exists seguro_solo;
