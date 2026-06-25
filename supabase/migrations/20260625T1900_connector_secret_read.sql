create or replace function public.connector_secret_read(
  p_account_connector_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_ref text;
  v_config jsonb;
  v_secret text;
begin
  select credentials_ref, config
    into v_ref, v_config
  from public.account_connector
  where id = p_account_connector_id;
  if v_ref is null then
    return null;
  end if;
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where id = v_ref::uuid;
  if v_secret is null then
    return null;
  end if;
  return jsonb_build_object(
    'secrets', v_secret::jsonb,
    'config', coalesce(v_config, '{}'::jsonb)
  );
end;
$$;
revoke all on function public.connector_secret_read(uuid) from public, anon, authenticated;
grant execute on function public.connector_secret_read(uuid) to service_role;
