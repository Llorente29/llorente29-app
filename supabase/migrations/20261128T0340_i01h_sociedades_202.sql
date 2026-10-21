-- cambia: public.tax_return_check · prueba: supabase/staging/sql/20261128_i01h_sociedades_202_prueba.sql
-- cambia: public.conta_impuesto_calendario · prueba: supabase/staging/sql/20261128_i01h_sociedades_202_prueba.sql
--
-- I01h · El 202 calculado por Sumied, con el molde del 303, el 111 y el 115
-- (encargo de Julio, 21/10).
--
--   corporate_tax_filing                                  [NUEVA] los datos
--     de cada 200 presentado: cuándo, la base imponible, la cuota que sirve de
--     base al 202 y el resultado (a ingresar, a devolver o cero). El lector de
--     justificantes no lee el 200: se escribe a mano, con su motivo y quién.
--     No es una tax_return: una presentada exige su CSV, y aquí se escribe lo
--     que dice el justificante de la gestoría sin él.
--   conta_impuesto_200_poner(empresa, ejercicio, datos, motivo)        [NUEVA]
--     Guarda (o corrige) el 200 de un ejercicio y vuelve a calcular los 202
--     que salen de él y no están presentados.
--   conta_impuesto_202_calcular(empresa, ejercicio, periodo)           [NUEVA]
--     El 202 de un periodo (1P, 2P o 3P), modalidad del artículo 40.2: la
--     [01] es la cuota del último 200 cuyo plazo ya había vencido y la [03],
--     su 18 %. Si sale 0, no hay que presentarlo: queda «No hace falta», con
--     el porqué. Uno presentado no se recalcula; uno revisado vuelve a borrador.
--   conta_impuesto_sociedades(empresa)                     [NUEVA, solo lee]
--     La pestaña «Impuesto de sociedades»: los 200 guardados, lo que queda por
--     cobrar de los que salieron a devolver y los 202 con su base.
--   tax_return_check: una clave más ('base_200'). El CHECK solo amplía.
--   conta_impuesto_calendario                    [CAMBIA, misma firma] lo de
--     la 0250 byte a byte (medido en producción el 21/10: md5 del cuerpo
--     caccacb3…), y una condición más: lo que no hacía falta presentar y
--     venció en el último mes se enseña con su porqué. Sin ella, el 2P de 2026
--     de un 202 a cero desaparecía del calendario sin decir nada.
--
-- Las reglas (Ley 27/2014, art. 40.2, y lo medido en Foodint el 21/10, solo
-- leyendo; los datos de los 200 de Foodint NO van aquí, los escribe Julio):
--   · La base del pago fraccionado es la cuota íntegra del último periodo
--     cuyo plazo de declaración estuviera vencido el primer día del plazo del
--     pago, menos deducciones, bonificaciones, retenciones e ingresos a
--     cuenta. Con el año natural, el 200 de un ejercicio vence el 25 de julio
--     del siguiente: el 1P (abril) sale del 200 de dos años antes y el 2P
--     (octubre) y el 3P (diciembre), del 200 del año anterior.
--   · El pago es el 18 % de esa base (art. 40.2, tercer párrafo).
--   · Con la base a cero no hay pago y no hay que presentarlo (lo confirma
--     la gestoría de Foodint para el 2P de 2026).
--   · Lo que salió a devolver se cobra cuando llega al banco: un asiento
--     validado posterior al 200 que abona la 4709 contra tesorería (57).
-- La modalidad del artículo 40.3 (sobre la base del periodo) no se calcula:
-- Sumied la dice y no da resultado.
--
-- Nada del camino del pedido: lo llaman solo las pantallas de Impuestos.

-- ── 1. El CHECK de lo comprobado (solo amplía) ─────────────────────────────
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified', 'base_200'));

