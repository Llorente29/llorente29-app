-- ============================================================================
-- C00 · Tarea 6 · La base de la IA del módulo de contabilidad (encargo §6.1–6.3)
-- ----------------------------------------------------------------------------
-- Tres piezas, y las tres se escriben SOLO por funciones (nadie las escribe a
-- mano desde la app: no hay políticas de escritura):
--
--   ai_data_origin   De dónde sale cada dato que puso la IA o una importación:
--                    con el motivo, la fecha y EL VALOR QUE PUSO. La marca «IA»
--                    sale mientras el dato siga valiendo eso; si la persona lo
--                    cambia, deja de coincidir y la marca desaparece sola.
--   ai_action_log    Qué hizo la IA, sobre qué, por qué, cuándo y en nombre de
--                    quién; con el antes y el después para poder deshacerlo.
--   ai_suggestion    Lo que la IA propone y espera respuesta. Rechazada, no
--                    vuelve por el mismo motivo (único por empresa, clase y
--                    motivo).
--
-- Funciones (SECURITY DEFINER: escriben donde la app no puede; cada una
-- comprueba antes que quien llama es administrador o encargado de la cuenta
-- de esa empresa, con la misma función que usa la RLS):
--
--   conta_ia_poner            pone un campo de la empresa o de su perfil
--                             fiscal (lista cerrada) y lo deja en el registro
--   conta_ia_anadir_actividad añade una actividad del catálogo oficial
--   conta_ia_deshacer         deshace una acción del registro, si nadie la
--                             ha cambiado después
--   conta_sugerencias_calcular  crea las sugerencias que se pueden
--                             fundamentar con datos de la propia cuenta
--   conta_sugerencia_responder  aceptar (aplica, y queda en el registro) o
--                             rechazar (no vuelve)
--
-- No está en el camino del pedido: nada vivo llama a estas funciones y solo
-- tocan tablas del módulo de contabilidad (y lee supplier).
-- ============================================================================

-- ── El origen de cada dato ──────────────────────────────────────────────────
create table if not exists public.ai_data_origin (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  table_key   text not null check (table_key in ('company', 'company_tax_profile', 'company_activity')),
  row_id      uuid not null,
  field       text not null,
  source      text not null check (source in ('ai', 'import')),
  value_set   jsonb,
  reason      text not null check (length(trim(reason)) > 0),
  set_at      timestamptz not null default now(),
  set_by      uuid,
  primary key (table_key, row_id, field)
);
comment on table public.ai_data_origin is
  'C00 (§6.1). Qué datos puso la IA o una importación, con su motivo y el valor que puso. Lo que no está aquí lo escribió una persona.';
create index if not exists ai_data_origin_empresa on public.ai_data_origin (company_id);

-- ── El registro ─────────────────────────────────────────────────────────────
create table if not exists public.ai_action_log (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  action          text not null check (action in ('poner', 'anadir_actividad')),
  source          text not null default 'ai' check (source in ('ai', 'import')),
  table_key       text not null,
  row_id          uuid,
  field           text,
  before_value    jsonb,
  after_value     jsonb,
  reason          text not null check (length(trim(reason)) > 0),
  suggestion_id   uuid,
  done_at         timestamptz not null default now(),
  done_for        uuid,
  done_for_name   text,
  undone_at       timestamptz,
  undone_by       uuid,
  undone_by_name  text
);
comment on table public.ai_action_log is
  'C00 (§6.3). Toda acción de la IA: qué, sobre qué, por qué, cuándo y para quién. Se deshace desde aquí. Solo lo escriben las funciones conta_ia_*.';
create index if not exists ai_action_log_empresa on public.ai_action_log (company_id, done_at desc);

-- ── Las sugerencias ─────────────────────────────────────────────────────────
create table if not exists public.ai_suggestion (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  kind             text not null check (kind in ('modelo')),
  reason_key       text not null,
  title            text not null,
  why              text not null,
  payload          jsonb not null default '{}',
  status           text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid,
  decided_by_name  text,
  unique (company_id, kind, reason_key)
);
comment on table public.ai_suggestion is
  'C00 (§6.2). Lo que la IA propone. Una rechazada no vuelve por el mismo motivo: (empresa, clase, motivo) es único.';

