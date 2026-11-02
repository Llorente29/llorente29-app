-- supabase/vuelta-atras/20261102T0830_n1d_ficha.down.sql
--
-- Vuelta atrás de la 0830: fuera lab_ficha, lab_poner_categoria, lab_poner_iban
-- y sus ayudas. Las categorías y los IBAN ya puestos se quedan en lab_contrato_condicion y lab_cambio.
drop function if exists public.lab_poner_iban(uuid, text);
drop function if exists public._lab_iban_valido(text);
drop function if exists public.lab_poner_categoria(uuid, text, text);
drop function if exists public.lab_ficha(uuid);
drop function if exists public._lab_cat(text, text);
