-- ============================================================================
-- C06 · TRAER DE DIEZ PARA OTRA EMPRESA — la base de Diez de cada empresa
-- ----------------------------------------------------------------------------
-- Encargo C06, tarea 5, y el freno de diezCliente.ts como lo autorizó Julio
-- (respuesta 1, 13/10):
--   · una base por empresa, en una tabla con registro, escrita SOLO por Folvy;
--   · C0001 vetada siempre;
--   · escribir en Diez sigue necesitando escribirEnReal y el autorizo por
--     empresa (eso vive en el código: aquí no se abre nada);
--   · Foodint sigue con C0008, igual que hoy.
--
-- Hasta hoy, las bases con las que se habla estaban escritas en el código
-- (C0008 y C0009) y cualquier otra se rechazaba. Para que una segunda empresa
-- traiga su Diez, su base sale de aquí: diezCliente.ts acepta la base que esta
-- tabla tiene registrada para la empresa, y ninguna otra.
--
-- Lo que hace (todo añade):
--   1. conta_diez_base: la base de Diez (nombre_bd) de cada empresa. Una por
--      empresa y una empresa por base. C0001 no entra nunca (check). La leen
--      los miembros de la cuenta; NADIE la escribe desde la app: ni una
--      política de escritura, y los permisos de escribir, retirados a anon y
--      authenticated. La escribe Folvy, con service_role, por
--      conta_diez_base_poner.
--   2. conta_diez_base_registro: cada alta, cambio o baja, con quién, por qué,
--      antes y después. Lo escribe un disparador; nadie más.
--   3. conta_diez_base_poner(empresa, nombre_bd, motivo, quién): la única
--      puerta (solo service_role).
--   4. Foodint: su base, la C0008, la de siempre. Solo si la empresa existe
--      (en staging no está: no hace nada).
-- ============================================================================

create table if not exists public.conta_diez_base (
  company_id  uuid primary key references public.company(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  nombre_bd   text not null,
  motivo      text not null,
  puesto_por  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint conta_diez_base_formato check (nombre_bd ~ '^C[0-9]{4}$'),
  constraint conta_diez_base_c0001 check (nombre_bd <> 'C0001'),
  constraint conta_diez_base_motivo check (btrim(motivo) <> '' and btrim(puesto_por) <> ''),
  constraint conta_diez_base_una_empresa unique (nombre_bd)
);

comment on table public.conta_diez_base is
  'C06 · La base de Diez (nombre_bd) de cada empresa. La escribe solo Folvy (conta_diez_base_poner, service_role). C0001, nunca.';

create table if not exists public.conta_diez_base_registro (
  id          bigint generated always as identity primary key,
  company_id  uuid not null,
  account_id  uuid not null,
  accion      text not null check (accion in ('alta', 'cambio', 'baja')),
  antes       text,
  despues     text,
  motivo      text,
  por         text,
  en          timestamptz not null default now()
);
create index if not exists conta_diez_base_registro_empresa on public.conta_diez_base_registro (company_id, en);

comment on table public.conta_diez_base_registro is
  'C06 · Registro de conta_diez_base: alta, cambio y baja, con quién, por qué, antes y después. Lo escribe su disparador.';

-- La empresa tiene que ser de la cuenta (el account_id no se escribe a mano).
create or replace function public.conta_diez_base_guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'conta_diez_base: la empresa % no es de la cuenta %.', new.company_id, new.account_id;
  end if;
  if new.account_id = '00000000-0000-0000-0000-000000000001' then
    raise exception 'conta_diez_base: Folvy Interno no se toca.';
  end if;
  new.nombre_bd := upper(btrim(new.nombre_bd));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.conta_diez_base_apuntar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conta_diez_base_registro (company_id, account_id, accion, antes, despues, motivo, por)
    values (new.company_id, new.account_id, 'alta', null, new.nombre_bd, new.motivo, new.puesto_por);
  elsif tg_op = 'UPDATE' then
    insert into public.conta_diez_base_registro (company_id, account_id, accion, antes, despues, motivo, por)
    values (new.company_id, new.account_id, 'cambio', old.nombre_bd, new.nombre_bd, new.motivo, new.puesto_por);
  else
    insert into public.conta_diez_base_registro (company_id, account_id, accion, antes, despues, motivo, por)
    values (old.company_id, old.account_id, 'baja', old.nombre_bd, null, null, coalesce(current_setting('request.jwt.claim.sub', true), current_user));
  end if;
  return null;
end;
$$;

drop trigger if exists conta_diez_base_guarda on public.conta_diez_base;
create trigger conta_diez_base_guarda before insert or update on public.conta_diez_base
  for each row execute function public.conta_diez_base_guarda();
drop trigger if exists conta_diez_base_apuntar on public.conta_diez_base;
create trigger conta_diez_base_apuntar after insert or update or delete on public.conta_diez_base
  for each row execute function public.conta_diez_base_apuntar();

-- Leer: los miembros de la cuenta. Escribir: nadie desde la app.
alter table public.conta_diez_base enable row level security;
alter table public.conta_diez_base_registro enable row level security;
drop policy if exists conta_diez_base_leer on public.conta_diez_base;
create policy conta_diez_base_leer on public.conta_diez_base for select
  using (account_id = any (public.current_user_account_ids()));
drop policy if exists conta_diez_base_registro_leer on public.conta_diez_base_registro;
create policy conta_diez_base_registro_leer on public.conta_diez_base_registro for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.conta_diez_base from anon, authenticated;
revoke insert, update, delete, truncate on public.conta_diez_base_registro from anon, authenticated;

-- La única puerta: Folvy, con service_role.
create or replace function public.conta_diez_base_poner(p_company uuid, p_nombre_bd text, p_motivo text, p_por text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_bd text := upper(btrim(coalesce(p_nombre_bd, '')));
  v_antes text;
begin
  if v_bd = 'C0001' then raise exception 'La base C0001 no se toca nunca.'; end if;
  if v_bd !~ '^C[0-9]{4}$' then raise exception 'Base de Diez no válida: «%» (es C y cuatro cifras).', p_nombre_bd; end if;
  if btrim(coalesce(p_motivo, '')) = '' or btrim(coalesce(p_por, '')) = '' then raise exception 'Hace falta el motivo y quién lo pone.'; end if;
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa % no existe.', p_company; end if;
  select nombre_bd into v_antes from public.conta_diez_base where company_id = p_company;
  if v_antes = v_bd then
    return jsonb_build_object('empresa', p_company, 'base', v_bd, 'cambia', false);
  end if;
  if v_antes is null then
    insert into public.conta_diez_base (company_id, account_id, nombre_bd, motivo, puesto_por)
    values (p_company, v_cuenta, v_bd, p_motivo, p_por);
  else
    update public.conta_diez_base set nombre_bd = v_bd, motivo = p_motivo, puesto_por = p_por where company_id = p_company;
  end if;
  return jsonb_build_object('empresa', p_company, 'base', v_bd, 'antes', v_antes, 'cambia', true);
end;
$$;

revoke all on function public.conta_diez_base_poner(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_diez_base_poner(uuid, text, text, text) to service_role;
revoke all on function public.conta_diez_base_apuntar() from public, anon, authenticated;

-- Foodint (Llorente29): su base de siempre. En staging no existe: no hace nada.
insert into public.conta_diez_base (company_id, account_id, nombre_bd, motivo, puesto_por)
select c.id, c.account_id, 'C0008', 'La base de siempre de esta empresa (C04b); se registra al generalizar el traer de Diez (C06).', 'Folvy (C06)'
  from public.company c
 where c.id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
on conflict (company_id) do nothing;
