-- Vuelta atrás de 20261019T0150_diez_importar.sql.
--
-- Quita las cuatro funciones. Lo que ya se haya traído con ellas se queda:
-- son asientos validados y la vuelta atrás no borra libro.

drop function if exists public.conta_diez_cerrar_ejercicio(uuid, text);
drop function if exists public.conta_diez_importar(uuid, uuid, jsonb);
drop function if exists public.conta_diez_subcuentas(uuid, uuid, jsonb);
drop function if exists public.conta_diez_ejercicio(uuid, text, date, date);
