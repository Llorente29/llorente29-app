-- 20260719T1500_customer_notify_cron.sql
-- Enciende el drenador automático de customer_notification (cada minuto).
-- APLICAR EN GO-LIVE, DESPUÉS de que la plantilla pedido_en_camino esté APROBADA
-- y de haber puesto el secreto CUSTOMER_NOTIFY_SECRET (ver pasos abajo).
--
-- Requisitos previos (una vez):
--   1) En la edge:   supabase secrets set CUSTOMER_NOTIFY_SECRET="<un_valor_aleatorio>" --project-ref xzmpnchlguibclvxyynt
--   2) En la BD:     select vault.create_secret('<el_MISMO_valor>', 'CUSTOMER_NOTIFY_SECRET');
--   3) Redeploy de la edge SIN el modo de prueba hello_to (endurecido).
-- El cron lee el secreto de Vault en tiempo de ejecución (NO hardcodeado).

BEGIN;

-- Idempotente: si ya existe, lo recrea.
select cron.unschedule('customer-notify-drain')
where exists (select 1 from cron.job where jobname = 'customer-notify-drain');

select cron.schedule(
  'customer-notify-drain',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/customer-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CUSTOMER_NOTIFY_SECRET')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

COMMIT;

-- Para apagarlo:
--   select cron.unschedule('customer-notify-drain');
