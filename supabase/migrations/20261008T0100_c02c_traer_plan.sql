-- ============================================================================
-- C02c · Traer el plan de cuentas de otro programa — 1 · ESTRUCTURA Y FUNCIONES
-- ----------------------------------------------------------------------------
-- Encargo C02c §4 y respuesta 1 de Julio. Activar el plan empieza por «¿Vienes
-- de otro programa?»; si sí, se traen sus cuentas con su código exacto,
-- enlazadas a lo que ya hay en Folvy, con revisión humana de lo dudoso.
--
--   · company_chart_import: una importación por empresa (la revisión que se
--     guarda para seguir luego, lo que se trajo y si se deshizo). La huella
--     (sha-256) es la del fichero leído: el mismo fichero no se trae dos veces.
--   · company_account.name_source: el nombre TAL CUAL venía del otro programa
--     (para «Comparar con Diez», §4.10); import_id: qué importación la trajo.
--   · supplier.import_id: la ficha de proveedor CREADA al traer el plan
--     («Traída de Diez · por completar», respuesta 1.1). Columna nueva y nula:
--     no cambia nada de lo que Cocina ya lee o escribe.
--   · source 'migrated' en company_account, company_account_link y
--     company_account_log; dos «qué» nuevos en el registro: importado e
--     importacion_deshecha.
--
-- Funciones (SECURITY DEFINER, con la guarda conta_ia_cuenta: administrador o
-- encargado de la cuenta):
--   company_chart_import_save(empresa, programa, ficheros, huella, revisión, quién)
--       guarda la revisión a medias («Guardar y seguir luego»). Solo con el plan
--       sin activar. Una sola importación abierta por empresa.
--   company_chart_import_discard(importación)
--       tira una revisión a medias (no se había traído nada).
--   company_chart_import_apply(importación, plan, quién)
--       TRAE EL PLAN: importar y activar en UN SOLO PASO y en una transacción
--       (respuesta 1.3). Lo comprueba todo otra vez: el núcleo del navegador
--       propone; aquí se valida.
--   company_chart_import_undo(importación, quién)
--       deshace entero: el plan vuelve a «sin activar» y se borran las fichas
--       que creó esa importación. Se bloquea, con el porqué, si una de esas
--       fichas ya se ha usado (un albarán, una factura…) o si hay asientos.
--
-- Fuera del camino del pedido: tablas y funciones de contabilidad. Lo único
-- que toca una tabla de Cocina es añadir una columna nula a supplier.
-- ============================================================================

-- ── 1. Origen «traído de otro programa» y el registro ───────────────────────
alter table public.company_account drop constraint company_account_source_check;
alter table public.company_account add constraint company_account_source_check check (source in ('serie', 'manual', 'ai_accepted', 'migrated'));
alter table public.company_account_link drop constraint company_account_link_source_check;
alter table public.company_account_link add constraint company_account_link_source_check check (source in ('serie', 'manual', 'ai_accepted', 'migrated'));
alter table public.company_account_log drop constraint company_account_log_source_check;
alter table public.company_account_log add constraint company_account_log_source_check check (source in ('serie', 'manual', 'ai_accepted', 'migrated'));
alter table public.company_account_log drop constraint company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check check (que in (
  'activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada', 'borrada_duplicada', 'fusionada',
  'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado', 'enlace_quitado', 'renombrada', 'importado', 'importacion_deshecha'));

-- ── 2. La importación ───────────────────────────────────────────────────────
create table public.company_chart_import (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  program text not null check (program in ('diez', 'sage50', 'contasol', 'holded', 'otro')),
  file_names text[] not null default '{}',
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  digits int not null check (digits between 6 and 12),
  plan text not null check (plan in ('pymes', 'general')),
  status text not null default 'revision' check (status in ('revision', 'traida', 'deshecha')),
  -- La revisión: las filas leídas y lo decidido en cada una (para seguir luego).
  review jsonb not null default '{}'::jsonb,
  -- Lo que se trajo: recuentos y las fichas creadas (para deshacer).
  result jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid,
  applied_by_name text,
  undone_at timestamptz,
  undone_by uuid,
  undone_by_name text
);
comment on table public.company_chart_import is
  'C02c. Traer el plan de cuentas de otro programa (Diez, Sage 50, Contasol, Holded, Excel): una por empresa abierta a la vez, con su revisión, lo traído y si se deshizo.';
