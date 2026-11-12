-- supabase/vuelta-atras/20261109T1500_g05_t4_parar_recibo.down.sql
-- Vuelta atrás de la 1500: los recibos que paró su cliente vuelven a estar sin
-- su marca (por revisar), fuera sus incidencias y las dos funciones, y el
-- CHECK de los tipos de «Pendiente de revisar» como antes.
update public.conta_recibo set parado = array(select x from unnest(parado) x where x not like 'El cliente no está de acuerdo%'), updated_at = now()
 where exists (select 1 from unnest(parado) x where x like 'El cliente no está de acuerdo%');
delete from public.conta_gestoria_diferencia where tipo = 'cliente_no_de_acuerdo';
drop function if exists public.conta_recibo_reanudar(uuid);
drop function if exists public.conta_recibo_parar(uuid, text, text);
drop function if exists public._conta_recibo_marca_cliente();
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm', 'falta_codigo_cliente']));
