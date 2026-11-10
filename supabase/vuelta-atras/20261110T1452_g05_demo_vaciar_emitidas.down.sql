-- supabase/vuelta-atras/20261110T1452_g05_demo_vaciar_emitidas.down.sql
-- G05 · Vuelta atrás de la 1452: las cuatro protecciones como estaban (de su
-- respaldo, byte a byte) y fuera las dos funciones de la marca. Va en orden:
-- primero las protecciones, que llaman a _conta_demo_vaciando.
select public._restaurar_funcion('public.customer_invoice_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._restaurar_funcion('public.customer_invoice_line_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._restaurar_funcion('public.journal_entry_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._restaurar_funcion('public.journal_line_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
drop function if exists public._conta_demo_permitir_vaciar(uuid);
drop function if exists public._conta_demo_vaciando(uuid);
