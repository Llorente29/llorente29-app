-- supabase/vuelta-atras/20261101T1731_s01o_plataforma_apunta_sola.down.sql
--
-- Vuelta atrás de la 1731: fuera la pasada, sus funciones y su tabla. Lo que ya
-- apuntó (asientos validados, inalterables) se queda: se deshace con «Deshacer»
-- (que anula su asiento) antes de quitar esto, o con la vuelta atrás de la 1732.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 's01o-apunta-solo';
  end if;
end $$;
drop function if exists public._conta_plataformas_apuntar_todas();
drop function if exists public.conta_apuntada_sola_deshacer(uuid, text);
drop function if exists public.conta_apuntadas_solas(uuid);
drop function if exists public._conta_plataformas_apuntar(uuid);
drop function if exists public._conta_plataforma_apuntar(uuid);
drop function if exists public._conta_s01o_periodo(date, date);
drop function if exists public._conta_plataforma_seguro(uuid);
drop table if exists public.supplier_invoice_auto;
