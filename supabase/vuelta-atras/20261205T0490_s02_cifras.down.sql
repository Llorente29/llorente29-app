-- supabase/vuelta-atras/20261205T0490_s02_cifras.down.sql
--
-- Vuelta atrás de 20261205T0490_s02_cifras, en orden inverso:
--   4. conta_impuesto_calendario, la de antes, byte a byte (la de la 0340, la
--      de producción: md5 del cuerpo 480da33a07e1885441de585237156d3e, medido
--      el 22/10);
--   3–1. fuera conta_saldos_terceros, conta_saldo_bancos y conta_pendientes.
-- Ninguna de las cuatro guarda nada: no se pierde ningún dato. Lo único que se
-- perdería es lo que se haya construido ENCIMA: PARA, sin tocar nada, si otra
-- función de la base llama ya a alguna de las tres (romperla en silencio sería
-- peor que no volver atrás). El front que las lee cae a la cuenta de antes si
-- no están (el patrón de leerEsperan).

do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('conta_pendientes', 'conta_saldo_bancos', 'conta_saldos_terceros')
     and p.prosrc ~ '\m(conta_pendientes|conta_saldo_bancos|conta_saldos_terceros)\M';
  if v is not null then
    raise exception 'S02 0490 vuelta atrás: % llama(n) a las funciones de las cifras y se quedarían rotas. No se toca nada.', v;
  end if;
end $$;

-- 4 · El calendario de producción del 22/10 (la 0340), tal cual.
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
          and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)))
      -- I01h · Lo que no hacía falta presentar y venció hace poco (el último mes): se
      -- enseña con su porqué, para que no desaparezca sin decir nada (Julio, 21/10).
      or (d.presentacion < v_hoy and d.status = 'not_required' and d.presentacion >= v_hoy - 31);

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
  -- 0250: y las reglas que dicen que no y nunca se escribieron (calcular no
  -- escribe una regla inactiva sin fila previa): «No te sale el 349: …».
  v_no := v_no || coalesce((select jsonb_agg(jsonb_build_object('modelo', r.form_code, 'nombre', f.name, 'por_que', r.why, 'origen', 'rule')
                                              order by r.form_code)
                              from public.conta_impuesto_reglas(p_company) r join public.tax_form f on f.code = r.form_code
                             where not r.active
                               and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company
                                                                                       and o3.valid_to is null and o3.form_code = r.form_code)), '[]');

  return jsonb_build_object(
    'hoy', v_hoy, 'ventana', v_ventana, 'desde', v_desde,
    -- Para los avisos de Inicio: el certificado con que presenta la empresa (su caducidad)…
    'certificado', (select jsonb_build_object('titular', t.subject_name, 'caduca', t.valid_to)
                      from public.company_tax_presenter pr join public.tax_certificate t on t.id = pr.certificate_id
                     where pr.company_id = p_company and pr.mode = 'company' and t.status <> 'removed'),
    -- …y lo presentado a pagar cuyo cargo no ha llegado al banco dos días después del plazo (respuesta 5 de Julio).
    'pagos_sin_llegar', (select coalesce(jsonb_agg(jsonb_build_object('declaracion', r.id, 'modelo', r.form_code, 'ejercicio', r.fiscal_year,
                                                                      'periodo', r.period, 'importe', r.amount, 'plazo', r.due_date,
                                                                      'domicilia', r.payment_mode = 'direct_debit') order by r.due_date), '[]')
                           from public.tax_return r
                          where r.company_id = p_company and r.status in ('filed', 'booked') and r.result_kind = 'to_pay'
                            and r.bank_match_id is null and r.due_date < v_hoy - 2 and r.due_date > v_hoy - 400),
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

-- 3–1 · Fuera las tres funciones de las cifras.
drop function if exists public.conta_saldos_terceros(uuid, date);
drop function if exists public.conta_saldo_bancos(uuid, date);
drop function if exists public.conta_pendientes(uuid);
