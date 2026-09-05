create table if not exists public.agent_pause (
  account_id  uuid        not null references public.accounts(id) on delete cascade,
  agent_key   text        not null,
  paused_at   timestamptz not null default now(),
  paused_by   uuid        references auth.users(id),
  paused_by_label text,
  primary key (account_id, agent_key)
);

comment on table public.agent_pause is
  'Agentes en pausa POR CUENTA. Una fila = ese agente no trabaja para esa cuenta. El cron sigue corriendo; el agente consulta esto y se salta la cuenta.';

alter table public.agent_pause enable row level security;

drop policy if exists agent_pause_lee on public.agent_pause;
create policy agent_pause_lee on public.agent_pause
  for select to authenticated
  using (account_id = any (public.current_user_account_ids()));

-- LA ESCRITURA DIRECTA SE CIERRA A MANO. En Supabase el rol `authenticated`
-- recibe INSERT/UPDATE/DELETE de serie sobre las tablas nuevas de `public`; sin
-- politica de escritura la RLS ya lo frena, pero el permiso sigue concedido.
-- Se quita explicito: asi el dia que alguien anada una politica permisiva por
-- error, no aparecen filas sin autor. El rastro lo pone la funcion o no existe.
revoke insert, update, delete on public.agent_pause from authenticated;
revoke insert, update, delete on public.agent_pause from anon;

create or replace function public.agent_pause_set(
  p_account_id uuid,
  p_agent_key  text,
  p_pausar     boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_label text;
begin
  if not (p_account_id = any (public.current_user_account_ids())) then
    raise exception 'agent_pause_set: sin acceso a la cuenta %', p_account_id;
  end if;
  if coalesce(btrim(p_agent_key), '') = '' then
    raise exception 'agent_pause_set: agente sin nombre';
  end if;

  select coalesce(up.display_name, 'alguien de la cuenta') into v_label
  from user_profiles up
  where up.user_id = auth.uid() and up.account_id = p_account_id
  limit 1;

  if p_pausar then
    insert into agent_pause (account_id, agent_key, paused_at, paused_by, paused_by_label)
    values (p_account_id, p_agent_key, now(), auth.uid(), v_label)
    on conflict (account_id, agent_key) do update
      set paused_at = now(), paused_by = auth.uid(), paused_by_label = excluded.paused_by_label;
  else
    delete from agent_pause
     where account_id = p_account_id and agent_key = p_agent_key;
  end if;

  -- Se devuelve el estado RESULTANTE, no un «ok»: quien llama pinta lo que hay
  -- en la base, no lo que creia que iba a pasar.
  return coalesce(
    (select jsonb_build_object(
       'agent_key', ap.agent_key, 'pausado', true,
       'paused_at', ap.paused_at, 'por', ap.paused_by_label)
     from agent_pause ap
     where ap.account_id = p_account_id and ap.agent_key = p_agent_key),
    jsonb_build_object('agent_key', p_agent_key, 'pausado', false));
end;
$fn$;

revoke all on function public.agent_pause_set(uuid, text, boolean) from public;
revoke all on function public.agent_pause_set(uuid, text, boolean) from anon;
grant execute on function public.agent_pause_set(uuid, text, boolean) to authenticated;

do $verif$
declare v_firmas int; v_rls boolean;
begin
  select count(*) into v_firmas from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='agent_pause_set';
  if v_firmas <> 1 then raise exception 'agent_pause_set tiene % firmas (Regla 2)', v_firmas; end if;

  select relrowsecurity into v_rls from pg_class where oid = 'public.agent_pause'::regclass;
  if not v_rls then raise exception 'agent_pause sin RLS'; end if;

  if has_function_privilege('anon', 'public.agent_pause_set(uuid,text,boolean)', 'EXECUTE') then
    raise exception 'anon puede ejecutar agent_pause_set';
  end if;
  if has_function_privilege('public', 'public.agent_pause_set(uuid,text,boolean)', 'EXECUTE') then
    raise exception 'PUBLIC puede ejecutar agent_pause_set';
  end if;
  if not has_function_privilege('authenticated', 'public.agent_pause_set(uuid,text,boolean)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar agent_pause_set';
  end if;
  if has_table_privilege('authenticated', 'public.agent_pause', 'INSERT')
     or has_table_privilege('authenticated', 'public.agent_pause', 'UPDATE') then
    raise exception 'authenticated puede escribir agent_pause sin pasar por la funcion';
  end if;

  raise notice 'VERIFICACION OK: agent_pause con RLS, escritura solo por funcion, anon y PUBLIC sin EXECUTE';
end;
$verif$;