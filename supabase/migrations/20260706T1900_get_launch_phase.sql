-- 20260706T1900_get_launch_phase.sql
-- Módulo Social · Pieza 5a — Palanca de fase (lectura)
--
-- get_launch_phase: la app lee la fase actual (apetito/comunidad/conversion) sin depender
-- de políticas de SELECT sobre social_config. La escritura ya la hace set_launch_phase (0a).
-- SECURITY DEFINER + belongs_to_account → NO probar desde el SQL Editor.

begin;

create or replace function public.get_launch_phase(p_account_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not belongs_to_account(p_account_id) then raise exception 'no autorizado'; end if;
  select launch_phase into v from social_config where account_id = p_account_id;
  return coalesce(v, 'apetito');
end $$;

revoke all on function public.get_launch_phase(uuid) from public, anon;
grant  execute on function public.get_launch_phase(uuid) to authenticated;

commit;