-- ── Seguridad: se lee con la cuenta; no se escribe desde la app ─────────────
do $$
declare t text;
begin
  foreach t in array array['ai_data_origin', 'ai_action_log', 'ai_suggestion'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (belongs_to_account(account_id))', t || '_select', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── Ayudas ──────────────────────────────────────────────────────────────────
-- La cuenta de una empresa, si quien llama puede cambiarla; si no, error.
create or replace function public.conta_ia_cuenta(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes cambiar esta empresa' using errcode = '42501';
  end if;
  return v_cuenta;
end $$;
revoke all on function public.conta_ia_cuenta(uuid) from public, anon, authenticated;

-- Los campos que la IA puede poner. Ni el NIF de una empresa ya dada de alta
-- ni nada que no esté aquí.
create or replace function public.conta_ia_campo_permitido(p_tabla text, p_campo text)
returns boolean language sql immutable as $$
  select (p_tabla = 'company' and p_campo in ('legal_name', 'trade_name', 'legal_form_code', 'fiscal_street_type',
            'fiscal_street', 'fiscal_number', 'fiscal_postal_code', 'fiscal_city', 'fiscal_province'))
      or (p_tabla = 'company_tax_profile' and p_campo in ('tax_territory', 'vat_scheme_code', 'vat_period', 'vat_cash_basis',
            'vat_surcharge', 'chart_kind', 'account_digits', 'tax_forms'))
$$;

-- ── Poner un campo ──────────────────────────────────────────────────────────
create or replace function public.conta_ia_poner(
  p_company uuid, p_tabla text, p_campo text, p_valor jsonb, p_motivo text, p_origen text default 'ai'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_clave text; v_antes jsonb; v_despues jsonb; v_id uuid;
begin
  if not public.conta_ia_campo_permitido(p_tabla, p_campo) then
    raise exception 'La IA no puede poner «%» de «%»', p_campo, p_tabla using errcode = '42501';
  end if;
  if p_origen not in ('ai', 'import') then raise exception 'Origen no válido: %', p_origen using errcode = '22023'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Lo que hace la IA lleva siempre su porqué' using errcode = '23514';
  end if;
  v_clave := case p_tabla when 'company' then 'id' else 'company_id' end;
  if p_tabla = 'company_tax_profile' then
    insert into public.company_tax_profile (company_id, account_id) values (p_company, v_cuenta) on conflict (company_id) do nothing;
  end if;
  execute format('select to_jsonb(t.%I) from public.%I t where t.%I = $1', p_campo, p_tabla, v_clave) into v_antes using p_company;
  execute format('update public.%I set %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1))).%I where %I = $2',
                 p_tabla, p_campo, p_tabla, p_campo, p_campo, v_clave) using p_valor, p_company;
  execute format('select to_jsonb(t.%I) from public.%I t where t.%I = $1', p_campo, p_tabla, v_clave) into v_despues using p_company;

  insert into public.ai_data_origin (account_id, company_id, table_key, row_id, field, source, value_set, reason, set_by)
  values (v_cuenta, p_company, p_tabla, p_company, p_campo, p_origen, v_despues, trim(p_motivo), auth.uid())
  on conflict (table_key, row_id, field) do update
    set source = excluded.source, value_set = excluded.value_set, reason = excluded.reason, set_at = now(), set_by = excluded.set_by;

  insert into public.ai_action_log (account_id, company_id, action, source, table_key, row_id, field, before_value, after_value, reason, done_for, done_for_name)
  values (v_cuenta, p_company, 'poner', p_origen, p_tabla, p_company, p_campo, v_antes, v_despues, trim(p_motivo), auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  return v_id;
end $$;

-- ── Añadir una actividad del catálogo ───────────────────────────────────────
create or replace function public.conta_ia_anadir_actividad(
  p_company uuid, p_descripcion text, p_clase text, p_iae text, p_cnae text, p_principal boolean, p_motivo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.conta_ia_cuenta(p_company); v_act uuid; v_id uuid;
begin
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Lo que hace la IA lleva siempre su porqué' using errcode = '23514';
  end if;
  -- Nunca inventa: el epígrafe y la CNAE tienen que estar en las tablas oficiales.
  if p_iae is not null and not exists (select 1 from public.iae_heading where code = p_iae) then
    raise exception 'El epígrafe % no está en el IAE', p_iae using errcode = '23503';
  end if;
  if p_cnae is not null and not exists (select 1 from public.cnae_code where version = '2025' and code = p_cnae) then
    raise exception 'El código % no está en la CNAE-2025', p_cnae using errcode = '23503';
  end if;
  if p_principal then
    update public.company_activity set is_main = false where company_id = p_company and is_main;
  end if;
  insert into public.company_activity (account_id, company_id, kind, description, iae_code, cnae_version, cnae_code, is_main, created_by)
  values (v_cuenta, p_company, p_clase, trim(p_descripcion), p_iae, '2025', p_cnae,
          p_principal or not exists (select 1 from public.company_activity where company_id = p_company and ended_on is null),
          auth.uid())
  returning id into v_act;
  insert into public.ai_data_origin (account_id, company_id, table_key, row_id, field, source, value_set, reason, set_by)
  values (v_cuenta, p_company, 'company_activity', v_act, 'description', 'ai', to_jsonb(trim(p_descripcion)), trim(p_motivo), auth.uid());
  insert into public.ai_action_log (account_id, company_id, action, table_key, row_id, after_value, reason, done_for, done_for_name)
  values (v_cuenta, p_company, 'anadir_actividad', 'company_activity', v_act,
          (select to_jsonb(a) from public.company_activity a where a.id = v_act), trim(p_motivo), auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  return v_id;
end $$;

-- ── Deshacer ────────────────────────────────────────────────────────────────
create or replace function public.conta_ia_deshacer(p_registro uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ai_action_log; v_ahora jsonb; v_clave text; v_otras int;
begin
  select * into r from public.ai_action_log where id = p_registro for update;
  if r.id is null then raise exception 'No encuentro esa acción' using errcode = '42501'; end if;
  perform public.conta_ia_cuenta(r.company_id);
  if r.undone_at is not null then raise exception 'Eso ya se deshizo' using errcode = '23514'; end if;

  if r.action = 'poner' then
    v_clave := case r.table_key when 'company' then 'id' else 'company_id' end;
    execute format('select to_jsonb(t.%I) from public.%I t where t.%I = $1', r.field, r.table_key, v_clave) into v_ahora using r.company_id;
    if v_ahora is distinct from r.after_value then
      raise exception 'Ese dato ya lo cambió alguien después: no lo deshago para no pisarlo' using errcode = '23514';
    end if;
    execute format('update public.%I set %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1))).%I where %I = $2',
                   r.table_key, r.field, r.table_key, r.field, r.field, v_clave) using r.before_value, r.company_id;
    delete from public.ai_data_origin where table_key = r.table_key and row_id = r.row_id and field = r.field and value_set = r.after_value;
  elsif r.action = 'anadir_actividad' then
    if exists (select 1 from public.company_activity where id = r.row_id and is_main) then
      select count(*) into v_otras from public.company_activity where company_id = r.company_id and ended_on is null and id <> r.row_id;
      if v_otras > 0 then
        raise exception 'Es tu actividad principal: haz principal otra antes de quitarla' using errcode = '23514';
      end if;
    end if;
    delete from public.company_activity where id = r.row_id;
    delete from public.ai_data_origin where table_key = 'company_activity' and row_id = r.row_id;
  end if;

  update public.ai_action_log set undone_at = now(), undone_by = auth.uid(), undone_by_name = public.conta_nombre_actor() where id = r.id;
  return jsonb_build_object('id', r.id, 'deshecho', r.reason);
end $$;

-- ── Sugerencias ─────────────────────────────────────────────────────────────
-- Solo las que se fundamentan con datos de la propia cuenta. Hoy, dos:
--   modelo_115  un proveedor de alquiler (cuenta 621) con un 19 % de retención,
--               y la empresa no presenta el 115 (RD 439/2007, art. 100).
--   modelo_111  un proveedor con retención de profesional (15 % o 7 %), y la
--               empresa no presenta el 111 (RD 439/2007, art. 108).
-- Una abierta que ya no se cumple (la persona lo puso a mano) se quita; una
-- rechazada no vuelve nunca (on conflict do nothing).
create or replace function public.conta_sugerencias_calcular(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_modelos text[]; v_prov text; n integer := 0;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then
    raise exception 'Esa empresa no es de esta cuenta' using errcode = '42501';
  end if;
  select coalesce(tax_forms, '{}') into v_modelos from public.company_tax_profile where company_id = p_company;
  v_modelos := coalesce(v_modelos, '{}');

  -- 115
  select s.name into v_prov from public.supplier s join public.expense_category e on e.id = s.expense_category_id
   where s.account_id = v_cuenta and coalesce(s.is_active, true) and s.archived_at is null
     and e.pgc_account_hint = '621' and s.irpf_withholding_pct = 19
   order by s.name limit 1;
  if v_prov is not null and not ('115' = any(v_modelos)) then
    insert into public.ai_suggestion (account_id, company_id, kind, reason_key, title, why, payload)
    values (v_cuenta, p_company, 'modelo', 'modelo_115',
            'Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?',
            format('Lo veo en %s: alquiler (cuenta 621) con un 19 %% de retención. Esa retención se declara cada trimestre en el 115 (RD 439/2007, art. 100).', v_prov),
            jsonb_build_object('modelo', '115'))
    on conflict (company_id, kind, reason_key) do nothing;
    if found then n := n + 1; end if;
  else
    delete from public.ai_suggestion where company_id = p_company and reason_key = 'modelo_115' and status = 'open';
  end if;

  -- 111
  v_prov := null;
  select s.name into v_prov from public.supplier s
   where s.account_id = v_cuenta and coalesce(s.is_active, true) and s.archived_at is null and s.irpf_withholding_pct in (7, 15)
   order by s.name limit 1;
  if v_prov is not null and not ('111' = any(v_modelos)) then
    insert into public.ai_suggestion (account_id, company_id, kind, reason_key, title, why, payload)
    values (v_cuenta, p_company, 'modelo', 'modelo_111',
            'Pagas a profesionales con retención y no tienes el modelo 111. ¿Lo añado?',
            format('Lo veo en %s: le retienes el IRPF. Esas retenciones se declaran cada trimestre en el 111 (RD 439/2007, art. 108).', v_prov),
            jsonb_build_object('modelo', '111'))
    on conflict (company_id, kind, reason_key) do nothing;
    if found then n := n + 1; end if;
  else
    delete from public.ai_suggestion where company_id = p_company and reason_key = 'modelo_111' and status = 'open';
  end if;
  return n;
end $$;

create or replace function public.conta_sugerencia_responder(p_sugerencia uuid, p_acepta boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ai_suggestion; v_modelos text[]; v_log uuid;
begin
  select * into s from public.ai_suggestion where id = p_sugerencia for update;
  if s.id is null then raise exception 'No encuentro esa sugerencia' using errcode = '42501'; end if;
  perform public.conta_ia_cuenta(s.company_id);
  if s.status <> 'open' then raise exception 'Esa sugerencia ya está contestada' using errcode = '23514'; end if;
  if p_acepta then
    if s.kind = 'modelo' then
      select coalesce(tax_forms, '{}') into v_modelos from public.company_tax_profile where company_id = s.company_id;
      v_modelos := coalesce(v_modelos, '{}');
      if not ((s.payload ->> 'modelo') = any(v_modelos)) then
        v_log := public.conta_ia_poner(s.company_id, 'company_tax_profile', 'tax_forms',
                   to_jsonb((select array_agg(m order by m) from unnest(v_modelos || (s.payload ->> 'modelo')) m)),
                   s.why, 'ai');
        update public.ai_action_log set suggestion_id = s.id where id = v_log;
      end if;
    end if;
  end if;
  update public.ai_suggestion
     set status = case when p_acepta then 'accepted' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decided_by_name = public.conta_nombre_actor()
   where id = s.id;
  return jsonb_build_object('id', s.id, 'aceptada', p_acepta, 'registro', v_log);
end $$;

-- Quién puede llamar a qué.
do $$
declare f text;
begin
  foreach f in array array[
    'conta_ia_poner(uuid, text, text, jsonb, text, text)',
    'conta_ia_anadir_actividad(uuid, text, text, text, text, boolean, text)',
    'conta_ia_deshacer(uuid)', 'conta_sugerencias_calcular(uuid)', 'conta_sugerencia_responder(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
