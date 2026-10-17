-- supabase/migrations/20261122T0110_i01_modelo_datos.sql
--
-- cambia: public.company_tax_profile · prueba: supabase/staging/sql/20261122_i01_modelo_datos_prueba.sql
--   (dos disparadores nuevos sobre company_tax_profile: tax_forms pasa a ser el
--   espejo de tax_obligation. Ponerlos toma un momento un cierre SHARE ROW
--   EXCLUSIVE sobre company_tax_profile, que no es del camino del pedido.)
--
-- I01a · 2 · EL MODELO DE DATOS DE IMPUESTOS (informe del paso 1, §7).
-- Todo con account_id y company_id (regla 9). Lo que la pantalla enseñará va
-- guardado en palabras de oficina.
--
--   1. company_tax_facts: lo que la empresa dijo de sí misma (¿tienes
--      empleados?, ¿alquilas el local con retención?…), cada dato con quién y
--      cuándo lo dijo. «No lo sé» se guarda: valor null.
--   2. tax_obligation: qué modelos presenta y POR QUÉ (regla con nombre y los
--      datos en que se basó, o el motivo de quien lo añadió o quitó).
--      company_tax_profile.tax_forms queda como ESPEJO de tax_obligation (la
--      vista company_tax_forms da lo mismo): lo que ya la lee no cambia. Lo
--      que hoy la escribe (el alta y Tu empresa) se traduce a obligaciones y
--      se dice que llegó sin motivo. Quitar la columna va en dos pasos (I01b).
--      Las empresas que ya tienen tax_forms pasan a tax_obligation tal cual.
--   3. tax_return (una por modelo, empresa, ejercicio, periodo y número de
--      orden), con su estado como dato (CHECK) y cada cambio en
--      tax_return_event; tax_return_box (casillas), tax_return_line (lo que
--      entra, congelado) y tax_return_check (lo que ha comprobado Sumied).
--   4. tax_certificate, tax_certificate_grant y tax_certificate_use: la ficha
--      del certificado (sin el certificado: lo guarda el almacén, pieza 4),
--      quién puede usarlo y cada uso.
--   5. company_tax_presenter: quién presenta (la empresa o su asesoría) y el
--      consentimiento de la empresa. Una asesoría solo ve y gestiona los
--      impuestos de una empresa de otra cuenta con ese consentimiento vivo.
--
-- Escrituras: solo por funciones (security definer) o por el servidor. Desde
-- el front se lee, con RLS; las piezas 3 a 6 ponen las funciones que escriben.

-- ── 5. Quién presenta (antes que nada: las funciones de abajo la leen) ────
create table if not exists public.company_tax_presenter (
  company_id          uuid primary key references public.company(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  mode                text not null default 'company' check (mode in ('company', 'advisor')),
  certificate_id      uuid,
  advisor_account_id  uuid references public.accounts(id),
  advisor_basis       text check (advisor_basis in ('social_collaborator', 'power_of_attorney')),
  consented_by        uuid,
  consented_by_name   text,
  consented_at        timestamptz,
  revoked_by          uuid,
  revoked_at          timestamptz,
  since               date not null default current_date,
  updated_at          timestamptz not null default now(),
  check (mode = 'company' or (advisor_account_id is not null and advisor_basis is not null and advisor_account_id <> account_id)),
  check (mode = 'advisor' or (advisor_account_id is null and advisor_basis is null)),
  check ((consented_at is null) = (consented_by is null)),
  check (revoked_at is null or consented_at is not null)
);
comment on table public.company_tax_presenter is
  'I01a. Quién presenta los impuestos de la empresa: ella misma o su asesoría (colaboradora social o con poder). La asesoría solo accede con el consentimiento de la empresa (consented_*) vivo (sin revoked_at).';
drop trigger if exists company_tax_presenter_misma_cuenta on public.company_tax_presenter;
create trigger company_tax_presenter_misma_cuenta before insert or update on public.company_tax_presenter
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists company_tax_presenter_al_dia on public.company_tax_presenter;
create trigger company_tax_presenter_al_dia before update on public.company_tax_presenter
  for each row execute function public.conta_al_dia();

-- ── Quién puede ver y quién puede gestionar los impuestos de una empresa ───
-- Ver: un miembro de la cuenta de la empresa, o de la cuenta de su asesoría
-- si la empresa lo ha consentido y no lo ha retirado. Gestionar: lo mismo con
-- administrador o encargado.
-- El nombre de quien lo hace, para el registro.
create or replace function public.conta_impuesto_quien()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(display_name), '') from public.user_profiles where user_id = auth.uid() and active order by display_name limit 1), 'Sumied')
$$;

create or replace function public.conta_impuesto_puede_ver(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company c where c.id = p_company and public.belongs_to_account(c.account_id))
      or exists (select 1 from public.company_tax_presenter t
                  where t.company_id = p_company and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
                    and t.advisor_account_id = any (public.current_user_account_ids()))
$$;

