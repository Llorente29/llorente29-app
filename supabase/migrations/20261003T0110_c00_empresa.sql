-- ============================================================================
-- C00 · El cimiento — 2/4 · LA EMPRESA
-- ----------------------------------------------------------------------------
-- Encargo C00 §4.1 y respuesta 1 de Julio. SOLO AÑADE.
--
-- Varias empresas por cuenta, cada una con su contabilidad. Todas las tablas
-- llevan account_id y las de una empresa, además, company_id; un disparador
-- impide que una fila hija apunte a una empresa de OTRA cuenta. RLS
-- equivalente a la de supplier; nada para anon. Ninguna migración crea
-- empresas: una empresa solo nace cuando una persona hace el alta.
--
-- Única tabla existente que se toca: supplier (una columna, related_party_kind).
-- Toma ACCESS EXCLUSIVE breve sobre supplier: fuera de la banda 12:15–00:30.
-- ============================================================================

-- ── Guardas comunes ─────────────────────────────────────────────────────────
-- Una fila hija (actividad, perfil, ejercicio…) no puede colgar de una empresa
-- de otra cuenta. La RLS mira account_id de la fila; esto ata account_id a la
-- empresa de verdad.
create or replace function public.conta_misma_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  -- SECURITY DEFINER para ver la empresa aunque la RLS la esconda; el mensaje
  -- no dice de quién es (no da a una cuenta datos de otra).
  select account_id into v from public.company where id = new.company_id;
  if v is distinct from new.account_id then
    raise exception 'Esa empresa no es de esta cuenta' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.conta_al_dia()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Empresa ─────────────────────────────────────────────────────────────────
create table if not exists public.company (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  legal_name          text,
  trade_name          text,
  tax_id              text,
  tax_id_type         text check (tax_id_type in ('nif_es', 'vat_eu', 'foreign')),
  tax_id_verified_at  timestamptz,
  entity_kind         text check (entity_kind in ('company', 'self_employed')),
  legal_form_code     text references public.legal_form(code),
  fiscal_street_type  text,
  fiscal_street       text,
  fiscal_number       text,
  fiscal_extra        text,
  fiscal_postal_code  text,
  fiscal_city         text,
  fiscal_province     text,
  fiscal_country      text not null default 'ES' check (fiscal_country ~ '^[A-Z]{2}$'),
  phone               text,
  email               text,
  website             text,
  tax_office_code     text,
  registry_name       text,
  registry_volume     text,
  registry_folio      text,
  registry_sheet      text,
  registry_entry      text,
  is_active           boolean not null default true,
  setup_step          text not null default 'nif'
                        check (setup_step in ('nif', 'nombre', 'actividad', 'impuestos', 'cuentas', 'banco', 'hecho')),
  setup_completed_at  timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  constraint company_postal_code_es check (
    fiscal_postal_code is null or fiscal_country <> 'ES' or fiscal_postal_code ~ '^[0-9]{5}$'),
  constraint company_alta_completa check (
    setup_completed_at is null or (legal_name is not null and tax_id is not null and entity_kind is not null))
);
comment on table public.company is
  'C00. Empresa: una cuenta puede llevar varias, cada una con su contabilidad. El NIF no se repite dentro de una cuenta.';
comment on column public.company.setup_step is 'Por dónde va el alta conversada; se puede seguir desde otro dispositivo.';

