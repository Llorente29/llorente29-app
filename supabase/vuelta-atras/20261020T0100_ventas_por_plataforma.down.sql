-- Vuelta atrás de 20261020T0100_ventas_por_plataforma.sql.
--
-- Las cuatro funciones, como estaban (copiadas de lo vigente el 13/10; md5 de
-- prosrc a0744c92…, c7ff7743…, c7b96fb8… y 99aab762…, iguales a sus ficheros:
-- 20261016T0120, 20261018T0100 §3 y §5, 20261010T0120), y fuera las piezas
-- nuevas. PARA si ya hay resúmenes por unidad: antes, la vuelta atrás de la
-- 0130, la 0120 y la 0110 (en ese orden), o retirar esas unidades.

do $$
begin
  if exists (select 1 from public.sales_day_summary where unit_key is not null) then
    raise exception 'Vuelta atrás de la 0100: hay resúmenes por unidad; deshaz antes la 0130, la 0120 y la 0110.';
  end if;
end $$;

create or replace function public.conta_dias_por_asentar(p_company uuid, p_desde date, p_hasta date)
returns table (location_id uuid, dia date, pedidos bigint)
language sql stable
set search_path = public
as $$
  select s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, count(*)
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own' and s.location_id is not null
     and s.sold_at >= (p_desde::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
     -- Cierre del día: solo días que ya han llegado a su hora de cierre.
     and s.sold_at < (select public.conta_cerrado_hasta(p_company))
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_day'
                        and x.source_key = s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date)
   group by 1, 2
   order by 2, 1
$$;

create or replace function public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_company using errcode = '23514';
  end if;
  if v_tipo = 'sales_day' then
    v_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
    -- El botón y el cierre del día pueden llegar a la vez al mismo día.
    perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || v_clave, 0));
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo and d.source_key = v_clave) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), p_quien)
      returning id into v_resumen;
    else
      -- Un resumen sin asiento vivo (el del 09/10 de Carabanchel, de antes del
      -- cierre del día) se rehace entero con el día de ahora: no se duplica.
      update public.sales_day_summary set tickets_count = (p_summary->>'tickets_count')::int, total = (p_summary->>'total')::numeric,
             by_rate = coalesce(p_summary->'by_rate', '[]'), by_channel = coalesce(p_summary->'by_channel', '[]'), by_brand = coalesce(p_summary->'by_brand', '[]'),
             detail_hash = p_summary->>'detail_hash',
             sale_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
             base_calculated = coalesce((p_summary->>'base_calculated')::boolean, false), entry_id = null
       where id = v_resumen;
    end if;
    v_origen := v_resumen;
  elsif v_origen is not null then
    select id into v_existente from public.journal_entry
     where company_id = p_company and source_type = v_tipo and source_id = v_origen and status in ('propuesto', 'borrador', 'validado');
    if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
  end if;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = p_company and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo');
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;
revoke all on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.conta_proponer_dias(p_company uuid, p_ahora timestamptz default now(), p_quien text default 'Folvy (cierre del día)')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_hasta date; y record; d record; v_p jsonb; v_r jsonb; v_res text; v_porque text; v_entry uuid;
  v_n jsonb := jsonb_build_object('propuestos', 0, 'ya_estaban', 0, 'descartados', 0, 'sin_propuesta', 0, 'fallos', 0);
  v_fallos text[] := '{}'; v_preguntar text[] := '{}';
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Proponer: la empresa % no existe.', p_company; end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  for y in select f.* from public.fiscal_year f where f.company_id = p_company and f.status = 'open' and f.starts_on <= v_hasta order by f.starts_on loop
    if y.imported_until is null
       and exists (select 1 from public.sale s where s.account_id = v_cuenta and s.sold_at < (y.starts_on::timestamp at time zone 'Europe/Madrid'))
       and not exists (select 1 from public.journal_entry e where e.company_id = p_company and e.fiscal_year_id = y.id) then
      v_preguntar := v_preguntar || y.code::text;
      continue;
    end if;
    for d in
      select x.location_id, x.dia from public.conta_dias_por_asentar(p_company, greatest(y.starts_on, coalesce(y.imported_until + 1, y.starts_on)), least(v_hasta, y.ends_on)) x
       where not exists (select 1 from public.fiscal_period_lock k where k.company_id = p_company and k.month = date_trunc('month', x.dia)::date and k.reopened_at is null)
       order by x.dia, x.location_id
    loop
      v_entry := null; v_porque := null;
      begin
        v_p := public.conta_propuesta_ventas_dia(p_company, d.location_id, d.dia);
        if v_p is null then
          raise exception 'la propuesta del día ha salido vacía (ni asiento ni porqué)';
        elsif v_p ? 'sin_propuesta' then
          v_res := 'sin_propuesta'; v_porque := v_p->>'sin_propuesta';
        else
          v_r := public._journal_entry_proponer(p_company, v_p->'entrada', v_p->'lineas', v_p->'resumen', p_quien, null);
          v_res := case when (v_r->>'descartada')::boolean then 'descartado' when (v_r->>'existente')::boolean then 'ya_estaba' else 'propuesto' end;
          v_entry := nullif(v_r->>'id', '')::uuid;
        end if;
      exception when others then
        v_res := 'fallo'; v_porque := format('%s (%s)', sqlerrm, sqlstate);
        v_fallos := v_fallos || format('%s %s: %s', d.dia, d.location_id, sqlerrm);
      end;
      insert into public.sales_day_proposal_log as g (account_id, company_id, location_id, sales_day, result, reason, entry_id)
      values (v_cuenta, p_company, d.location_id, d.dia, v_res, v_porque, v_entry)
      on conflict (company_id, location_id, sales_day) do update
        set result = excluded.result, reason = excluded.reason, entry_id = excluded.entry_id, attempts = g.attempts + 1, last_at = now();
      v_n := jsonb_set(v_n, array[case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                              when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end],
                       to_jsonb((v_n->>case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                                  when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end)::int + 1));
    end loop;
  end loop;
  return v_n || jsonb_build_object('company_id', p_company, 'hasta', v_hasta, 'errores', to_jsonb(v_fallos), 'preguntar_ejercicio', to_jsonb(v_preguntar));
