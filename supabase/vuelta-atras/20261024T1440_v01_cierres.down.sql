-- supabase/vuelta-atras/20261024T1440_v01_cierres.down.sql
--
-- Vuelta atrás de 20261024T1440_v01_cierres. Va DESPUÉS de la de la 1441 (que
-- deja de leer conta_cierre_ajuste). Borra las funciones de la pantalla, las
-- dos tablas (con lo que haya: los cambios de los pedidos en sus cierres y lo
-- puesto en espera; los pedidos de Folvy no los tocó nunca) y las dos
-- columnas. Las facturas resumen ya emitidas se quedan (son facturas: no se
-- borran nunca), y su serie también, sin la columna del canal.

drop function if exists public.conta_cierre_validar(uuid, integer, text, text, text, text, integer, text);
drop function if exists public.conta_cierre_espera(uuid, text, text);
drop function if exists public.conta_cierre_guardar(uuid, jsonb, text);
drop function if exists public._conta_cierre_rehacer(uuid, uuid, date, text, text);
drop function if exists public.conta_cierre_pedidos(uuid);
drop function if exists public.conta_cierres(uuid, date, date);
drop function if exists public.conta_cierre_factura_prevista(uuid);
drop function if exists public._conta_cierre_de(uuid);
drop function if exists public._conta_cierre_serie(uuid, uuid);
alter table public.customer_invoice_payment drop column if exists entry_id;
drop index if exists public.invoice_series_canal_uidx;
alter table public.invoice_series drop column if exists channel_id;
drop table if exists public.conta_cierre_espera;
drop table if exists public.conta_cierre_ajuste;