-- El NIF no se repite dentro de una cuenta (comparando sin espacios ni guiones).
create unique index if not exists company_nif_por_cuenta
  on public.company (account_id, upper(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g')))
  where tax_id is not null;
create index if not exists company_account_idx on public.company (account_id);
drop trigger if exists company_al_dia on public.company;
create trigger company_al_dia before update on public.company for each row execute function public.conta_al_dia();

-- ── Actividades ─────────────────────────────────────────────────────────────
create table if not exists public.company_activity (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  company_id    uuid not null references public.company(id) on delete cascade,
  kind          text not null check (kind in ('business', 'professional', 'other')),
  iae_code      text references public.iae_heading(code),
  cnae_version  text not null default '2025',
  cnae_code     text,
  description   text not null check (length(trim(description)) > 0),
  started_on    date,
  ended_on      date,
  is_main       boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  constraint company_activity_fechas check (ended_on is null or started_on is null or ended_on >= started_on),
  foreign key (cnae_version, cnae_code) references public.cnae_code(version, code)
);
comment on table public.company_activity is 'C00. Actividades: epígrafe del IAE y CNAE. Una y solo una principal entre las vigentes.';
-- Como mucho una principal vigente…
create unique index if not exists company_activity_una_principal
  on public.company_activity (company_id) where is_main and ended_on is null;
-- …y, si hay alguna vigente, exactamente una (se comprueba al cerrar la transacción).
create or replace function public.conta_una_principal()
returns trigger language plpgsql set search_path = public as $$
declare c uuid := coalesce(new.company_id, old.company_id); vigentes int; principales int;
begin
  select count(*), count(*) filter (where is_main) into vigentes, principales
    from public.company_activity where company_id = c and ended_on is null;
  if vigentes > 0 and principales <> 1 then
    raise exception 'La empresa tiene % actividades y % principales: tiene que haber una y solo una principal', vigentes, principales
      using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists company_activity_una_principal_chk on public.company_activity;
create constraint trigger company_activity_una_principal_chk
  after insert or update or delete on public.company_activity
  deferrable initially deferred for each row execute function public.conta_una_principal();
drop trigger if exists company_activity_misma_cuenta on public.company_activity;
create trigger company_activity_misma_cuenta before insert or update on public.company_activity
  for each row execute function public.conta_misma_cuenta();

-- ── Perfil fiscal (una fila por empresa) ────────────────────────────────────
create table if not exists public.company_tax_profile (
  company_id        uuid primary key references public.company(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  tax_territory     text not null default 'peninsula_baleares'
                      check (tax_territory in ('peninsula_baleares', 'canarias', 'ceuta_melilla')),
  vat_scheme_code   text references public.vat_scheme(code),
  vat_cash_basis    boolean not null default false,
  vat_surcharge     boolean not null default false,
  vat_period        text not null default 'quarterly' check (vat_period in ('quarterly', 'monthly')),
  vat_prorata       boolean not null default false,
  vat_prorata_pct   numeric(5, 2) check (vat_prorata_pct is null or vat_prorata_pct between 0 and 100),
  sii               boolean not null default false,
  chart_kind        text not null default 'pymes' check (chart_kind in ('pymes', 'normal')),
  account_digits    smallint not null default 8 check (account_digits between 4 and 12),
  tax_forms         text[] not null default '{}',
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
comment on table public.company_tax_profile is
  'C00. Perfil fiscal de la empresa: territorio, régimen y periodicidad del IVA, plan contable y modelos que presenta.';
drop trigger if exists company_tax_profile_misma_cuenta on public.company_tax_profile;
create trigger company_tax_profile_misma_cuenta before insert or update on public.company_tax_profile
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists company_tax_profile_al_dia on public.company_tax_profile;
create trigger company_tax_profile_al_dia before update on public.company_tax_profile
  for each row execute function public.conta_al_dia();

-- ── Ejercicios ──────────────────────────────────────────────────────────────
create table if not exists public.fiscal_year (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  code              text not null,
  starts_on         date not null,
  ends_on           date not null,
  previous_year_id  uuid references public.fiscal_year(id),
  status            text not null default 'open' check (status in ('open', 'closed')),
  closed_at         timestamptz,
  closed_by         uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (company_id, code),
  constraint fiscal_year_fechas check (ends_on >= starts_on),
  constraint fiscal_year_hasta_doce_meses check (ends_on < (starts_on + interval '1 year')::date)
);
comment on table public.fiscal_year is 'C00. Ejercicios de una empresa: sin solapes ni huecos entre uno y el anterior.';
create or replace function public.conta_ejercicio_sin_solapes()
returns trigger language plpgsql set search_path = public as $$
declare otro text; prev_fin date; prev_empresa uuid;
begin
  select code into otro from public.fiscal_year
   where company_id = new.company_id and id <> new.id
     and daterange(starts_on, ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
   limit 1;
  if otro is not null then
    raise exception 'El ejercicio % se solapa con el ejercicio %', new.code, otro using errcode = '23P01';
  end if;
  if new.previous_year_id is not null then
    select ends_on, company_id into prev_fin, prev_empresa from public.fiscal_year where id = new.previous_year_id;
    if prev_empresa is distinct from new.company_id then
      raise exception 'El ejercicio anterior es de otra empresa' using errcode = '23514';
    end if;
    if prev_fin + 1 <> new.starts_on then
      raise exception 'Entre el ejercicio anterior (acaba el %) y el % (empieza el %) no puede haber hueco', prev_fin, new.code, new.starts_on
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fiscal_year_sin_solapes on public.fiscal_year;
create trigger fiscal_year_sin_solapes before insert or update on public.fiscal_year
  for each row execute function public.conta_ejercicio_sin_solapes();
drop trigger if exists fiscal_year_misma_cuenta on public.fiscal_year;
create trigger fiscal_year_misma_cuenta before insert or update on public.fiscal_year
  for each row execute function public.conta_misma_cuenta();

-- ── Cierre de meses (solo el bloqueo) ──────────────────────────────────────
create table if not exists public.fiscal_period_lock (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  fiscal_year_id    uuid not null references public.fiscal_year(id) on delete cascade,
  month             date not null check (month = date_trunc('month', month)::date),
  locked_at         timestamptz not null default now(),
  locked_by         uuid,
  locked_by_name    text,
  reopened_at       timestamptz,
  reopened_by       uuid,
  reopened_by_name  text,
  reopen_reason     text,
  constraint fiscal_period_lock_reabrir_con_motivo check (
    reopened_at is null or (reopen_reason is not null and length(trim(reopen_reason)) > 0))
);
comment on table public.fiscal_period_lock is
  'C00. Meses cerrados. Reabrir no borra la fila: la marca reabierta, con quién, cuándo y por qué. Volver a cerrar es una fila nueva.';
create unique index if not exists fiscal_period_lock_un_cierre_vivo
  on public.fiscal_period_lock (company_id, month) where reopened_at is null;
drop trigger if exists fiscal_period_lock_misma_cuenta on public.fiscal_period_lock;
create trigger fiscal_period_lock_misma_cuenta before insert or update on public.fiscal_period_lock
  for each row execute function public.conta_misma_cuenta();

/** ¿Está cerrado el mes de esta fecha? Para que lo que tenga fecha (asientos, facturas) lo consulte. */
create or replace function public.conta_mes_cerrado(p_company uuid, p_fecha date)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.fiscal_period_lock
     where company_id = p_company and month = date_trunc('month', p_fecha)::date and reopened_at is null)
$$;

create or replace function public.conta_nombre_actor()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select display_name from public.user_profiles where user_id = auth.uid() and active order by created_at limit 1),
    (select email from auth.users where id = auth.uid()))
$$;
revoke all on function public.conta_nombre_actor() from public, anon;
grant execute on function public.conta_nombre_actor() to authenticated;

-- Cerrar un mes: el primero abierto del ejercicio (se cierra en orden).
create or replace function public.conta_cerrar_mes(p_company uuid, p_mes date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_ej public.fiscal_year; v_mes date := date_trunc('month', p_mes)::date; v_primero date; v_id uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta puede cerrar meses' using errcode = '42501';
  end if;
  select * into v_ej from public.fiscal_year
   where company_id = p_company and v_mes between date_trunc('month', starts_on)::date and ends_on;
  if v_ej.id is null then raise exception 'No hay ejercicio para %', to_char(v_mes, 'MM/YYYY') using errcode = '23514'; end if;
  select min(m)::date into v_primero
    from generate_series(date_trunc('month', v_ej.starts_on), v_ej.ends_on, interval '1 month') m
   where not exists (select 1 from public.fiscal_period_lock l
                      where l.company_id = p_company and l.month = m::date and l.reopened_at is null);
  if v_primero is distinct from v_mes then
    raise exception 'Los meses se cierran en orden: el primero abierto es %', to_char(v_primero, 'MM/YYYY') using errcode = '23514';
  end if;
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, locked_by, locked_by_name)
  values (v_cuenta, p_company, v_ej.id, v_mes, auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'mes', v_mes);
end $$;

-- Reabrir: el último cerrado, con motivo. Deja rastro en la misma fila.
create or replace function public.conta_reabrir_mes(p_company uuid, p_mes date, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_mes date := date_trunc('month', p_mes)::date; v_ultimo date; v_id uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta puede reabrir meses' using errcode = '42501';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para reabrir un mes hay que decir por qué' using errcode = '23514';
  end if;
  select max(month) into v_ultimo from public.fiscal_period_lock where company_id = p_company and reopened_at is null;
  if v_ultimo is distinct from v_mes then
    raise exception 'Solo se puede reabrir el último mes cerrado: %', coalesce(to_char(v_ultimo, 'MM/YYYY'), 'no hay ninguno')
      using errcode = '23514';
  end if;
  update public.fiscal_period_lock
     set reopened_at = now(), reopened_by = auth.uid(), reopened_by_name = public.conta_nombre_actor(), reopen_reason = trim(p_motivo)
   where company_id = p_company and month = v_mes and reopened_at is null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'mes', v_mes);
end $$;

-- ── Socios y cargos (solo administradores) ──────────────────────────────────
create table if not exists public.company_person (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) > 0),
  tax_id          text,
  roles           text[] not null default '{}'
                    check (roles <@ array['partner', 'administrator', 'representative', 'secretary', 'president', 'filer']::text[]),
  ownership_pct   numeric(5, 2) check (ownership_pct is null or ownership_pct between 0 and 100),
  started_on      date,
  ended_on        date,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  constraint company_person_fechas check (ended_on is null or started_on is null or ended_on >= started_on)
);
comment on table public.company_person is 'C00. Socios y cargos. Solo los ven y los tocan los administradores de la cuenta.';
create or replace function public.conta_socios_hasta_cien()
returns trigger language plpgsql set search_path = public as $$
declare total numeric;
begin
  select coalesce(sum(ownership_pct), 0) into total from public.company_person
   where company_id = new.company_id and ended_on is null;
  if total > 100 then
    raise exception 'Los porcentajes de los socios suman % %%: no pueden pasar de 100', total using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists company_person_hasta_cien on public.company_person;
