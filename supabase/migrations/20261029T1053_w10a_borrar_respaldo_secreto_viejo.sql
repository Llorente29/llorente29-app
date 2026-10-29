-- supabase/migrations/20261029T1053_w10a_borrar_respaldo_secreto_viejo.sql
--
-- W10a · cierre (29/10/2026). El secreto de order-advance ya está cambiado y
-- comprobado (Julio, 29/10), con el relevo y los _PREV borrados. Queda una
-- copia del VIEJO, escrito en el texto de la trg_sale_push_status de antes de
-- la 1630: el respaldo que guardó la 1630 en funcion_respaldo para su vuelta
-- atrás. Esa fila la copia el volcado de staging (W09) a datos.sql, y su
-- búsqueda de secretos lo para («un secreto interno de Folvy (fv_…)», línea
-- 44700): desde que main aplicó la 1630 en staging (29/10, 10:10 UTC), el
-- volcado está en rojo.
--
-- Esto borra esa fila, y solo esa:
--   firma 'public.trg_sale_push_status()', migración
--   '20261028T1630_w10a_order_advance_secreto_del_vault'.
--
-- Medido el 29/10 con la expresión del volcado (\mfv_<para qué>_<16+>\M), en
-- producción y en staging: es la ÚNICA fila de funcion_respaldo con un secreto
-- así, y ninguna función viva de public lo lleva.
--
-- GUARDA, antes de borrar. Para si algo no cuadra y no toca nada:
--   1. la trg_sale_push_status viva es la de la 1630 (huella corta 385240cb):
--      sin la 1630 aplicada, este respaldo es su única vuelta atrás;
--   2. hay como mucho una fila de esa firma y esa migración, y si la hay es la
--      de antes (huella corta 2470441d).
-- Si la fila ya no está, no hace nada (se puede pasar dos veces).
--
-- SIN VUELTA ATRÁS, a propósito: devolver la fila sería volver a escribir el
-- secreto viejo, que además ya no vale. Desde aquí la vuelta atrás de la 1630
-- (supabase/vuelta-atras/20261028T1630_…down.sql) no puede ejecutarse: su
-- _restaurar_funcion para por falta de respaldo, y está bien que pare,
-- porque dejaría la función con un secreto revocado.

do $$
declare
  v_viva text;
  v_n int;
  v_h text;
begin
  select left(md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), 8) into v_viva;
  if v_viva is distinct from '385240cb' then
    raise exception 'La trg_sale_push_status viva no es la de la 1630 (huella %, se esperaba 385240cb): este respaldo puede ser su única vuelta atrás. No se borra.', v_viva
      using errcode = 'P0001';
  end if;

  select count(*), min(left(huella, 8)) into v_n, v_h
    from public.funcion_respaldo
   where firma = 'public.trg_sale_push_status()'
     and migracion = '20261028T1630_w10a_order_advance_secreto_del_vault';
  if v_n = 0 then
    raise notice 'El respaldo de la 1630 ya no está: nada que borrar.';
    return;
  end if;
  if v_n > 1 or v_h is distinct from '2470441d' then
    raise exception 'El respaldo de la 1630 no es el esperado (% filas, huella %; se esperaba 1 y 2470441d). No se borra.', v_n, v_h
      using errcode = 'P0001';
  end if;

  delete from public.funcion_respaldo
   where firma = 'public.trg_sale_push_status()'
     and migracion = '20261028T1630_w10a_order_advance_secreto_del_vault'
     and left(huella, 8) = '2470441d';
  raise notice 'Borrado el respaldo de la 1630 (el texto de antes, con el secreto viejo).';
end $$;
