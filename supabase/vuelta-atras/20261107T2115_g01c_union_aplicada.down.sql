-- supabase/vuelta-atras/20261107T2115_g01c_union_aplicada.down.sql
--
-- G01c · La vuelta atrás de la 2115: las dos funciones como estaban (del
-- respaldo) y sin la columna. La unión aplicada se queda en el mapa (mapa.union),
-- que es donde la leía la lectura de antes.
-- sin prueba con datos: la prueba de staging (20261107_g01c_union_aplicada_prueba.sql) la pasa en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

select public._restaurar_funcion('public.conta_crm_aplicar_union(uuid,text)', '20261107T2115_g01c_union_aplicada');
select public._restaurar_funcion('public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)', '20261107T2115_g01c_union_aplicada');
update public.conta_crm set mapa = mapa || jsonb_build_object('union', union_aplicada)
 where union_aplicada is not null and mapa is not null and mapa->'union' is distinct from union_aplicada;
alter table public.conta_crm drop column if exists union_aplicada;
