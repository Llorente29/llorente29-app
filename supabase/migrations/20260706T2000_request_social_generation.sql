-- 20260706T2000_request_social_generation.sql
-- Módulo Social · "Generar ahora"
--
-- La app (con la sesión del usuario) llama a esta RPC → comprueba que es admin/encargado →
-- dispara el social-agent SOLO para su cuenta y con force:true (salta el cupo diario).
-- Mismo patrón que el cron: net.http_post + x-agent-secret leído del Vault. El agente
-- respeta cualquier directiva pendiente antes de sus reglas.
--
-- SECURITY DEFINER + current_user_is_admin_or_manager_of → NO probar desde el SQL Editor.

begin;

create or replace function public.request_social_generation(p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if not current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'no autorizado';
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'offers_agent_secret';
  if v_secret is null then raise exception 'secreto del agente no configurado'; end if;

  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/social-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', v_secret
    ),
    body := jsonb_build_object('account_id', p_account_id, 'force', true),
    timeout_milliseconds := 20000
  );
end $$;

revoke all on function public.request_social_generation(uuid) from public, anon;
grant  execute on function public.request_social_generation(uuid) to authenticated;

commit;
