-- supabase/vuelta-atras/20261124T0835_x31_antes_de_enviar_mirar.down.sql
-- X31 · Quita las dos decisiones, devuelve la cola a su respaldo y el estado a su CHECK de antes (lo que esté en duda
-- vuelve a «no pudo», para que el CHECK de antes lo admita), y quita las columnas nuevas.
drop function if exists public.conta_erp10_envio_es_otro(uuid, text);
drop function if exists public.conta_erp10_envio_es_la_misma(uuid, boolean, text);
select public._restaurar_funcion('public.conta_erp10_cola(integer)', '20261124T0835_x31_antes_de_enviar_mirar');
update public.conta_erp10_envio set estado = 'no_pudo', motivo = coalesce(motivo, 'Estaba en duda (X31, deshecho).') where estado = 'duda';
alter table public.conta_erp10_envio drop constraint if exists conta_erp10_envio_estado_check;
alter table public.conta_erp10_envio add constraint conta_erp10_envio_estado_check check (estado in ('enviando', 'en_erp10', 'no_pudo'));
alter table public.conta_erp10_envio drop column if exists alta_pedida_en;
alter table public.conta_erp10_envio drop column if exists decision_en;
alter table public.conta_erp10_envio drop column if exists decision_por;
alter table public.conta_erp10_envio drop constraint if exists conta_erp10_envio_decision_valores;
alter table public.conta_erp10_envio drop column if exists decision;
alter table public.conta_erp10_envio drop column if exists duda;
