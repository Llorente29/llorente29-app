-- supabase/vuelta-atras/20261121T1110_r14_proveedor_solo_anade.down.sql
--
-- R14 · Vuelta atrás de la 1110: fuera lo que añadió. Los proveedores y subcuentas que
-- Sumied dio de alta AL LEER se quedan (son de verdad); solo se pierde su «Deshacer».
-- Va la última, después de la de la 1120.
drop function if exists public.conta_proveedor_solo_deshacer(uuid, text);
drop function if exists public._conta_proveedor_solo_deshacer(uuid, text);
drop function if exists public._conta_proveedor_solo(uuid, text);
drop function if exists public._r14_partir_direccion(text);
drop function if exists public._r14_unir(uuid, uuid, text, text);
drop table if exists public.conta_proveedor_unido;
drop function if exists public._r14_plataforma_de(uuid, text, text);
drop function if exists public._r14_nombre_clave(text);
drop table if exists public.conta_proveedor_solo;
drop function if exists public.conta_gasto_propuesto(uuid, uuid, uuid);
drop function if exists public._conta_gasto_propuesto(uuid, uuid, uuid);
drop function if exists public._conta_gasto_por_venta(text[]);
drop function if exists public._r14_sin_tildes(text);
drop table if exists public.conta_gasto_por_venta;
