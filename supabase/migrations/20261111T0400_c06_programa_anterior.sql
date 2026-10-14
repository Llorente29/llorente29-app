-- ============================================================================
-- C06 · DE QUÉ PROGRAMA VIENE CADA EMPRESA
-- ----------------------------------------------------------------------------
-- Respuesta 4 de Julio (14/10), retoque 1. El alta no termina sin el plan
-- activado, y antes pregunta «¿De qué programa vienes?»: Cegid Diez, Holded,
-- Sage, a3, ContaSol, Quipu, «Otro» con su nombre escrito, o «Empiezo de
-- cero». La respuesta se guarda en la cuenta, con su registro, para saber qué
-- importadores hacen falta después.
--
-- Solo AÑADE: dos tablas nuevas, sus disparadores, sus políticas y una función
-- nueva. Ningún dato de lo que existe cambia. Foodint no tiene fila (su alta es
-- de antes) y nada de lo que lee hoy cambia.
--
--   conta_programa_anterior            una fila por empresa (la última respuesta)
--   conta_programa_anterior_registro   cada respuesta y cada cambio, con quién
--   conta_programa_anterior_poner      la escribe quien es de la cuenta (el alta)
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0400_c06_programa_anterior.down.sql
-- ============================================================================

create table if not exists public.conta_programa_anterior (
  company_id   uuid primary key references public.company(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  programa     text not null,
  otro_nombre  text,
  puesto_por   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint conta_programa_anterior_programa check (programa in ('diez', 'holded', 'sage', 'a3', 'contasol', 'quipu', 'otro', 'ninguno')),
  -- «Otro» lleva su nombre escrito; los demás, no.
  constraint conta_programa_anterior_otro check ((programa = 'otro') = (otro_nombre is not null and btrim(otro_nombre) <> ''))
);

comment on table public.conta_programa_anterior is
  'C06 · De qué programa viene la empresa (pregunta del alta). Para saber qué importadores hacen falta. ninguno = empieza de cero.';

create table if not exists public.conta_programa_anterior_registro (
  id           bigint generated always as identity primary key,
  company_id   uuid not null,
  account_id   uuid not null,
  accion       text not null check (accion in ('alta', 'cambio', 'baja')),
  antes        text,
  despues      text,
  por          uuid,
  en           timestamptz not null default now()
);
create index if not exists conta_programa_anterior_registro_empresa on public.conta_programa_anterior_registro (company_id, en);

comment on table public.conta_programa_anterior_registro is
  'C06 · Registro de conta_programa_anterior: cada respuesta y cada cambio, con quién y cuándo. Lo escribe su disparador.';

create or replace function public.conta_programa_anterior_guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'conta_programa_anterior: la empresa % no es de la cuenta %.', new.company_id, new.account_id;
  end if;
  new.otro_nombre := nullif(btrim(coalesce(new.otro_nombre, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.conta_programa_anterior_apuntar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conta_programa_anterior_registro (company_id, account_id, accion, antes, despues, por)
    values (new.company_id, new.account_id, 'alta', null, new.programa || coalesce(': ' || new.otro_nombre, ''), new.puesto_por);
  elsif tg_op = 'UPDATE' then
    if new.programa is distinct from old.programa or new.otro_nombre is distinct from old.otro_nombre then
      insert into public.conta_programa_anterior_registro (company_id, account_id, accion, antes, despues, por)
      values (new.company_id, new.account_id, 'cambio', old.programa || coalesce(': ' || old.otro_nombre, ''),
              new.programa || coalesce(': ' || new.otro_nombre, ''), new.puesto_por);
    end if;
  else
    insert into public.conta_programa_anterior_registro (company_id, account_id, accion, antes, despues, por)
    values (old.company_id, old.account_id, 'baja', old.programa || coalesce(': ' || old.otro_nombre, ''), null, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists conta_programa_anterior_guarda on public.conta_programa_anterior;
create trigger conta_programa_anterior_guarda before insert or update on public.conta_programa_anterior
  for each row execute function public.conta_programa_anterior_guarda();
drop trigger if exists conta_programa_anterior_apuntar on public.conta_programa_anterior;
create trigger conta_programa_anterior_apuntar after insert or update or delete on public.conta_programa_anterior
  for each row execute function public.conta_programa_anterior_apuntar();

-- Leer: los miembros de la cuenta. Escribir: solo por la función.
alter table public.conta_programa_anterior enable row level security;
alter table public.conta_programa_anterior_registro enable row level security;
drop policy if exists conta_programa_anterior_leer on public.conta_programa_anterior;
create policy conta_programa_anterior_leer on public.conta_programa_anterior for select
  using (account_id = any (public.current_user_account_ids()));
drop policy if exists conta_programa_anterior_registro_leer on public.conta_programa_anterior_registro;
create policy conta_programa_anterior_registro_leer on public.conta_programa_anterior_registro for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.conta_programa_anterior from anon, authenticated;
revoke insert, update, delete, truncate on public.conta_programa_anterior_registro from anon, authenticated;
revoke all on function public.conta_programa_anterior_apuntar() from public, anon, authenticated;

-- La escribe quien es de la cuenta de la empresa (el alta) y Folvy (service_role).
create or replace function public.conta_programa_anterior_poner(p_company uuid, p_programa text, p_otro text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_prog text := lower(btrim(coalesce(p_programa, '')));
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (v_cuenta = any (public.current_user_account_ids())) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  insert into public.conta_programa_anterior (company_id, account_id, programa, otro_nombre, puesto_por)
  values (p_company, v_cuenta, v_prog, case when v_prog = 'otro' then p_otro end, auth.uid())
  on conflict (company_id) do update
    set programa = excluded.programa, otro_nombre = excluded.otro_nombre, puesto_por = excluded.puesto_por;
  return jsonb_build_object('empresa', p_company, 'programa', v_prog, 'otro', case when v_prog = 'otro' then nullif(btrim(p_otro), '') end);
end;
$$;

revoke all on function public.conta_programa_anterior_poner(uuid, text, text) from public, anon;
grant execute on function public.conta_programa_anterior_poner(uuid, text, text) to authenticated, service_role;
