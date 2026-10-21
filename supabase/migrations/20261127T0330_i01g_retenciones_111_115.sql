-- supabase/migrations/20261127T0330_i01g_retenciones_111_115.sql
-- cambia: public.tax_return_check · prueba: supabase/staging/sql/20261127_i01g_retenciones_prueba.sql
--
-- I01g · EL 111 Y EL 115, CALCULADOS POR SUMIED DESDE EL DIARIO (Julio, 20/10:
-- «con el mismo molde que el 303, para que el 4T salga de Sumied»).
--
-- Lo que hace (añade tres funciones y amplía el CHECK de lo comprobado):
--
--   conta_impuesto_retenciones_diario(empresa, ejercicio, periodo)   [lee]
--     Los asientos del periodo con retención (la 4751), cada uno con su modelo,
--     su base, lo retenido y su perceptor, y las sumas. No escribe nada. La usan
--     el cálculo y la pantalla (para un 111 o un 115 ya presentado, casar lo
--     presentado con el diario).
--   conta_impuesto_retenciones_calcular(empresa, ejercicio, periodo, modelo)
--     Crea (o recalcula) el borrador del 111 o del 115, como el 303: sus
--     casillas y lo comprobado. Uno presentado no se recalcula; uno revisado
--     vuelve a borrador.
--   conta_impuesto_perceptores_poner(declaración, perceptores, motivo)
--     La [01] del 111 (cuántas personas cobraron nómina), a mano y con su
--     motivo, y vuelve a calcular (decisión de Julio, 20/10).
--
-- Las reglas, medidas en los 11 trimestres de Foodint de 2024 a 2026 (solo
-- leyendo, 20/10): ningún asiento con retención se queda sin modelo, y lo de
-- 2026 casa con lo presentado salvo la base del 111 del 1T (abajo).
--   · Un asiento cuenta si mueve la 4751, está validado (o anulado: su
--     contraasiento lo compensa) y es del periodo. Lo retenido es su haber
--     menos su debe en la 4751.
--   · La apertura no cuenta: es el asiento que mueve el grupo 1 (10, 11 o 12)
--     o lleva source_type 'opening'/'closing'. La serie no sirve para saberlo:
--     en Foodint las nóminas van en la 4 y la apertura en la 9.
--   · El pago a Hacienda no cuenta: lleva la 4751 al debe contra tesorería (57)
--     y no es un contraasiento.
--   · El modelo y la base, de la línea de la 4751 si los lleva: Sumied no
--     valida una retención sin su tipo, su base y su modelo (journal_entry_validar,
--     medido en staging el 20/10). El tipo «administradores» va en las
--     nóminas ([01]–[03]: rendimientos del trabajo); el resto del 111, en los
--     profesionales ([07]–[09]); el 123 (capital) no va en ninguno de los dos.
--   · Si la línea no los lleva (lo traído de Diez: todo lo de Foodint): 115 si
--     el asiento carga la 621 (arrendamientos), nómina si carga la 640, y
--     profesional si carga otro gasto o inmovilizado (6 o 2). Si no carga
--     ninguno, no se sabe: es un error y el modelo no se da por revisado. La
--     base: la 621 en el 115; la 640 en las nóminas, sin la 641
--     (indemnizaciones) ni otras (decisión de Julio, 20/10: así lo presentó la
--     gestoría el 2T y el 3T); el gasto en los profesionales.
--   · Los perceptores: en el 115 y los profesionales, cada proveedor distinto
--     (su subcuenta 40 o 41) con algo retenido. En las nóminas, a mano: el
--     diario de Foodint lleva una nómina por mes, sin trabajadores.
-- El 1T de 2026 de Foodint: la 640 suma 334,49 € más que la base presentada
-- (una segunda línea de la 640 en la nómina de febrero, junto a la 471). Sale
-- «no casa» y se explica; no bloquea nada (Julio, 20/10). Lo pregunta a la
-- gestoría.
--
-- Nada del camino del pedido: lo llaman solo las pantallas de Impuestos.

-- ── 1. El CHECK de lo comprobado (solo amplía) ─────────────────────────────
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified'));

