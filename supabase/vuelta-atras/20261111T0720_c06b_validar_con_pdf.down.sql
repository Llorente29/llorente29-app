-- supabase/vuelta-atras/20261111T0720_c06b_validar_con_pdf.down.sql
--
-- Vuelta atrás de 20261111T0720_c06b_validar_con_pdf.sql. Quita el disparador
-- diferido y las tres funciones. No borra ni cambia ningún asiento ni ningún
-- documento: lo validado con su PDF sigue validado con su PDF.
--
-- ANTES, el front tiene que volver al de antes (validar y, después, guardar el
-- PDF): el de la 0720 llama a conta_numero_previsto y a
-- journal_entry_validar_con_documento, y sin ellas no validaría ningún
-- asiento de ventas de una plataforma (lo diría en pantalla, regla 8).
drop trigger if exists trg_journal_entry_valida_con_pdf on public.journal_entry;
drop function if exists public.journal_entry_valida_con_pdf();
drop function if exists public.journal_entry_validar_con_documento(uuid, integer, text, text, text, integer, text);
drop function if exists public.conta_numero_previsto(uuid);
