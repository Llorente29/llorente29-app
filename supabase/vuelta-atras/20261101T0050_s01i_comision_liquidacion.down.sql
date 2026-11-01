-- supabase/vuelta-atras/20261101T0050_s01i_comision_liquidacion.down.sql
--
-- S01i · Vuelta atrás de la 0050: fuera las funciones y la tabla. Lo ligado
-- de antes sigue en channel_settlement.commission_invoice_id, que no se tocó.

drop function if exists public.conta_comision_ligar(uuid, uuid, text);
drop function if exists public._conta_comision_buscar(uuid);
drop function if exists public._conta_comision_ligar(uuid, uuid, text, text);
drop function if exists public._conta_comision_pagar(uuid, boolean);
drop function if exists public.conta_comision_de_la_factura(uuid);
drop function if exists public._conta_comision_estado(uuid);
drop function if exists public._conta_liquidacion_a_facturar(public.channel_settlement);
drop function if exists public._conta_comision_datos(uuid);
drop function if exists public._conta_local_de_texto(uuid, text[]);
drop function if exists public._conta_dir_coincide(text, text);
drop table if exists public.channel_settlement_invoice;
