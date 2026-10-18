-- supabase/migrations/20261122T0190_i01b_calendario.sql
--
-- I01b · P1 · EL CALENDARIO DE IMPUESTOS. Solo añade funciones.
--
--   conta_impuesto_calendario(empresa, hoy)                      [la persona]
--     Lo que pinta Impuestos › Calendario (tablero 8), de una vez:
--       · los periodos que tocan: todos los modelos que presenta la empresa
--         (tax_obligation vigente y activa) con su plazo dentro del mes del
--         próximo plazo (la «ventana»), y los de antes que se pasaron sin
--         presentar desde que la empresa lleva aquí sus impuestos. Cada uno
--         con sus dos fechas (conta_impuesto_plazo), su declaración si la hay
--         (estado, resultado, avisos y si cuadra) y cómo se paga;
--       · lo siguiente: los plazos de después de la ventana;
--       · los presentados del año;
--       · por qué le sale cada modelo y los que no le salen.
--     No escribe nada. Lo ve quien puede ver los impuestos de la empresa
--     (conta_impuesto_puede_ver: su cuenta, o su asesoría con consentimiento).
--
-- «Desde que la empresa lleva aquí sus impuestos» es la fecha más antigua de
-- sus modelos vigentes (tax_obligation.valid_from): lo de antes no se sabe si
-- se presentó, y no se pinta como atrasado. Una declaración que exista sí
-- cuenta siempre, sea del periodo que sea (también lo apuntado como
-- presentado fuera).
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0190_i01b_calendario.down.sql

-- El plazo de un periodo, o nada si no se puede calcular (faltan los festivos
-- de ese año): el calendario no pinta un plazo inventado.
create or replace function public.conta_impuesto_plazo_si_hay(p_modelo text, p_cadencia text, p_ejercicio int, p_periodo text)
returns table (presentacion date, domiciliacion date, provisional text)
language plpgsql stable set search_path = public as $$
begin
  return query select x.presentacion, x.domiciliacion, x.provisional from public.conta_impuesto_plazo(p_modelo, p_cadencia, p_ejercicio, p_periodo) x;
exception when others then
  return;
end $$;

-- Cada periodo de cada modelo vigente de la empresa, del año pasado al que
-- viene, con su plazo. Solo la llama el calendario (que mira quién pregunta).
create or replace function public.conta_impuesto_periodos(p_company uuid, p_y int)
returns table (obligacion uuid, modelo text, cadencia text, ejercicio int, periodo text,
               presentacion date, domiciliacion date, provisional text, pago text, cuenta uuid)
language sql stable security definer set search_path = public as $$
  select o.id, o.form_code, o.cadence, e.ej, p.per, pl.presentacion, pl.domiciliacion, pl.provisional,
         o.payment_mode, o.payment_treasury_account_id
    from public.tax_obligation o
   cross join generate_series(p_y - 1, p_y + 1) e(ej)
   cross join lateral unnest(case o.cadence
       when 'quarterly' then array['1T', '2T', '3T', '4T']
       when 'monthly' then array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
       when 'annual' then array['0A']
       when 'instalments_202' then array['1P', '2P', '3P'] end) p(per)
   cross join lateral public.conta_impuesto_plazo_si_hay(o.form_code, o.cadence, e.ej, p.per) pl
   where o.company_id = p_company and o.valid_to is null and o.active
$$;

create or replace function public.conta_impuesto_calendario(p_company uuid, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_y int := extract(year from coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date))::int;
  v_desde date; v_ventana date; v_filas jsonb; v_siguiente jsonb; v_reglas jsonb; v_no jsonb; v_pres jsonb;
