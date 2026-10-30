-- supabase/vuelta-atras/20261030T1950_dm1_cuenta_activa.down.sql
--
-- Vuelta atrás de la 1950 (después de la de la 1951, que deja de usar
-- _cuenta_activa): quita las cuatro funciones y la tabla de la cuenta abierta.
drop function if exists public._usuario_por_correo(text);
drop function if exists public.cambiar_empresa(uuid);
drop function if exists public.mis_empresas();
drop function if exists public._cuenta_activa();
drop table if exists public.user_active_account;