create or replace function public.conta_impuesto_puede_gestionar(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company c where c.id = p_company and public.current_user_is_admin_or_manager_of(c.account_id))
      or exists (select 1 from public.company_tax_presenter t
                  where t.company_id = p_company and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
                    and public.current_user_is_admin_or_manager_of(t.advisor_account_id))
$$;

-- ── 1. Lo que la empresa dijo de sí misma ──────────────────────────────────
create table if not exists public.company_tax_facts (
  company_id     uuid not null references public.company(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  fact           text not null check (fact in ('pays_with_withholding', 'has_employees', 'pays_professionals', 'rents_premises_with_withholding',
                                               'roi_registered', 'previous_year_turnover', 'redeme', 'withheld_income_70')),
  value          jsonb,
  origin         text not null check (origin in ('alta', 'ajustes', 'asesoria', 'datos')),
  said_by        uuid,
  said_by_name   text,
  said_at        timestamptz not null default now(),
  primary key (company_id, fact),
  -- Sí/no o un número; null = «No lo sé».
  check (value is null or (fact = 'previous_year_turnover' and jsonb_typeof(value) = 'number')
                       or (fact <> 'previous_year_turnover' and jsonb_typeof(value) = 'boolean'))
);
comment on table public.company_tax_facts is
  'I01a. Datos de la empresa que deciden sus modelos (informe §4 y §7.1), cada uno con quién y cuándo lo dijo. value null = «No lo sé». pays_with_withholding: la pregunta del alta «¿Pagas nóminas o facturas de profesionales con retención?» (junta has_employees y pays_professionals, que quedan para cuando se pregunten por separado). withheld_income_70: autónomo profesional con al menos el 70 % de sus ingresos retenidos.';
drop trigger if exists company_tax_facts_misma_cuenta on public.company_tax_facts;
create trigger company_tax_facts_misma_cuenta before insert or update on public.company_tax_facts
  for each row execute function public.conta_misma_cuenta();

-- ── 2. Qué modelos presenta y por qué ──────────────────────────────────────
-- Una fila por decisión. La vigente de cada modelo es la de valid_to null; las
-- de antes quedan (historia). origin: rule = lo dijo una regla (rule_key,
-- rule_facts, why); added / removed = lo decidió una persona (reason, obligatorio).
create table if not exists public.tax_obligation (
  id                           uuid primary key default gen_random_uuid(),
  account_id                   uuid not null references public.accounts(id) on delete cascade,
  company_id                   uuid not null references public.company(id) on delete cascade,
  form_code                    text not null references public.tax_form(code),
  cadence                      text not null check (cadence in ('monthly', 'quarterly', 'annual', 'instalments_202')),
  active                       boolean not null,
  origin                       text not null check (origin in ('rule', 'added', 'removed')),
  rule_key                     text,
  rule_facts                   jsonb not null default '{}',
  why                          text not null check (btrim(why) <> ''),
  reason                       text,
  payment_mode                 text not null default 'none' check (payment_mode in ('direct_debit', 'nrc', 'none')),
  payment_treasury_account_id  uuid references public.treasury_account(id),
  valid_from                   date not null default current_date,
  valid_to                     date,
  decided_by                   uuid,
  decided_by_name              text,
  decided_at                   timestamptz not null default now(),
  check (origin <> 'rule' or rule_key is not null),
  check (origin = 'rule' or (reason is not null and btrim(reason) <> '')),
  -- Una persona que añade, lo deja activo; que quita, inactivo. Una regla puede decir las dos cosas («Llevas el SII: no presentas el 390»).
  check (origin <> 'removed' or not active),
  check (origin <> 'added' or active),
  check (valid_to is null or valid_to >= valid_from),
  check (payment_mode <> 'direct_debit' or payment_treasury_account_id is not null)
);
comment on table public.tax_obligation is
  'I01a. Qué modelos presenta la empresa y por qué. why: el porqué en palabras de oficina («Tienes 6 personas en nómina»); rule_key y rule_facts: la regla y los datos (origin rule); reason: el motivo de quien lo añadió o quitó (obligatorio). La vigente: valid_to null.';
create unique index if not exists tax_obligation_vigente on public.tax_obligation (company_id, form_code) where valid_to is null;
create index if not exists tax_obligation_empresa on public.tax_obligation (company_id, valid_to);
drop trigger if exists tax_obligation_misma_cuenta on public.tax_obligation;
create trigger tax_obligation_misma_cuenta before insert or update on public.tax_obligation
  for each row execute function public.conta_misma_cuenta();

-- La lista de siempre, desde las obligaciones: lo que lee tax_forms.
create or replace view public.company_tax_forms with (security_invoker = true) as
  select c.id as company_id, c.account_id,
         coalesce(array_agg(o.form_code order by o.form_code) filter (where o.id is not null), '{}') as tax_forms
    from public.company c
    left join public.tax_obligation o on o.company_id = c.id and o.valid_to is null and o.active
   group by c.id, c.account_id;
comment on view public.company_tax_forms is
  'I01a. Los modelos que presenta cada empresa, desde tax_obligation. Sustituye a company_tax_profile.tax_forms, que queda como espejo hasta quitarla (dos pasos, I01b).';

-- El espejo: tax_obligation → company_tax_profile.tax_forms. Marca la sesión
-- para que el disparador de la columna no lo tome por una escritura de fuera.
create or replace function public.conta_impuesto_espejo_tax_forms()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid := coalesce(new.company_id, old.company_id);
begin
  -- Dentro del disparador de la columna (o de la migración): la columna la pone él.
  if coalesce(current_setting('conta.i01_desde_columna', true), '') = 'si' then return null; end if;
  perform set_config('conta.i01_espejo', 'si', true);
  update public.company_tax_profile p set tax_forms = f.tax_forms
    from public.company_tax_forms f
   where p.company_id = v_company and f.company_id = v_company and p.tax_forms is distinct from f.tax_forms;
  perform set_config('conta.i01_espejo', '', true);
  return null;
end $$;
drop trigger if exists tax_obligation_espejo on public.tax_obligation;
create trigger tax_obligation_espejo after insert or update or delete on public.tax_obligation
  for each row execute function public.conta_impuesto_espejo_tax_forms();

-- Lo que escribe tax_forms a la antigua (el alta, Tu empresa) se traduce a
-- obligaciones: lo que entra, «added»; lo que sale, «removed». Sin motivo, y
-- se dice: la pantalla de antes no lo pide. La primera lista de una empresa
-- (no tenía ninguna) es la deducción del alta: origin rule, regla alta_c00.
create or replace function public.conta_impuesto_desde_tax_forms()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quien uuid := auth.uid(); v_nombre text; v_primera boolean; c text;
  v_motivo constant text := 'Cambiado en los datos de la empresa, sin motivo: esa pantalla todavía no lo pide.';
begin
  if coalesce(current_setting('conta.i01_espejo', true), '') = 'si' then return new; end if;
  if tg_op = 'UPDATE' and new.tax_forms is not distinct from old.tax_forms then return new; end if;
  v_nombre := public.conta_impuesto_quien();
  v_primera := not exists (select 1 from public.tax_obligation where company_id = new.company_id);
  perform set_config('conta.i01_desde_columna', 'si', true);
  -- Lo que sale.
  for c in select o.form_code from public.tax_obligation o
            where o.company_id = new.company_id and o.valid_to is null and o.active
              and not (o.form_code = any (coalesce(new.tax_forms, '{}'))) loop
    update public.tax_obligation set valid_to = current_date where company_id = new.company_id and form_code = c and valid_to is null;
    insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, why, reason, decided_by, decided_by_name)
    values (new.account_id, new.company_id, c, public.conta_impuesto_cadencia_de(new.company_id, c), false, 'removed',
            'Quitado de la lista de modelos.', v_motivo, v_quien, v_nombre);
  end loop;
  -- Lo que entra.
  for c in select distinct x from unnest(coalesce(new.tax_forms, '{}')) x
            where not exists (select 1 from public.tax_obligation o where o.company_id = new.company_id and o.form_code = x and o.valid_to is null and o.active) loop
    update public.tax_obligation set valid_to = current_date where company_id = new.company_id and form_code = c and valid_to is null;
    if v_primera then
      insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, rule_key, why, decided_by, decided_by_name)
      values (new.account_id, new.company_id, c, public.conta_impuesto_cadencia_de(new.company_id, c), true, 'rule', 'alta_c00',
              'Lo propuso el alta con tus respuestas.', v_quien, v_nombre);
    else
      insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, why, reason, decided_by, decided_by_name)
      values (new.account_id, new.company_id, c, public.conta_impuesto_cadencia_de(new.company_id, c), true, 'added',
              'Añadido a la lista de modelos.', v_motivo, v_quien, v_nombre);
    end if;
  end loop;
  perform set_config('conta.i01_desde_columna', '', true);
  -- La columna queda como dicen las obligaciones.
  select f.tax_forms into new.tax_forms from public.company_tax_forms f where f.company_id = new.company_id;
  new.tax_forms := coalesce(new.tax_forms, '{}');
  return new;
