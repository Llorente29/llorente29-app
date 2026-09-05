-- C9 · Lote 2 §5 (04/09/2026). El cron que despierta la purga.
--
-- 04:15 UTC = 06:15 de Madrid en horario de verano. Fuera de servicio en los
-- dos locales por bastante margen, y despues de la ventana de despliegue de la
-- noche (la banda prohibida acaba a las 23:45).
--
-- ORDEN QUE IMPORTA: la edge function `order-evidence-purge` se despliega por
-- CI esta noche. Si el despliegue se retrasa, la primera ejecucion devolvera
-- 404 y quedara registrada en net._http_response; no se pierde nada, porque
-- `sale_capture` esta VACIA y no hay ninguna foto que purgar todavia.
--
-- El secreto es el mismo `cron_secret` que ya usan edge-drift-watchdog y los
-- demas vigias: ni una llave nueva.

select cron.unschedule('order-evidence-purge')
 where exists (select 1 from cron.job where jobname = 'order-evidence-purge');

select cron.schedule(
  'order-evidence-purge',
  '15 4 * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/order-evidence-purge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret
                          from vault.decrypted_secrets
                         where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

do $verif$
declare v_n int;
begin
  select count(*) into v_n from cron.job
   where jobname = 'order-evidence-purge' and active is true;
  if v_n <> 1 then
    raise exception 'C9 L2: el cron de la purga no quedo programado y activo (encontrados %).', v_n;
  end if;
end
$verif$;
