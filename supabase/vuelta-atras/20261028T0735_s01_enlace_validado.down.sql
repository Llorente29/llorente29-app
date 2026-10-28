-- supabase/vuelta-atras/20261028T0735_s01_enlace_validado.down.sql
--
-- Vuelta atrás de la 0735: journal_entry_validar y _s01_asiento_cobro vuelven
-- a ser EXACTAMENTE las de antes, desde su respaldo y con la huella comprobada
-- (_restaurar_funcion); después se quita _journal_entry_validar, que ya no la
-- llama nadie. Los asientos de cobro que nacieron validados se quedan como
-- están: ya están en el libro (si hay que deshacer uno, se anula con su
-- contraasiento, como cualquier otro).

select public._restaurar_funcion('public.journal_entry_validar(uuid,text)', '20261028T0735_s01_enlace_validado');
select public._restaurar_funcion('public._s01_asiento_cobro(uuid,text)', '20261028T0735_s01_enlace_validado');
drop function if exists public._journal_entry_validar(uuid, text);
