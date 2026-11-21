-- supabase/vuelta-atras/20261121T0930_x20_subcuenta_con_codigo.down.sql
--
-- X20 · Vuelta atrás de la 0930: quita company_account_add_codigo. Las subcuentas que ya se crearon con
-- ella se quedan (son cuentas de la empresa, como las de company_account_add).

drop function if exists public.company_account_add_codigo(uuid, text, text, text);
