-- supabase/vuelta-atras/20261026T0218_v03_verifactu_reenviar.down.sql
--
-- Vuelta atrás de 20261026T0218_v03_verifactu_reenviar: quita la función. Los
-- registros de subsanación que haya escrito se quedan (no se borran: son de
-- Hacienda), y los porqués que cambió, también.
drop function if exists public.verifactu_reenviar(uuid, jsonb, text);