end $$;

-- La cadencia de cada modelo: la del IVA para 303 y 349; anual para los resúmenes y el 200; el 202, en tres pagos.
create or replace function public.conta_impuesto_cadencia_de(p_company uuid, p_form text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_form in ('303', '349', '111', '115') then
      case when (select vat_period from public.company_tax_profile where company_id = p_company) = 'monthly' then 'monthly' else 'quarterly' end
    when p_form = '202' then 'instalments_202'
    else 'annual' end
$$;

drop trigger if exists company_tax_profile_tax_forms on public.company_tax_profile;
create trigger company_tax_profile_tax_forms before insert or update of tax_forms on public.company_tax_profile
  for each row execute function public.conta_impuesto_desde_tax_forms();

-- Las empresas que ya tienen su lista: pasa a tax_obligation tal cual, como
-- deducción del alta (no se recalcula nada aquí: eso es la pieza 3).
do $$
declare v_n int;
begin
  -- Sin tocar company_tax_profile: la columna ya dice lo mismo (el espejo no corre).
  perform set_config('conta.i01_desde_columna', 'si', true);
  insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, rule_key, why, decided_by_name)
  select p.account_id, p.company_id, x, public.conta_impuesto_cadencia_de(p.company_id, x), true, 'rule', 'alta_c00',
         'Lo propuso el alta con tus respuestas.', 'Migración I01a'
    from public.company_tax_profile p, unnest(p.tax_forms) x
   where exists (select 1 from public.tax_form f where f.code = x)
     and not exists (select 1 from public.tax_obligation o where o.company_id = p.company_id and o.form_code = x and o.valid_to is null);
  get diagnostics v_n = row_count;
  perform set_config('conta.i01_desde_columna', '', true);
  raise notice 'I01a: % modelos de company_tax_profile.tax_forms pasan a tax_obligation.', v_n;
