-- supabase/vuelta-atras/20261026T0226_v03_verifactu_otros_programas.down.sql
--
-- Vuelta atrás de 20261026T0226_v03_verifactu_otros_programas: quita la
-- función y la columna (lo que hubieran dicho las empresas se pierde: solo
-- servía para el aviso de la pantalla).
drop function if exists public.verifactu_otros_programas(uuid, text[], text);
alter table public.verifactu_empresa drop column if exists otros_programas;
