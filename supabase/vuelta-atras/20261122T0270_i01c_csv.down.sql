-- supabase/vuelta-atras/20261122T0270_i01c_csv.down.sql
--
-- Deshace la 0270: las dos funciones vuelven a ser las de la 0260
-- (conta_impuesto_justificante_apuntar) y la 0210 (conta_impuesto_presentados),
-- byte a byte, y se quitan las cuatro columnas (con lo que tuvieran: el
-- expediente, el presentador y de dónde salió el PDF; lo demás de cada
-- declaración se queda).

create or replace function public.conta_impuesto_justificante_apuntar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m jsonb; c public.company; r public.tax_return; v_id uuid; v_nombre text := public.conta_impuesto_quien();
  v_mod text := p_datos->>'modelo'; v_per text := upper(p_datos->>'periodo'); v_ej int := (p_datos->>'ejercicio')::int;
  v_cad text; v_pl record; v_due date; v_dd date; v_prov text; v_regla record; v_mes date;
  v_mano boolean := coalesce((p_datos->>'a_mano')::boolean, false); v_motivo text := btrim(coalesce(p_datos->>'motivo', ''));
  v_caja_res text := case p_datos->>'modelo' when '303' then '71' when '111' then '30' when '115' then '05' end;
  v_casillas jsonb := p_datos->'casillas'; v_antes text;
begin
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, sube justificantes.' using errcode = '42501';
  end if;
  m := public.conta_impuesto_justificante_mirar(p_company, p_datos);
  if m->>'estado' = 'error' then raise exception '%', m->>'motivo' using errcode = '22023'; end if;
  if m->>'estado' = 'ya_estaba' then
    return m || jsonb_build_object('ok', true, 'mensaje', m->>'motivo');
  end if;
  select * into c from public.company where id = p_company;
  v_cad := m->>'cadencia';
  -- La [71] (o la del resultado) escrita a mano si el PDF no la traía.
  if v_caja_res is not null and not (v_casillas ? v_caja_res) then
    v_casillas := v_casillas || jsonb_build_object(v_caja_res, (p_datos->>'resultado')::numeric);
  end if;

  if m->>'estado' = 'nuevo' then
    select * into v_pl from public.conta_impuesto_plazo_si_hay(v_mod, v_cad, v_ej, v_per);
    v_due := v_pl.presentacion; v_dd := v_pl.domiciliacion; v_prov := v_pl.provisional;
    if v_due is null then
      -- Sin los festivos de ese año: el día de la regla, sin trasladar, y dicho.
      select * into v_regla from public.tax_form_deadline d
       where d.form_code = v_mod and d.cadence = v_cad and d.period in (v_per, '*') order by (d.period = v_per) desc limit 1;
      if v_regla.form_code is null then
        raise exception 'No tengo la regla del plazo del % (%): no se inventa.', v_mod, v_per using errcode = 'P0002';
      end if;
      v_mes := (make_date(v_ej, public.conta_impuesto_fin_periodo(v_cad, v_per), 1) + make_interval(months => v_regla.months_after))::date;
      v_due := case when v_regla.day is null then (v_mes + interval '1 month - 1 day')::date
                    else make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, v_regla.day) end;
      v_prov := 'Sin los festivos de ' || extract(year from v_due)::int || ': el día de la regla, sin trasladar si caía en festivo.';
    end if;
    -- Nace presentada (de «pendiente» no se pasa a «presentada»: el registro lo dice como alta).
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date, due_date_direct_debit, due_provisional,
                                   status, result_kind, amount, filed_at, filed_by, filed_by_name, filed_via, aeat_csv, aeat_receipt_number, outside_csv_pasted_at)
    values (c.account_id, p_company,
            (select o.id from public.tax_obligation o where o.company_id = p_company and o.form_code = v_mod and o.valid_to is null),
            v_mod, v_ej, v_cad, v_per, v_due, v_dd, v_prov,
            'filed', m->>'resultado', (m->>'importe')::numeric, (m->>'presentada')::timestamptz, auth.uid(), v_nombre, 'outside',
            upper(regexp_replace(p_datos->>'csv', '\s', '', 'g')), nullif(btrim(coalesce(p_datos->>'justificante', '')), ''), now())
    returning * into r;
    v_antes := null;
  else
    select * into r from public.tax_return where id = (m->>'declaracion')::uuid for update;
    v_antes := r.status;
    -- Una pendiente pasa por borrador: los cambios de estado que valen (conta_impuesto_estado_vale).
    if r.status = 'pending' then update public.tax_return set status = 'draft' where id = r.id; end if;
  end if;

  -- Las casillas: las del justificante, y ninguna más (lo calculado que no está en él, fuera; queda en el evento).
  delete from public.tax_return_box where tax_return_id = r.id;
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason, source)
  select r.id, r.account_id, p_company, k, round(v::numeric, 2),
         case when v_mano or (k = v_caja_res and not (p_datos->'casillas' ? k)) then 'manual' else 'justificante' end,
         case when v_mano then 'Escrita a mano del justificante: ' || v_motivo
              when k = v_caja_res and not (p_datos->'casillas' ? k) then 'El resultado, escrito a mano: el PDF no lo traía. ' || nullif(v_motivo, '') end,
         jsonb_build_object('justificante', p_datos->>'justificante')
    from jsonb_each_text(v_casillas) e(k, v);

  update public.tax_return
     set status = 'filed', result_kind = m->>'resultado', amount = (m->>'importe')::numeric,
         filed_at = (m->>'presentada')::timestamptz, filed_by = auth.uid(), filed_by_name = v_nombre, filed_via = 'outside',
         aeat_csv = upper(regexp_replace(p_datos->>'csv', '\s', '', 'g')), aeat_receipt_number = nullif(btrim(coalesce(p_datos->>'justificante', '')), ''),
         outside_csv_pasted_at = now(), updated_at = now()
   where id = r.id and v_antes is not null;
  -- El cambio de estado lo apunta su disparador; aquí, de dónde sale y las diferencias.
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, p_company, auth.uid(), v_nombre, 'note',
          'Presentado fuera de Sumied: ' || case when v_mano then 'casillas escritas a mano del justificante' else 'subido el justificante' end
            || coalesce(' nº ' || nullif(btrim(coalesce(p_datos->>'justificante', '')), ''), '') || '.',
          jsonb_build_object('origen', case when v_mano then 'justificante_a_mano' else 'justificante' end, 'antes', v_antes,
                             'csv_cola', right(upper(p_datos->>'csv'), 4), 'diferencias', coalesce(m->'diferencias', '[]'),
                             'casillas', (select count(*) from jsonb_object_keys(v_casillas))));
  return m || jsonb_build_object('ok', true, 'declaracion', r.id, 'cuenta', r.account_id,
    'mensaje', 'Apuntado el ' || v_mod || ' del ' || v_per || '/' || v_ej || ' como presentado fuera, ' ||
               case when v_casillas = '{}'::jsonb then 'con su importe y sin casillas (el impreso era imagen)'
                    else 'con ' || (select count(*) from jsonb_object_keys(v_casillas)) || ' casillas' end ||
               case when jsonb_array_length(coalesce(m->'diferencias', '[]')) > 0
                    then ' (' || jsonb_array_length(m->'diferencias') || ' distintas de lo calculado)' else '' end || '.');
