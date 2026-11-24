-- supabase/vuelta-atras/20261118T2248_e05_banco_a_mano.down.sql
--
-- E05 · Vuelta atrás de la 2248: quita la función de «Escribir uno a mano». Los
-- asientos que ya se escribieron con ella se quedan: son asientos validados de la
-- serie 3, como cualquier otro, y se corrigen como cualquier otro.
drop function if exists public.conta_banco_a_mano(uuid, date, text, text, numeric, text);
