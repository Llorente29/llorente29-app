-- Vuelta atrás de 20261009T0140_c03_funciones.sql: quita las funciones del C03.
-- Lo que hayan escrito (clientes, cobros, borradores) se queda; lo quitan las
-- vueltas atrás de las tablas (0120 y 0100).
drop function if exists public.brand_licensing_agreement_set_party(uuid, uuid);
drop function if exists public.brand_partner_settlement_confirm(uuid, numeric, text);
drop function if exists public.brand_partner_settlement_prepare(uuid, uuid, date, date, text);
drop function if exists public.brand_partner_settlement_compute(uuid, uuid, date, date);
drop function if exists public.channel_settlement_confirm_period(uuid);
drop function if exists public.channel_settlement_uncollect(uuid);
drop function if exists public.channel_settlement_collect(uuid, date, numeric, text, text);
drop function if exists public.party_set_archived(uuid, boolean, text);
drop function if exists public.party_add_role(uuid, text, jsonb);
drop function if exists public.party_save_customer(uuid, uuid, text, text, jsonb, text);
drop function if exists public.party_cuenta(uuid);
