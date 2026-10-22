-- supabase/vuelta-atras/20261130T0420_i01d_impuestos_2025.down.sql
--
-- Vuelta atrás de 20261130T0420_i01d_impuestos_2025: conta_impuesto_trimestre
-- como estaba (la de 20261122T0280_i01c_trimestre, byte a byte el cuerpo que
-- hay en producción el 21/10: md5 9522728be846f7d8acc8d03a09cabfa5). Misma
-- firma: los permisos no cambian.

create or replace function public.conta_impuesto_trimestre(p_company uuid, p_year int, p_quarter int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hechos constant text[] := array['filed', 'booked', 'paid', 'offset', 'refunded'];
  v_q text; v_meses text[]; v_202 text;
  v_modelos jsonb; v_filas jsonb;
  v_ant public.tax_return; v_ant_y int; v_ant_p text;
  v_esperada numeric; v_esperada_de text;
  v_inicio numeric; v_inicio_de text;
  v_borr public.tax_return; v_b110 numeric; v_b110_origen text; v_desfasada boolean := false;
begin
  if not exists (select 1 from public.company where id = p_company) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  if p_quarter is null or p_quarter not between 1 and 4 then
    raise exception 'El trimestre es del 1 al 4.' using errcode = '22023';
  end if;
  if p_year is null or p_year < 2000 or p_year > extract(year from now())::int + 1 then
    raise exception 'El ejercicio «%» no es un año que se pueda mirar.', p_year using errcode = '22023';
  end if;

  v_q := p_quarter || 'T';
  v_meses := array[lpad(((p_quarter - 1) * 3 + 1)::text, 2, '0'), lpad(((p_quarter - 1) * 3 + 2)::text, 2, '0'), lpad(((p_quarter - 1) * 3 + 3)::text, 2, '0')];
  -- El 202 que se paga con el trimestre: el 1P en abril (tras el 1T), el 2P en
  -- octubre (tras el 3T) y el 3P en diciembre (en el 4T). En el 2T no toca.
  v_202 := case p_quarter when 1 then '1P' when 3 then '2P' when 4 then '3P' end;

  -- ── La tira: cada modelo que la empresa presenta, con lo que le toca este trimestre ──
  with o as (
    select o.form_code, o.cadence from public.tax_obligation o
     where o.company_id = p_company and o.valid_to is null and o.active and o.cadence <> 'annual'
  ), p as (
    select o.form_code, o.cadence, x.per
      from o cross join lateral unnest(case o.cadence
             when 'quarterly' then array[v_q]
             when 'monthly' then v_meses
             when 'instalments_202' then case when v_202 is null then array[null::text] else array[v_202] end end) x(per)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'modelo', p.form_code, 'nombre', f.name, 'cadencia', p.cadence, 'periodo', p.per,
           -- Un modelo que presenta y no toca este trimestre se dice (regla 7): el 202 en el 2T.
           'no_toca', p.per is null,
           'presentacion', pl.presentacion, 'domiciliacion', pl.domiciliacion,
           'declaracion', case when r.id is null then null else jsonb_build_object(
             'id', r.id, 'cuenta', r.account_id, 'estado', r.status, 'estado_texto', public.conta_impuesto_estado_texto(r.status),
             'resultado', r.result_kind, 'importe', r.amount,
             'presentada', r.filed_at, 'presentada_por', r.filed_by_name, 'por', r.filed_via,
             'csv', r.aeat_csv, 'justificante', r.aeat_receipt_number, 'justificante_pdf', r.receipt_document_path,
             'traido', r.receipt_source = 'aeat_csv', 'expediente', r.aeat_expediente,
             'presentador', case when r.presenter_tax_id is not null or r.presenter_name is not null
                                 then jsonb_build_object('nif', r.presenter_tax_id, 'nombre', r.presenter_name) end,
             'casillas', (select coalesce(jsonb_agg(jsonb_build_object('casilla', b.box, 'valor', b.value, 'texto', b.value_text,
                                                                       'origen', b.origin, 'motivo', b.manual_reason)
                                                    order by length(b.box), b.box), '[]')
                            from public.tax_return_box b where b.tax_return_id = r.id)) end
         ) order by case p.form_code when '303' then 1 when '111' then 2 when '115' then 3 when '202' then 4 else 5 end, p.form_code, p.per), '[]')
    into v_modelos
    from p join public.tax_form f on f.code = p.form_code
    left join lateral public.conta_impuesto_plazo_si_hay(p.form_code, p.cadence, p_year, p.per) pl on p.per is not null
    left join public.tax_return r on p.per is not null and r.company_id = p_company and r.form_code = p.form_code
                                  and r.fiscal_year = p_year and r.period = p.per and r.sequence = 1;

  -- ── La cartera del 303: los cuatro trimestres del año, con [110], [78] y [87] ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'periodo', q.per, 'declaracion', r.id, 'estado', r.status,
           'presentada', r.status = any (v_hechos),
           'resultado', r.result_kind, 'importe', r.amount,
           'c110', (select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '110'),
           'c78', (select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '78'),
           'c87', (select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '87'),
           'origen110', (select b.origin from public.tax_return_box b where b.tax_return_id = r.id and b.box = '110'))
         order by q.per), '[]')
    into v_filas
    from unnest(array['1T', '2T', '3T', '4T']) q(per)
    left join public.tax_return r on r.company_id = p_company and r.form_code = '303' and r.fiscal_year = p_year
                                  and r.period = q.per and r.sequence = 1;

  -- Lo que quedaba al empezar el año: la [110] del 1T presentado o, si no, lo
  -- que dejó el 4T del año anterior presentado. Si no hay ninguno, no se sabe.
  select * into v_ant from public.tax_return
   where company_id = p_company and form_code = '303' and fiscal_year = p_year and period = '1T' and sequence = 1 and status = any (v_hechos);
  if v_ant.id is not null then
    v_inicio := (select b.value from public.tax_return_box b where b.tax_return_id = v_ant.id and b.box = '110');
    v_inicio_de := '1T/' || p_year;
  end if;
  if v_inicio is null then
    select * into v_ant from public.tax_return
     where company_id = p_company and form_code = '303' and fiscal_year = p_year - 1 and period = '4T' and sequence = 1 and status = any (v_hechos);
    if v_ant.id is not null then
      v_inicio := coalesce((select b.value from public.tax_return_box b where b.tax_return_id = v_ant.id and b.box = '87'), 0)
                + case when v_ant.result_kind = 'to_offset' then v_ant.amount else 0 end;
      v_inicio_de := '4T/' || (p_year - 1);
    end if;
  end if;

  -- La [110] que le toca al trimestre: lo que dejó el 303 inmediatamente
  -- anterior presentado (como lo calcula conta_impuesto_303_calcular, 0240).
  v_ant_y := case when p_quarter = 1 then p_year - 1 else p_year end;
  v_ant_p := case when p_quarter = 1 then '4T' else (p_quarter - 1) || 'T' end;
  select * into v_ant from public.tax_return
   where company_id = p_company and form_code = '303' and fiscal_year = v_ant_y and period = v_ant_p and sequence = 1 and status = any (v_hechos);
  if v_ant.id is not null then
    v_esperada := coalesce((select b.value from public.tax_return_box b where b.tax_return_id = v_ant.id and b.box = '87'), 0)
                + case when v_ant.result_kind = 'to_offset' then v_ant.amount else 0 end;
    v_esperada_de := v_ant_p || '/' || v_ant_y;
  end if;

  -- ¿El borrador del trimestre está desfasado? Solo si se calculó solo (una
  -- [110] escrita a mano la decidió una persona) y no es la que le toca.
  select * into v_borr from public.tax_return
   where company_id = p_company and form_code = '303' and fiscal_year = p_year and period = v_q and sequence = 1
     and status in ('draft', 'reviewed');
  if v_borr.id is not null then
    select b.value, b.origin into v_b110, v_b110_origen from public.tax_return_box b where b.tax_return_id = v_borr.id and b.box = '110';
    v_desfasada := v_esperada is not null and coalesce(v_b110_origen, 'calculated') <> 'manual'
                   and (v_b110 is null or abs(v_b110 - v_esperada) >= 0.005);
  end if;

  return jsonb_build_object(
    'empresa', (select jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(c.trade_name, ''), c.legal_name), 'razon_social', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = p_company),
    'ejercicio', p_year, 'trimestre', v_q,
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'modelos', v_modelos,
    'cartera', jsonb_build_object(
      'filas', v_filas,
      'pendiente_al_empezar', case when v_inicio is null then null else jsonb_build_object('importe', v_inicio, 'de', v_inicio_de) end,
      'esperada_110', case when v_esperada is null then null else jsonb_build_object('importe', v_esperada, 'de', v_esperada_de) end,
      'borrador', case when v_borr.id is null then null else jsonb_build_object('id', v_borr.id, 'estado', v_borr.status, 'c110', v_b110, 'origen110', v_b110_origen) end,
      'desfasada', v_desfasada));
end $$;