begin
  if not exists (select 1 from public.company where id = p_company) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;

  select min(valid_from) into v_desde from public.tax_obligation where company_id = p_company and valid_to is null and active;

  -- La ventana: el mes del próximo plazo de presentación.
  select date_trunc('month', min(presentacion))::date into v_ventana from public.conta_impuesto_periodos(p_company, v_y) where presentacion >= v_hoy;

  with d as (
    select c.*, r.id as rid, r.status, r.result_kind, r.amount, r.previous_period_amount, r.not_required_reason,
           coalesce(r.payment_mode, case when c.pago = 'direct_debit' then 'direct_debit' end) as pago_real,
           coalesce(r.payment_treasury_account_id, c.cuenta) as cuenta_real,
           r.filed_at, r.filed_via, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'obligacion', d.obligacion, 'modelo', d.modelo, 'nombre', f.name, 'cadencia', d.cadencia,
           'ejercicio', d.ejercicio, 'periodo', d.periodo,
           'presentacion', d.presentacion, 'domiciliacion', d.domiciliacion, 'provisional', d.provisional,
           'atrasado', d.presentacion < v_hoy,
           'domicilia', coalesce(d.pago_real = 'direct_debit', false),
           'cuenta_final', (select right(t.iban, 4) from public.treasury_account t where t.id = d.cuenta_real and t.company_id = p_company),
           'se_calcula', d.modelo = '303',
           'declaracion', case when d.rid is null then null else jsonb_build_object(
             'id', d.rid, 'estado', d.status, 'estado_texto', public.conta_impuesto_estado_texto(d.status),
             'resultado', d.result_kind, 'importe', d.amount, 'anterior', d.previous_period_amount,
             'no_hace_falta', d.not_required_reason,
             'presentada', d.filed_at, 'por', d.filed_via,
             'errores', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'error'),
             'avisos', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'warning' and k.accepted_at is null),
             'aviso', (select k.title from public.tax_return_check k where k.tax_return_id = d.rid and k.result in ('error', 'warning') and k.accepted_at is null
                        order by (k.result = 'error') desc, k.checked_at limit 1),
             'cuadra', exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'book_vs_303' and k.result = 'ok')
                   and exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'ledger_477_472' and (k.result = 'ok' or k.accepted_at is not null))) end
         ) order by d.presentacion, d.modelo, d.ejercicio, d.periodo), '[]')
    into v_filas
    from d join public.tax_form f on f.code = d.modelo
   where (v_ventana is not null and date_trunc('month', d.presentacion)::date = v_ventana)
      -- Lo de antes que no se ha presentado: desde que lleva aquí sus impuestos, o si tiene declaración.
      or (d.presentacion < v_hoy
          and coalesce(d.status, 'pending') in ('pending', 'draft', 'reviewed')
          and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)));

  -- Lo siguiente: los plazos de después de la ventana, hasta un año.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', c.modelo, 'nombre', f.name, 'cadencia', c.cadencia, 'ejercicio', c.ejercicio,
                                               'periodo', c.periodo, 'presentacion', c.presentacion, 'domiciliacion', c.domiciliacion)
                            order by c.presentacion, c.modelo), '[]')
    into v_siguiente
    from public.conta_impuesto_periodos(p_company, v_y) c join public.tax_form f on f.code = c.modelo
   where v_ventana is not null and c.presentacion >= (v_ventana + interval '1 month')::date
     and c.presentacion < (v_ventana + interval '1 year')::date;

  -- Los presentados del año: los periodos con plazo en el año que ya han vencido
  -- (desde que lleva aquí sus impuestos, o con declaración), y cuántos están presentados.
  with v as (
    select c.*, r.id as rid, r.status, r.filed_at, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
     where extract(year from c.presentacion) = v_y
       and (c.presentacion < v_hoy or r.filed_at is not null)
       and coalesce(r.status, 'pending') <> 'not_required'
       and (r.id is not null or (v_desde is not null and c.presentacion >= v_desde))
  )
  select jsonb_build_object('ano', v_y, 'desde', v_desde,
           'vencidos', count(*),
           'presentados', count(*) filter (where status in ('filed', 'booked', 'paid', 'offset', 'refunded')),
           'en_plazo', count(*) filter (where filed_at is not null and (filed_at at time zone 'Europe/Madrid')::date <= presentacion),
           'contabilizados', count(*) filter (where status in ('booked', 'paid', 'offset', 'refunded')))
    into v_pres from v;

  -- Por qué le sale cada modelo, y los que no.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin,
                                               'cadencia', o2.cadence, 'quien', o2.decided_by_name, 'cuando', o2.decided_at)
                            order by o2.form_code) filter (where o2.active), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin)
                            order by o2.form_code) filter (where not o2.active), '[]')
    into v_reglas, v_no
    from public.tax_obligation o2 join public.tax_form f on f.code = o2.form_code
   where o2.company_id = p_company and o2.valid_to is null;

  return jsonb_build_object(
    'hoy', v_hoy, 'ventana', v_ventana, 'desde', v_desde,
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'filas', v_filas, 'siguiente', v_siguiente, 'presentados', v_pres,
    'modelos', v_reglas, 'no_presenta', v_no,
    -- Para «+ Añadir otro impuesto»: los modelos que conoce Sumied y no están en la lista.
    'se_pueden_anadir', (select coalesce(jsonb_agg(jsonb_build_object('modelo', f.code, 'nombre', f.name) order by f.code), '[]')
                           from public.tax_form f
                          where f.code in (select distinct form_code from public.tax_form_deadline)
                            and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company and o3.valid_to is null
                                                                                    and o3.active and o3.form_code = f.code)));
end $$;

comment on function public.conta_impuesto_calendario(uuid, date) is
  'I01b. Lo que pinta Impuestos › Calendario: los periodos que tocan con su plazo y su declaración, lo siguiente, los presentados del año y el porqué de cada modelo. No escribe nada.';

revoke all on function public.conta_impuesto_plazo_si_hay(text, text, int, text), public.conta_impuesto_periodos(uuid, int) from public, anon, authenticated;
grant execute on function public.conta_impuesto_plazo_si_hay(text, text, int, text), public.conta_impuesto_periodos(uuid, int) to service_role;
revoke all on function public.conta_impuesto_calendario(uuid, date) from public, anon;
grant execute on function public.conta_impuesto_calendario(uuid, date) to authenticated, service_role;
