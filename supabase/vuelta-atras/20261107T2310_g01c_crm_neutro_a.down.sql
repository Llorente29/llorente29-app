-- supabase/vuelta-atras/20261107T2310_g01c_crm_neutro_a.down.sql
--
-- G01c · La vuelta atrás de la 2310 (PR A): todo como estaba. Confirmar el mapa
-- como antes (del respaldo), fuera las funciones nuevas, y los dos CHECK como
-- estaban. Lo escrito con lo nuevo vuelve a lo de antes: las diferencias de
-- los tipos neutros pasan a su tipo de antes y las lecturas de origen «crm», a
-- «bitrix» (son las de Bitrix24, el único CRM). El secreto de Vault con el
-- nombre nuevo, si una conexión lo creó, sigue valiendo por su id.
-- sin prueba con datos: la prueba de staging (20261107_g01c_crm_neutro_a_prueba.sql) la pasa en ROLLBACK, con filas de los tipos y del origen nuevos, y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

select public._restaurar_funcion('public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)', '20261107T2310_g01c_crm_neutro_a');
drop function if exists public.conta_crm_guardar_conexion(uuid, text, text, text, text, text);
drop function if exists public.conta_crm_secreto(uuid, text);
drop function if exists public._conta_crm_campo_sensible(text, jsonb);

update public.conta_gestoria_diferencia set tipo = case tipo when 'crm_sin_cobro' then 'bitrix_sin_cobro' when 'nif_repetido_en_crm' then 'nif_repetido_en_bitrix'
  else 'correo_repetido_en_bitrix' end
 where tipo in ('crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm');
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos']));
update public.conta_gestoria_lectura set origen = 'bitrix' where origen = 'crm';
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_origen_check;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_origen_check check (origen = any (array['bitrix', 'gocardless']));
