-- supabase/vuelta-atras/20261124T1730_r18b_actualizar_bitrix.down.sql
-- Vuelta atrás del R18b: quita las funciones del interruptor «Actualizar Bitrix24» y de la clave para escribir,
-- y sus columnas en conta_crm. La clave guardada en Vault («conta_crm:<crm>:<cuenta>:escribir») se queda: se
-- borra a mano si hace falta (no se pierde nada de la conexión de leer).
drop function if exists public.conta_crm_escribir_de_portal(text);
drop function if exists public.conta_crm_actualizar_estado(uuid, text);
drop function if exists public.conta_crm_clave_escribir_guardar(uuid, text, text, text);
drop function if exists public.conta_crm_actualizar_poner(uuid, text, boolean, text);
drop function if exists public._conta_es_admin_plataforma();
alter table public.conta_crm drop column if exists actualizar, drop column if exists actualizar_por_name, drop column if exists actualizar_at,
  drop column if exists escribir_ref, drop column if exists escribir_por_name, drop column if exists escribir_at;
