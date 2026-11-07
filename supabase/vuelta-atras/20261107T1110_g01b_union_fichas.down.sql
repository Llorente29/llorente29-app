-- supabase/vuelta-atras/20261107T1110_g01b_union_fichas.down.sql
--
-- G01b · La vuelta atrás de la 1110: confirmar el mapa como antes (del
-- respaldo), fuera aplicar la unión, guardar los clientes y la tabla de fichas;
-- el mapa sin la unión aplicada; las diferencias de los tipos nuevos fuera y
-- el CHECK de antes. Los clientes ya unidos se quedan como están (son clientes
-- de Sumied); la próxima lectura, con la función de antes, guarda ficha a ficha.
-- sin prueba con datos: la prueba de staging (20261107_g01b_union_fichas_prueba.sql) la pasa en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

drop function if exists public.conta_bitrix_aplicar_union(uuid);
drop function if exists public.conta_bitrix_guardar_clientes(uuid, jsonb);
drop table if exists public.conta_gestoria_ficha;
update public.conta_crm_bitrix set mapa = mapa - 'union', updated_at = now() where mapa ? 'union';
delete from public.conta_gestoria_diferencia where tipo in ('fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada');
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo in (
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix',
  'correo_repetido_en_bitrix', 'nif_distinto', 'suscripcion_sin_convertir', 'totales_distintos',
  'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta'));

select public._restaurar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261107T1110_g01b_union_fichas');
drop function if exists public._conta_bitrix_campo_sensible(jsonb);
