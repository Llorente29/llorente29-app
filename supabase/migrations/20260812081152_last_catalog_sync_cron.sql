CREATE OR REPLACE FUNCTION public.last_catalog_sync_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_row    record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lastapp_internal_key';
  if v_secret is null then
    raise warning 'last_catalog_sync_dispatch: secreto lastapp_internal_key ausente en Vault, no se dispara nada';
    return;
  end if;

  for v_row in
    select distinct account_id, external_org_id
    from public.external_integration
    where source = 'lastapp' and is_active = true
  loop
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/last-catalog-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_secret),
      body    := jsonb_build_object('account_id', v_row.account_id, 'external_org_id', v_row.external_org_id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$function$;

comment on function public.last_catalog_sync_dispatch() is
  'Dispara la Edge Function last-catalog-sync (net.http_post, fire-and-forget) para cada (account_id, external_org_id) activo en external_integration source=lastapp. Cron last-catalog-sync-hourly, horario de servicio 12-23 UTC.';

revoke all on function public.last_catalog_sync_dispatch() from public, anon, authenticated;

select cron.schedule(
  'last-catalog-sync-hourly',
  '0 12-23 * * *',
  $cron$select public.last_catalog_sync_dispatch()$cron$
);