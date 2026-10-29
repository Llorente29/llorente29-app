-- supabase/migrations/20261028T1950_s02_modelo_190.sql
-- cambia: public.tax_return_check · prueba: supabase/staging/sql/20261028_s02_modelo_190_prueba.sql
--
-- S02 · EL 190, CALCULADO POR SUMIED DESDE LOS 111 DEL AÑO (encargo de Julio,
-- 28/10: «el 190, del 111 por perceptor y clave»), con el molde del 111.
--
--   conta_impuesto_190_calcular(empresa, ejercicio)                    [NUEVA]
--     Crea (o recalcula) el borrador del 190 del año (periodo «0A»):
--       · recorre los periodos del 111 del año con conta_impuesto_retenciones_diario
--         (la misma regla que el 111: lo que cuenta y lo que no);
--       · profesionales (lo que el 111 lleva en [07]–[09]): un perceptor por
--         proveedor, clave G del anexo; subclave 03 si lo retenido es el 7 %
--         de la base (tipo reducido de inicio de actividad, art. 95.1 RIRPF),
--         si no 01 (tipo general). El NIF, el nombre y la provincia, de su
--         ficha de proveedor (la provincia, las dos primeras cifras de su
--         código postal, que son las del anexo);
--       · indemnizaciones exentas (la 641): clave L, subclave 05 del anexo;
--       · nóminas ([01]–[03] del 111, y también las que no llevan retención,
--         que el 111 no ve): un perceptor por trabajador, clave A,
--         con lo que dicen sus nóminas (payroll_cost: bruto, IRPF y sus
--         cotizaciones, que son los «gastos deducibles» del anexo) si la
--         cuenta tiene una sola empresa. Lo que el diario retiene en nóminas
--         y no está en ninguna nómina por trabajador queda en una línea «sin
--         trabajador»: es un error, porque el 190 lleva un registro por
--         persona, y se dice con los asientos que lo causan;
--       · casillas: [01] número de percepciones, [02] importe total de las
--         percepciones y [03] total de las retenciones (los tres totales del
--         registro de declarante del anexo, posiciones 136-175);
--       · lo comprobado: que sume los 111 del año, trimestre a trimestre
--         ('sum_111_vs_190'); NIF que falta o no vale; perceptor sin
--         provincia; nóminas sin trabajador; asientos con retención sin
--         modelo.
--     El 190 es informativo: no se paga. Queda con resultado «cero». Uno
--     presentado no se recalcula; uno revisado vuelve a borrador.
--   conta_impuesto_anual(empresa, ejercicio)                  [NUEVA, solo lee]
--     La tira del año (390, 190, 180, 347, 349: los que presenta la empresa),
--     con la misma forma que conta_impuesto_trimestre, para la pantalla.
--   conta_impuesto_informativa_fuera(empresa, modelo, ejercicio, csv, fecha,
--     justificante)                                                    [NUEVA]
--     «Ya lo presenté fuera» de un modelo anual informativo: con su CSV, queda
--     presentado fuera y con candado (ya no se recalcula). El lector de
--     justificantes aún no lee los anuales: queda apuntado con su CSV, y se dice.
--   conta_impuesto_190_fichero(declaración, usuario)   [NUEVA, solo servicio]
--     Los datos del fichero (lo llama conta-hacienda, «fichero_190»). Con un
--     error sin resolver, no da datos.
--   tax_return_check: tres claves más ('payees_190_nif', 'payees_190_province',
--     'payroll_190'). El CHECK solo amplía.
--
-- Nada del camino del pedido: lo llaman solo las pantallas de Impuestos.

-- ── 1. El CHECK de lo comprobado (solo amplía) ─────────────────────────────
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified', 'base_200',
                       'payees_190_nif', 'payees_190_province', 'payroll_190'));

