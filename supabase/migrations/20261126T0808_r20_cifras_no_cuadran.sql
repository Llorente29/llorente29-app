-- supabase/migrations/20261126T0808_r20_cifras_no_cuadran.sql
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261126_r20_cifras_fiables_prueba.sql
--
-- R20 · Un tipo nuevo en «Pendiente de revisar» (conta_gestoria_diferencia; el CHECK SOLO AMPLÍA: todo lo que hay
-- sigue valiendo): cifras_no_cuadran, lo que deja la comprobación de cada noche (conta-gocardless-leer/cifras.ts)
-- cuando GoCardless y las cuotas de Sumied no cuadran en el mes del próximo cobro (con la diferencia y sus grupos en
-- palabras), o una cifra no es la suma de su lista. De ahí sale en «Lo que tienes que hacer».
--
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261126T0808_r20_cifras_no_cuadran.down.sql

-- «Pendiente de revisar»: un tipo más (los de antes, todos, siguen).
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta', 'fichas_repetidas',
  'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm',
  'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe', 'bitrix_cambiado',
  'linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar',
  'cifras_no_cuadran']::text[]));
