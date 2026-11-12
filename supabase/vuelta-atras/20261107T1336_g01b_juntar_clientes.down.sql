-- supabase/vuelta-atras/20261107T1336_g01b_juntar_clientes.down.sql
--
-- G01b · La vuelta atrás de la 1336: guardar los clientes como antes (del
-- respaldo) y fuera la función de juntar. Los clientes ya juntados se quedan
-- como están, y su rastro también (la tabla solo se quita si está vacía).
-- sin prueba con datos: la prueba de staging (20261107_g01b_juntar_clientes_prueba.sql) la pasa en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

select public._restaurar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261107T1336_g01b_juntar_clientes');
drop function if exists public._conta_gestoria_juntar(uuid, uuid, uuid, text);
-- El rastro solo se quita si está vacío: si ya se juntó algún cliente, se queda (dice qué se movió).
do $$ begin
  if to_regclass('public.conta_gestoria_union') is not null and not exists (select 1 from public.conta_gestoria_union) then
    drop table public.conta_gestoria_union;
  end if;
end $$;