-- ── 2. El borrador del 190 ────────────────────────────────────────────────
create or replace function public.conta_impuesto_190_calcular(p_company uuid, p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; o public.tax_obligation; r public.tax_return; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_cad111 text; v_pers text[]; v_per text; v_d jsonb; v_asientos jsonb := '[]'; v_sin_modelo jsonb := '[]';
  v_lineas jsonb; v_trim jsonb := '[]'; v_n int; v_base numeric; v_ret numeric; v_det jsonb;
  v_nom_base numeric := 0; v_nom_ret numeric := 0; v_sin_ret_base numeric := 0; v_sin_ret_asientos jsonb := '[]'; v_l05 numeric := 0; v_l05_asientos jsonb := '[]'; v_det_a jsonb; v_det_l jsonb; v_pay_base numeric := 0; v_pay_ret numeric := 0; v_una_empresa boolean;
  v_dif text; v_falta_111 text; v_box jsonb;
  e text := 'FM999G999G990D00';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, calcula sus impuestos.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2025 or p_year > extract(year from now())::int then
    raise exception 'El 190 de «%» no se puede calcular: el diseño del fichero es del 2025 en adelante, y el año tiene que haber empezado.', p_year using errcode = '22023';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = '190' and valid_to is null and active;
  if o.id is null then raise exception 'Esta empresa no presenta el 190 (no está en sus modelos).' using errcode = 'P0002'; end if;

  select * into r from public.tax_return where company_id = p_company and form_code = '190' and fiscal_year = p_year and period = '0A' and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'El 190 de % ya está «%»: no se recalcula.', p_year, public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo_si_hay('190', o.cadence, p_year, '0A');
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date,
                                   due_date_direct_debit, due_provisional, alert_on, status)
    values (c.account_id, p_company, o.id, '190', p_year, o.cadence, '0A', v_plazo.presentacion, null, v_plazo.provisional,
            v_plazo.presentacion, 'draft')
    returning * into r;
  elsif r.status <> 'draft' then
    update public.tax_return set status = 'draft' where id = r.id returning * into r;
  end if;

  -- Los periodos del 111 del año: los de su obligación (trimestres o meses).
  select coalesce(public.conta_impuesto_cadencia_de(p_company, '111'), 'quarterly') into v_cad111;
  v_pers := case when v_cad111 = 'monthly' then array['01','02','03','04','05','06','07','08','09','10','11','12'] else array['1T','2T','3T','4T'] end;
  foreach v_per in array v_pers loop
    v_d := public.conta_impuesto_retenciones_diario(p_company, p_year, v_per);
    v_asientos := v_asientos || coalesce((select jsonb_agg(a || jsonb_build_object('periodo', v_per)) from jsonb_array_elements(v_d->'asientos') a
                                           where a->>'tipo' in ('111_nomina', '111_profesional')), '[]');
    v_sin_modelo := v_sin_modelo || coalesce((select jsonb_agg(a) from jsonb_array_elements(v_d->'asientos') a where a->>'tipo' = 'sin_modelo'), '[]');
    v_trim := v_trim || jsonb_build_array(jsonb_build_object('periodo', v_per,
      'base', (v_d#>>'{sumas,111_nomina,base}')::numeric + (v_d#>>'{sumas,111_profesional,base}')::numeric,
      'retenido', (v_d#>>'{sumas,111_nomina,retenido}')::numeric + (v_d#>>'{sumas,111_profesional,retenido}')::numeric));
  end loop;

  -- ── Los perceptores ──
  -- Profesionales: por perceptor (el tercero de la 4751 o la subcuenta del proveedor), con su ficha.
  with a as (
    select x->>'perceptor' as perceptor, max(x->>'perceptor_nombre') as cuenta_nombre,
           sum((x->>'base')::numeric) as base, sum((x->>'retenido')::numeric) as retenido,
           jsonb_agg(jsonb_build_object('asiento', x->>'asiento', 'fecha', x->>'fecha', 'serie', x->>'serie', 'numero', x->>'numero',
                                        'retenido', (x->>'retenido')::numeric, 'periodo', x->>'periodo') order by x->>'fecha') as asientos
      from jsonb_array_elements(v_asientos) x where x->>'tipo' = '111_profesional'
     group by 1
  ), f as (
    select a.*, s.id as proveedor, coalesce(nullif(s.tax_id, ''), nullif(p.tax_id, '')) as nif,
           coalesce(nullif(s.legal_name, ''), nullif(s.name, ''), nullif(p.name, ''), a.cuenta_nombre) as nombre,
           case when coalesce(nullif(upper(s.country_code), ''), 'ES') = 'ES' and regexp_replace(coalesce(s.fiscal_postal_code, ''), '\D', '', 'g') ~ '^\d{5}$'
                then left(regexp_replace(s.fiscal_postal_code, '\D', '', 'g'), 2) end as provincia
      from a
      left join public.party p on p.account_id = c.account_id and p.id::text = a.perceptor
      -- Un enlace por subcuenta (el más antiguo, si hubiera dos): una línea por perceptor.
      left join lateral (select l.entity_id from public.company_account_link l
                          where l.account_id = c.account_id and l.company_id = p_company and l.company_account_id::text = a.perceptor
                            and l.entity = 'supplier' and l.role = 'principal' order by l.created_at, l.id limit 1) l on true
      left join lateral (select pr.supplier_id from public.party_role pr where pr.account_id = c.account_id and pr.party_id = p.id and pr.supplier_id is not null limit 1) pr on true
      left join public.supplier s on s.account_id = c.account_id and s.id::text = coalesce(l.entity_id, pr.supplier_id::text)
     where abs(a.retenido) >= 0.005 or abs(a.base) >= 0.005
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'origen', 'diario', 'clave', 'G',
           'subclave', case when f.base > 0 and abs(f.retenido / f.base - 0.07) < 0.0005 then '03' else '01' end,
           'perceptor', f.perceptor, 'proveedor', f.proveedor, 'nif', f.nif, 'nombre', f.nombre, 'provincia', f.provincia,
           'nif_valido', f.nif is not null and public._verifactu_nif_es_valido(f.nif),
           'integra', round(f.base, 2), 'retenciones', round(f.retenido, 2), 'asientos', f.asientos) order by f.nombre), '[]')
    into v_lineas
    from f;

  -- Nóminas: lo del diario, y lo de las nóminas por trabajador del año (si la cuenta tiene una sola empresa).
  select coalesce(sum((x->>'base')::numeric), 0), coalesce(sum((x->>'retenido')::numeric), 0) into v_nom_base, v_nom_ret
    from jsonb_array_elements(v_asientos) x where x->>'tipo' = '111_nomina';
  -- Y las nóminas SIN retención (mueven la 640 y no la 4751): también van en el 190, con
  -- retenciones cero. Sin la regularización (la que salda la 640 contra el grupo 1), sin
  -- apertura ni cierre. Un asiento anulado y su contraasiento se compensan.
  -- (S02, 29/10: lo enseñó el 190 de 2023 de Foodint, una nómina de 546,00 € sin retención.)
  select coalesce(sum(q.n640), 0),
         coalesce(jsonb_agg(jsonb_build_object('asiento', q.id, 'fecha', q.entry_date, 'serie', q.series, 'numero', q.number,
                                               'retenido', 0, 'base', round(q.n640, 2), 'sin_retencion', true) order by q.entry_date), '[]')
    into v_sin_ret_base, v_sin_ret_asientos
    from (select je.id, je.entry_date, je.series, je.number, sum(l.debit - l.credit) filter (where ca.code like '640%') as n640
            from public.journal_entry je
            join public.journal_line l on l.entry_id = je.id
            join public.company_account ca on ca.id = l.company_account_id
           where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
             and je.entry_date between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
             and coalesce(je.source_type, '') not in ('opening', 'closing')
           group by je.id, je.entry_date, je.series, je.number
          having bool_or(ca.code like '640%') and not bool_or(ca.code like '4751%') and not bool_or(ca.code ~ '^(10|11|12)')) q
   where abs(q.n640) >= 0.005;
  v_nom_base := v_nom_base + v_sin_ret_base;
  select count(*) = 1 into v_una_empresa from public.company where account_id = c.account_id;
  if v_una_empresa then
    with n as (
      select pc.employee_id, sum(pc.gross) as bruto, sum(pc.irpf) as irpf, sum(coalesce(pc.employee_ss, 0)) as cotizaciones, count(*) as nominas
        from public.payroll_cost pc
       where pc.account_id = c.account_id and pc.period_year = p_year and pc.irpf is not null and pc.gross is not null
       group by 1
    )
    select coalesce(v_lineas || coalesce(jsonb_agg(jsonb_build_object(
             'origen', 'nominas', 'clave', 'A', 'subclave', null, 'perceptor', em.id, 'nif', nullif(em.dni, ''), 'nombre', em.name,
             'provincia', null, 'nif_valido', nullif(em.dni, '') is not null and public._verifactu_nif_es_valido(em.dni),
             'anio_nacimiento', extract(year from em.birth_date)::int, 'nominas', n.nominas,
             -- Los «gastos deducibles» del 190 (art. 19.2 LIRPF): las cotizaciones a cargo del trabajador.
             'gastos', round(n.cotizaciones, 2),
             'integra', round(n.bruto, 2), 'retenciones', round(n.irpf, 2)) order by em.name), '[]'), v_lineas),
           coalesce(sum(n.bruto), 0), coalesce(sum(n.irpf), 0)
      into v_lineas, v_pay_base, v_pay_ret
      from n join public.employees em on em.id = n.employee_id and em.account_id = c.account_id;
  end if;
  if abs(v_nom_ret - v_pay_ret) >= 0.005 or abs(v_nom_base - v_pay_base) >= 0.005 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'origen', 'diario', 'clave', 'A', 'subclave', null, 'perceptor', null, 'nif', null, 'nombre', null, 'provincia', null, 'nif_valido', false,
      'sin_trabajador', true, 'integra', round(v_nom_base - v_pay_base, 2), 'retenciones', round(v_nom_ret - v_pay_ret, 2),
      'asientos', coalesce((select jsonb_agg(jsonb_build_object('asiento', x->>'asiento', 'fecha', x->>'fecha', 'serie', x->>'serie', 'numero', x->>'numero',
                                                                 'retenido', (x->>'retenido')::numeric, 'periodo', x->>'periodo') order by x->>'fecha')
                              from jsonb_array_elements(v_asientos) x where x->>'tipo' = '111_nomina'), '[]') || v_sin_ret_asientos));
  end if;

  -- Las indemnizaciones exentas (la 641): clave L, subclave 05 del anexo («indemnizaciones por
  -- despido o cese del trabajador que estén exentas», art. 7.e LIRPF). Sin retención. Del diario
  -- no se sabe de quién son: van «sin trabajador» hasta que entren las nóminas de cada persona.
  -- (S02, 29/10: la L.05 de los 190 presentados de Foodint es la 641 al céntimo: 717,68 en
  -- 2024; 897,78 + 870,43 en 2025.)
  select coalesce(sum(q.n641), 0),
         coalesce(jsonb_agg(jsonb_build_object('asiento', q.id, 'fecha', q.entry_date, 'serie', q.series, 'numero', q.number,
                                               'retenido', 0, 'base', round(q.n641, 2)) order by q.entry_date), '[]')
    into v_l05, v_l05_asientos
    from (select je.id, je.entry_date, je.series, je.number, sum(l.debit - l.credit) filter (where ca.code like '641%') as n641
            from public.journal_entry je
            join public.journal_line l on l.entry_id = je.id
            join public.company_account ca on ca.id = l.company_account_id
           where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
             and je.entry_date between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
             and coalesce(je.source_type, '') not in ('opening', 'closing')
           group by je.id, je.entry_date, je.series, je.number
          having bool_or(ca.code like '641%') and not bool_or(ca.code ~ '^(10|11|12)')) q
   where abs(q.n641) >= 0.005;
  if abs(v_l05) >= 0.005 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'origen', 'diario', 'clave', 'L', 'subclave', '05', 'perceptor', null, 'nif', null, 'nombre', null, 'provincia', null, 'nif_valido', false,
      'sin_trabajador', true, 'integra', round(v_l05, 2), 'retenciones', 0, 'asientos', v_l05_asientos));
  end if;

  -- Las líneas: cada perceptor y clave, con su foto.
  delete from public.tax_return_line where tax_return_id = r.id;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, boxes, frozen)
  select r.id, c.account_id, p_company, array['01', '02', '03'], l from jsonb_array_elements(v_lineas) l;

  -- Las casillas: los totales del registro de declarante.
  select count(*) filter (where not coalesce((l->>'sin_trabajador')::boolean, false)),
         coalesce(sum((l->>'integra')::numeric), 0), coalesce(sum((l->>'retenciones')::numeric), 0)
    into v_n, v_base, v_ret from jsonb_array_elements(v_lineas) l;
  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
  values (r.id, c.account_id, p_company, '01', v_n, jsonb_build_object('de', 'los perceptores con su clave (un registro de perceptor cada uno)')),
         (r.id, c.account_id, p_company, '02', round(v_base, 2), jsonb_build_object('de', 'la suma de lo pagado a esos perceptores en el año')),
         (r.id, c.account_id, p_company, '03', round(v_ret, 2), jsonb_build_object('de', 'la suma de lo retenido en la 4751, de los 111 del año'))
  on conflict (tax_return_id, box) do nothing;

  -- Informativo: no se paga.
  update public.tax_return set result_kind = case when jsonb_array_length(v_lineas) = 0 then 'no_activity' else 'zero' end, amount = 0,
         calculated_at = now(), updated_at = now() where id = r.id;

  -- ── Lo comprobado (se rehace entero) ──
  delete from public.tax_return_check where tax_return_id = r.id;

  -- a) Que sume los 111 del año, periodo a periodo: lo que el 111 declaró ([02]+[08] y [03]+[09]) contra el diario.
  with t as (
    select x->>'periodo' as periodo, (x->>'base')::numeric as base, (x->>'retenido')::numeric as retenido,
           d.id as decl, d.status,
           (select coalesce(sum(b.value), 0) from public.tax_return_box b where b.tax_return_id = d.id and b.box in ('02', '08')) as base111,
           (select coalesce(sum(b.value), 0) from public.tax_return_box b where b.tax_return_id = d.id and b.box in ('03', '09')) as ret111
      from jsonb_array_elements(v_trim) x
      left join public.tax_return d on d.company_id = p_company and d.form_code = '111' and d.fiscal_year = p_year and d.period = x->>'periodo' and d.sequence = 1
  )
  select string_agg(t.periodo || ': ' || concat_ws(' y ',
                      case when abs(t.ret111 - t.retenido) >= 0.005 then 'lo retenido, ' || translate(to_char(t.ret111, e), ',.', '.,') || ' € en el 111 y ' ||
                                                                          translate(to_char(t.retenido, e), ',.', '.,') || ' € en el diario' end,
                      case when abs(t.base111 - t.base) >= 0.005 then 'la base, ' || translate(to_char(t.base111, e), ',.', '.,') || ' € en el 111 y ' ||
                                                                       translate(to_char(t.base, e), ',.', '.,') || ' € en el diario' end), '; ' order by t.periodo)
           filter (where t.decl is not null and (abs(t.ret111 - t.retenido) >= 0.005 or abs(t.base111 - t.base) >= 0.005)),
         string_agg(t.periodo, ', ' order by t.periodo) filter (where t.decl is null and (t.retenido <> 0 or t.base <> 0)),
         jsonb_agg(jsonb_build_object('periodo', t.periodo, 'declaracion', t.decl, 'estado', t.status, 'base_111', t.base111, 'retenido_111', t.ret111,
                                      'base_diario', t.base, 'retenido_diario', t.retenido) order by t.periodo),
         coalesce(sum(t.ret111), 0)
    into v_dif, v_falta_111, v_det, v_base
    from t;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'sum_111_vs_190', case when v_dif is null and v_falta_111 is null then 'ok' else 'warning' end,
          case when v_dif is null and v_falta_111 is null
               then 'El 190 suma lo mismo que los 111 del año: ' || translate(to_char(v_ret, e), ',.', '.,') || ' € retenidos.'
               else concat_ws(' ',
                      case when v_dif is not null then 'No casa con los 111 del año: ' || v_dif || '.' end,
                      case when v_falta_111 is not null then 'Hay retenciones en el diario y no hay 111 en Sumied de: ' || v_falta_111 || '.' end) end,
          jsonb_build_object('periodos', v_det, 'retenido_190', round(v_ret, 2), 'retenido_111', round(v_base, 2)));
  -- (El 190 lleva lo que dice el diario; lo que el 111 presentó distinto se explica aquí y se da por bueno con su motivo.)

  -- b) NIF que falta o no vale.
  select coalesce(jsonb_agg(l), '[]'), count(*) into v_det, v_n from jsonb_array_elements(v_lineas) l
   where not coalesce((l->>'sin_trabajador')::boolean, false) and not coalesce((l->>'nif_valido')::boolean, false);
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'payees_190_nif', case when v_n > 0 then 'error' else 'ok' end,
          case when v_n = 0 then 'Cada perceptor tiene un NIF que vale.'
               when v_n = 1 then '1 perceptor sin NIF o con un NIF que no vale: ' || coalesce((select l->>'nombre' from jsonb_array_elements(v_det) l limit 1), 'uno sin ficha de proveedor') || '. Corrígelo en su ficha.'
               else v_n || ' perceptores sin NIF o con un NIF que no vale. Corrígelo en su ficha.' end,
          jsonb_build_object('perceptores', v_det));

  -- c) Perceptor sin provincia (el anexo la pide: la de su domicilio).
  select coalesce(jsonb_agg(l), '[]'), count(*) into v_det, v_n from jsonb_array_elements(v_lineas) l
   where not coalesce((l->>'sin_trabajador')::boolean, false) and coalesce(l->>'provincia', '') = '';
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'payees_190_province', case when v_n > 0 then 'error' else 'ok' end,
          case when v_n = 0 then 'Cada perceptor tiene su provincia.'
               else concat_ws(' ',
                 case (select count(*) from jsonb_array_elements(v_det) l where l->>'clave' = 'G')
                   when 0 then null
                   when 1 then '1 proveedor sin provincia (sin código postal español en su ficha): ' || coalesce((select l->>'nombre' from jsonb_array_elements(v_det) l where l->>'clave' = 'G' limit 1), 'uno sin ficha de proveedor') || '.'
                   else (select count(*) from jsonb_array_elements(v_det) l where l->>'clave' = 'G') || ' proveedores sin provincia (sin código postal español en su ficha).' end,
                 case (select count(*) from jsonb_array_elements(v_det) l where l->>'clave' = 'A')
                   when 0 then null
                   when 1 then '1 trabajador sin provincia: Sumied no guarda el domicilio de los trabajadores, y el 190 lo pide.'
                   else (select count(*) from jsonb_array_elements(v_det) l where l->>'clave' = 'A') || ' trabajadores sin provincia: Sumied no guarda el domicilio de los trabajadores, y el 190 lo pide.' end) end,
          jsonb_build_object('perceptores', v_det));

  -- d) Nóminas sin trabajador.
  select coalesce(jsonb_agg(l), '[]') into v_det from jsonb_array_elements(v_lineas) l where coalesce((l->>'sin_trabajador')::boolean, false);
  select l into v_det_a from jsonb_array_elements(v_det) l where l->>'clave' = 'A' limit 1;
  select l into v_det_l from jsonb_array_elements(v_det) l where l->>'clave' = 'L' limit 1;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'payroll_190', case when jsonb_array_length(v_det) > 0 then 'error' else 'ok' end,
          case when jsonb_array_length(v_det) = 0 then 'Las nóminas del año van por trabajador.'
               else concat_ws(' ',
                 case when v_det_a is not null then
                    'Las nóminas del diario pagan ' || translate(to_char(v_nom_base, e), ',.', '.,') || ' € (' ||
                    translate(to_char(v_nom_ret, e), ',.', '.,') || ' € retenidos) y las nóminas por trabajador de Sumied, ' ||
                    translate(to_char(v_pay_base, e), ',.', '.,') || ' € (' || translate(to_char(v_pay_ret, e), ',.', '.,') ||
                    ' €): el 190 lleva una línea por persona, y quedan ' ||
                    translate(to_char(v_nom_base - v_pay_base, e), ',.', '.,') || ' € pagados y ' ||
                    translate(to_char(v_nom_ret - v_pay_ret, e), ',.', '.,') || ' € retenidos sin trabajador (' ||
                    jsonb_array_length(v_det_a->'asientos') || case when jsonb_array_length(v_det_a->'asientos') = 1 then ' asiento' else ' asientos' end || ' de nómina).' end,
                 case when v_det_l is not null then
                    'Las indemnizaciones exentas (la 641, clave L.05) suman ' || translate(to_char(v_l05, e), ',.', '.,') ||
                    ' € y tampoco se sabe de quién son (' || jsonb_array_length(v_det_l->'asientos') ||
                    case when jsonb_array_length(v_det_l->'asientos') = 1 then ' asiento).' else ' asientos).' end end,
                 case when not v_una_empresa then 'La cuenta tiene más de una empresa: sus nóminas no se pueden repartir.' end) end,
          jsonb_build_object('diario', jsonb_build_object('base', v_nom_base, 'retenido', v_nom_ret, 'sin_retencion', v_sin_ret_base, 'indemnizaciones_l05', v_l05),
                             'nominas', jsonb_build_object('base', v_pay_base, 'retenido', v_pay_ret), 'lineas', v_det));

  -- e) Asientos con retención sin modelo en el año.
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'withholding_unclassified', case when jsonb_array_length(v_sin_modelo) > 0 then 'error' else 'ok' end,
          case when jsonb_array_length(v_sin_modelo) = 0 then 'Cada asiento con retención del año tiene su modelo.'
               when jsonb_array_length(v_sin_modelo) = 1 then '1 asiento del año mueve la 4751 sin gasto ni nómina: Sumied no sabe si va en el 190. Ábrelo en el diario.'
               else jsonb_array_length(v_sin_modelo) || ' asientos del año mueven la 4751 sin gasto ni nómina: Sumied no sabe si van en el 190. Ábrelos en el diario.' end,
          jsonb_build_object('asientos', v_sin_modelo));

  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, c.account_id, p_company, auth.uid(), v_quien, 'calculation',
          v_quien || ' calculó el 190 de ' || p_year || ' desde los 111 del año: ' || translate(to_char(v_ret, e), ',.', '.,') || ' € retenidos.',
          jsonb_build_object('periodos', v_trim));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'modelo', '190', 'ejercicio', p_year,
                            'perceptores', (select count(*) from public.tax_return_line where tax_return_id = r.id),
                            'casillas', coalesce(v_box, '{}'),
                            'errores', (select count(*) from public.tax_return_check where tax_return_id = r.id and result = 'error'),
                            'avisos', (select count(*) from public.tax_return_check where tax_return_id = r.id and result = 'warning'),
                            'quien', v_quien);
