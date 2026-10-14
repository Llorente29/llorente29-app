-- ============================================================================
-- Vuelta atrás de B01 · 2 · las funciones de bancos. Quita las funciones; las
-- tablas y lo que tengan se quedan (las quita 20261101T0100…down.sql).
-- ============================================================================
drop function if exists public.bank_regla_confirmada(uuid);
drop function if exists public.bank_regla_estado(uuid, text);
drop function if exists public.bank_regla_guardar(uuid, uuid, text, jsonb, jsonb, text, text);
drop function if exists public.bank_repetido_resolver(uuid, boolean);
drop function if exists public.bank_ignorar(uuid, text);
drop function if exists public.bank_deshacer(uuid, text);
drop function if exists public.bank_casar(uuid, jsonb, text, text, jsonb, text, uuid);
drop function if exists public.bank_proponer(uuid, text, text, text, jsonb);
drop function if exists public.bank_importar(uuid, text, text, text, text, date, date, numeric, numeric, text, text, jsonb);
drop function if exists public.bank_cuentas_por_dar_de_alta(uuid);
drop function if exists public.bank_cuenta_iban_corregir(uuid, text);
drop function if exists public.bank_cuenta_local(uuid, uuid, boolean);
drop function if exists public.bank_cuenta_alta(uuid, text, text, text, text, uuid, boolean);
drop function if exists public.bank_ajustes_guardar(uuid, smallint, boolean, date);
drop function if exists public._bank_log(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb);
drop function if exists public._bank_ajustes(uuid);
drop function if exists public._bank_cuenta_572(uuid);
drop function if exists public._bank_cuenta_de_empresa(uuid);
