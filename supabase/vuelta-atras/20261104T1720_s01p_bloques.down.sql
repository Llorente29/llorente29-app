-- supabase/vuelta-atras/20261104T1720_s01p_bloques.down.sql
-- Vuelta atrás de la 1720: fuera las funciones de los bloques de «Cerrar el mes».
-- Solo se añadieron; nadie más las llama todavía (la pantalla llega en el paso 5).
drop function if exists public.conta_cierre_mes(uuid, date);
drop function if exists public.conta_cierre_bloque_ventas(uuid, date);
drop function if exists public.conta_cierre_bloque_compras(uuid, date);
drop function if exists public.conta_cierre_bloque_plataformas(uuid, date);
drop function if exists public.conta_cierre_bloque_bancos(uuid, date);
drop function if exists public.conta_cierre_bloque_justificantes(uuid, date);
drop function if exists public.conta_cierre_bloque_laboral(uuid, date);
drop function if exists public.conta_cierre_bloque_repite(uuid, date);
drop function if exists public.conta_cierre_bloque_asientos(uuid, date);
drop function if exists public.conta_cierre_bloque_iva(uuid, date);
drop function if exists public._s01p_bloque(text, text, text, text, jsonb, jsonb, text);
drop function if exists public._s01p_cuenta_de(uuid);
drop function if exists public._s01p_euros(numeric);
