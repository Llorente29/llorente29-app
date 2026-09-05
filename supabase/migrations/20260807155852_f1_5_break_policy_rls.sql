-- RLS con el patrón F0.5: lectura por cuenta, escritura solo admin de la cuenta.
drop policy if exists break_policy_select on public.break_policy;
create policy break_policy_select on public.break_policy
  for select to authenticated
  using (account_id = any(current_user_account_ids()));

drop policy if exists break_policy_write on public.break_policy;
create policy break_policy_write on public.break_policy
  for all to authenticated
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));

grant select, insert, update, delete on public.break_policy to authenticated;
grant all on public.break_policy to service_role;