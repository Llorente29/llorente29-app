-- ============================================================================
-- C02c · 0130 · Las GENÉRICAS de Diez entran con su número (respuesta 2,
-- camino B). Va después de la 0100, la 0110 y la 0120.
-- ----------------------------------------------------------------------------
-- Diez crea una subcuenta para cada cuenta del cuadro aunque el plan de pymes
-- la desglose: 16000000 para la 160 (hojas 1603, 1604, 1605), 44500000 para
-- una 445 que el plan de pymes no tiene (va bajo la 44). En el plan de Foodint
-- son 42. «Las mismas cuentas que en Diez»: entran con su número.
--
-- 1. company_account_madre (disparador, antes de insertar o cambiar code,
--    template_code o source): una cuenta puede colgar de una cuenta del cuadro
--    CON hijas SOLO si es traída (source = 'migrated') y es su genérica:
--      · su madre es la cuenta con hijas más larga que es prefijo del código;
--      · ninguna hoja del cuadro es prefijo del código (si lo fuera, es de ella);
--      · el código es el relleno de la madre (16000000) o de una cuenta de 3
--        dígitos que empieza por ella y no está en el cuadro (44500000);
--      · CHOQUE: si una hoja hija de la madre, rellenada, da el mismo código,
--        para: no se sabe cuál es cuál.
--    Para todo lo que cuelga de una hoja (la activación normal, «+ Añadir
--    subcuenta», las propuestas, los bancos, el IVA por tipo) no cambia nada:
--    sale en la primera comprobación. Antes esta regla no estaba en la base
--    (la hacían las funciones, una a una); ahora está, y solo se abre para
--    las traídas.
-- 2. company_chart_import_apply: copia LITERAL de la 0100 (create or replace,
--    misma firma: la regla 2 es para cuando cambia la firma) con:
--      · 4c bis: las genéricas (p_plan -> 'genericas': code, madre, nombre,
--        nombre_origen), kind own, source migrated, con su import_id (el
--        deshacer de la 0100 ya las quita: borra todo lo de la importación);
--      · el resultado y el registro cuentan «cuentas» = propias + genéricas, y
--        «genericas» aparte.
--    La IA no propone nada sobre ellas (todo lo que propone parte de una hoja).
-- Vuelta atrás: supabase/vuelta-atras/20261008T0130_c02c_genericas.down.sql
-- ============================================================================

-- ── 1. La guarda: de una cuenta con hijas solo cuelgan las genéricas traídas ─
create function public.company_account_madre()
returns trigger language plpgsql set search_path = public as $$
declare
  v_sin text; v_relleno text; v_choque text; v_hoja text; v_mas_larga text;
begin
  if exists (select 1 from public.pgc_account p where p.plan = new.plan and p.code = new.template_code and p.is_leaf and p.valid_to is null) then
    return new;
  end if;
  if new.source <> 'migrated' then
    raise exception '% cuelga de la %, que tiene hijas en el plan de %: solo una cuenta traída de otro programa (su genérica) puede.', new.code, new.template_code, new.plan using errcode = '23514';
  end if;
  if not exists (select 1 from public.pgc_account p where p.plan = new.plan and p.code = new.template_code and not p.is_leaf and p.valid_to is null) then
    raise exception '% dice colgar de la %, que no es una cuenta del plan de %.', new.code, new.template_code, new.plan using errcode = '23514';
  end if;
  -- Choque: una hoja hija de la madre que, rellenada, da el mismo número.
  select p.code into v_choque from public.pgc_account p
   where p.plan = new.plan and p.is_leaf and p.valid_to is null and p.code like new.template_code || '%' and rpad(p.code, length(new.code), '0') = new.code
   limit 1;
  if v_choque is not null then
    raise exception '% sería la genérica de la %, pero la % rellenada da el mismo número: no se sabe cuál es cuál.', new.code, new.template_code, v_choque using errcode = '23505';
  end if;
  select p.code into v_hoja from public.pgc_account p
   where p.plan = new.plan and p.is_leaf and p.valid_to is null and new.code like p.code || '%' limit 1;
  if v_hoja is not null then
    raise exception '% empieza por la %, que es hoja: cuelga de ella, no de la %.', new.code, v_hoja, new.template_code using errcode = '23514';
  end if;
  select p.code into v_mas_larga from public.pgc_account p
   where p.plan = new.plan and not p.is_leaf and p.valid_to is null and length(p.code) > length(new.template_code) and new.code like p.code || '%'
   order by length(p.code) desc limit 1;
  if v_mas_larga is not null then
    raise exception 'La madre de % es la %, no la %.', new.code, v_mas_larga, new.template_code using errcode = '23514';
  end if;
  v_sin := rtrim(new.code, '0');
  v_relleno := case when length(v_sin) <= length(new.template_code) then new.template_code else v_sin end;
  if v_relleno <> new.template_code and length(v_relleno) > 3 then
    raise exception '% no es la genérica de la % (ni de una cuenta de 3 dígitos que empiece por ella): no se sabe dónde va.', new.code, new.template_code using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.company_account_madre() from public, anon, authenticated;