-- ── 2. Lo que dice el diario de las retenciones de un periodo ──────────────
create or replace function public.conta_impuesto_retenciones_diario(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.company; v_desde date; v_hasta date; v_asientos jsonb; v_sumas jsonb; v_640 jsonb; v_621 numeric; v_4751 jsonb;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(p_year, p_period);

  with e as (
    select je.id, je.entry_date, je.series, je.number, je.concept, je.status, je.source_type, je.reverses_entry_id
      from public.journal_entry je
     where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
       and je.entry_date between v_desde and v_hasta
       and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                    where l.entry_id = je.id and ca.code like '4751%')
  ), x as (
    select e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id,
           coalesce(sum(l.credit - l.debit) filter (where ca.code like '4751%'), 0) as retenido,
           bool_or(ca.code ~ '^(10|11|12)') as mueve_grupo_1,
           bool_or(ca.code like '57%') as tesoreria,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '621%'), 0) as b621,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '640%'), 0) as b640,
           coalesce(sum(l.debit - l.credit) filter (where ca.code ~ '^(6|2)' and ca.code !~ '^(621|64)'), 0) as bgasto,
           max(l.withholding_model) filter (where ca.code like '4751%') as modelo_linea,
           max(wr.code) filter (where ca.code like '4751%') as tipo_linea,
           -- La base de la línea de la 4751 (Sumied la exige al validar): manda si la llevan todas.
           case when bool_and(l.withholding_base is not null) filter (where ca.code like '4751%')
                then sum(l.withholding_base) filter (where ca.code like '4751%') end as base_linea,
           string_agg(distinct ca.code, ' ') filter (where ca.code like '4751%') as cuentas_4751,
           -- El perceptor: el tercero de la línea de la 4751 o, si no, la subcuenta del proveedor (40 o 41).
           coalesce(max(l.party_id::text) filter (where ca.code like '4751%'),
                    max(ca.id::text) filter (where ca.code ~ '^(40|41)')) as perceptor,
           max(ca.code || ' · ' || coalesce(nullif(ca.plain_name, ''), ca.name)) filter (where ca.code ~ '^(40|41)') as perceptor_nombre
      from e
      join public.journal_line l on l.entry_id = e.id
      join public.company_account ca on ca.id = l.company_account_id
      left join public.withholding_rate wr on wr.id = l.withholding_rate_id
     group by e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id
  ), m0 as (
    select x.*,
           case when x.source_type in ('opening', 'closing') or x.mueve_grupo_1 then 'apertura'
                when x.retenido < 0 and x.reverses_entry_id is null and x.tesoreria then 'pago'
                when x.modelo_linea is not null and x.modelo_linea not in ('111', '115') then 'otro_modelo'
                when x.modelo_linea = '115' or (x.modelo_linea is null and x.b621 <> 0) then '115'
                when x.modelo_linea = '111' and x.tipo_linea = 'administradores' then '111_nomina'
                when x.modelo_linea = '111' then '111_profesional'
                when x.b640 <> 0 then '111_nomina'
                when x.bgasto <> 0 then '111_profesional'
                else 'sin_modelo' end as tipo
      from x
  ), m as (
    -- La base: la de la línea de la 4751 si la lleva (con el signo de lo retenido: un
    -- contraasiento resta); si no (lo traído de Diez), la de la regla de arriba.
    select m0.*,
           case when m0.base_linea is not null then sign(m0.retenido) * abs(m0.base_linea)
                else case m0.tipo when '115' then m0.b621 when '111_nomina' then m0.b640 when '111_profesional' then m0.bgasto end end as base
      from m0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'asiento', m.id, 'fecha', m.entry_date, 'serie', m.series, 'numero', m.number, 'concepto', m.concept, 'estado', m.status,
           'tipo', m.tipo, 'retenido', round(m.retenido, 2),
           'base', round(m.base, 2), 'tipo_retencion', m.tipo_linea,
           'perceptor', case when m.tipo in ('115', '111_profesional') then m.perceptor end,
           'perceptor_nombre', case when m.tipo in ('115', '111_profesional') then m.perceptor_nombre end,
           'cuentas_4751', m.cuentas_4751) order by m.entry_date, m.series, m.number), '[]'),
         jsonb_build_object(
           '115', jsonb_build_object('asientos', count(*) filter (where m.tipo = '115'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '115'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '115'), 0), 2)),
           '111_nomina', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_nomina'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_nomina'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_nomina'), 0), 2)),
           '111_profesional', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_profesional'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_profesional'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_profesional'), 0), 2)),
           'sin_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'sin_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'sin_modelo'), 0), 2)),
           'otro_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'otro_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'otro_modelo'), 0), 2)),
           'pagos', count(*) filter (where m.tipo = 'pago'),
           'aperturas', count(*) filter (where m.tipo = 'apertura'))
    into v_asientos, v_sumas
    from m;

  -- Los perceptores distintos con algo retenido (un contraasiento lo deja a cero).
  v_sumas := jsonb_set(jsonb_set(v_sumas, '{115,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '115' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s))),
    '{111_profesional,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_profesional' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s)));

  -- Cada línea de la 640 de las nóminas, para explicar una diferencia con lo presentado.
  select coalesce(jsonb_agg(jsonb_build_object('asiento', je.id, 'fecha', je.entry_date, 'importe', round(l.debit - l.credit, 2),
                                               'concepto', coalesce(l.concept, je.concept)) order by je.entry_date, l.position), '[]')
    into v_640
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.id in (select (a->>'asiento')::uuid from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_nomina')
     and ca.code like '640%';

  -- La 621 entera del periodo (también los alquileres sin retención) y el haber de cada subcuenta de la 4751.
  select coalesce(sum(l.debit - l.credit), 0) into v_621
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
     and je.entry_date between v_desde and v_hasta and ca.code like '621%';
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', q.code, 'nombre', q.nombre, 'haber', q.haber, 'debe', q.debe) order by q.code), '[]')
    into v_4751
    from (select ca.code, coalesce(nullif(ca.plain_name, ''), ca.name) as nombre, round(sum(l.credit), 2) as haber, round(sum(l.debit), 2) as debe
            from public.journal_line l join public.journal_entry je on je.id = l.entry_id
            join public.company_account ca on ca.id = l.company_account_id
           where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
             and je.entry_date between v_desde and v_hasta and ca.code like '4751%'
             and je.source_type not in ('opening', 'closing')
             and not exists (select 1 from public.journal_line g join public.company_account gc on gc.id = g.company_account_id
                              where g.entry_id = je.id and gc.code ~ '^(10|11|12)')
           group by 1, 2) q;

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'asientos', v_asientos, 'sumas', v_sumas,
                            'lineas_640', v_640, 'cuenta_621', round(v_621, 2), 'cuentas_4751', v_4751);