end $$;

comment on function public.conta_impuesto_190_calcular(uuid, int) is
  'S02. Crea o recalcula el borrador del 190 del año desde los periodos del 111 (conta_impuesto_retenciones_diario): un perceptor por proveedor (clave G) y por trabajador (clave A, de sus nóminas), las casillas [01]-[03] del registro de declarante y lo comprobado (suma de los 111, NIF, provincia, nóminas sin trabajador). Informativo: resultado cero. Uno presentado no se recalcula.';

-- ── 3. La tira del año ────────────────────────────────────────────────────
create or replace function public.conta_impuesto_anual(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_modelos jsonb; v_desde date;
begin
  if not exists (select 1 from public.company where id = p_company) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > extract(year from now())::int + 1 then
    raise exception 'El ejercicio «%» no es un año que se pueda mirar.', p_year using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'modelo', o.form_code, 'nombre', f.name, 'cadencia', o.cadence, 'periodo', '0A', 'no_toca', false,
           'presentacion', pl.presentacion, 'domiciliacion', null,
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
         ) order by case o.form_code when '390' then 1 when '190' then 2 when '180' then 3 when '347' then 4 when '349' then 5 else 6 end, o.form_code), '[]')
    into v_modelos
    from public.tax_obligation o
    join public.tax_form f on f.code = o.form_code
    left join lateral public.conta_impuesto_plazo_si_hay(o.form_code, o.cadence, p_year, '0A') pl on true
    left join public.tax_return r on r.company_id = p_company and r.form_code = o.form_code and r.fiscal_year = p_year and r.period = '0A' and r.sequence = 1
   where o.company_id = p_company and o.valid_to is null and o.active and o.cadence = 'annual';

  select min(valid_from) into v_desde from public.tax_obligation where company_id = p_company and valid_to is null and active;

  return jsonb_build_object(
    'empresa', (select jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(c.trade_name, ''), c.legal_name), 'razon_social', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = p_company),
    'ejercicio', p_year, 'trimestre', '0A', 'desde', v_desde,
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'modelos', v_modelos,
    'cartera', jsonb_build_object('filas', '[]'::jsonb, 'pendiente_al_empezar', null, 'esperada_110', null, 'borrador', null, 'desfasada', false));
