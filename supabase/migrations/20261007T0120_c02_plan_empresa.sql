-- ============================================================================
-- C02 · Plan contable — 3 · EL PLAN DE CADA EMPRESA
-- ----------------------------------------------------------------------------
-- Encargo C02 §3 y respuesta 1 de Julio (D2, D3, D5). La regla está escrita
-- y probada en src/modules/conta/lib/planEmpresa.ts; aquí se repite en SQL y
-- supabase/staging/sql/20261007_c02_prueba_plan.sql comprueba que da lo mismo
-- sobre las empresas A y B de staging.
--
--   company_account       Las cuentas en las que apunta la empresa: las HOJAS
--                         del cuadro rellenadas a su longitud (D2) y sus
--                         subcuentas. Única por (empresa, código).
--   company_account_link  Qué cuenta usa cada cosa: proveedor, cliente, banco,
--                         tipo de gasto, tipo de IVA (soportado y repercutido)
--                         y retención. Va en tabla propia porque varios tipos
--                         de gasto o de retención comparten cuenta (602, 4751);
--                         la regla «un tercero, una subcuenta, salvo la común»
--                         la guarda un disparador.
--   company_account_log   «Lo que ha hecho Folvy» del plan: activar, crear,
--                         ocultar, enlazar, renumerar. Por empresa.
--
-- Funciones (SECURITY DEFINER, con la guarda de siempre: administrador o
-- encargado de la cuenta de esa empresa, conta_ia_cuenta):
--   company_account_length_locked(empresa)  false hasta el C04 (no hay asientos).
--   company_chart_activate(empresa, común)  Activa el plan (una vez).
--   company_account_add(…)                  Añade una subcuenta: siguiente libre.
--   company_account_set_hidden(…)           Oculta o vuelve a enseñar.
--   company_account_link_set(…)             Cambia a qué cuenta va una cosa.
--   company_chart_set_digits(empresa, d)    Cambia la longitud y renumera
--                                           (solo si no está bloqueada).
--
-- Y company_tax_profile.account_digits pasa de 4–12 a 6–12 (D3). Medido el
-- 04/10: producción tiene UNA fila (Foodint, 8) y staging tres (8). El CHECK
-- toma cierre exclusivo sobre company_tax_profile, que no está en el camino
-- del pedido (solo la leen pantallas de contabilidad).
--
-- Nada de esto está en el camino del pedido: tablas nuevas y funciones que
-- solo llaman las pantallas de contabilidad.
-- ============================================================================

-- ── 0. Longitud de 6 a 12 (D3) ──────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.company_tax_profile where account_digits < 6) then
    raise exception 'Hay empresas con menos de 6 dígitos: hay que hablarlo antes de cambiar la regla.';
  end if;
end $$;
alter table public.company_tax_profile drop constraint if exists company_tax_profile_account_digits_check;
alter table public.company_tax_profile add constraint company_tax_profile_account_digits_check check (account_digits between 6 and 12);

