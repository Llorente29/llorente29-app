-- supabase/vuelta-atras/20261125T1329_r19b_sumied_igual_gocardless.down.sql
-- Vuelta atrás del R19 · paso 1: deja cada línea igualada como estaba (su baja y su importe propio de antes, desde lo
-- apuntado), quita lo apuntado, los «Pendiente de revisar» de los tres tipos nuevos, deja el CHECK como estaba y las dos
-- funciones de «Cobros de GoCardless sin cliente» como estaban.
-- (Las líneas que la lectura convirtió de suscripciones nuevas no son de este paso: se quedan.)
update public.conta_linea l
   set hasta = (g.antes->>'hasta')::date,
       importe_propio = case when g.antes->>'importePropioCent' is null then null else (g.antes->>'importePropioCent')::numeric / 100 end,
       updated_at = now(), updated_by_name = 'Vuelta atrás del R19 · paso 1'
  from (select distinct on (linea_id) linea_id, antes from public.conta_gc_igualado order by linea_id, hecho_at asc) g
 where l.id = g.linea_id;
drop table if exists public.conta_gc_igualado;
delete from public.conta_gestoria_diferencia where tipo in ('linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar');
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta', 'fichas_repetidas',
  'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm',
  'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe', 'bitrix_cambiado']::text[]));

-- Las dos funciones de «Cobros de GoCardless sin cliente», como estaban (del respaldo que guardó la migración).
select public._restaurar_funcion('public.conta_lista_que_hacer(uuid)', '20261125T1329_r19b_sumied_igual_gocardless');
select public._restaurar_funcion('public.conta_pantalla_asignar(uuid)', '20261125T1329_r19b_sumied_igual_gocardless');
