-- Coherencia con F0.3: tabla nueva no nace con grants a anon (aunque RLS ya lo tapara).
revoke all on public.break_policy from anon, public;
grant select, insert, update, delete on public.break_policy to authenticated;
grant all on public.break_policy to service_role;