-- Una abierta (en revisión o traída) por empresa: el mismo plan no se trae dos veces.
create unique index company_chart_import_una_abierta on public.company_chart_import (company_id) where status in ('revision', 'traida');

create or replace function public.company_chart_import_misma_cuenta()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esta cuenta.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger company_chart_import_misma_cuenta before insert or update on public.company_chart_import
  for each row execute function public.company_chart_import_misma_cuenta();

alter table public.company_chart_import enable row level security;
create policy company_chart_import_select on public.company_chart_import for select to authenticated using (belongs_to_account(account_id));
revoke all on table public.company_chart_import from anon, authenticated;
grant select on table public.company_chart_import to authenticated;

alter table public.company_account add column name_source text;
alter table public.company_account add column import_id uuid references public.company_chart_import(id) on delete set null;
comment on column public.company_account.name_source is 'C02c. El nombre tal cual venía del otro programa (Diez…). El que se enseña es name.';
comment on column public.company_account.import_id is 'C02c. La importación que trajo esta cuenta (null si no viene de otro programa).';
create index company_account_import_id on public.company_account (import_id) where import_id is not null;

alter table public.supplier add column import_id uuid references public.company_chart_import(id) on delete set null;
comment on column public.supplier.import_id is 'C02c. Ficha creada al traer el plan de otro programa («Traída de … · por completar»). Null en las demás.';