-- ── 2. Los datos de cada 200 presentado ─────────────────────────────────────
create table if not exists public.corporate_tax_filing (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  fiscal_year      int not null check (fiscal_year between 2000 and 2100),
  filed_on         date not null,
  taxable_base     numeric(14, 2) not null,
  quota            numeric(14, 2) not null check (quota >= 0),
  result_kind      text not null check (result_kind in ('to_pay', 'to_refund', 'zero')),
  result_amount    numeric(14, 2) not null check (result_amount >= 0),
  origin           text not null default 'manual' check (origin in ('manual', 'justificante')),
  manual_reason    text,
  written_by       uuid,
  written_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, fiscal_year),
  check ((result_kind = 'zero') = (result_amount = 0)),
  check (origin <> 'manual' or (manual_reason is not null and btrim(manual_reason) <> ''))
);
comment on table public.corporate_tax_filing is
  'I01h. Los datos de cada Impuesto de sociedades (200) presentado: la fecha, la base imponible, la cuota que sirve de base al 202 (art. 40.2: cuota íntegra menos deducciones, bonificaciones, retenciones e ingresos a cuenta) y el resultado. Se escribe con conta_impuesto_200_poner.';
comment on column public.corporate_tax_filing.quota is
  'La base del pago fraccionado del artículo 40.2 que sale de este 200 (la [01] del 202).';

alter table public.corporate_tax_filing enable row level security;
drop policy if exists corporate_tax_filing_select on public.corporate_tax_filing;
create policy corporate_tax_filing_select on public.corporate_tax_filing for select to authenticated
  using (public.conta_impuesto_puede_ver(company_id));
revoke all on public.corporate_tax_filing from anon;
grant select on public.corporate_tax_filing to authenticated;

