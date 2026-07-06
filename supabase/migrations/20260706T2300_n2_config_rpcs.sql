-- 20260706T2300_n2_config_rpcs.sql
-- Módulo Social · N2 · Capa 3a — config N2 desde la app + biblioteca propia
--
-- get_n2_config / set_n2_config: leer y guardar n2_enabled / n2_daily_cap / n2_mood_ratio
-- desde Ajustes (sin depender de políticas de social_config).
-- seed_account_scenes: "personalizar mi biblioteca" — copia las escenas globales a la cuenta
-- (solo si no tiene propias) para que el cliente las edite/active/pese libremente (evolutivo).
--
-- SECURITY DEFINER + belongs_to_account / current_user_is_admin_or_manager_of → NO probar
-- desde el SQL Editor (auth.uid() null → "no autorizado"); se prueban desde la app.

begin;

create or replace function public.get_n2_config(p_account_id uuid)
returns table(n2_enabled boolean, n2_daily_cap int, n2_mood_ratio int)
language plpgsql security definer set search_path = public as $$
begin
  if not belongs_to_account(p_account_id) then raise exception 'no autorizado'; end if;
  return query select c.n2_enabled, c.n2_daily_cap, c.n2_mood_ratio
    from social_config c where c.account_id = p_account_id;
end $$;

create or replace function public.set_n2_config(p_account_id uuid, p_enabled boolean, p_cap int, p_ratio int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_user_is_admin_or_manager_of(p_account_id) then raise exception 'no autorizado'; end if;
  update social_config
     set n2_enabled = p_enabled,
         n2_daily_cap = greatest(coalesce(p_cap, 30), 0),
         n2_mood_ratio = greatest(coalesce(p_ratio, 5), 0),
         updated_at = now()
   where account_id = p_account_id;
  if not found then
    insert into social_config(account_id, launch_phase, n2_enabled, n2_daily_cap, n2_mood_ratio)
    values (p_account_id, 'apetito', p_enabled, greatest(coalesce(p_cap,30),0), greatest(coalesce(p_ratio,5),0));
  end if;
end $$;

create or replace function public.seed_account_scenes(p_account_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not current_user_is_admin_or_manager_of(p_account_id) then raise exception 'no autorizado'; end if;
  if exists(select 1 from social_scene where account_id = p_account_id) then return 0; end if;
  insert into social_scene(account_id, mode, label, prompt, is_active, weight, lang)
  select p_account_id, mode, label, prompt, is_active, weight, lang
    from social_scene where account_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.get_n2_config(uuid)                    from public, anon;
revoke all on function public.set_n2_config(uuid, boolean, int, int) from public, anon;
revoke all on function public.seed_account_scenes(uuid)              from public, anon;
grant  execute on function public.get_n2_config(uuid)                    to authenticated;
grant  execute on function public.set_n2_config(uuid, boolean, int, int) to authenticated;
grant  execute on function public.seed_account_scenes(uuid)              to authenticated;

commit;