end $$;
comment on function public.conta_proponer_dias(uuid, timestamptz, text) is
  'Cierre del día 2: propone las ventas de los días cerrados y abiertos que no tienen asiento vivo, y apunta en sales_day_proposal_log lo que pasó con cada uno. Lo llama el cierre del día cada hora.';
revoke all on function public.conta_proponer_dias(uuid, timestamptz, text) from public, anon, authenticated;

create or replace function public.journal_entry_descartar(p_entry uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_clave text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta descarta propuestas.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then raise exception 'Solo se descarta una propuesta o un borrador; lo validado se anula.' using errcode = '23514'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Para descartar hay que decir por qué.' using errcode = '23514'; end if;
  if v_e.source_type = 'sales_day' then
    select s.location_id || ':' || s.sales_day into v_clave from public.sales_day_summary s where s.id = v_e.source_id;
  else
    v_clave := v_e.source_id::text;
  end if;
  if v_clave is not null then
    insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
    values (v_e.account_id, v_e.company_id, v_e.source_type, v_clave, trim(p_motivo), auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
    on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;
  end if;
  delete from public.journal_entry where id = p_entry;
  return jsonb_build_object('descartado', p_entry, 'clave', v_clave);
end $$;
revoke all on function public.journal_entry_descartar(uuid, text, text) from public, anon;
grant execute on function public.journal_entry_descartar(uuid, text, text) to authenticated;

drop function if exists public.conta_propuestas_ventas_dia(uuid, uuid, date);
drop function if exists public.conta_propuesta_ventas_unidad(uuid, uuid, date, uuid, uuid);
drop function if exists public.conta_unidad_ventas(uuid, uuid, uuid);
alter table public.sales_day_summary drop column if exists brand_id;
alter table public.sales_day_summary drop column if exists channel_id;
alter table public.sales_day_summary drop column if exists unit_key;
drop table if exists public.conta_ventas_marca;
drop table if exists public.conta_ventas_canal;