end $$;

-- ── 3. La declaración ──────────────────────────────────────────────────────
create table if not exists public.tax_return (
  id                           uuid primary key default gen_random_uuid(),
  account_id                   uuid not null references public.accounts(id) on delete cascade,
  company_id                   uuid not null references public.company(id) on delete cascade,
  obligation_id                uuid references public.tax_obligation(id),
  form_code                    text not null references public.tax_form(code),
  fiscal_year                  int not null check (fiscal_year between 2000 and 2100),
  cadence                      text not null check (cadence in ('monthly', 'quarterly', 'annual', 'instalments_202')),
  period                       text not null check (period ~ '^([1-4]T|0[1-9]|1[0-2]|0A|[1-3]P)$'),
  sequence                     smallint not null default 1 check (sequence >= 1),
  kind                         text not null default 'normal' check (kind in ('normal', 'complementary', 'substitutive')),
  replaces_return_id           uuid references public.tax_return(id),
  -- Plazos: los calcula conta_impuesto_plazo y se guardan (decisión del 17/10).
  due_date                     date not null,
  due_date_direct_debit        date,
  due_provisional              text,
  alert_on                     date,
  -- Estado, como dato.
  status                       text not null default 'pending'
                                 check (status in ('pending', 'draft', 'reviewed', 'filed', 'booked', 'paid', 'offset', 'refunded', 'not_required')),
  not_required_reason          text,
  -- Resultado.
  result_kind                  text check (result_kind in ('to_pay', 'to_refund', 'to_offset', 'zero', 'no_activity')),
  amount                       numeric(14, 2) check (amount >= 0),
  previous_period_amount       numeric(14, 2),
  -- Pago.
  payment_mode                 text check (payment_mode in ('direct_debit', 'nrc', 'debt_recognition', 'offset', 'refund')),
  payment_treasury_account_id  uuid references public.treasury_account(id),
  nrc                          text,
  -- Presentación.
  filed_at                     timestamptz,
  filed_by                     uuid,
  filed_by_name                text,
  filed_via                    text check (filed_via in ('sumied', 'outside')),
  presenter_kind               text check (presenter_kind in ('company', 'advisor')),
  certificate_id               uuid,
  aeat_csv                     text,
  aeat_receipt_number          text,
  receipt_document_path        text,
  outside_csv_pasted_at        timestamptz,
  -- Enlaces.
  liquidation_entry_id         uuid references public.journal_entry(id) on delete set null,
  payment_entry_id             uuid references public.journal_entry(id) on delete set null,
  bank_match_id                uuid references public.bank_match(id) on delete set null,
  -- Revisión.
  calculated_at                timestamptz,
  reviewed_at                  timestamptz,
  reviewed_by                  uuid,
  reviewed_by_name             text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (company_id, form_code, fiscal_year, period, sequence),
  check ((kind = 'normal') = (replaces_return_id is null)),
  check (status <> 'not_required' or (not_required_reason is not null and btrim(not_required_reason) <> '')),
  check (result_kind is null or amount is not null),
  check (result_kind not in ('zero', 'no_activity') or amount = 0),
  check (result_kind not in ('to_pay', 'to_refund', 'to_offset') or amount > 0),
  -- Presentada: con su fecha, su vía y su CSV (también si se presentó fuera).
  check (status not in ('filed', 'booked', 'paid', 'offset', 'refunded')
         or (filed_at is not null and filed_via is not null and aeat_csv is not null)),
  check (status not in ('reviewed', 'filed', 'booked', 'paid', 'offset', 'refunded') or result_kind is not null),
  check (payment_mode <> 'direct_debit' or payment_treasury_account_id is not null),
  check (payment_mode <> 'nrc' or nrc is not null or status in ('pending', 'draft', 'reviewed'))
);
comment on table public.tax_return is
  'I01a. Una declaración por modelo, empresa, ejercicio, periodo y número de orden (las complementarias y sustitutivas llevan otro). Estado como dato (CHECK) y cada cambio en tax_return_event. Plazos calculados y guardados.';
create index if not exists tax_return_empresa_plazo on public.tax_return (company_id, due_date);
drop trigger if exists tax_return_misma_cuenta on public.tax_return;
create trigger tax_return_misma_cuenta before insert or update on public.tax_return
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists tax_return_al_dia on public.tax_return;
create trigger tax_return_al_dia before update on public.tax_return
  for each row execute function public.conta_al_dia();

