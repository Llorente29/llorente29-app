-- supabase/vuelta-atras/20261123T1712_x29_extractos_anade.down.sql
--
-- X29 · Vuelta atrás de la 1712: quita las funciones, la tabla de huellas y las columnas nuevas. Lo borrado a mano
-- se queda borrado (sin su huella, volvería en la siguiente lectura); lo validado pierde la marca.
drop function if exists public.bank_movimiento_borrado_quitar(uuid, text);
drop function if exists public.bank_movimientos_borrar(uuid[], text);
drop table if exists public.bank_movimiento_borrado;
drop function if exists public.bank_quitar_validacion(uuid[]);
drop function if exists public.bank_validar(uuid[], text);
alter table public.conta_user_pref drop column if exists casar_plegado;
alter table public.bank_movement drop column if exists validated_by_name;
alter table public.bank_movement drop column if exists validated_at;