create constraint trigger company_person_hasta_cien after insert or update on public.company_person
  deferrable initially deferred for each row execute function public.conta_socios_hasta_cien();
drop trigger if exists company_person_misma_cuenta on public.company_person;
create trigger company_person_misma_cuenta before insert or update on public.company_person
  for each row execute function public.conta_misma_cuenta();

-- ── Relación con otras empresas (solo se guarda) ───────────────────────────
create table if not exists public.company_relation (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  related_company_id  uuid references public.company(id) on delete cascade,
  third_party_name    text,
  third_party_tax_id  text,
  kind                text not null check (kind in ('group', 'joint', 'associate', 'other_related')),
  from_on             date,
  to_on               date,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  constraint company_relation_con_quien check (related_company_id is not null or third_party_name is not null),
  constraint company_relation_no_consigo check (related_company_id is distinct from company_id)
);
comment on table public.company_relation is
  'C00. Relación con otra empresa de la cuenta o con un tercero: grupo, multigrupo, asociada u otra vinculada. Solo se guarda; nada la usa todavía.';
drop trigger if exists company_relation_misma_cuenta on public.company_relation;
create trigger company_relation_misma_cuenta before insert or update on public.company_relation
  for each row execute function public.conta_misma_cuenta();

alter table public.supplier add column if not exists related_party_kind text;
alter table public.supplier drop constraint if exists supplier_related_party_kind_check;
alter table public.supplier add constraint supplier_related_party_kind_check
  check (related_party_kind is null or related_party_kind in ('group', 'joint', 'associate', 'other_related'));