create table if not exists public.tax_return_event (
  id             uuid primary key default gen_random_uuid(),
  tax_return_id  uuid not null references public.tax_return(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  at             timestamptz not null default now(),
  by_user        uuid,
  by_name        text,
  kind           text not null check (kind in ('status', 'calculation', 'check', 'aeat_call', 'note')),
  from_status    text,
  to_status      text,
  aeat_service   text check (aeat_service in ('present', 'query', 'receipt_pdf', 'outside_check')),
  result         text check (result in ('ok', 'error')),
  aeat_codes     text[],
  message        text,
  detail         jsonb not null default '{}',
  check (kind <> 'status' or to_status is not null),
  check (kind <> 'aeat_call' or (aeat_service is not null and result is not null))
);
comment on table public.tax_return_event is
  'I01a. Cada cambio de estado de una declaración y cada llamada a Hacienda, con quién, cuándo y el resultado. message: lo que pasó en palabras de oficina (los errores de Hacienda, traducidos); aeat_codes: los códigos tal cual.';
create index if not exists tax_return_event_declaracion on public.tax_return_event (tax_return_id, at);

-- Los cambios de estado que valen, y cada cambio a su registro.
create or replace function public.conta_impuesto_estado_vale(p_de text, p_a text)
returns boolean language sql immutable set search_path = public as $$
  select (p_de, p_a) in (
    ('pending', 'draft'), ('pending', 'not_required'),
    ('draft', 'reviewed'), ('draft', 'pending'), ('draft', 'not_required'), ('draft', 'filed'),
    ('reviewed', 'draft'), ('reviewed', 'filed'), ('reviewed', 'not_required'),
    ('filed', 'booked'), ('filed', 'paid'), ('filed', 'offset'), ('filed', 'refunded'),
    ('booked', 'paid'), ('booked', 'offset'), ('booked', 'refunded'),
    ('not_required', 'pending'))
$$;

-- Antes de escribir (antes que los CHECK): el cambio tiene que valer, y se dice cuál no.
create or replace function public.conta_impuesto_estado_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.conta_impuesto_estado_vale(old.status, new.status) then
    raise exception 'Una declaración no pasa de «%» a «%».', public.conta_impuesto_estado_texto(old.status), public.conta_impuesto_estado_texto(new.status)
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists tax_return_estado_antes on public.tax_return;
create trigger tax_return_estado_antes before update of status on public.tax_return
  for each row execute function public.conta_impuesto_estado_antes();

-- Después: cada cambio, a su registro.
create or replace function public.conta_impuesto_estado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_nombre := public.conta_impuesto_quien();
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, from_status, to_status, message)
  values (new.id, new.account_id, new.company_id, auth.uid(), v_nombre, 'status',
          case when tg_op = 'UPDATE' then old.status end, new.status,
          case when new.status = 'not_required' then 'No hay que presentarlo: ' || new.not_required_reason
               else public.conta_impuesto_estado_texto(new.status) end);
  return new;
end $$;
drop trigger if exists tax_return_estado on public.tax_return;
create trigger tax_return_estado after insert or update of status on public.tax_return
  for each row execute function public.conta_impuesto_estado();

-- El nombre de cada estado, en palabras de oficina (tableros 9 y 10).
create or replace function public.conta_impuesto_estado_texto(p_status text)
returns text language sql immutable set search_path = public as $$
  select case p_status
    when 'pending' then 'Por calcular' when 'draft' then 'Borrador' when 'reviewed' then 'Revisado'
    when 'filed' then 'Presentado' when 'booked' then 'Contabilizado' when 'paid' then 'Pagado'
    when 'offset' then 'Compensado' when 'refunded' then 'Devuelto' when 'not_required' then 'No hay que presentarlo'
    else p_status end
$$;

