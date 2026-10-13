-- Vuelta atrás de «C04b · T2 · La conexión con Diez, por empresa».
-- Las conexiones por empresa (scope company) se borran con sus secretos y
-- tokens de Vault; las de antes (cuenta, marca, local) no se tocan. Los CHECK
-- vuelven a ser los de antes.
do $$
declare r record;
begin
  for r in select id, credentials_ref, token_ref from public.account_connector where scope = 'company' or status = 'down' loop
    if r.credentials_ref is not null then delete from vault.secrets where id = r.credentials_ref::uuid; end if;
    if r.token_ref is not null then delete from vault.secrets where id = r.token_ref::uuid; end if;
  end loop;
  delete from public.account_connector where scope = 'company';
  update public.account_connector set status = 'error' where status = 'down';
end $$;

drop function if exists public.connector_mark_down(uuid, text);
drop function if exists public.connector_token_read(uuid);
drop function if exists public.connector_token_save(uuid, text, timestamptz);

delete from public.connector c where c.code = 'diez' and not exists (select 1 from public.account_connector ac where ac.connector_id = c.id);

drop index if exists public.account_connector_company_uq;
alter table public.account_connector drop constraint if exists account_connector_company_scope;
alter table public.account_connector drop constraint if exists account_connector_status_check;
alter table public.account_connector add constraint account_connector_status_check
  check (status = any (array['available', 'requested', 'connecting', 'connected', 'paused', 'error']));
alter table public.account_connector drop constraint if exists account_connector_scope_check;
alter table public.account_connector add constraint account_connector_scope_check
  check (scope = any (array['account', 'brand', 'location']));
alter table public.account_connector drop column if exists token_expires_at;
alter table public.account_connector drop column if exists token_ref;
alter table public.account_connector drop column if exists company_id;