end $$;

comment on function public.conta_impuesto_anual(uuid, int) is
  'S02. La tira del año: los modelos anuales que presenta la empresa (390, 190, 180, 347, 349) con su plazo y su declaración, con la forma de conta_impuesto_trimestre. Solo lee.';

-- ── 4. «Ya lo presenté fuera» de un modelo anual informativo ───────────────
create or replace function public.conta_impuesto_informativa_fuera(p_company uuid, p_form text, p_year int, p_csv text, p_fecha date, p_justificante text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; o public.tax_obligation; r public.tax_return; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_csv text := upper(regexp_replace(coalesce(p_csv, ''), '\s', '', 'g'));
begin
  if p_form not in ('190', '180', '347', '349', '390') then
    raise exception 'Aquí se apuntan los modelos anuales (390, 190, 180, 347 y 349), no el %.', p_form using errcode = '22023';
  end if;
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, apunta lo presentado.' using errcode = '42501';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = p_form and valid_to is null and active;
  if o.id is null or o.cadence <> 'annual' then raise exception 'Esta empresa no presenta el % (no está en sus modelos anuales).', p_form using errcode = 'P0002'; end if;
  if v_csv !~ '^[A-Z0-9]{16}$' then raise exception 'El CSV no tiene la forma de los de Hacienda (16 letras y números).' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de presentación.' using errcode = '22023'; end if;
  if p_fecha > (now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha de presentación es futura: no puede estar presentado.' using errcode = '22023'; end if;
  if p_fecha <= make_date(p_year, 12, 31) then raise exception 'El % de % se presenta después de acabar el año: el % no casa.', p_form, p_year, to_char(p_fecha, 'DD/MM/YYYY') using errcode = '22023'; end if;

  select * into r from public.tax_return where company_id = p_company and form_code = p_form and fiscal_year = p_year and period = '0A' and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed') then
    return jsonb_build_object('ok', true, 'declaracion', r.id, 'mensaje', 'El ' || p_form || ' de ' || p_year || ' ya estaba apuntado como presentado (' || public.conta_impuesto_estado_texto(r.status) || ').');
  end if;
  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo_si_hay(p_form, 'annual', p_year, '0A');
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date, due_provisional, alert_on, status)
    values (c.account_id, p_company, o.id, p_form, p_year, 'annual', '0A', v_plazo.presentacion, v_plazo.provisional, v_plazo.presentacion, 'draft')
    returning * into r;
  end if;
  update public.tax_return
     set status = 'filed', result_kind = coalesce(result_kind, 'zero'), amount = coalesce(amount, 0),
         filed_at = (p_fecha::timestamp at time zone 'Europe/Madrid') + interval '12 hours', filed_by = auth.uid(), filed_by_name = v_quien, filed_via = 'outside',
         aeat_csv = v_csv, aeat_receipt_number = nullif(btrim(coalesce(p_justificante, '')), ''), outside_csv_pasted_at = now(), receipt_source = 'upload',
         updated_at = now()
   where id = r.id returning * into r;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, c.account_id, p_company, auth.uid(), v_quien, 'note',
          v_quien || ' apuntó el ' || p_form || ' de ' || p_year || ' como presentado fuera el ' || to_char(p_fecha, 'DD/MM/YYYY') || ' (CSV …' || right(v_csv, 4) || ').',
          jsonb_build_object('fecha', p_fecha, 'justificante', r.aeat_receipt_number));
  return jsonb_build_object('ok', true, 'declaracion', r.id,
    'mensaje', 'Apuntado: el ' || p_form || ' de ' || p_year || ' presentado fuera el ' || to_char(p_fecha, 'DD/MM/YYYY') ||
               ', CSV terminado en ' || right(v_csv, 4) || '. Ya no se recalcula. El PDF del justificante de los anuales aún no se lee en Sumied: queda apuntado con su CSV.');