create table if not exists public.tax_return_box (
  tax_return_id  uuid not null references public.tax_return(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  box            text not null check (box ~ '^[0-9]{2,3}[A-Z]?$'),
  value          numeric(16, 2),
  value_text     text,
  origin         text not null default 'calculated' check (origin in ('calculated', 'manual')),
  manual_reason  text,
  source         jsonb not null default '{}',
  primary key (tax_return_id, box),
  check ((value is null) <> (value_text is null)),
  check (origin <> 'manual' or (manual_reason is not null and btrim(manual_reason) <> ''))
);
comment on table public.tax_return_box is
  'I01a. Las casillas del modelo oficial. source: de qué filas sale cada una. Una casilla puesta a mano lleva su motivo. El fichero oficial se genera de aquí.';

create table if not exists public.tax_return_line (
  id                   uuid primary key default gen_random_uuid(),
  tax_return_id        uuid not null references public.tax_return(id) on delete cascade,
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  vat_book_entry_id    uuid references public.vat_book_entry(id) on delete set null,
  journal_line_id      uuid references public.journal_line(id) on delete set null,
  supplier_invoice_id  uuid references public.supplier_invoice(id) on delete set null,
  boxes                text[] not null default '{}',
  frozen               jsonb not null,
  check (vat_book_entry_id is not null or journal_line_id is not null or supplier_invoice_id is not null or frozen ? 'origen')
);
comment on table public.tax_return_line is
  'I01a. Qué filas entran en una declaración y cómo eran al declararlas (frozen: base, cuota, tipo, fecha…). Si después se toca una, se ve la diferencia y pide complementaria.';
create index if not exists tax_return_line_declaracion on public.tax_return_line (tax_return_id);
create index if not exists tax_return_line_libro on public.tax_return_line (vat_book_entry_id) where vat_book_entry_id is not null;

create table if not exists public.tax_return_check (
  id                uuid primary key default gen_random_uuid(),
  tax_return_id     uuid not null references public.tax_return(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  check_key         text not null check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                                                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout')),
  result            text not null check (result in ('ok', 'warning', 'error')),
  title             text not null check (btrim(title) <> ''),
  detail            jsonb not null default '{}',
  checked_at        timestamptz not null default now(),
  accepted_by       uuid,
  accepted_by_name  text,
  accepted_at       timestamptz,
  accepted_reason   text,
  unique (tax_return_id, check_key),
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or (result = 'warning' and accepted_reason is not null and btrim(accepted_reason) <> ''))
);
comment on table public.tax_return_check is
  'I01a. Lo que ha comprobado Sumied antes de presentar (tablero 9): ✓ = ok, ! = warning o error. title: lo que se ve, en palabras de oficina. Un aviso se puede dar por bueno, con motivo («Julio la dio por buena el 09/10»); un error, no.';

-- ── 4. El certificado (la ficha; el certificado lo guarda el almacén) ───────
create table if not exists public.tax_certificate (
  id                   uuid primary key default gen_random_uuid(),
  owner_account_id     uuid not null references public.accounts(id) on delete cascade,
  subject_name         text not null,
  subject_tax_id_hash  text not null check (subject_tax_id_hash ~ '^[0-9a-f]{64}$'),
  subject_tax_id_tail  text check (subject_tax_id_tail ~ '^[0-9A-Z]{3}$'),
  issuer               text not null,
  serial               text not null,
  valid_from           timestamptz not null,
  valid_to             timestamptz not null,
  fingerprint_sha256   text not null unique check (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  kind                 text not null check (kind in ('legal_representative', 'natural_person', 'other')),
  storage              text not null check (storage in ('vault', 'kms')),
  vault_secret_id      uuid,
  kms_key_ref          text,
  ciphertext           bytea,
  wrapped_key          bytea,
  status               text not null default 'active' check (status in ('active', 'expired', 'removed')),
  uploaded_by          uuid,
  uploaded_by_name     text,
  uploaded_at          timestamptz not null default now(),
  removed_at           timestamptz,
  removed_by           uuid,
  removed_by_name      text,
  last_test_at         timestamptz,
  last_test_result     text check (last_test_result in ('ok', 'error')),
  last_test_message    text,
  check (valid_to > valid_from),
  check ((status = 'removed') = (removed_at is not null)),
  -- Dónde está: en el Vault (su secreto) o en el KMS (cifrado y su clave). Quitado, ya no está en ninguno.
  check (status = 'removed'
         or (storage = 'vault' and vault_secret_id is not null and kms_key_ref is null and ciphertext is null)
         or (storage = 'kms' and kms_key_ref is not null and ciphertext is not null and vault_secret_id is null)),
  check (status <> 'removed' or (vault_secret_id is null and ciphertext is null and wrapped_key is null))
);
comment on table public.tax_certificate is
  'I01a. La ficha de un certificado electrónico: de quién es, quién lo emitió, hasta cuándo vale y en qué almacén está (storage). El certificado no está aquí: lo guarda el almacén (pieza 4); el front no lee vault_secret_id, kms_key_ref, ciphertext ni wrapped_key. El NIF del titular, solo su huella y sus tres últimos caracteres.';

alter table public.company_tax_presenter drop constraint if exists company_tax_presenter_certificate_id_fkey;
alter table public.company_tax_presenter add constraint company_tax_presenter_certificate_id_fkey
  foreign key (certificate_id) references public.tax_certificate(id) on delete set null;
alter table public.tax_return drop constraint if exists tax_return_certificate_id_fkey;
alter table public.tax_return add constraint tax_return_certificate_id_fkey
  foreign key (certificate_id) references public.tax_certificate(id) on delete set null;

create table if not exists public.tax_certificate_grant (
  id              uuid primary key default gen_random_uuid(),
  certificate_id  uuid not null references public.tax_certificate(id) on delete cascade,
  user_id         uuid not null,
  permission      text not null check (permission in ('file', 'view')),
  granted_by      uuid,
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
comment on table public.tax_certificate_grant is
  'I01a. Quién puede usar un certificado: file = puede presentar; view = solo ver. Uno vivo por persona y certificado.';
create unique index if not exists tax_certificate_grant_vivo on public.tax_certificate_grant (certificate_id, user_id) where revoked_at is null;

create table if not exists public.tax_certificate_use (
  id               uuid primary key default gen_random_uuid(),
  certificate_id   uuid not null references public.tax_certificate(id) on delete cascade,
  owner_account_id uuid not null references public.accounts(id) on delete cascade,
  tax_return_id    uuid references public.tax_return(id) on delete set null,
  company_id       uuid references public.company(id) on delete set null,
  user_id          uuid,
  user_name        text,
  action           text not null check (action in ('upload', 'test', 'file', 'query', 'receipt_pdf', 'remove')),
  confirmation_id  uuid unique,
  result           text not null check (result in ('ok', 'error', 'denied')),
  message          text,
  aeat_ref_masked  text,
  at               timestamptz not null default now()
);
comment on table public.tax_certificate_use is
  'I01a. Cada vez que se ha usado un certificado (tablero 8): quién, para qué, con qué resultado. confirmation_id: el token de un solo uso con el que se abrió. Solo se añade: no se cambia ni se borra.';
create index if not exists tax_certificate_use_certificado on public.tax_certificate_use (certificate_id, at desc);

-- ── RLS: se lee con permiso; se escribe por funciones ──────────────────────
alter table public.company_tax_presenter enable row level security;
alter table public.company_tax_facts enable row level security;
alter table public.tax_obligation enable row level security;
alter table public.tax_return enable row level security;
alter table public.tax_return_event enable row level security;
alter table public.tax_return_box enable row level security;
alter table public.tax_return_line enable row level security;
alter table public.tax_return_check enable row level security;
alter table public.tax_certificate enable row level security;
alter table public.tax_certificate_grant enable row level security;
alter table public.tax_certificate_use enable row level security;

drop policy if exists company_tax_presenter_select on public.company_tax_presenter;
create policy company_tax_presenter_select on public.company_tax_presenter for select to authenticated
  using (public.conta_impuesto_puede_ver(company_id) or advisor_account_id = any (public.current_user_account_ids()));
drop policy if exists company_tax_facts_select on public.company_tax_facts;
create policy company_tax_facts_select on public.company_tax_facts for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_obligation_select on public.tax_obligation;
create policy tax_obligation_select on public.tax_obligation for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_return_select on public.tax_return;
create policy tax_return_select on public.tax_return for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_return_event_select on public.tax_return_event;
create policy tax_return_event_select on public.tax_return_event for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_return_box_select on public.tax_return_box;
create policy tax_return_box_select on public.tax_return_box for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_return_line_select on public.tax_return_line;
create policy tax_return_line_select on public.tax_return_line for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
drop policy if exists tax_return_check_select on public.tax_return_check;
create policy tax_return_check_select on public.tax_return_check for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
-- El certificado y sus permisos, solo la cuenta dueña. El cliente de una asesoría
-- no ve nada del certificado de la asesoría (tablero 8): ve que presenta ella.
drop policy if exists tax_certificate_select on public.tax_certificate;
create policy tax_certificate_select on public.tax_certificate for select to authenticated using (public.belongs_to_account(owner_account_id));
drop policy if exists tax_certificate_grant_select on public.tax_certificate_grant;
create policy tax_certificate_grant_select on public.tax_certificate_grant for select to authenticated
  using (exists (select 1 from public.tax_certificate c where c.id = certificate_id and public.belongs_to_account(c.owner_account_id)));
drop policy if exists tax_certificate_use_select on public.tax_certificate_use;
create policy tax_certificate_use_select on public.tax_certificate_use for select to authenticated using (public.belongs_to_account(owner_account_id));

revoke all on table public.company_tax_presenter, public.company_tax_facts, public.tax_obligation, public.tax_return, public.tax_return_event,
  public.tax_return_box, public.tax_return_line, public.tax_return_check, public.tax_certificate, public.tax_certificate_grant,
  public.tax_certificate_use from anon, authenticated;
grant select on table public.company_tax_presenter, public.company_tax_facts, public.tax_obligation, public.tax_return, public.tax_return_event,
  public.tax_return_box, public.tax_return_line, public.tax_return_check, public.tax_certificate_grant, public.tax_certificate_use to authenticated;
-- Del certificado, el front solo lee la ficha: nunca dónde ni cómo está guardado.
grant select (id, owner_account_id, subject_name, subject_tax_id_tail, issuer, serial, valid_from, valid_to, fingerprint_sha256, kind, storage,
              status, uploaded_by_name, uploaded_at, removed_at, removed_by_name, last_test_at, last_test_result, last_test_message)
  on public.tax_certificate to authenticated;
grant select on public.company_tax_forms to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.company_tax_presenter, public.company_tax_facts, public.tax_obligation, public.tax_return, public.tax_return_event,
      public.tax_return_box, public.tax_return_line, public.tax_return_check, public.tax_certificate_grant, public.tax_certificate_use,
      public.company_tax_forms to conta_lectura;
    grant select (id, owner_account_id, issuer, valid_from, valid_to, kind, storage, status, uploaded_at, removed_at, last_test_at, last_test_result)
      on public.tax_certificate to conta_lectura;
  end if;
end $$;

revoke all on function public.conta_impuesto_puede_ver(uuid), public.conta_impuesto_puede_gestionar(uuid), public.conta_impuesto_quien() from public, anon;
grant execute on function public.conta_impuesto_puede_ver(uuid), public.conta_impuesto_puede_gestionar(uuid), public.conta_impuesto_quien() to authenticated, service_role;
revoke all on function public.conta_impuesto_espejo_tax_forms(), public.conta_impuesto_desde_tax_forms(), public.conta_impuesto_estado(), public.conta_impuesto_estado_antes(),
  public.conta_impuesto_cadencia_de(uuid, text) from public, anon, authenticated;

-- ── Escribir: los datos de la empresa y quién presenta ─────────────────────
-- Un dato de la empresa (el alta, Ajustes o la asesoría): quién y cuándo.
create or replace function public.conta_impuesto_dato_poner(p_company uuid, p_fact text, p_value jsonb, p_origin text default 'ajustes')
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_nombre text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, cambia estos datos.' using errcode = '42501';
  end if;
  v_nombre := public.conta_impuesto_quien();
  insert into public.company_tax_facts (company_id, account_id, fact, value, origin, said_by, said_by_name, said_at)
  values (p_company, v_acc, p_fact, case when p_value = 'null'::jsonb then null else p_value end, p_origin, auth.uid(), v_nombre, now())
  on conflict (company_id, fact) do update set value = excluded.value, origin = excluded.origin, said_by = excluded.said_by,
    said_by_name = excluded.said_by_name, said_at = excluded.said_at;
end $$;

-- Las respuestas del paso «impuestos» del alta, que hasta hoy se tiraban.
-- «__nolose» = «No lo sé» (valor null). Lo que no se preguntó, no se toca.
create or replace function public.conta_impuesto_datos_del_alta(p_company uuid, p_respuestas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare k text; v text; v_fact text; n int := 0;
begin
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_respuestas, '{}')) loop
    v_fact := case k when 'retiene' then 'pays_with_withholding' when 'alquiler' then 'rents_premises_with_withholding'
                     when 'retenido70' then 'withheld_income_70' end;
    continue when v_fact is null;
    if v not in ('__nolose', 'si', 'no') then
      raise exception 'La respuesta «%» a «%» no es sí, no ni «No lo sé».', v, k using errcode = '22023';
    end if;
    perform public.conta_impuesto_dato_poner(p_company, v_fact,
      case v when '__nolose' then 'null'::jsonb when 'si' then 'true'::jsonb else 'false'::jsonb end, 'alta');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Quién presenta: la empresa, o su asesoría con el consentimiento de la empresa
-- (lo da un administrador de la empresa, nunca la asesoría).
create or replace function public.conta_impuesto_presentador_poner(p_company uuid, p_mode text, p_advisor_account uuid default null,
                                                                   p_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_nombre text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_acc) then
    raise exception 'Solo un administrador de la empresa decide quién presenta sus impuestos.' using errcode = '42501';
  end if;
  v_nombre := public.conta_impuesto_quien();
  insert into public.company_tax_presenter (company_id, account_id, mode, advisor_account_id, advisor_basis, consented_by, consented_by_name, consented_at, since)
  values (p_company, v_acc, p_mode, p_advisor_account, p_basis,
          case when p_mode = 'advisor' then auth.uid() end, case when p_mode = 'advisor' then v_nombre end,
          case when p_mode = 'advisor' then now() end, current_date)
  on conflict (company_id) do update set mode = excluded.mode, advisor_account_id = excluded.advisor_account_id,
    advisor_basis = excluded.advisor_basis, consented_by = excluded.consented_by, consented_by_name = excluded.consented_by_name,
    consented_at = excluded.consented_at, revoked_by = null, revoked_at = null, since = excluded.since, certificate_id = null;
end $$;

-- Retirar el consentimiento: la asesoría deja de ver y de gestionar en el acto.
create or replace function public.conta_impuesto_presentador_retirar(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.current_user_is_admin_of(v_acc) then
    raise exception 'Solo un administrador de la empresa retira el permiso de su asesoría.' using errcode = '42501';
  end if;
  update public.company_tax_presenter set revoked_by = auth.uid(), revoked_at = now()
   where company_id = p_company and mode = 'advisor' and revoked_at is null;
  if not found then raise exception 'Esta empresa no tiene una asesoría con permiso.' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.conta_impuesto_dato_poner(uuid, text, jsonb, text), public.conta_impuesto_datos_del_alta(uuid, jsonb),
  public.conta_impuesto_presentador_poner(uuid, text, uuid, text), public.conta_impuesto_presentador_retirar(uuid) from public, anon;
grant execute on function public.conta_impuesto_dato_poner(uuid, text, jsonb, text), public.conta_impuesto_datos_del_alta(uuid, jsonb),
  public.conta_impuesto_presentador_poner(uuid, text, uuid, text), public.conta_impuesto_presentador_retirar(uuid) to authenticated;