-- ── 3. El 202 de un periodo ─────────────────────────────────────────────────
create or replace function public.conta_impuesto_202_calcular(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; o public.tax_obligation; r public.tax_return; f public.corporate_tax_filing; v_plazo record;
  v_quien text := public.conta_impuesto_quien(); v_base_y int; v01 numeric; v03 numeric; v_kind text; v_motivo text;
  v_box jsonb; e text := 'FM999G999G990D00';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, calcula sus impuestos.' using errcode = '42501';
  end if;
  if p_period !~ '^[1-3]P$' then raise exception 'El 202 va en tres pagos: 1P, 2P o 3P, y «%» no es uno.', p_period using errcode = '22023'; end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = '202' and valid_to is null and active;
  if o.id is null then raise exception 'Esta empresa no presenta el 202 (no está en sus modelos).' using errcode = 'P0002'; end if;

  select * into r from public.tax_return where company_id = p_company and form_code = '202' and fiscal_year = p_year and period = p_period and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed', 'not_required') then
    raise exception 'El 202 del % de % ya está «%»: no se recalcula.', p_period, p_year, public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;

  -- El 200 del que sale: el último con el plazo vencido al empezar el del pago.
  v_base_y := case when p_period = '1P' then p_year - 2 else p_year - 1 end;
  select * into f from public.corporate_tax_filing where company_id = p_company and fiscal_year = v_base_y;
  if f.id is not null then
    v01 := f.quota;
    v03 := round(v01 * 0.18, 2);
    v_kind := case when v03 > 0 then 'to_pay' else 'zero' end;
    v_motivo := case when v_kind = 'zero' then 'el impuesto de ' || v_base_y || ' salió a cero' end;
  end if;

  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo('202', o.cadence, p_year, p_period, 'ES-MD');
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date,
                                   due_date_direct_debit, due_provisional, alert_on, status, not_required_reason, payment_mode, payment_treasury_account_id)
    values (c.account_id, p_company, o.id, '202', p_year, o.cadence, p_period, v_plazo.presentacion, v_plazo.domiciliacion, v_plazo.provisional,
            case when o.payment_mode = 'direct_debit' then v_plazo.domiciliacion else v_plazo.presentacion end,
            case when v_kind = 'zero' then 'not_required' else 'draft' end, v_motivo,
            nullif(o.payment_mode, 'none'), case when o.payment_mode = 'direct_debit' then o.payment_treasury_account_id end)
    returning * into r;
  elsif v_kind = 'zero' and r.status <> 'not_required' then
    update public.tax_return set status = 'not_required', not_required_reason = v_motivo where id = r.id returning * into r;
  elsif v_kind = 'zero' then
    update public.tax_return set not_required_reason = v_motivo where id = r.id returning * into r;
  else
    -- Hay que presentarlo (o aún no se sabe): de «No hace falta» se vuelve por «Pendiente».
    if r.status = 'not_required' then update public.tax_return set status = 'pending' where id = r.id returning * into r; end if;
    if r.status <> 'draft' then update public.tax_return set status = 'draft' where id = r.id returning * into r; end if;
  end if;

  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  if f.id is not null then
    insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
    values (r.id, c.account_id, p_company, '01', v01, jsonb_build_object('de', 'la cuota del 200 de ' || v_base_y, 'ejercicio', v_base_y)),
           (r.id, c.account_id, p_company, '03', v03, jsonb_build_object('de', '18 % de la [01] (art. 40.2)'))
    on conflict (tax_return_id, box) do nothing;
  end if;
  update public.tax_return set result_kind = v_kind, amount = case when v_kind is not null then v03 end,
         calculated_at = now(), updated_at = now() where id = r.id;

  delete from public.tax_return_check where tax_return_id = r.id;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'base_200', case when f.id is null then 'error' else 'ok' end,
          case when f.id is null
               then 'Falta el Impuesto de sociedades de ' || v_base_y || ': escribe en «Impuesto de sociedades» su cuota, que es la base de este pago.'
               else 'La base es la cuota del Impuesto de sociedades de ' || v_base_y || ' (presentado el ' || to_char(f.filed_on, 'DD/MM/YYYY') || '): ' ||
                    translate(to_char(v01, e), ',.', '.,') || ' € × 18 % = ' || translate(to_char(v03, e), ',.', '.,') || ' €.' ||
                    case when v_kind = 'zero' then ' No hay que presentarlo.' else '' end end,
          jsonb_build_object('ejercicio_base', v_base_y, 'declaracion_200', f.id, 'cuota', v01, 'pago', v03));

  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, c.account_id, p_company, auth.uid(), v_quien, 'calculation',
          v_quien || ' calculó el 202 del ' || p_period || '/' || p_year ||
          case when f.id is null then ': falta el 200 de ' || v_base_y || '.'
               else ' desde el 200 de ' || v_base_y || ': ' || translate(to_char(v03, e), ',.', '.,') || ' €.' end,
          jsonb_build_object('ejercicio_base', v_base_y, 'cuota', v01, 'pago', v03));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'modelo', '202', 'ejercicio', p_year, 'periodo', p_period,
                            'ejercicio_base', v_base_y, 'falta_200', f.id is null, 'cuota', v01,
                            'resultado', v_kind, 'importe', v03, 'no_hace_falta', v_kind = 'zero',
                            'casillas', coalesce(v_box, '{}'), 'quien', v_quien);
end $$;

comment on function public.conta_impuesto_202_calcular(uuid, int, text) is
  'I01h. El 202 de un periodo (1P, 2P o 3P), modalidad del art. 40.2: la [01] es la cuota del 200 de dos años antes (1P) o del anterior (2P y 3P) y la [03], su 18 %. Con 0, queda «No hace falta» con el porqué. Sin ese 200, un error en lo comprobado y sin resultado. Uno presentado no se recalcula.';

