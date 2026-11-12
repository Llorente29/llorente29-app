-- supabase/vuelta-atras/20261109T1006_g05_cobro_base.down.sql
--
-- Vuelta atrás de la 1006 del G05: quita las funciones, las tablas del cobro
-- (conta_cobro_mes, conta_recibo y conta_recibo_evento, con sus filas), las
-- columnas nuevas de los ajustes, de invoice_series y de conta_cobro_cliente,
-- y el tipo «falta_codigo_cliente» de las diferencias (con sus filas).
-- Va después de la vuelta atrás de la 1007 (que deja de leer
-- invoice_series.formato). Las facturas y los asientos que ya se hicieran se
-- quedan: son de la contabilidad, no del cobro.

drop function if exists public.conta_pantalla_cobro(uuid, uuid, text);
drop function if exists public.conta_cobro_modo_codigo(uuid, text);
drop function if exists public.conta_cobro_codigo_poner(uuid, uuid, int);
drop function if exists public._conta_cobro_codigos(uuid);
drop function if exists public._conta_cobro_falta_codigo();
drop function if exists public.conta_cobro_aprobar_iguales(uuid, text);
drop function if exists public.conta_cobro_decidir(uuid, text);
drop function if exists public.conta_cobro_seguir(uuid);
drop function if exists public._conta_cobro_devolver(uuid);
drop function if exists public._conta_cobro_facturar(uuid);
drop function if exists public.conta_cobro_no_enviado(uuid, text, text);
drop function if exists public.conta_cobro_enviado(uuid, text, text, date, text, text, uuid, text);
drop function if exists public.conta_cobro_para_enviar(uuid, text);
drop function if exists public.conta_cobro_guardar(uuid, text, jsonb, jsonb, text);
drop function if exists public._conta_cobro_asiento(uuid, date, text, text, uuid, uuid, jsonb, text, uuid);
drop function if exists public._conta_cobro_dejar(jsonb);
drop function if exists public._conta_cobro_como(uuid, uuid);
drop function if exists public._conta_cobro_estado(text, boolean);
drop function if exists public._conta_cobro_cuenta_cliente(uuid, uuid, text);
drop function if exists public._conta_cobro_cuenta(uuid, text, text, text);
drop function if exists public._conta_cobro_ajustes(uuid);
drop function if exists public._conta_cobro_evento(uuid, text, text, jsonb, text);

drop table if exists public.conta_recibo_evento;
drop table if exists public.conta_recibo;
drop table if exists public.conta_cobro_mes;

drop index if exists public.conta_cobro_cliente_codigo;
alter table public.conta_cobro_cliente drop constraint if exists conta_cobro_cliente_codigo_cliente;
alter table public.conta_cobro_cliente drop column if exists codigo_cliente;
alter table public.invoice_series drop column if exists formato;
alter table public.conta_gestoria_ajustes drop constraint if exists conta_gestoria_ajustes_retencion_pct;
alter table public.conta_gestoria_ajustes drop constraint if exists conta_gestoria_ajustes_dias_cobro;
alter table public.conta_gestoria_ajustes drop constraint if exists conta_gestoria_ajustes_codigo_cliente_modo;
alter table public.conta_gestoria_ajustes drop column if exists codigo_cliente_modo;
-- Los «Pendiente de revisar» de «Falta su código de cliente» se van, y el CHECK de los tipos vuelve a ser el de antes.
delete from public.conta_gestoria_diferencia where tipo = 'falta_codigo_cliente';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm']));
alter table public.conta_gestoria_ajustes
  drop column if exists precios_con_iva, drop column if exists iva_pct, drop column if exists retencion_pct, drop column if exists serie_cobro,
  drop column if exists dia_aviso, drop column if exists dia_cargo, drop column if exists prefijo_cliente, drop column if exists cuenta_ingresos,
  drop column if exists cuenta_iva, drop column if exists cuenta_retencion, drop column if exists cuenta_plataforma, drop column if exists cuenta_banco;
