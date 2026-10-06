-- ============================================================================
-- C02c · Traer el plan de otro programa — 2 · LA ACTIVACIÓN NORMAL ESPERA
-- ----------------------------------------------------------------------------
-- company_chart_activate («No, empiezo de cero») se niega si la empresa tiene
-- una importación EN REVISIÓN: activar con numeración automática pisaría el
-- plan que se está trayendo (la regla de Julio que origina el C02c: las
-- cuentas de quien viene de otro programa son las de allí).
--
-- Copia LITERAL de la versión vigente (20261007T0180) con una sola guarda
-- añadida tras la de «ya está activado». Misma firma: create or replace
-- (regla 2 de CLAUDE.md: solo añadir un parámetro obliga a drop + create).
-- La vuelta atrás vuelve a poner la de la 0180 tal cual.
-- ============================================================================

create or replace function public.company_chart_activate(p_company uuid, p_comun_proveedores boolean default false, p_quien_nombre text default null)
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
  -- C02c: con un plan de otro programa a medio revisar, empezar de cero lo pisaría.
  if exists (select 1 from public.company_chart_import where company_id = p_company and status = 'revision') then
    raise exception 'Tienes a medias traer tu plan de otro programa: termínalo o tíralo antes de empezar de cero.' using errcode = '23514';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits, p.tax_territory
    into v_plan, v_d, v_territorio
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene completado «Tus impuestos y detalle contable».' using errcode = '22023'; end if;
  v_sistema := case v_territorio when 'canarias' then 'igic' else 'iva' end;

  -- Las hojas, rellenadas (D2). 4000 y 4300 son las cuentas comunes.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, is_common, source, created_by, created_by_name)
  select v_cuenta, p_company, v_plan, rpad(a.code, v_d, '0'), a.code, a.name, a.plain_name, 'template', a.code in ('4000', '4100', '4300'), 'serie', v_quien, p_quien_nombre
    from public.pgc_account a where a.plan = v_plan and a.is_leaf and a.valid_to is null;
  get diagnostics n_cuentas = row_count;

  -- IVA (o IGIC): una subcuenta por tipo vigente, en 472 y 477; el 0 % a la hoja.
  for r in
    select case when t.rate = trunc(t.rate) then t.rate::int else round(t.rate * 10)::int end suf, array_agg(t.id::text order by t.code) ids,
           replace(rtrim(to_char(min(t.rate), 'FM990.99'), '.'), '.', ',') tipo
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
                case v_code when '472' then 'IVA soportado ' else 'IVA repercutido ' end || r.tipo || ' %', 'own', 'serie', v_quien, p_quien_nombre)
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

  -- Proveedores: 4000 si lo que vende es mercancía, 4100 si son servicios
  -- (respuesta 2 de Julio). La hoja sale de la marca de su tipo de gasto; si
  -- no la tiene, de su cuenta del 6 (60 → 4000, el resto → 4100); sin tipo de
  -- gasto, 4000. Misma regla que hojaDeProveedor() en planEmpresa.ts. Una
  -- subcuenta cada uno, por orden de nombre dentro de cada hoja, o la común.
  for r in
    select s.id, s.name,
           coalesce(g.supplier_account_leaf, case when g.pgc_account_hint like '60%' then '4000' when g.pgc_account_hint is not null then '4100' else '4000' end) hoja
      from public.supplier s left join public.expense_category g on g.id = s.expense_category_id
     where s.account_id = v_cuenta and s.archived_at is null
     order by 3, s.name, s.id
  loop
    if p_comun_proveedores then
      select id into v_id from public.company_account where company_id = p_company and code = rpad(r.hoja, v_d, '0');
    else
      v_code := public.company_account_siguiente(p_company, r.hoja, v_d);
      if v_code is null then avisos := avisos || ('Numeración agotada en ' || r.hoja || ': ' || r.name || ' se queda sin subcuenta.'); continue; end if;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
      values (v_cuenta, p_company, v_plan, v_code, r.hoja, case r.hoja when '4000' then 'Proveedores · ' else 'Acreedores · ' end || r.name, 'own', 'serie', v_quien, p_quien_nombre)
      returning id into v_id;
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
