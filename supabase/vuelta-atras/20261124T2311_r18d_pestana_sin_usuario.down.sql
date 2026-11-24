-- supabase/vuelta-atras/20261124T2311_r18d_pestana_sin_usuario.down.sql
-- Vuelta atrás del R18d: quita las funciones de la pestaña sin usuario de Sumied, la tabla de quién ha mirado y la
-- marca del portal unido. La pestaña vuelve a ser solo para quien tiene usuario de Sumied con su correo.
drop function if exists public.conta_bitrix_pestana_leer_portal(text, text, text, text, text);
drop function if exists public.conta_bitrix_portal_unir(text, text);
drop table if exists public.conta_bitrix_pestana_persona;
alter table public.conta_crm drop column if exists pestana_portal_at, drop column if exists pestana_portal_por;
