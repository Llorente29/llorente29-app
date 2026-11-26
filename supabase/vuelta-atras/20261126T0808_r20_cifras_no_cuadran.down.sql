-- supabase/vuelta-atras/20261126T0808_r20_cifras_no_cuadran.down.sql
-- Vuelta atrás del R20 (0808): quita los «Pendiente de revisar» del tipo nuevo y deja el CHECK como estaba.
delete from public.conta_gestoria_diferencia where tipo = 'cifras_no_cuadran';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta', 'fichas_repetidas',
  'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm',
  'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe', 'bitrix_cambiado',
  'linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar']::text[]));
