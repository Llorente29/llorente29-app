-- supabase/vuelta-atras/20261028T0705_l1a_correcciones_firma_e_informe.down.sql
--
-- Deja la base como antes de la 0705: fuera lo que añadió (funciones, tablas
-- y columnas del rastro). Va DESPUÉS de la vuelta atrás de la 0706, que deja
-- de usar _puede_corregir y las columnas. Se pierden las firmas, los enlaces y
-- las respuestas de conformidad que se hubieran guardado.

drop function if exists public.jornadas_para_revisar(uuid);
drop function if exists public.informe_por_enlace(text);
drop function if exists public.revocar_enlace_inspeccion(text);
drop function if exists public.crear_enlace_inspeccion(uuid, date, date, integer);
drop function if exists public.informe_registro_jornada(uuid, date, date);
drop function if exists public._informe_registro_jornada(uuid, date, date, boolean, boolean);
drop function if exists public.firmar_registro_mes(uuid, date, jsonb);
drop function if exists public.responder_correccion(uuid, boolean, text);

drop table if exists public.registro_jornada_enlace;
drop table if exists public.registro_jornada_firma;

drop function if exists public._puede_corregir(uuid, uuid);
drop function if exists public._huella_registro_mes(uuid, date);
drop function if exists public._mes_madrid(timestamptz);

alter table public.clock_entry_audit
  drop column if exists peticion_id,
  drop column if exists conformidad_nota,
  drop column if exists conformidad_at,
  drop column if exists conformidad;