-- ── 1. Tablas ───────────────────────────────────────────────────────────────
create table public.company_account (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  plan             text not null check (plan in ('pymes', 'general')),
  code             text not null check (code ~ '^[0-9]{6,12}$'),
  template_code    text not null check (template_code ~ '^[1-9][0-9]{0,4}$'),
  name             text not null check (length(trim(name)) > 0),
  plain_name       text,
  keywords         text[] not null default '{}',
  kind             text not null check (kind in ('template', 'own')),
  status           text not null default 'activa' check (status in ('activa', 'oculta', 'cerrada')),
  is_common        boolean not null default false,
  source           text not null check (source in ('serie', 'manual', 'ai_accepted')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (company_id, code),
  check (code like template_code || '%'),
  check (kind = 'own' or code = rpad(template_code, length(code), '0')),
  check (not is_common or kind = 'template')
);
comment on table public.company_account is
  'C02. Cuentas en las que apunta la empresa: hojas del cuadro (pgc_account) rellenadas a su longitud y sus subcuentas. D2: solo hojas.';
comment on column public.company_account.template_code is 'La hoja del cuadro de la que cuelga (pgc_account.code, is_leaf).';
comment on column public.company_account.is_common is 'Cuenta común de un tipo de terceros (40000000, 43000000): para los que no tienen la suya.';
create index company_account_cuenta on public.company_account (account_id);

create table public.company_account_link (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  company_account_id  uuid not null references public.company_account(id) on delete restrict,
  entity              text not null check (entity in ('supplier', 'customer', 'bank_account', 'expense_category', 'tax_rate', 'withholding_rate')),
  entity_id           text not null,
  role                text not null default 'principal' check (role in ('principal', 'soportado', 'repercutido')),
  source              text not null check (source in ('serie', 'manual', 'ai_accepted')),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  unique (company_id, entity, entity_id, role)
);
comment on table public.company_account_link is
  'C02. A qué cuenta de la empresa va cada cosa. entity_id es el id (uuid) o, para las filas de serie de las tablas generales, su id también.';
create index company_account_link_cuenta on public.company_account_link (company_account_id);

create table public.company_account_log (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  que            text not null check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada')),
  code           text,
  detalle        text not null,
  antes          jsonb,
  despues        jsonb,
  source         text not null check (source in ('serie', 'manual', 'ai_accepted')),
  done_at        timestamptz not null default now(),
  done_by        uuid,
  done_by_name   text
);
comment on table public.company_account_log is 'C02. «Lo que ha hecho Folvy» del plan contable de una empresa.';
create index company_account_log_empresa on public.company_account_log (company_id, done_at desc);

-- La cuenta y la empresa van juntas (regla 9): la empresa es de esa cuenta.
create function public.company_account_misma_cuenta() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'company_account_link' then
    if not exists (select 1 from public.company_account a where a.id = new.company_account_id and a.company_id = new.company_id) then
      raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
    end if;
    -- Un tercero, una subcuenta; salvo la común (encargo §3).
    if new.entity in ('supplier', 'customer', 'bank_account')
       and not (select is_common from public.company_account where id = new.company_account_id)
       and exists (select 1 from public.company_account_link l
                    where l.company_account_id = new.company_account_id and l.id <> new.id
                      and l.entity in ('supplier', 'customer', 'bank_account')
                      and (l.entity, l.entity_id) is distinct from (new.entity, new.entity_id)) then
      raise exception 'Esa subcuenta ya es de otro tercero, y no es la cuenta común.' using errcode = '23505';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger company_account_misma_cuenta before insert or update on public.company_account
  for each row execute function public.company_account_misma_cuenta();
create trigger company_account_link_misma_cuenta before insert or update on public.company_account_link
  for each row execute function public.company_account_misma_cuenta();

-- Una cuenta con enlace activo no se oculta ni se cierra (encargo §3).
create function public.company_account_no_ocultar_enlazada() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status <> 'activa' and old.status = 'activa'
     and exists (select 1 from public.company_account_link l where l.company_account_id = new.id) then
    raise exception 'Tiene un enlace activo: cambia antes ese enlace a otra cuenta.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger company_account_no_ocultar_enlazada before update of status on public.company_account
  for each row execute function public.company_account_no_ocultar_enlazada();

-- ── 2. Seguridad: se lee con la cuenta; se escribe solo por las funciones ───
do $$
declare t text;
begin
  foreach t in array array['company_account', 'company_account_link', 'company_account_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (belongs_to_account(account_id))', t || '_select', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── 3. Funciones ────────────────────────────────────────────────────────────

-- Longitud fija desde el primer asiento. Hasta el C04 no hay asientos.
create function public.company_account_length_locked(p_company uuid)
returns boolean language sql stable set search_path = public as $$
  select false
$$;
comment on function public.company_account_length_locked(uuid) is
  'C02. ¿Está fija la longitud de las cuentas? Desde el primer asiento sí. El C04 la reescribe cuando existan asientos; hoy siempre false.';

-- Siguiente número libre bajo un prefijo (el 0 es la cuenta común).
create function public.company_account_siguiente(p_company uuid, p_prefijo text, p_digitos int)
returns text language plpgsql stable set search_path = public as $$
declare n int; v text; sitio int := p_digitos - length(p_prefijo);
begin
  if sitio < 1 then return null; end if;
  for n in 1 .. (10 ^ sitio)::int - 1 loop
    v := p_prefijo || lpad(n::text, sitio, '0');
    if not exists (select 1 from public.company_account where company_id = p_company and code = v) then return v; end if;
  end loop;
  return null;
end $$;
revoke all on function public.company_account_siguiente(uuid, text, int) from public, anon, authenticated;

create function public.company_chart_activate(p_company uuid, p_comun_proveedores boolean default false, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_plan text; v_d int; v_territorio text; v_sistema text;
  v_quien uuid := auth.uid();
  r record; v_code text; v_id uuid; v_suf int;
  n_cuentas int := 0; n_sub int := 0; n_enl int := 0; avisos text[] := '{}';
begin
  if exists (select 1 from public.company_account where company_id = p_company) then
    raise exception 'El plan contable de esta empresa ya está activado.' using errcode = '23505';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits, p.tax_territory
    into v_plan, v_d, v_territorio
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene completado «Tus impuestos y detalle contable».' using errcode = '22023'; end if;
  v_sistema := case v_territorio when 'canarias' then 'igic' else 'iva' end;

  -- Las hojas, rellenadas (D2). 4000 y 4300 son las cuentas comunes.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, is_common, source, created_by, created_by_name)
  select v_cuenta, p_company, v_plan, rpad(a.code, v_d, '0'), a.code, a.name, a.plain_name, 'template', a.code in ('4000', '4300'), 'serie', v_quien, p_quien_nombre
    from public.pgc_account a where a.plan = v_plan and a.is_leaf and a.valid_to is null;
  get diagnostics n_cuentas = row_count;

  -- IVA (o IGIC): una subcuenta por tipo vigente, en 472 y 477; el 0 % a la hoja.
  for r in
    select case when t.rate = trunc(t.rate) then t.rate::int else round(t.rate * 10)::int end suf, array_agg(t.id::text order by t.code) ids
      from public.tax_rate t
     where t.tax_system = v_sistema and t.treatment = 'taxed' and (t.valid_to is null or t.valid_to >= current_date)
       and (t.is_system or (t.account_id = v_cuenta and (t.company_id is null or t.company_id = p_company)))
     group by 1 order by 1 desc
  loop
    for v_code, v_suf in select * from (values ('472', 1), ('477', 2)) x(h, o) loop
      if r.suf = 0 then
        select id into v_id from public.company_account where company_id = p_company and code = rpad(v_code, v_d, '0');
      else
        insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
        values (v_cuenta, p_company, v_plan, v_code || lpad(r.suf::text, v_d - 3, '0'), v_code,
                case v_code when '472' then 'IVA soportado ' else 'IVA repercutido ' end || r.suf || ' %', 'own', 'serie', v_quien, p_quien_nombre)
        returning id into v_id;
        n_sub := n_sub + 1;
      end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
      select v_cuenta, p_company, v_id, 'tax_rate', i, case v_suf when 1 then 'soportado' else 'repercutido' end, 'serie', v_quien from unnest(r.ids) i;
      n_enl := n_enl + cardinality(r.ids);
    end loop;
  end loop;

  -- Retenciones y tipos de gasto: a su hoja.
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, p_company, a.id, 'withholding_rate', w.id::text, 'principal', 'serie', v_quien
    from public.withholding_rate w
    join public.company_account a on a.company_id = p_company and a.kind = 'template' and a.template_code = coalesce(w.pgc_hint, '4751')
   where (w.valid_to is null or w.valid_to >= current_date)
     and (w.is_system or (w.account_id = v_cuenta and (w.company_id is null or w.company_id = p_company)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, p_company, a.id, 'expense_category', g.id::text, 'principal', 'serie', v_quien
    from public.expense_category g
    join public.company_account a on a.company_id = p_company and a.kind = 'template' and a.template_code = g.pgc_account_hint
   where g.is_active and (g.is_system or (g.account_id = v_cuenta and (g.company_id is null or g.company_id = p_company)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;
  select coalesce(array_agg('El tipo de gasto «' || g.name || '» no apunta a una hoja del plan (' || coalesce(g.pgc_account_hint, 'ninguna') || ').'), '{}') || avisos
    into avisos
    from public.expense_category g
   where g.is_active and (g.is_system or (g.account_id = v_cuenta and (g.company_id is null or g.company_id = p_company)))
     and not exists (select 1 from public.company_account a where a.company_id = p_company and a.kind = 'template' and a.template_code = g.pgc_account_hint);

  -- Bancos: una subcuenta cada uno (57200001…), por orden de nombre.
  for r in select t.id, t.name from public.treasury_account t where t.company_id = p_company and t.kind = 'bank' and t.is_active order by t.name, t.id loop
    v_code := public.company_account_siguiente(p_company, '572', v_d);
    if v_code is null then avisos := avisos || ('Numeración agotada en 572: ' || r.name || ' se queda sin subcuenta.'); continue; end if;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
    values (v_cuenta, p_company, v_plan, v_code, '572', 'Bancos · ' || r.name, 'own', 'serie', v_quien, p_quien_nombre) returning id into v_id;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, p_company, v_id, 'bank_account', r.id::text, 'principal', 'serie', v_quien);
    n_sub := n_sub + 1; n_enl := n_enl + 1;
  end loop;

  -- Proveedores: una subcuenta cada uno (40000001…), o la común si se elige.
  for r in select s.id, s.name from public.supplier s where s.account_id = v_cuenta and s.archived_at is null order by s.name, s.id loop
    if p_comun_proveedores then
      select id into v_id from public.company_account where company_id = p_company and code = rpad('4000', v_d, '0');
    else
      v_code := public.company_account_siguiente(p_company, '4000', v_d);
      if v_code is null then avisos := avisos || ('Numeración agotada en 4000: ' || r.name || ' se queda sin subcuenta.'); continue; end if;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
      values (v_cuenta, p_company, v_plan, v_code, '4000', 'Proveedores · ' || r.name, 'own', 'serie', v_quien, p_quien_nombre) returning id into v_id;
      n_sub := n_sub + 1;
    end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, p_company, v_id, 'supplier', r.id::text, 'principal', 'serie', v_quien);
    n_enl := n_enl + 1;
  end loop;

  insert into public.company_account_log (account_id, company_id, que, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'activado',
          format('Plan de %s activado con cuentas de %s dígitos: %s cuentas de serie, %s subcuentas y %s enlaces.',
                 case v_plan when 'pymes' then 'pymes' else 'general' end, v_d, n_cuentas, n_sub, n_enl),
          jsonb_build_object('plan', v_plan, 'digitos', v_d, 'cuentas', n_cuentas, 'subcuentas', n_sub, 'enlaces', n_enl,
                             'comun_proveedores', p_comun_proveedores, 'avisos', to_jsonb(avisos)),
          'serie', v_quien, p_quien_nombre);
  return jsonb_build_object('plan', v_plan, 'digitos', v_d, 'cuentas', n_cuentas, 'subcuentas', n_sub, 'enlaces', n_enl, 'avisos', to_jsonb(avisos));
end $$;
comment on function public.company_chart_activate(uuid, boolean, text) is
  'C02. Activa el plan contable en una empresa: hojas del cuadro rellenadas, 472/477 por tipo de IVA, enlaces de gastos y retenciones, una subcuenta por banco y por proveedor (o la común). Misma regla que planEmpresa.ts (activar).';

create function public.company_account_add(
  p_company uuid, p_hoja text, p_nombre text, p_plain_name text default null,
  p_entity text default null, p_entity_id text default null, p_quien_nombre text default null, p_source text default 'manual'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_plan text; v_d int; v_code text; v_id uuid;
begin
  if p_source not in ('manual', 'ai_accepted') then raise exception 'Origen no válido.' using errcode = '22023'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre.' using errcode = '22023'; end if;
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_plan is null then raise exception 'El plan contable de esta empresa no está activado.' using errcode = '22023'; end if;
  if not exists (select 1 from public.pgc_account p where p.plan = v_plan and p.code = p_hoja and p.is_leaf and p.valid_to is null) then
    raise exception 'La % no es una cuenta del plan en la que se pueda apuntar.', p_hoja using errcode = '22023';
  end if;
  v_code := public.company_account_siguiente(p_company, p_hoja, v_d);
  if v_code is null then
    raise exception 'Ya no quedan subcuentas libres en % con % dígitos.', p_hoja, v_d using errcode = '22023';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by, created_by_name)
  values (v_cuenta, p_company, v_plan, v_code, p_hoja, trim(p_nombre), nullif(trim(p_plain_name), ''), 'own', p_source, auth.uid(), p_quien_nombre)
  returning id into v_id;
  if p_entity is not null then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, p_company, v_id, p_entity, p_entity_id, 'principal', p_source, auth.uid())
    on conflict (company_id, entity, entity_id, role) do update set company_account_id = excluded.company_account_id, source = excluded.source;
  end if;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'subcuenta_creada', v_code, format('Subcuenta %s · %s, bajo la %s.', v_code, trim(p_nombre), p_hoja),
          jsonb_build_object('code', v_code, 'name', trim(p_nombre), 'entity', p_entity, 'entity_id', p_entity_id), p_source, auth.uid(), p_quien_nombre);
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function public.company_account_set_hidden(p_id uuid, p_oculta boolean, p_quien_nombre text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_a public.company_account; v_cuenta uuid;
begin
  select * into v_a from public.company_account where id = p_id;
  if not found then raise exception 'Esa cuenta no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(v_a.company_id);
  if v_a.status = 'cerrada' then raise exception 'Una cuenta cerrada no se oculta ni se enseña: está en los libros.' using errcode = '22023'; end if;
  update public.company_account set status = case when p_oculta then 'oculta' else 'activa' end, updated_at = now() where id = p_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, source, done_by, done_by_name)
  values (v_cuenta, v_a.company_id, case when p_oculta then 'oculta' else 'visible' end, v_a.code,
          format('%s %s · %s.', case when p_oculta then 'Ocultada' else 'Vuelve a verse' end, v_a.code, v_a.name), 'manual', auth.uid(), p_quien_nombre);
end $$;

create function public.company_account_link_set(
  p_company uuid, p_entity text, p_entity_id text, p_role text, p_account_id uuid, p_quien_nombre text default null, p_source text default 'manual'
) returns void language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.conta_ia_cuenta(p_company); v_antes text; v_despues text;
begin
  select a.code into v_antes from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = p_company and l.entity = p_entity and l.entity_id = p_entity_id and l.role = p_role;
  select code into v_despues from public.company_account where id = p_account_id and company_id = p_company;
  if v_despues is null then raise exception 'Esa cuenta no es de esta empresa.' using errcode = '22023'; end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  values (v_cuenta, p_company, p_account_id, p_entity, p_entity_id, p_role, p_source, auth.uid())
  on conflict (company_id, entity, entity_id, role) do update set company_account_id = excluded.company_account_id, source = excluded.source;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'enlace_cambiado', v_despues,
          format('%s pasa de %s a %s.', p_entity, coalesce(v_antes, 'ninguna'), v_despues),
          jsonb_build_object('code', v_antes), jsonb_build_object('code', v_despues, 'entity', p_entity, 'entity_id', p_entity_id, 'role', p_role),
          p_source, auth.uid(), p_quien_nombre);
end $$;

-- Cambiar la longitud y renumerar: lo de detrás del prefijo es el número de la
-- subcuenta y se conserva (40000012 → 4000000012). Misma regla que renumerar().
create function public.company_chart_set_digits(p_company uuid, p_digitos int, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_de int; n int;
begin
  if p_digitos not between 6 and 12 then raise exception 'La longitud tiene que ir de 6 a 12 dígitos.' using errcode = '22023'; end if;
  if public.company_account_length_locked(p_company) then
    raise exception 'Ya hay asientos: la longitud de las cuentas no se puede cambiar.' using errcode = '22023';
  end if;
  select account_digits into v_de from public.company_tax_profile where company_id = p_company for update;
  if v_de = p_digitos then return jsonb_build_object('renumeradas', 0); end if;
  if exists (select 1 from public.company_account a where a.company_id = p_company
              and length(ltrim(substr(a.code, length(a.template_code) + 1), '0')) > p_digitos - length(a.template_code)) then
    raise exception 'Alguna subcuenta no cabe en % dígitos.', p_digitos using errcode = '22023';
  end if;
  -- Un solo paso: los códigos viejos y los nuevos tienen distinta longitud,
  -- así que no pueden chocar a mitad de camino.
  update public.company_account a
     set code = a.template_code || lpad(coalesce(nullif(ltrim(substr(a.code, length(a.template_code) + 1), '0'), ''), '0'), p_digitos - length(a.template_code), '0'),
         updated_at = now()
   where company_id = p_company;
  get diagnostics n = row_count;
  update public.company_tax_profile set account_digits = p_digitos, updated_at = now(), updated_by = auth.uid() where company_id = p_company;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'longitud_cambiada', format('Las cuentas pasan de %s a %s dígitos: %s renumeradas.', v_de, p_digitos, n),
          jsonb_build_object('digitos', v_de), jsonb_build_object('digitos', p_digitos, 'renumeradas', n), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('renumeradas', n);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'company_chart_activate(uuid, boolean, text)',
    'company_account_add(uuid, text, text, text, text, text, text, text)',
    'company_account_set_hidden(uuid, boolean, text)',
    'company_account_link_set(uuid, text, text, text, uuid, text, text)',
    'company_chart_set_digits(uuid, int, text)',
    'company_account_length_locked(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
