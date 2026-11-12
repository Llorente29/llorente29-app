-- supabase/vuelta-atras/20261110T0050_gb_bitrix_choques.down.sql
--
-- Vuelta atrás de la 0050 del GB: fuera la función y el tipo. Las diferencias
-- «bitrix_cambiado» que hubiera se borran antes (el CHECK de antes no las
-- admite); lo escrito en Bitrix24 y lo apuntado de la pestaña se quedan.
drop function if exists public.conta_bitrix_pestana_choque(uuid, uuid, jsonb, text[]);
delete from public.conta_gestoria_diferencia where tipo = 'bitrix_cambiado';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm', 'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe']));