-- ── 4. Escribir un 200 (a mano, con su motivo) ──────────────────────────────
create or replace function public.conta_impuesto_200_poner(p_company uuid, p_year int, p_datos jsonb, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; f public.corporate_tax_filing; v_quien text := public.conta_impuesto_quien();
  v_presentado date; v_base numeric; v_cuota numeric; v_kind text; v_importe numeric;
  v_hechos jsonb := '[]'; v_calc jsonb; v_p record; v_ya public.tax_return; v_frase text; e text := 'FM999G999G990D00';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, escribe sus impuestos.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Escribe el ejercicio del 200.' using errcode = '22023'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Para escribir un 200 a mano hace falta decir de dónde salen los datos.' using errcode = '22023'; end if;
  begin
    v_presentado := (p_datos->>'presentado')::date;
    v_base := (p_datos->>'base_imponible')::numeric;
    v_cuota := (p_datos->>'cuota')::numeric;
    v_importe := coalesce((p_datos->>'importe')::numeric, 0);
  exception when others then
    raise exception 'Los datos del 200 no se entienden: la fecha va como AAAA-MM-DD y las cifras, con punto decimal.' using errcode = '22023';
  end;
  v_kind := p_datos->>'resultado';
  if v_presentado is null or v_base is null or v_cuota is null or v_kind is null then
    raise exception 'Del 200 hacen falta la fecha en que se presentó, la base imponible, la cuota y el resultado.' using errcode = '22023';
  end if;
  if v_presentado <= make_date(p_year, 12, 31) then raise exception 'El 200 de % se presenta en %: la fecha % no puede ser.', p_year, p_year + 1, to_char(v_presentado, 'DD/MM/YYYY') using errcode = '22023'; end if;
  if v_presentado > (now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha en que se presentó no puede ser de después de hoy.' using errcode = '22023'; end if;
  if v_cuota < 0 then raise exception 'La cuota (la base del 202) no puede ser negativa: si salió negativa, es 0.' using errcode = '22023'; end if;
  if v_kind not in ('to_pay', 'to_refund', 'zero') then raise exception 'El resultado es «a ingresar», «a devolver» o «cero».' using errcode = '22023'; end if;
  if v_importe < 0 then raise exception 'El importe del resultado va sin signo: «a devolver» ya dice que es a tu favor.' using errcode = '22023'; end if;
  if (v_kind = 'zero') <> (v_importe = 0) then
    raise exception '%', case when v_kind = 'zero' then 'Si el resultado es cero, el importe es 0.' else 'A ingresar o a devolver lleva su importe.' end using errcode = '22023';
  end if;

  insert into public.corporate_tax_filing (account_id, company_id, fiscal_year, filed_on, taxable_base, quota, result_kind, result_amount,
                                           origin, manual_reason, written_by, written_by_name)
  values (c.account_id, p_company, p_year, v_presentado, round(v_base, 2), round(v_cuota, 2), v_kind, round(v_importe, 2), 'manual',
          btrim(p_motivo) || ' (' || v_quien || ', ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ')', auth.uid(), v_quien)
  on conflict (company_id, fiscal_year) do update
    set filed_on = excluded.filed_on, taxable_base = excluded.taxable_base, quota = excluded.quota, result_kind = excluded.result_kind,
        result_amount = excluded.result_amount, origin = 'manual', manual_reason = excluded.manual_reason,
        written_by = excluded.written_by, written_by_name = excluded.written_by_name, updated_at = now()
  returning * into f;

  -- Los 202 que salen de este 200 (2P y 3P del año siguiente, 1P del otro), si no están
  -- presentados. Los que ya están en Sumied se vuelven a calcular; uno nuevo, solo de este
  -- año en adelante y con su plazo sabido: un 200 viejo no inventa pagos que ya se hicieron fuera.
  if exists (select 1 from public.tax_obligation where company_id = p_company and form_code = '202' and valid_to is null and active) then
    for v_p in select * from (values (p_year + 1, '2P'), (p_year + 1, '3P'), (p_year + 2, '1P')) t(y, p) loop
      select * into v_ya from public.tax_return where company_id = p_company and form_code = '202' and fiscal_year = v_p.y and period = v_p.p and sequence = 1;
      if v_ya.id is null and (v_p.y < extract(year from now() at time zone 'Europe/Madrid')::int
                              or not exists (select 1 from public.conta_impuesto_plazo_si_hay('202', 'instalments_202', v_p.y, v_p.p))) then
        continue;
      elsif v_ya.id is null or v_ya.status in ('pending', 'draft', 'reviewed', 'not_required') then
        v_calc := public.conta_impuesto_202_calcular(p_company, v_p.y, v_p.p);
        v_hechos := v_hechos || jsonb_build_array(jsonb_build_object('periodo', v_p.p, 'ejercicio', v_p.y, 'importe', v_calc->'importe', 'no_hace_falta', v_calc->'no_hace_falta'));
      else
        v_hechos := v_hechos || jsonb_build_array(jsonb_build_object('periodo', v_p.p, 'ejercicio', v_p.y, 'presentado', true));
      end if;
    end loop;
  end if;

  select string_agg(case when (h->>'presentado')::boolean then 'el ' || (h->>'periodo') || '/' || (h->>'ejercicio') || ' ya estaba presentado'
                         when (h->>'no_hace_falta')::boolean then 'el ' || (h->>'periodo') || '/' || (h->>'ejercicio') || ', no hay que presentarlo'
                         else 'el ' || (h->>'periodo') || '/' || (h->>'ejercicio') || ', ' || translate(to_char((h->>'importe')::numeric, e), ',.', '.,') || ' € a ingresar' end, '; ' order by n)
    into v_frase from jsonb_array_elements(v_hechos) with ordinality t(h, n);
  return jsonb_build_object('ok', true, 'declaracion_200', f.id, 'pagos_202', v_hechos,
    'mensaje', 'Guardado el Impuesto de sociedades de ' || p_year || ': cuota ' || translate(to_char(f.quota, e), ',.', '.,') || ' €, ' ||
               case f.result_kind when 'to_pay' then translate(to_char(f.result_amount, e), ',.', '.,') || ' € a ingresar'
                                  when 'to_refund' then translate(to_char(f.result_amount, e), ',.', '.,') || ' € a devolver'
                                  else 'resultado cero' end || '.' ||
               case when v_frase is not null then ' Vueltos a calcular los 202 que salen de él: ' || v_frase || '.' else '' end);
end $$;

comment on function public.conta_impuesto_200_poner(uuid, int, jsonb, text) is
  'I01h. Escribe a mano (con su motivo y quién) los datos del 200 de un ejercicio: {presentado, base_imponible, cuota, resultado (to_pay/to_refund/zero), importe}. Vuelve a calcular el 2P y el 3P del año siguiente y el 1P del otro, si no están presentados.';

-- ── 5. Lo que enseña la pestaña «Impuesto de sociedades» ────────────────────
create or replace function public.conta_impuesto_sociedades(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.company; v_200 jsonb; v_202 jsonb; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;

  -- Los 200, y lo que salió a devolver: cobrado cuando un asiento posterior abona la 4709 contra tesorería.
  select coalesce(jsonb_agg(jsonb_build_object(
           'ejercicio', f.fiscal_year, 'presentado', f.filed_on, 'base_imponible', f.taxable_base, 'cuota', f.quota,
           'resultado', f.result_kind, 'importe', f.result_amount, 'origen', f.origin, 'motivo', f.manual_reason, 'quien', f.written_by_name,
           'devolucion', case when f.result_kind = 'to_refund' then jsonb_build_object(
               'importe', f.result_amount, 'cobrado', coalesce(k.cobrado, 0), 'cobrado_el', k.ultimo, 'asiento', k.asiento,
               'pendiente', greatest(f.result_amount - coalesce(k.cobrado, 0), 0)) end)
           order by f.fiscal_year desc), '[]')
    into v_200
    from public.corporate_tax_filing f
    left join lateral (
      select sum(l.credit - l.debit) as cobrado, max(je.entry_date) as ultimo, (array_agg(je.id order by je.entry_date desc))[1] as asiento
        from public.journal_entry je
        join public.journal_line l on l.entry_id = je.id
        join public.company_account ca on ca.id = l.company_account_id
       where f.result_kind = 'to_refund' and je.account_id = c.account_id and je.company_id = p_company and je.status = 'validado'
         and je.entry_date >= f.filed_on and ca.code like '4709%' and l.credit > 0
         and exists (select 1 from public.journal_line l2 join public.company_account c2 on c2.id = l2.company_account_id
                      where l2.entry_id = je.id and c2.code like '57%' and l2.debit > 0)
    ) k on true
   where f.company_id = p_company;

  -- Los 202: los de los años con alguno en Sumied y el de este año, con el 200 del que salen.
  with anos as (
    select distinct fiscal_year y from public.tax_return where company_id = p_company and form_code = '202'
    union select extract(year from v_hoy)::int
  ), p as (
    select a.y, x.p, case when x.p = '1P' then a.y - 2 else a.y - 1 end as base_y
      from anos a cross join (values ('1P'), ('2P'), ('3P')) x(p)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ejercicio', p.y, 'periodo', p.p, 'ejercicio_base', p.base_y,
           'plazo', coalesce(r.due_date, (select presentacion from public.conta_impuesto_plazo_si_hay('202', 'instalments_202', p.y, p.p))),
           'cuota_200', f.quota, 'esperado', case when f.id is not null then round(f.quota * 0.18, 2) end,
           'declaracion', case when r.id is not null then jsonb_build_object(
               'id', r.id, 'estado', r.status, 'estado_texto', public.conta_impuesto_estado_texto(r.status), 'resultado', r.result_kind,
               'importe', r.amount, 'no_hace_falta', r.not_required_reason,
               'c01', (select value from public.tax_return_box where tax_return_id = r.id and box = '01'),
               'c03', (select value from public.tax_return_box where tax_return_id = r.id and box = '03'),
               'origen', (select origin from public.tax_return_box where tax_return_id = r.id and box = '03')) end)
           order by p.y desc, p.p), '[]')
    into v_202
    from p
    left join public.tax_return r on r.company_id = p_company and r.form_code = '202' and r.fiscal_year = p.y and r.period = p.p and r.sequence = 1
    left join public.corporate_tax_filing f on f.company_id = p_company and f.fiscal_year = p.base_y;

  return jsonb_build_object('empresa', p_company, 'hoy', v_hoy, 'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
                            'declaraciones_200', v_200, 'pagos_202', v_202);
end $$;

comment on function public.conta_impuesto_sociedades(uuid) is
  'I01h. Solo lee. La pestaña «Impuesto de sociedades»: los 200 guardados (con lo que queda por cobrar de los que salieron a devolver: cobrado cuando un asiento validado posterior abona la 4709 contra tesorería) y los 202 de los años que tienen alguno, con el 200 del que salen y lo que daría.';

-- ── 5b. El calendario: lo que no hacía falta, con su porqué ────────────────
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


-- ── 6. Quién las llama: con sesión, nunca con la clave anónima (como el 303) ─
-- Las tres de la 0330 (I01g) se quedaron con el permiso por defecto, y
-- conta_impuesto_retenciones_calcular deja pasar a quien no tiene sesión
-- (auth.uid() nulo, para los procesos de la base): con la clave anónima se
-- podía calcular un borrador del 111 o el 115 de cualquier empresa. Se cierra
-- aquí igual que el 303 (0140): solo amplía lo que ya se hacía en el 303.
revoke all on function public.conta_impuesto_202_calcular(uuid, int, text) from public, anon;
revoke all on function public.conta_impuesto_200_poner(uuid, int, jsonb, text) from public, anon;
revoke all on function public.conta_impuesto_sociedades(uuid) from public, anon;
revoke all on function public.conta_impuesto_retenciones_calcular(uuid, int, text, text) from public, anon;
revoke all on function public.conta_impuesto_retenciones_diario(uuid, int, text) from public, anon;
revoke all on function public.conta_impuesto_perceptores_poner(uuid, int, text) from public, anon;
grant execute on function public.conta_impuesto_202_calcular(uuid, int, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_200_poner(uuid, int, jsonb, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_sociedades(uuid) to authenticated, service_role;
grant execute on function public.conta_impuesto_retenciones_calcular(uuid, int, text, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_retenciones_diario(uuid, int, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_perceptores_poner(uuid, int, text) to authenticated, service_role;