comment on column public.supplier.related_party_kind is 'C00. Si el proveedor es parte vinculada: grupo, multigrupo, asociada u otra. Solo se guarda.';

-- ── Dudas para el asesor («No lo sé» en el alta) ────────────────────────────
create table if not exists public.company_doubt (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  question_key    text not null,
  question        text not null,
  default_answer  text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  resolved_at     timestamptz,
  resolved_by     uuid,
  unique (company_id, question_key)
);
comment on table public.company_doubt is
  'C00. Lo que la persona contestó «No lo sé» en el alta: se dejó la opción por defecto y queda como duda para el asesor.';
drop trigger if exists company_doubt_misma_cuenta on public.company_doubt;
create trigger company_doubt_misma_cuenta before insert or update on public.company_doubt
  for each row execute function public.conta_misma_cuenta();

-- ── Seguridad ───────────────────────────────────────────────────────────────
-- Como supplier: lee quien pertenece a la cuenta; escribe administrador o
-- encargado. Socios y cargos: solo administradores, también para leer.
do $$
declare t text;
begin
  foreach t in array array['company','company_activity','company_tax_profile','fiscal_year','fiscal_period_lock','company_relation','company_doubt'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (belongs_to_account(account_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (current_user_is_admin_or_manager_of(account_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (current_user_is_admin_or_manager_of(account_id)) with check (current_user_is_admin_or_manager_of(account_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (current_user_is_admin_or_manager_of(account_id))', t || '_delete', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;
-- Los cierres de mes SOLO se escriben por conta_cerrar_mes / conta_reabrir_mes
-- (SECURITY DEFINER, que exigen administrador, orden y motivo): sin políticas
-- de escritura directa, nadie se salta el orden ni el rastro por la API.
drop policy if exists fiscal_period_lock_insert on public.fiscal_period_lock;
drop policy if exists fiscal_period_lock_update on public.fiscal_period_lock;
drop policy if exists fiscal_period_lock_delete on public.fiscal_period_lock;

alter table public.company_person enable row level security;
drop policy if exists company_person_select on public.company_person;
create policy company_person_select on public.company_person for select to authenticated using (current_user_is_admin_of(account_id));
drop policy if exists company_person_insert on public.company_person;
create policy company_person_insert on public.company_person for insert to authenticated with check (current_user_is_admin_of(account_id));
drop policy if exists company_person_update on public.company_person;
create policy company_person_update on public.company_person for update to authenticated
  using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
drop policy if exists company_person_delete on public.company_person;
create policy company_person_delete on public.company_person for delete to authenticated using (current_user_is_admin_of(account_id));
revoke all on table public.company_person from anon;

revoke all on function public.conta_cerrar_mes(uuid, date) from public, anon;
revoke all on function public.conta_reabrir_mes(uuid, date, text) from public, anon;
revoke all on function public.conta_mes_cerrado(uuid, date) from public, anon;
grant execute on function public.conta_cerrar_mes(uuid, date) to authenticated;
grant execute on function public.conta_reabrir_mes(uuid, date, text) to authenticated;
grant execute on function public.conta_mes_cerrado(uuid, date) to authenticated;