-- ── 3. Guardar la revisión a medias ─────────────────────────────────────────
create function public.company_chart_import_save(
  p_company uuid, p_program text, p_file_names text[], p_sha text, p_review jsonb, p_quien_nombre text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_plan text; v_d int; v_id uuid; v_status text;
begin
  if exists (select 1 from public.company_account where company_id = p_company) then
    raise exception 'El plan contable de esta empresa ya está activado: no se puede traer otro encima.' using errcode = '23505';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits into v_plan, v_d
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene completado «Tus impuestos y detalle contable».' using errcode = '22023'; end if;
  if jsonb_typeof(p_review) <> 'object' then raise exception 'La revisión no es válida.' using errcode = '22023'; end if;

  select id, status into v_id, v_status from public.company_chart_import where company_id = p_company and status in ('revision', 'traida');
  if v_status = 'traida' then raise exception 'Ya hay un plan traído en esta empresa.' using errcode = '23505'; end if;
  if v_id is null then
    insert into public.company_chart_import (account_id, company_id, program, file_names, file_sha256, digits, plan, review, created_by_name)
    values (v_cuenta, p_company, p_program, coalesce(p_file_names, '{}'), lower(p_sha), v_d, v_plan, p_review, coalesce(p_quien_nombre, public.conta_nombre_actor()))
    returning id into v_id;
  else
    update public.company_chart_import
       set program = p_program, file_names = coalesce(p_file_names, '{}'), file_sha256 = lower(p_sha), digits = v_d, plan = v_plan, review = p_review
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.company_chart_import_save(uuid, text, text[], text, jsonb, text) from public, anon;
grant execute on function public.company_chart_import_save(uuid, text, text[], text, jsonb, text) to authenticated;

create function public.company_chart_import_discard(p_import uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_status text;
begin
  select company_id, status into v_company, v_status from public.company_chart_import where id = p_import;
  if v_company is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  perform public.conta_ia_cuenta(v_company);
  if v_status <> 'revision' then raise exception 'Solo se tira una revisión a medias; lo traído se deshace.' using errcode = '23514'; end if;
  delete from public.company_chart_import where id = p_import;
end $$;
revoke all on function public.company_chart_import_discard(uuid) from public, anon;
grant execute on function public.company_chart_import_discard(uuid) to authenticated;

-- ── 4. Traer el plan: importar y activar en un solo paso ────────────────────
-- p_plan (lo arma planTraer() en propuestaImportacion.ts):
--   cuentas       [{code, hoja, nombre, nombre_origen, nota}]       las propias del fichero
--   crear         [{code, nombre, nif, direccion, cp, poblacion, provincia}]   fichas nuevas
--   enlaces       [{code, entity, entity_id, crea_code, role}]       supplier | bank_account
--   retenciones   [{code, modelo}]                                    4751 propias → 111 | 115
--   nombres_serie [{code, nombre_origen}]                             las de serie que traía el fichero
create function public.company_chart_import_apply(p_import uuid, p_plan jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_quien uuid := auth.uid(); v_nombre text;
  v_plan text; v_d int; v_territorio text; v_sistema text; v_programa text;
  r record; x jsonb; v_code text; v_id uuid; v_suf int;
  n_serie int := 0; n_propias int := 0; n_fichas int := 0; n_enl int := 0; n_sub int := 0;
  avisos text[] := '{}'; fichas jsonb := '{}'::jsonb; creadas uuid[] := '{}';
begin
  select * into imp from public.company_chart_import where id = p_import for update;
  if imp.id is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(imp.company_id);
  v_nombre := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if imp.status <> 'revision' then raise exception 'Esta importación ya está %.', case imp.status when 'traida' then 'traída' else 'deshecha' end using errcode = '23514'; end if;
  if exists (select 1 from public.company_account where company_id = imp.company_id) then
    raise exception 'El plan contable de esta empresa ya está activado.' using errcode = '23505';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits, p.tax_territory into v_plan, v_d, v_territorio
    from public.company_tax_profile p where p.company_id = imp.company_id;
  if v_plan is distinct from imp.plan or v_d is distinct from imp.digits then
    raise exception 'La empresa usa ahora el plan % con % dígitos y el fichero se leyó para % con %: vuelve a leerlo.', v_plan, v_d, imp.plan, imp.digits using errcode = '22023';
  end if;
  v_sistema := case v_territorio when 'canarias' then 'igic' else 'iva' end;
  v_programa := case imp.program when 'diez' then 'Cegid Diez' when 'sage50' then 'Sage 50' when 'contasol' then 'Contasol' when 'holded' then 'Holded' else 'otro programa' end;
  if jsonb_typeof(p_plan -> 'cuentas') <> 'array' then raise exception 'Falta la lista de cuentas.' using errcode = '22023'; end if;

  -- 4a · Validar las cuentas propias: su longitud, su hoja (del plan de la empresa) y que no sean de serie.
  for x in select * from jsonb_array_elements(p_plan -> 'cuentas') loop
    v_code := x ->> 'code';
    if v_code !~ ('^[0-9]{' || v_d || '}$') then raise exception '«%» no tiene % dígitos.', v_code, v_d using errcode = '22023'; end if;
    if not exists (select 1 from public.pgc_account a where a.plan = v_plan and a.code = x ->> 'hoja' and a.is_leaf and a.valid_to is null) then
      raise exception '% dice colgar de %, que no es una cuenta sin hijas del plan de %.', v_code, x ->> 'hoja', v_plan using errcode = '22023';
    end if;
    if v_code not like (x ->> 'hoja') || '%' or v_code = rpad(x ->> 'hoja', v_d, '0') then
      raise exception '% no es una subcuenta propia de %.', v_code, x ->> 'hoja' using errcode = '22023';
    end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception '% no tiene nombre.', v_code using errcode = '22023'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_plan -> 'cuentas')) <> (select count(distinct e ->> 'code') from jsonb_array_elements(p_plan -> 'cuentas') e) then
    raise exception 'Hay un código repetido en las cuentas.' using errcode = '22023';
  end if;

  -- 4b · Las hojas de serie, rellenadas, como en la activación normal (D2). El
  --      nombre del fichero, si lo traía, va a name_source; el que se enseña es el oficial (§4.3).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, is_common, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, rpad(a.code, v_d, '0'), a.code, a.name, a.plain_name, 'template', a.code in ('4000', '4100', '4300'), 'serie', v_quien, v_nombre,
         (select s ->> 'nombre_origen' from jsonb_array_elements(coalesce(p_plan -> 'nombres_serie', '[]'::jsonb)) s where s ->> 'code' = rpad(a.code, v_d, '0') limit 1),
         null
    from public.pgc_account a where a.plan = v_plan and a.is_leaf and a.valid_to is null;
  get diagnostics n_serie = row_count;

  -- 4c · Las propias del fichero, con su código exacto (§4.2).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, x ->> 'code', x ->> 'hoja', trim(x ->> 'nombre'), 'own', 'migrated', v_quien, v_nombre, nullif(trim(x ->> 'nombre_origen'), ''), imp.id
    from jsonb_array_elements(p_plan -> 'cuentas') x;
  get diagnostics n_propias = row_count;

  -- 4d · Las fichas de proveedor nuevas («Traída de … · por completar»): solo para cuentas propias de 40x/41x del fichero.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'crear', '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(p_plan -> 'cuentas') c where c ->> 'code' = x ->> 'code' and (c ->> 'hoja' like '40%' or c ->> 'hoja' like '41%')) then
      raise exception 'La ficha nueva de % no corresponde a una cuenta de proveedor o acreedor del fichero.', x ->> 'code' using errcode = '22023';
    end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception 'La ficha nueva de % no tiene nombre.', x ->> 'code' using errcode = '22023'; end if;
    insert into public.supplier (account_id, name, legal_name, tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, created_by, created_by_name, import_id)
    values (v_cuenta, trim(x ->> 'nombre'), trim(x ->> 'nombre'), nullif(trim(x ->> 'nif'), ''), nullif(trim(x ->> 'direccion'), ''), nullif(trim(x ->> 'cp'), ''),
            nullif(trim(x ->> 'poblacion'), ''), nullif(trim(x ->> 'provincia'), ''), v_quien, v_nombre, imp.id)
    returning id into v_id;
    fichas := fichas || jsonb_build_object(x ->> 'code', v_id);
    creadas := creadas || v_id;
    n_fichas := n_fichas + 1;
  end loop;

  -- 4e · Los enlaces a proveedores y bancos (los comprueba además el disparador de la 0160:
  --      misma cuenta, un tercero por subcuenta, pago solo a 57x/43x).
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'enlaces', '[]'::jsonb)) loop
    select id into v_id from public.company_account where company_id = imp.company_id and code = x ->> 'code' and import_id = imp.id;
    if v_id is null then raise exception 'El enlace apunta a %, que no es una cuenta traída del fichero.', x ->> 'code' using errcode = '22023'; end if;
    if x ->> 'role' not in ('principal', 'pago') then raise exception 'Papel no válido en %.', x ->> 'code' using errcode = '22023'; end if;
    if x ->> 'entity' = 'supplier' then
      if x ->> 'crea_code' is not null then
        if not fichas ? (x ->> 'crea_code') then raise exception '% se enlaza con la ficha que iba a crear %, y no se crea.', x ->> 'code', x ->> 'crea_code' using errcode = '22023'; end if;
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
        values (v_cuenta, imp.company_id, v_id, 'supplier', fichas ->> (x ->> 'crea_code'), x ->> 'role', 'migrated', v_quien);
      else
        if not exists (select 1 from public.supplier s where s.id::text = x ->> 'entity_id' and s.account_id = v_cuenta) then
          raise exception 'El proveedor de % no es de esta cuenta.', x ->> 'code' using errcode = '22023';
        end if;
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
        values (v_cuenta, imp.company_id, v_id, 'supplier', x ->> 'entity_id', x ->> 'role', 'migrated', v_quien);
      end if;
    elsif x ->> 'entity' = 'bank_account' then
      if x ->> 'role' <> 'principal' or not exists (select 1 from public.treasury_account t where t.id::text = x ->> 'entity_id' and t.company_id = imp.company_id and t.kind = 'bank') then
        raise exception 'El banco de % no es de esta empresa.', x ->> 'code' using errcode = '22023';
      end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
      values (v_cuenta, imp.company_id, v_id, 'bank_account', x ->> 'entity_id', 'principal', 'migrated', v_quien);
    else
      raise exception 'Entidad no válida en %.', x ->> 'code' using errcode = '22023';
    end if;
    n_enl := n_enl + 1;
  end loop;

  -- 4f · IVA por tipo (§4.7, decisión de Julio): como en la activación normal. Si el código ya
  --      lo trae el fichero (otro programa con subcuentas de IVA por tipo), se respeta y se enlaza a él.
  for r in
    select case when t.rate = trunc(t.rate) then t.rate::int else round(t.rate * 10)::int end suf, array_agg(t.id::text order by t.code) ids,
           replace(rtrim(to_char(min(t.rate), 'FM990.99'), '.'), '.', ',') tipo
      from public.tax_rate t
     where t.tax_system = v_sistema and t.treatment = 'taxed' and (t.valid_to is null or t.valid_to >= current_date)
       and (t.is_system or (t.account_id = v_cuenta and (t.company_id is null or t.company_id = imp.company_id)))
     group by 1 order by 1 desc
  loop
    for v_code, v_suf in select * from (values ('472', 1), ('477', 2)) x(h, o) loop
      if r.suf = 0 then
        select id into v_id from public.company_account where company_id = imp.company_id and code = rpad(v_code, v_d, '0');
      else
        select id into v_id from public.company_account where company_id = imp.company_id and code = v_code || lpad(r.suf::text, v_d - 3, '0');
        if v_id is null then
          insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
          values (v_cuenta, imp.company_id, v_plan, v_code || lpad(r.suf::text, v_d - 3, '0'), v_code,
                  case v_code when '472' then 'IVA soportado ' else 'IVA repercutido ' end || r.tipo || ' %', 'own', 'serie', v_quien, v_nombre)
          returning id into v_id;
          n_sub := n_sub + 1;
        else
          avisos := avisos || (v_code || lpad(r.suf::text, v_d - 3, '0') || ' venía en el fichero: el IVA del ' || r.tipo || ' % se enlaza a ella.');
        end if;
      end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
      select v_cuenta, imp.company_id, v_id, 'tax_rate', i, case v_suf when 1 then 'soportado' else 'repercutido' end, 'serie', v_quien from unnest(r.ids) i;
      n_enl := n_enl + cardinality(r.ids);
    end loop;
  end loop;

  -- 4g · Retenciones: las del modelo elegido a la 4751 del fichero; las demás, a su hoja.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) loop
    if x ->> 'modelo' not in ('111', '115') then raise exception 'Modelo no válido en %.', x ->> 'code' using errcode = '22023'; end if;
    if (select count(*) from jsonb_array_elements(p_plan -> 'retenciones') y where y ->> 'modelo' = x ->> 'modelo') > 1 then
      raise exception 'Dos cuentas van al modelo %: elige una.', x ->> 'modelo' using errcode = '22023';
    end if;
    if not exists (select 1 from public.company_account where company_id = imp.company_id and code = x ->> 'code' and import_id = imp.id and template_code = '4751') then
      raise exception '% no es una cuenta de retenciones (4751) traída del fichero.', x ->> 'code' using errcode = '22023';
    end if;
  end loop;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, imp.company_id,
         coalesce((select a.id from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) y
                     join public.company_account a on a.company_id = imp.company_id and a.code = y ->> 'code'
                    where y ->> 'modelo' = w.filed_in limit 1), h.id),
         'withholding_rate', w.id::text, 'principal', case when exists (select 1 from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) y where y ->> 'modelo' = w.filed_in) then 'migrated' else 'serie' end, v_quien
    from public.withholding_rate w
    join public.company_account h on h.company_id = imp.company_id and h.kind = 'template' and h.template_code = coalesce(w.pgc_hint, '4751')
   where (w.valid_to is null or w.valid_to >= current_date)
     and (w.is_system or (w.account_id = v_cuenta and (w.company_id is null or w.company_id = imp.company_id)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;

  -- 4h · Tipos de gasto: a su hoja, como en la activación normal.
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, imp.company_id, a.id, 'expense_category', g.id::text, 'principal', 'serie', v_quien
    from public.expense_category g
    join public.company_account a on a.company_id = imp.company_id and a.kind = 'template' and a.template_code = g.pgc_account_hint
   where g.is_active and (g.is_system or (g.account_id = v_cuenta and (g.company_id is null or g.company_id = imp.company_id)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;

  -- 4i · Bancos de Folvy que no venían en el fichero: su subcuenta, la siguiente libre (§4.9).
  for r in select t.id, t.name from public.treasury_account t
            where t.company_id = imp.company_id and t.kind = 'bank' and t.is_active
              and not exists (select 1 from public.company_account_link l where l.company_id = imp.company_id and l.entity = 'bank_account' and l.entity_id = t.id::text)
            order by t.name, t.id loop
    v_code := public.company_account_siguiente(imp.company_id, '572', v_d);
    if v_code is null then avisos := avisos || ('Numeración agotada en 572: ' || r.name || ' se queda sin subcuenta.'); continue; end if;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
    values (v_cuenta, imp.company_id, v_plan, v_code, '572', 'Bancos · ' || r.name, 'own', 'serie', v_quien, v_nombre) returning id into v_id;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, imp.company_id, v_id, 'bank_account', r.id::text, 'principal', 'serie', v_quien);
    n_sub := n_sub + 1; n_enl := n_enl + 1;
  end loop;
  -- Los proveedores de Folvy que no venían en el fichero NO se numeran aquí: reciben la
  -- propuesta de la IA como hoy (0180), con el siguiente número libre dentro de lo traído.

  update public.company_chart_import
     set status = 'traida', applied_at = now(), applied_by = v_quien, applied_by_name = v_nombre,
         result = jsonb_build_object('serie', n_serie, 'cuentas', n_propias, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub,
                                     'fichas_creadas', to_jsonb(creadas), 'avisos', to_jsonb(avisos))
   where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importado',
          format('Plan traído de %s · %s cuentas · %s enlaces%s', v_programa, n_propias,
                 (select count(distinct l.company_account_id) from public.company_account_link l join public.company_account a on a.id = l.company_account_id
                   where a.import_id = imp.id and l.source = 'migrated'),
                 case when n_fichas > 0 then format(' · %s fichas nuevas', n_fichas) else '' end),
          jsonb_build_object('importacion', imp.id, 'programa', imp.program, 'plan', v_plan, 'digitos', v_d, 'serie', n_serie, 'cuentas', n_propias,
                             'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos)),
          'migrated', v_quien, v_nombre);
  return jsonb_build_object('importacion', imp.id, 'serie', n_serie, 'cuentas', n_propias, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos));
end $$;
revoke all on function public.company_chart_import_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.company_chart_import_apply(uuid, jsonb, text) to authenticated;

-- ── 5. Deshacer entero ──────────────────────────────────────────────────────
-- Tablas que son PARTE de una ficha de proveedor (se van con ella, on delete
-- cascade): no cuentan como «usada». Cualquier otra que apunte a supplier sí.
create function public.company_chart_import_undo(p_import uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_nombre text; fk record; n bigint; usadas text[] := '{}'; v_fichas uuid[]; n_cuentas int; n_borradas int;
begin
  select * into imp from public.company_chart_import where id = p_import for update;
  if imp.id is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(imp.company_id);
  v_nombre := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if imp.status <> 'traida' then raise exception 'Solo se deshace un plan traído.' using errcode = '23514'; end if;
  -- Con asientos no se deshace (respuesta 1.3). Hasta el C04 no hay asientos: la guarda es la de la longitud.
  if public.company_account_length_locked(imp.company_id) then
    raise exception 'Ya hay asientos en este plan: deshacer la importación borraría su historia. No se puede.' using errcode = '23514';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_fichas from public.supplier s where s.import_id = imp.id;
  if cardinality(v_fichas) > 0 then
    for fk in
      select c.conrelid::regclass::text tabla, a.attname columna
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.supplier'::regclass and cardinality(c.conkey) = 1
         and c.conrelid::regclass::text not in ('supplier_contact', 'supplier_alias', 'supplier_learning', 'supplier_learning_log', 'supplier_proposal')
    loop
      execute format('select count(*) from %s where %I = any($1)', fk.tabla, fk.columna) into n using v_fichas;
      if n > 0 then usadas := usadas || format('%s en %s', n, fk.tabla); end if;
    end loop;
    if cardinality(usadas) > 0 then
      raise exception 'Alguna ficha creada al traer el plan ya se ha usado (%): deshacer la borraría. Quita antes ese uso o deja el plan como está.', array_to_string(usadas, ', ') using errcode = '23514';
    end if;
  end if;

  select count(*) into n_cuentas from public.company_account where import_id = imp.id;
  delete from public.company_account_link where company_id = imp.company_id;
  delete from public.company_account where company_id = imp.company_id;
  get diagnostics n_borradas = row_count;
  -- Las propuestas de la IA contestadas sobre este plan vuelven a poder salir.
  delete from public.ai_suggestion where company_id = imp.company_id and kind = 'plan';
  delete from public.supplier where id = any(v_fichas);
  update public.company_chart_import set status = 'deshecha', undone_at = now(), undone_by = auth.uid(), undone_by_name = v_nombre where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importacion_deshecha',
          format('Deshecho el plan traído: se quitan sus %s cuentas y %s fichas nuevas; el plan vuelve a estar sin activar.', n_cuentas, cardinality(v_fichas)),
          jsonb_build_object('importacion', imp.id, 'cuentas_borradas', n_borradas, 'fichas_borradas', cardinality(v_fichas)),
          'migrated', auth.uid(), v_nombre);
  return jsonb_build_object('cuentas', n_borradas, 'fichas', cardinality(v_fichas));
end $$;
revoke all on function public.company_chart_import_undo(uuid, text) from public, anon;
grant execute on function public.company_chart_import_undo(uuid, text) to authenticated;