end $$;
comment on function public.conta_impuesto_justificante_apuntar(uuid, jsonb) is
  'I01c (0260). Apunta un justificante de Hacienda como declaración presentada fuera: la crea o completa la que había (nunca duplica), con sus casillas de origen justificante y las diferencias con lo calculado en el evento.';

create or replace function public.conta_impuesto_presentados(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_y int := extract(year from (now() at time zone 'Europe/Madrid'))::int;
begin
  if not exists (select 1 from public.company where id = p_company) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'presentados', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'cuenta', r.account_id, 'modelo', r.form_code, 'nombre', f.name, 'cadencia', r.cadence, 'ejercicio', r.fiscal_year, 'periodo', r.period,
               'estado', r.status, 'estado_texto', public.conta_impuesto_estado_texto(r.status),
               'resultado', r.result_kind, 'importe', r.amount,
               'presentada', r.filed_at, 'presentada_por', r.filed_by_name, 'por', r.filed_via, 'plazo', r.due_date,
               'csv', r.aeat_csv, 'justificante', r.aeat_receipt_number, 'justificante_pdf', r.receipt_document_path,
               'contabilizada', r.liquidation_entry_id is not null, 'casada', r.bank_match_id is not null,
               'comprobada', r.filed_via = 'sumied' or exists (select 1 from public.tax_return_event e where e.tax_return_id = r.id
                                                                   and e.aeat_service = 'outside_check' and e.result = 'ok'))
             order by r.filed_at desc nulls last, r.fiscal_year desc, r.period desc), '[]')
        from public.tax_return r join public.tax_form f on f.code = r.form_code
       where r.company_id = p_company and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')),
    'para_apuntar', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ejercicio', c.ejercicio, 'periodo', c.periodo, 'presentacion', c.presentacion,
               'declaracion', r.id, 'estado', r.status, 'resultado', r.result_kind, 'importe', r.amount)
             order by c.ejercicio desc, c.periodo desc), '[]')
        from public.conta_impuesto_periodos(p_company, v_y) c
        left join public.tax_return r on r.company_id = p_company and r.form_code = '303' and r.fiscal_year = c.ejercicio
                                      and r.period = c.periodo and r.sequence = 1
       where c.modelo = '303' and c.ejercicio between v_y - 1 and v_y
         and c.presentacion - interval '25 days' <= v_hoy
         and coalesce(r.status, 'pending') in ('pending', 'draft', 'reviewed')));
end $$;

comment on function public.conta_impuesto_presentados(uuid) is
  'I01b. Las declaraciones presentadas de la empresa y los periodos del 303 que se pueden apuntar como presentados fuera. No escribe nada.';

alter table public.tax_return drop column if exists receipt_source;
alter table public.tax_return drop column if exists presenter_name;
alter table public.tax_return drop column if exists presenter_tax_id;
alter table public.tax_return drop column if exists aeat_expediente;
