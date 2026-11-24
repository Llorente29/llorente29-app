-- supabase/vuelta-atras/20261112T1110_g06_confirmar_enlace.down.sql
--
-- G06 · Vuelta atrás de la 1110: quita las funciones de confirmar, «sin ficha», deshacer y la de guardar de la
-- lectura; devuelve el CHECK de estado y _conta_gestoria_juntar (del respaldo que guardó la 1110) a como estaban, y quita
-- la columna antes. Lo que una persona haya dicho «sin ficha» se pierde (solo vivía aquí); lo confirmado con
-- «Es esta» sigue en conta_gestoria_decision y en los dos enlaces de antes, y la lectura lo vuelve a escribir.
drop function if exists public.conta_gc_enlace_deshacer(uuid, text);
drop function if exists public.conta_gc_enlace_sin_ficha(uuid, text);
drop function if exists public.conta_gc_enlace_confirmar(uuid, text, uuid);
drop function if exists public._conta_gc_enlace_guardar(jsonb);
delete from public.conta_gc_enlace where estado = 'sin_ficha';
alter table public.conta_gc_enlace
  drop constraint conta_gc_enlace_estado_check,
  add constraint conta_gc_enlace_estado_check check (estado in ('atado', 'propuesto', 'conflicto'));
alter table public.conta_gc_enlace drop column if exists antes;
select public._restaurar_funcion('public._conta_gestoria_juntar(uuid,uuid,uuid,text)', '20261112T1110_g06_confirmar_enlace');