create trigger company_account_madre
  before insert or update of code, template_code, source on public.company_account
  for each row execute function public.company_account_madre();

comment on column public.company_account.template_code is
  'La hoja del cuadro de la que cuelga (pgc_account.code, is_leaf). Única excepción: las genéricas traídas de otro programa (source migrated) cuelgan de su cuenta con hijas (C02c, respuesta 2; disparador company_account_madre).';

-- ── 2. Traer el plan, con las genéricas ─────────────────────────────────────
create or replace function public.company_chart_import_apply(p_import uuid, p_plan jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_quien uuid := auth.uid(); v_nombre text;
  v_plan text; v_d int; v_territorio text; v_sistema text; v_programa text;
  r record; x jsonb; v_code text; v_id uuid; v_suf int;
  n_serie int := 0; n_propias int := 0; n_genericas int := 0; n_fichas int := 0; n_enl int := 0; n_sub int := 0;
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
  select v_cuenta, imp.company_id, v_plan, j ->> 'code', j ->> 'hoja', trim(j ->> 'nombre'), 'own', 'migrated', v_quien, v_nombre, nullif(trim(j ->> 'nombre_origen'), ''), imp.id
    from jsonb_array_elements(p_plan -> 'cuentas') j;
  get diagnostics n_propias = row_count;

  -- 4c bis · Las GENÉRICAS del programa (respuesta 2 del C02c): la 16000000 de Diez bajo la 160,
  --          que tiene hijas. Con su número, kind own, source migrated. La regla (madre, relleno,
  --          choque con una hoja) la vuelve a mirar el disparador company_account_madre al insertar.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) loop
    v_code := x ->> 'code';
    if v_code !~ ('^[0-9]{' || v_d || '}$') then raise exception '«%» no tiene % dígitos.', v_code, v_d using errcode = '22023'; end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception '% no tiene nombre.', v_code using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(p_plan -> 'cuentas') c where c ->> 'code' = v_code) then
      raise exception '% viene a la vez como cuenta propia y como genérica.', v_code using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb))) <> (select count(distinct e ->> 'code') from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) e) then
    raise exception 'Hay un código repetido en las genéricas.' using errcode = '22023';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, j ->> 'code', j ->> 'madre', trim(j ->> 'nombre'), 'own', 'migrated', v_quien, v_nombre, nullif(trim(j ->> 'nombre_origen'), ''), imp.id
    from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) j;
  get diagnostics n_genericas = row_count;

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
         result = jsonb_build_object('serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub,
                                     'fichas_creadas', to_jsonb(creadas), 'avisos', to_jsonb(avisos))
   where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importado',
          format('Plan traído de %s · %s cuentas%s · %s enlaces%s', v_programa, n_propias + n_genericas,
                 case when n_genericas > 0 then format(' · %s %s', n_genericas, case when n_genericas = 1 then 'genérica' else 'genéricas' end) else '' end,
                 (select count(distinct l.company_account_id) from public.company_account_link l join public.company_account a on a.id = l.company_account_id
                   where a.import_id = imp.id and l.source = 'migrated'),
                 case when n_fichas > 0 then format(' · %s fichas nuevas', n_fichas) else '' end),
          jsonb_build_object('importacion', imp.id, 'programa', imp.program, 'plan', v_plan, 'digitos', v_d, 'serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas,
                             'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos)),
          'migrated', v_quien, v_nombre);
  return jsonb_build_object('importacion', imp.id, 'serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos));
end $$;
revoke all on function public.company_chart_import_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.company_chart_import_apply(uuid, jsonb, text) to authenticated;