end $$;

comment on function public.conta_impuesto_informativa_fuera(uuid, text, int, text, date, text) is
  'S02. «Ya lo presenté fuera» de un modelo anual informativo (390, 190, 180, 347, 349): con su CSV y su fecha queda presentado fuera, con candado (ya no se recalcula). Dice qué ha apuntado.';

-- ── 5. Los datos del fichero (solo el servicio: conta-hacienda) ────────────
create or replace function public.conta_impuesto_190_fichero(p_return uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; c public.company; v_n int; v_quien text;
begin
  select * into r from public.tax_return where id = p_return and form_code = '190';
  if r.id is null then raise exception 'Ese 190 no está.' using errcode = 'P0002'; end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'error' and check_key <> 'file_layout';
  if v_n > 0 then
    raise exception 'Este 190 tiene % que resolver en «Lo comprobado»: sin eso no se prepara el fichero.',
      case when v_n = 1 then 'una cosa' else v_n || ' cosas' end using errcode = '22023';
  end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'warning' and accepted_at is null;
  if v_n > 0 then
    raise exception 'Antes, mira % de «Lo comprobado» y dalo por bueno si lo está: con un aviso sin mirar no se prepara el fichero.',
      case when v_n = 1 then 'el aviso' else 'los ' || v_n || ' avisos' end using errcode = '22023';
  end if;
  if r.result_kind is null then raise exception 'Este 190 no está calculado todavía: no se prepara el fichero.' using errcode = '22023'; end if;
  select * into c from public.company where id = r.company_id;
  v_quien := coalesce(public.conta_impuesto_nombre_de(p_user), c.legal_name);
  return jsonb_build_object(
    'ejercicio', r.fiscal_year, 'nif', c.tax_id, 'nombre', c.legal_name,
    'contacto', jsonb_build_object('telefono', coalesce(c.phone, ''), 'nombre', v_quien, 'correo', coalesce(c.email, '')),
    -- El número identificativo: 190, el año y la secuencia de la declaración (13 cifras).
    'numero', '190' || r.fiscal_year || lpad(r.sequence::text, 6, '0'),
    'perceptores', (select coalesce(jsonb_agg(jsonb_build_object(
                       'nif', l.frozen->>'nif', 'nombre', l.frozen->>'nombre', 'provincia', l.frozen->>'provincia',
                       'clave', l.frozen->>'clave', 'subclave', l.frozen->>'subclave',
                       'integra', (l.frozen->>'integra')::numeric, 'retenciones', (l.frozen->>'retenciones')::numeric,
                       'anio_nacimiento', (l.frozen->>'anio_nacimiento')::int, 'gastos', (l.frozen->>'gastos')::numeric) order by l.frozen->>'clave', l.frozen->>'nombre'), '[]')
                      from public.tax_return_line l where l.tax_return_id = r.id and not coalesce((l.frozen->>'sin_trabajador')::boolean, false)));
end $$;

comment on function public.conta_impuesto_190_fichero(uuid, uuid) is
  'S02. Los datos del fichero del 190 (conta-hacienda, «fichero_190»): declarante, persona de contacto y un perceptor por línea. Con un error sin resolver en lo comprobado, no da datos. Solo el servicio.';

revoke all on function public.conta_impuesto_190_calcular(uuid, int) from public, anon;
revoke all on function public.conta_impuesto_anual(uuid, int) from public, anon;
revoke all on function public.conta_impuesto_informativa_fuera(uuid, text, int, text, date, text) from public, anon;
revoke all on function public.conta_impuesto_190_fichero(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_impuesto_190_calcular(uuid, int) to authenticated, service_role;
grant execute on function public.conta_impuesto_anual(uuid, int) to authenticated, service_role;
grant execute on function public.conta_impuesto_informativa_fuera(uuid, text, int, text, date, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_190_fichero(uuid, uuid) to service_role;