end $$;

comment on function public.conta_impuesto_retenciones_diario(uuid, int, text) is
  'I01g. Lo que dice el diario de las retenciones de un periodo: cada asiento con la 4751 (sin la apertura ni el pago a Hacienda) con su modelo (115, nómina, profesional o sin modelo), base, retenido y perceptor; las sumas; las líneas de la 640 de las nóminas; la 621 entera y el haber de cada subcuenta de la 4751. Solo lee.';

-- ── 3. El borrador del 111 o del 115 ───────────────────────────────────────
create or replace function public.conta_impuesto_retenciones_calcular(p_company uuid, p_year int, p_period text, p_form text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; o public.tax_obligation; r public.tax_return; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_d jsonb; s jsonb; v_man jsonb; v_box jsonb; v_kind text; v_total numeric; v_n int; v_det jsonb;
  v_ant public.tax_return; v_ant_y int; v_ant_p text; v_prop numeric; v_sin int; v_sin_ret numeric;
  v_nomina numeric; v_prof numeric; v_115 numeric; v_4751 numeric; v_otro numeric; v_falta_01 boolean;
  e text := 'FM999G999G990D00';
begin
  if p_form not in ('111', '115') then raise exception 'Solo se calculan aquí el 111 y el 115.' using errcode = '22023'; end if;
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, calcula sus impuestos.' using errcode = '42501';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = p_form and valid_to is null and active;
  if o.id is null then raise exception 'Esta empresa no presenta el % (no está en sus modelos).', p_form using errcode = 'P0002'; end if;
  if (o.cadence = 'quarterly' and p_period !~ '^[1-4]T$') or (o.cadence = 'monthly' and p_period !~ '^(0[1-9]|1[0-2])$') then
    raise exception 'Esta empresa presenta el % %, y «%» no es un periodo suyo.', p_form, case o.cadence when 'monthly' then 'cada mes' else 'cada trimestre' end, p_period using errcode = '22023';
  end if;

  select * into r from public.tax_return where company_id = p_company and form_code = p_form and fiscal_year = p_year and period = p_period and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'El % del % de % ya está «%»: no se recalcula.', p_form, p_period, p_year, public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo(p_form, o.cadence, p_year, p_period, 'ES-MD');
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date,
                                   due_date_direct_debit, due_provisional, alert_on, status, payment_mode, payment_treasury_account_id)
    values (c.account_id, p_company, o.id, p_form, p_year, o.cadence, p_period, v_plazo.presentacion, v_plazo.domiciliacion, v_plazo.provisional,
            case when o.payment_mode = 'direct_debit' then v_plazo.domiciliacion else v_plazo.presentacion end, 'draft',
            nullif(o.payment_mode, 'none'), case when o.payment_mode = 'direct_debit' then o.payment_treasury_account_id end)
    returning * into r;
  elsif r.status <> 'draft' then
    update public.tax_return set status = 'draft' where id = r.id returning * into r;
  end if;

  v_d := public.conta_impuesto_retenciones_diario(p_company, p_year, p_period);
  s := v_d->'sumas';
  v_nomina := (s#>>'{111_nomina,retenido}')::numeric;
  v_prof := (s#>>'{111_profesional,retenido}')::numeric;
  v_115 := (s#>>'{115,retenido}')::numeric;
  v_sin := (s#>>'{sin_modelo,asientos}')::int;
  v_sin_ret := (s#>>'{sin_modelo,retenido}')::numeric;

  -- Las líneas: cada asiento del modelo, con su foto.
  delete from public.tax_return_line where tax_return_id = r.id;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, boxes, frozen)
  select r.id, c.account_id, p_company,
         case when p_form = '115' then array['02', '03'] when a->>'tipo' = '111_nomina' then array['02', '03'] else array['08', '09'] end,
         a || jsonb_build_object('origen', 'diario')
    from jsonb_array_elements(v_d->'asientos') a
   where (p_form = '115' and a->>'tipo' = '115') or (p_form = '111' and a->>'tipo' in ('111_nomina', '111_profesional'));

  -- Las casillas calculadas (la [01] del 111 a mano se queda, y manda).
  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  select coalesce(jsonb_object_agg(box, value), '{}') into v_man from public.tax_return_box where tax_return_id = r.id and origin = 'manual' and value is not null;
  if p_form = '111' then
    v_total := v_nomina + v_prof;
    insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
    select r.id, c.account_id, p_company, k, round(val, 2), jsonb_build_object('de', como)
      from (values ('02', (s#>>'{111_nomina,base}')::numeric, 'la 640 de las nóminas del periodo, sin la 641', v_nomina <> 0 or (s#>>'{111_nomina,base}')::numeric <> 0),
                   ('03', v_nomina, 'lo retenido en la 4751 en las nóminas', v_nomina <> 0 or (s#>>'{111_nomina,base}')::numeric <> 0),
                   ('07', (s#>>'{111_profesional,perceptores}')::numeric, 'los proveedores distintos con retención', v_prof <> 0),
                   ('08', (s#>>'{111_profesional,base}')::numeric, 'el gasto de las facturas con retención', v_prof <> 0),
                   ('09', v_prof, 'lo retenido en la 4751 en esas facturas', v_prof <> 0),
                   ('28', v_total, '[03]+[09]', true),
                   ('30', v_total, '[28]−[29]', true)) t(k, val, como, va)
     where va and not v_man ? k
    on conflict (tax_return_id, box) do nothing;
  else
    v_total := v_115;
    insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
    select r.id, c.account_id, p_company, k, round(val, 2), jsonb_build_object('de', como)
      from (values ('01', (s#>>'{115,perceptores}')::numeric, 'los arrendadores distintos con retención'),
                   ('02', (s#>>'{115,base}')::numeric, 'la 621 de las facturas con retención'),
                   ('03', v_115, 'lo retenido en la 4751 en esas facturas'),
                   ('05', v_115, '[03]−[04]')) t(k, val, como)
     where not v_man ? k
    on conflict (tax_return_id, box) do nothing;
  end if;

  -- La [01] del 111: a mano (Julio, 20/10). Sin ella, con nóminas, no se da por revisado.
  v_falta_01 := p_form = '111' and (v_nomina <> 0 or (s#>>'{111_nomina,base}')::numeric <> 0) and not v_man ? '01';

  -- El resultado.
  v_kind := case when v_total > 0 then 'to_pay' when v_total = 0 and jsonb_array_length(v_d->'asientos') = 0 then 'no_activity'
                 when v_total = 0 then 'zero' else null end;
  update public.tax_return set result_kind = v_kind, amount = case when v_kind is not null then abs(v_total) end,
         calculated_at = now(), updated_at = now() where id = r.id;

  -- Lo comprobado (se rehace entero).
  delete from public.tax_return_check where tax_return_id = r.id;

  -- a) Lo retenido de este modelo y de los demás suma lo que la 4751 tiene del periodo.
  v_4751 := v_nomina + v_prof + v_115 + v_sin_ret;
  v_otro := case when p_form = '111' then v_115 else v_nomina + v_prof end;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'ledger_4751', case when v_total < 0 then 'error' else 'ok' end,
          case when v_total < 0
               then 'Lo retenido en el periodo sale negativo (' || translate(to_char(v_total, e), ',.', '.,') || ' €): mira los contraasientos de la 4751 en el mayor.'
               else 'Lo retenido sale del diario: ' || translate(to_char(v_total, e), ',.', '.,') || ' € en la 4751' ||
                    case when v_otro <> 0 then ' (otros ' || translate(to_char(v_otro, e), ',.', '.,') || ' € van en el ' || case when p_form = '111' then '115' else '111' end || ')' else '' end ||
                    ', sin la apertura ni los pagos a Hacienda (' || (s->>'pagos') || ').' end,
          jsonb_build_object('retenido', v_total, 'cuenta_4751', v_4751, 'otro_modelo', v_otro, 'pagos', (s->>'pagos')::int, 'aperturas', (s->>'aperturas')::int));

  -- b) Asientos con retención que Sumied no sabe a qué modelo van.
  select coalesce(jsonb_agg(a), '[]') into v_det from jsonb_array_elements(v_d->'asientos') a where a->>'tipo' = 'sin_modelo';
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'withholding_unclassified', case when v_sin > 0 then 'error' else 'ok' end,
          case when v_sin = 0 then 'Cada asiento con retención del periodo tiene su modelo.'
               when v_sin = 1 then '1 asiento mueve la 4751 sin gasto ni nómina (' || translate(to_char(v_sin_ret, e), ',.', '.,') || ' € retenidos): Sumied no sabe si va en el 111 o en el 115. Ábrelo en el diario.'
               else v_sin || ' asientos mueven la 4751 sin gasto ni nómina (' || translate(to_char(v_sin_ret, e), ',.', '.,') || ' € retenidos): Sumied no sabe si van en el 111 o en el 115. Ábrelos en el diario.' end,
          jsonb_build_object('asientos', v_det));

  -- c) Los perceptores de las nóminas (solo el 111).
  if p_form = '111' then
    v_ant_y := case when p_period in ('1T', '01') then p_year - 1 else p_year end;
    v_ant_p := case when p_period ~ '^[1-4]T$' then case when p_period = '1T' then '4T' else (left(p_period, 1)::int - 1) || 'T' end
                    else case when p_period = '01' then '12' else lpad((p_period::int - 1)::text, 2, '0') end end;
    select * into v_ant from public.tax_return where company_id = p_company and form_code = '111' and fiscal_year = v_ant_y and period = v_ant_p and sequence = 1;
    select value into v_prop from public.tax_return_box where tax_return_id = v_ant.id and box = '01';
    insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
    values (r.id, c.account_id, p_company, 'payees_111', case when v_falta_01 then 'error' else 'ok' end,
            case when v_falta_01
                 then 'Falta cuántas personas cobraron nómina en el periodo ([01]): el diario lleva las nóminas sin trabajadores. Escríbelo con su motivo' ||
                      case when v_prop is not null then ' (en el ' || v_ant_p || '/' || v_ant_y || ' fueron ' || v_prop::int || ').' else '.' end
                 when v_man ? '01' then 'Las personas que cobraron nómina las escribió una persona: ' || (v_man->>'01')::numeric::int || '.'
                 else 'En el periodo no hay nóminas con retención.' end,
            jsonb_build_object('a_mano', v_man ? '01', 'perceptores', v_man->'01', 'propuesta', v_prop, 'periodo_anterior', v_ant_p || '/' || v_ant_y));
  end if;

  -- d) Recibidas por correo sin apuntar: pueden llevar retención.
  select count(*) into v_n from public.supplier_invoice si
   where si.account_id = c.account_id and si.company_id = p_company and si.arrival_channel = 'correo'
     and si.status not in ('anulada', 'descartada') and si.journal_entry_id is null and si.invoice_date <= (v_d->>'hasta')::date;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'mail_invoices_missing', case when v_n > 0 then 'warning' else 'ok' end,
          case when v_n = 0 then 'No falta ninguna factura recibida por correo.'
               when v_n = 1 then '1 factura que llegó por correo está sin apuntar: si lleva retención, no entra hasta que se valide.'
               else v_n || ' facturas que llegaron por correo están sin apuntar: si llevan retención, no entran hasta que se validen.' end,
          jsonb_build_object('facturas', v_n));

  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, c.account_id, p_company, auth.uid(), v_quien, 'calculation',
          v_quien || ' calculó el ' || p_form || ' del ' || p_period || '/' || p_year || ' desde el diario: ' || translate(to_char(v_total, e), ',.', '.,') || ' €.',
          jsonb_build_object('sumas', s));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'modelo', p_form, 'desde', v_d->'desde', 'hasta', v_d->'hasta',
                            'asientos', (select count(*) from public.tax_return_line where tax_return_id = r.id),
                            'resultado', v_kind, 'importe', case when v_kind is not null then abs(v_total) end,
                            'casillas', coalesce(v_box, '{}'), 'falta_perceptores', v_falta_01, 'propuesta_perceptores', v_prop, 'quien', v_quien);
end $$;

comment on function public.conta_impuesto_retenciones_calcular(uuid, int, text, text) is
  'I01g. Crea o recalcula el borrador del 111 o del 115 del periodo desde el diario (conta_impuesto_retenciones_diario): casillas, líneas y lo comprobado. La [01] del 111 va a mano (conta_impuesto_perceptores_poner): sin ella, con nóminas, queda un error y no se da por revisado. Uno presentado no se recalcula; uno revisado vuelve a borrador.';

-- ── 4. La [01] del 111, a mano ──────────────────────────────────────────────
create or replace function public.conta_impuesto_perceptores_poner(p_return uuid, p_perceptores int, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; v_quien text := public.conta_impuesto_quien(); v_calc jsonb;
begin
  select * into r from public.tax_return where id = p_return and form_code = '111' for update;
  if r.id is null then raise exception 'Ese 111 no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, escribe casillas de sus impuestos.' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'Este 111 ya está «%»: sus casillas no se cambian.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_perceptores is null or p_perceptores < 1 then
    raise exception 'Escribe cuántas personas cobraron nómina en el periodo (1 o más).' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Para escribir los perceptores hace falta decir de dónde sale el número.' using errcode = '22023'; end if;
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason, source)
  values (r.id, r.account_id, r.company_id, '01', p_perceptores, 'manual',
          btrim(p_motivo) || ' (' || v_quien || ', ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ')',
          jsonb_build_object('de', 'a mano', 'quien', v_quien))
  on conflict (tax_return_id, box) do update
    set value = excluded.value, value_text = null, origin = 'manual', manual_reason = excluded.manual_reason, source = excluded.source;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_quien, 'note',
          v_quien || ' escribió a mano la [01] (' || p_perceptores || ' perceptores): ' || btrim(p_motivo) || '.', jsonb_build_object('casillas', jsonb_build_object('01', p_perceptores)));
  v_calc := public.conta_impuesto_retenciones_calcular(r.company_id, r.fiscal_year, r.period, '111');
  return jsonb_build_object('ok', true, 'calculo', v_calc,
    'mensaje', 'Escrita la [01]: ' || p_perceptores || case when p_perceptores = 1 then ' persona' else ' personas' end || ' con nómina. Vuelto a calcular el 111: ' ||
               translate(to_char((v_calc->>'importe')::numeric, 'FM999G999G990D00'), ',.', '.,') || ' € a ingresar.');
end $$;

comment on function public.conta_impuesto_perceptores_poner(uuid, int, text) is
  'I01g. Escribe a mano la [01] del 111 (cuántas personas cobraron nómina), con su motivo y quién, y vuelve a calcular el 111.';
