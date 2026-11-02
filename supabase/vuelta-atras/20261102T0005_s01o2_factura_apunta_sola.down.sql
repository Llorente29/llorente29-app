-- supabase/vuelta-atras/20261102T0005_s01o2_factura_apunta_sola.down.sql
--
-- Vuelta atrás de la 0910: fuera la pasada y sus funciones. Lo que ya apuntó
-- (asientos validados, inalterables) se queda: se deshace antes desde
-- «Apuntadas solas» › «Deshacer», que lo anula con su contraasiento.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 's01o2-apunta-solo') then perform cron.unschedule('s01o2-apunta-solo'); end if;
  end if;
end $$;
drop function if exists public._conta_facturas_apuntar_todas();
drop function if exists public._conta_facturas_apuntar(uuid);
drop function if exists public._conta_factura_apuntar(uuid);
drop function if exists public._conta_factura_segura(uuid);
