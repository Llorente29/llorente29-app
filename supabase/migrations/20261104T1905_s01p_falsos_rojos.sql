-- supabase/migrations/20261104T1905_s01p_falsos_rojos.sql
--
-- S01p · 5 · Los falsos rojos de «Cerrar el mes» (Julio, respuesta S01p·5,
-- 04/11 19:35). La 1720 pasada sobre octubre de Foodint, punto por punto contra
-- los datos (regla 31, medido en producción en solo lectura el 04/11):
--
--   1. Alquileres: los 5 tienen su asiento del 01/08 y del 01/09 (traídos de
--      Diez) y ninguno del 01/10; la 621 de octubre es 0. La del 01/11 dice
--      «arrendamiento del mes»: es la de noviembre. El rojo es de verdad; el
--      bloque dice ahora qué mes falta y que la última es de un mes posterior.
--   2. La cuota del 03/10 (674,36 €) se pagó el 05/10 y se casó a mano el 29/10
--      contra la 520 entera (asiento 3294). Sus intereses se apuntaron DOS veces
--      contra la 52000001: el 3291 (05/10) y el 3313 (30/10, «corrige el 3294»),
--      115,68 € cada uno (S01p·6, medido por la sesión principal). El bloque
--      mira ahora cada cuota por lo que hay en el libro: pagada, y sus intereses
--      una vez; dos o más, «intereses apuntados dos veces».
--   3. Plataformas: 36 de los 38 son de Uber y 2 de Just Eat. La semana del
--      28/09 al 04/10 va a octubre porque el motor da cada semana al mes en que
--      acaba (la del 26/10 al 01/11 va a noviembre): nada se pide dos veces. Es
--      de verdad; el bloque enseña ahora de qué canal es cada cosa.
--   4. Justificantes: los 87 son casados a mano contra una cuenta. Decisiones
--      de Julio (S01p·6): el cobro de plataforma, solo casado con su liquidación,
--      uno a uno (nunca por importe); lo de la 520/170, con su contrato; el pago
--      de la nómina (465), con la nómina del mes anterior que tiene su PDF (si
--      no lo tiene: «falta el PDF de la nómina de MM/AAAA»); la 5201, «falta el
--      contrato de la póliza». El resto sale por tipo.
--   5. «Sin medir» decía 0 con dos dentro: ahora cuenta también las partes sin
--      medir de un bloque en rojo (Revolut en Bancos, las amortizaciones, Laboral
--      sin el mes), y salen en «por_justificar».
--   6. Laboral: el 642 de octubre (2.529,70 €) es del asiento manual del 19/10,
--      el reconocimiento de deuda y aplazamiento de la TGSS (con 669 y 678): no es
--      la Seguridad Social de octubre. El devengo sale solo de los asientos de la
--      nómina (los que llevan 640); ese 642 se enseña aparte.
--
-- Cambia cinco funciones con la misma firma (con respaldo) y añade un ayudante.
-- No toca filas. Nada en el camino del pedido.
--
-- cambia: public.conta_cierre_bloque_plataformas · prueba: supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql
-- cambia: public.conta_cierre_bloque_justificantes · prueba: supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql
-- cambia: public.conta_cierre_bloque_laboral · prueba: supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql
-- cambia: public.conta_cierre_bloque_repite · prueba: supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql
-- cambia: public.conta_cierre_mes · prueba: supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql

select public._respaldar_funcion('public.conta_cierre_bloque_plataformas(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._respaldar_funcion('public.conta_cierre_bloque_justificantes(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._respaldar_funcion('public.conta_cierre_bloque_laboral(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._respaldar_funcion('public.conta_cierre_bloque_repite(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._respaldar_funcion('public.conta_cierre_mes(uuid,date)', '20261104T1905_s01p_falsos_rojos');

-- Un bloque tiene algo sin medir: todo él, o una parte (Bancos sin saldo del banco,
-- las amortizaciones de «Lo que se repite», Laboral sin el mes).
create or replace function public._s01p_sin_medir(b jsonb)
returns boolean language sql immutable as $$
  select b->>'estado' = 'sin_medir'
      or (b->>'codigo' = 'bancos' and coalesce((b->'cifras'->>'sin_medir')::int, 0) > 0)
      or (b->>'codigo' = 'repite' and b->'cifras'->>'amortizaciones' = 'sin_medir')
      or (b->>'codigo' = 'laboral' and b->>'estado' <> 'no_aplica' and coalesce((b->'cifras'->>'laboral_personas')::int, 0) = 0)
$$;

create or replace function public.conta_cierre_bloque_plataformas(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._s01p_cuenta_de(p_company); j jsonb; r jsonb; v_estado text; v_ej jsonb; v_canal jsonb; v_canal_txt text;
begin
  j := public.conta_liquidaciones_mes(p_company, date_trunc('month', p_mes)::date);
  r := j->'resumen';
  if coalesce((r->>'total')::int, 0) = 0 then
    return public._s01p_bloque('plataformas', 'Plataformas', 'no_aplica', 'No hay liquidaciones de plataformas en el mes.');
  end if;
  select jsonb_agg(x) into v_ej from (
    select jsonb_build_object('canal', f->>'canal', 'marca', f->>'marca', 'local', f->>'local', 'periodo', (f->>'desde') || '→' || (f->>'hasta'),
                              'que', case f->>'accion' when 'pidela' then 'falta la liquidación' when 'subela' then 'falta la factura de comisión'
                                                       else 'no cuadra' end) x
      from jsonb_array_elements(j->'filas') f where f->>'estado' in ('te_necesita', 'no_cuadra')
     order by f->>'desde', f->>'canal', f->>'marca' limit 5) z;
  v_estado := case when (r->>'te_necesita')::int + (r->>'no_cuadra')::int > 0 then 'rojo' else 'verde' end;
  -- S01p·5: de quién es lo que falta, por canal (en octubre de Foodint, 36 de los 38 eran de Uber).
  select jsonb_object_agg(canal, n), string_agg(format('%s de %s', n, canal), ', ' order by n desc, canal)
    into v_canal, v_canal_txt
    from (select f->>'canal' canal, count(*) n from jsonb_array_elements(j->'filas') f
           where f->>'estado' in ('te_necesita', 'no_cuadra') group by 1) c;
  return public._s01p_bloque('plataformas', 'Plataformas', v_estado,
    case when v_estado = 'verde' then format('Los %s periodos con su liquidación y su factura de comisión%s.', r->>'total',
                                             case when (r->>'aun_no_toca')::int > 0 then format(' (%s cobros se miran el mes siguiente)', r->>'aun_no_toca') else '' end)
         else concat_ws(' · ',
           case when (r->>'te_necesita')::int > 0 then format('%s periodos te necesitan', r->>'te_necesita') end,
           case when (r->>'no_cuadra')::int > 0 then format('%s no cuadran', r->>'no_cuadra') end,
           case when v_canal_txt is not null then format('(%s)', v_canal_txt) end) end,
    r || jsonb_build_object('por_canal', coalesce(v_canal, '{}'::jsonb)), coalesce(v_ej, '[]'::jsonb), 'ventas/liquidaciones');
end $$;

create or replace function public.conta_cierre_bloque_justificantes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_n int; v_ok int; v_sin int; v_sin_imp numeric; v_ej jsonb; v_pdf int; v_pdf_ej jsonb; v_recarga numeric; v_facturado numeric; v_estado text;
  v_tipos jsonb; v_tipos_txt text;
begin
  with m as (
    select b.id, b.op_date, b.amount, k.kind, k.journal_entry_id
      from public.bank_movement b
      join public.bank_match k on k.movement_id = b.id and k.undone_at is null and k.account_id = v_acc
     where b.company_id = p_company and b.account_id = v_acc and b.status = 'casado' and b.op_date between v_ini and v_fin),
  c as (
    select m.*,
           (m.kind in ('liquidacion', 'factura_recibida', 'traspaso', 'remesa', 'factura_emitida', 'modelo', 'nomina', 'contrato')
            or exists (select 1 from public.journal_entry_document d where d.entry_id = m.journal_entry_id)
            or exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                        where l.entry_id = m.journal_entry_id and a.code !~ '^572' and (a.code ~ '^626' or a.code ~ '^407'))
            -- S01p·6: un cobro de plataforma se justifica solo casado con su liquidación, uno a uno (kind
            -- 'liquidacion', arriba), nunca por importe. Lo de la 520/170, con su contrato (el cuadro es el documento).
            -- El pago de la nómina (465), con la nómina del mes anterior que tenga su PDF (abajo, nomina_pdf).
            or exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                         join public.recurring_contract c on c.company_id = p_company and c.account_id = v_acc and c.is_active
                                                         and a.code in (c.capital_account, c.short_capital_account, c.long_capital_account)
                        where l.entry_id = m.journal_entry_id)
            or (n.id is not null and n.con_pdf)) ok,
           n.id is not null and not n.con_pdf nomina_sin_pdf,
           (select string_agg(distinct left(a.code, 3), '+') from public.journal_line l join public.company_account a on a.id = l.company_account_id
             where l.entry_id = m.journal_entry_id and a.code !~ '^572') contra
      from m
      -- La nómina del mes anterior al pago: el asiento validado con 640 y 465 al haber; con su PDF o sin él.
      left join lateral (
        select e.id, exists (select 1 from public.journal_entry_document d where d.entry_id = e.id) con_pdf
          from public.journal_entry e
         where exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                        where l.entry_id = m.journal_entry_id and a.code ~ '^465')
           and e.company_id = p_company and e.account_id = v_acc and e.status = 'validado'
           and e.entry_date between (date_trunc('month', m.op_date) - interval '1 month')::date and (date_trunc('month', m.op_date) - interval '1 day')::date
           and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = e.id and a.code ~ '^640')
           and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = e.id and a.code ~ '^465' and l.credit > 0)
         order by exists (select 1 from public.journal_entry_document d where d.entry_id = e.id) desc, e.entry_date desc limit 1) n on true)
  , t as (select c.*, case when c.nomina_sin_pdf then format('falta el PDF de la nómina de %s', to_char(c.op_date - interval '1 month', 'MM/YYYY'))
                           when c.contra ~ '430' then 'cobros de clientes o plataformas sin casar con su liquidación'
                           when c.contra ~ '5201' then 'falta el contrato de la póliza'
                           when c.contra ~ '(520|170|171|521)' then 'falta el contrato del préstamo'
                           when c.contra ~ '(400|410)' then 'pagos a proveedores sin su factura'
                           when c.contra ~ '465' then 'pagos de nómina sin su nómina'
                           when c.contra ~ '(475|476)' then 'pagos a Hacienda o a la Seguridad Social sin su modelo'
                           when c.contra ~ '^6' then 'gastos sin su factura'
                           else 'otros' end tipo from c)
  select count(*), count(*) filter (where ok), count(*) filter (where not ok), coalesce(sum(abs(amount)) filter (where not ok), 0),
         (select jsonb_agg(x) from (select jsonb_build_object('dia', c2.op_date, 'importe', c2.amount, 'contra', c2.contra, 'que', c2.tipo) x
                from t c2 where not c2.ok order by abs(c2.amount) desc limit 5) z),
         (select jsonb_object_agg(tipo, n) from (select tipo, count(*) n from t where not ok group by 1) z),
         (select string_agg(format('%s %s', n, tipo), ' · ' order by n desc, tipo) from (select tipo, count(*) n from t where not ok group by 1) z)
    into v_n, v_ok, v_sin, v_sin_imp, v_ej, v_tipos, v_tipos_txt from t;

  -- Catcher: lo recargado (debe de la 407) frente a lo facturado (haber de la 407) en el mes; la diferencia, saldo a favor.
  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) into v_recarga, v_facturado
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin and a.code ~ '^407';

  select count(*), (select jsonb_agg(x) from (select jsonb_build_object('factura', f.code, 'fecha', f.invoice_date, 'total', f.grand_total) x
                     from public.supplier_invoice f join public.journal_entry e on e.id = f.journal_entry_id
                    where f.account_id = v_acc and e.company_id = p_company and e.entry_date between v_ini and v_fin and e.status <> 'anulado'
                      and f.raw_document_url is null and f.no_document_at is null order by f.grand_total desc nulls last limit 5) z)
    into v_pdf, v_pdf_ej from public.supplier_invoice f join public.journal_entry e on e.id = f.journal_entry_id
   where f.account_id = v_acc and e.company_id = p_company and e.entry_date between v_ini and v_fin and e.status <> 'anulado'
     and f.raw_document_url is null and f.no_document_at is null;

  if coalesce(v_n, 0) = 0 and coalesce(v_pdf, 0) = 0 then
    return public._s01p_bloque('justificantes', 'Justificantes', 'no_aplica', 'No hay movimientos del banco casados en el mes.');
  end if;
  v_estado := case when v_sin > 0 or v_pdf > 0 then 'rojo' else 'verde' end;
  return public._s01p_bloque('justificantes', 'Justificantes', v_estado,
    case when v_estado = 'verde' then format('Los %s movimientos casados tienen su justificante.', v_n)
         else concat_ws(' · ',
           case when v_sin > 0 then format('%s movimientos sin su documento (%s): %s', v_sin, public._s01p_euros(v_sin_imp), v_tipos_txt) end,
           case when v_pdf > 0 then format('%s facturas recibidas sin PDF', v_pdf) end) end,
    jsonb_build_object('casados', v_n, 'justificados', v_ok, 'sin_documento', v_sin, 'sin_documento_importe', v_sin_imp, 'sin_documento_por_tipo', coalesce(v_tipos, '{}'::jsonb),
                       'recibidas_sin_pdf', v_pdf, 'catcher_recargado', v_recarga, 'catcher_facturado', v_facturado,
                       'catcher_saldo_a_favor', v_recarga - v_facturado),
    coalesce(v_ej, '[]'::jsonb) || coalesce(v_pdf_ej, '[]'::jsonb), 'bancos');
end $$;

create or replace function public.conta_cierre_bloque_laboral(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_640 numeric; v_642 numeric; v_642_fuera numeric; v_465_pago numeric; v_laboral int; v_dias smallint[]; v_estado text; v_frase text;
begin
  -- S01p·5: el devengo del mes sale de los asientos de la nómina (los que llevan 640). Un 642 en otro
  -- asiento (en octubre de Foodint, el reconocimiento de deuda y aplazamiento de la TGSS del 19/10, con
  -- 669 y 678) no es la Seguridad Social del mes: se enseña aparte.
  with n as (
    select a.code, l.debit - l.credit imp,
           exists (select 1 from public.journal_line l2 join public.company_account a2 on a2.id = l2.company_account_id
                    where l2.entry_id = e.id and a2.code ~ '^640') de_nomina
      from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
     where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin
       and e.source_type not in ('closing', 'regularization') and a.code ~ '^64[02]')
  select coalesce(sum(imp) filter (where code ~ '^640'), 0), coalesce(sum(imp) filter (where code ~ '^642' and de_nomina), 0),
         coalesce(sum(imp) filter (where code ~ '^642' and not de_nomina), 0)
    into v_640, v_642, v_642_fuera from n;
  select coalesce(sum(l.debit), 0) into v_465_pago
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin
     and a.code ~ '^465' and e.source_type = 'bank';
  select count(*) into v_laboral from public.payroll_cost c
   where c.account_id = v_acc and c.period_year = extract(year from v_ini) and c.period_month = extract(month from v_ini);
  select payroll_pay_days into v_dias from public.company where id = p_company;

  if v_640 = 0 and v_laboral = 0 and v_465_pago = 0 then
    -- Ni nómina en el libro, ni en Laboral, ni pagos: puede que no tenga personal; no se da por verde.
    if not exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
                    where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and a.code ~ '^640' and e.entry_date >= v_ini - 365) then
      return public._s01p_bloque('laboral', 'Laboral', 'no_aplica', 'Sin nóminas en el último año.');
    end if;
  end if;
  v_estado := case when v_640 = 0 then 'rojo' when v_laboral = 0 then 'sin_medir' else 'verde' end;
  v_frase := concat_ws(' · ',
    case when v_640 = 0 then format('Falta la nómina de %s: ningún 640 con fecha del mes', to_char(v_ini, 'MM/YYYY'))
         else format('Nómina del mes en el libro: 640 %s y 642 %s', public._s01p_euros(v_640), public._s01p_euros(v_642)) end,
    case when v_laboral = 0 then 'Laboral no tiene este mes: sin medir' end,
    case when v_642_fuera <> 0 then format('%s de 642 en asientos que no son de la nómina (no se cuentan como devengo)', public._s01p_euros(v_642_fuera)) end,
    case when v_465_pago > 0 then format('Pago de la nómina anterior: %s', public._s01p_euros(v_465_pago)) else 'Ningún pago de nóminas por el banco en el mes' end,
    case when v_dias is null then 'Sin días de pago de la nómina en la empresa' end);
  return public._s01p_bloque('laboral', 'Laboral', v_estado, v_frase,
    jsonb_build_object('devengo_640', v_640, 'devengo_642', v_642, 'otro_642', v_642_fuera, 'pago_465', v_465_pago, 'laboral_personas', v_laboral, 'dias_de_pago', to_jsonb(v_dias)),
    '[]'::jsonb, 'laboral');
end $$;

create or replace function public.conta_cierre_bloque_repite(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_cuotas int; v_cuotas_mal int; v_cuotas_ej jsonb; v_alq int; v_alq_ej jsonb; v_rsf int; v_estado text;
begin
  -- S01p·6: cada cuota del mes, mirada por lo que hay en el libro. Su pago (casado con su fila, o casado
  -- a mano: el movimiento del banco por el importe de la cuota) y sus intereses: los apuntes a la cuenta
  -- de intereses del contrato por el importe de la fila, en el asiento del pago o en otro, del día de la
  -- cuota al fin del mes siguiente. Uno, bien; ninguno, faltan; dos o más, apuntados dos veces (en
  -- octubre de Foodint, los asientos 3291 y 3313, de 115,68 € los dos).
  with q as (
    select c.id, c.name, (f->>'fecha')::date fecha, (f->>'cuota')::numeric cuota, coalesce((f->>'intereses')::numeric, 0) intereses,
           exists (select 1 from public.bank_match m where m.contract_id = c.id and m.undone_at is null and m.contract_due_date = (f->>'fecha')::date) con_fila,
           (select b.op_date from public.bank_movement b join public.bank_match k on k.movement_id = b.id and k.undone_at is null
             where b.company_id = p_company and b.account_id = v_acc and b.treasury_account_id = c.treasury_account_id
               and b.status = 'casado' and abs(abs(b.amount) - abs((f->>'cuota')::numeric)) <= 0.02
               and b.op_date between (f->>'fecha')::date - 5 and (f->>'fecha')::date + 10
             order by abs(b.op_date - (f->>'fecha')::date) limit 1) pagada,
           (select coalesce(array_agg(distinct e.number order by e.number), '{}')
              from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
             where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and a.code = c.interest_account
               and abs(l.debit - coalesce((f->>'intereses')::numeric, 0)) <= 0.02
               and e.entry_date between (f->>'fecha')::date - 5 and ((date_trunc('month', (f->>'fecha')::date) + interval '2 month - 1 day')::date)) asientos_int
      from public.recurring_contract c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.schedule) = 'array' then c.schedule else '[]'::jsonb end) f
     where c.company_id = p_company and c.account_id = v_acc and c.is_active and (f->>'fecha')::date between v_ini and v_fin),
  e as (
    select q.*, case when q.intereses > 0 and cardinality(q.asientos_int) >= 2
                       then format('intereses apuntados dos veces (%s de %s, asientos %s)', cardinality(q.asientos_int), public._s01p_euros(q.intereses), array_to_string(q.asientos_int, ' y '))
                     when q.pagada is null and not q.con_fila then 'cuota sin pagar ni casar con su fila del cuadro'
                     when q.intereses > 0 and cardinality(q.asientos_int) = 0 and not q.con_fila
                       then format('pagada el %s y casada a mano, sin sus intereses (%s): cásala con su fila', to_char(q.pagada, 'DD/MM'), public._s01p_euros(q.intereses))
                end que
      from q)
  select count(*), count(*) filter (where que is not null),
         jsonb_agg(jsonb_build_object('contrato', name, 'fecha', fecha, 'cuota', cuota, 'que', que)) filter (where que is not null)
    into v_cuotas, v_cuotas_mal, v_cuotas_ej
    from e;
  select count(*), jsonb_agg(jsonb_build_object('alquiler', n.supplier_name, 'ultima', n.ultima,
                 'que', format('falta la de %s%s', to_char(v_ini, 'MM/YYYY'),
                               case when n.ultima > v_fin then format(' (la última, del %s, es de un mes posterior)', to_char(n.ultima, 'DD/MM')) else '' end)))
    into v_alq, v_alq_ej
    from public.conta_esperadas_del_mes(p_company, v_ini) n join public.supplier_expected_invoice x on x.id = n.expected_id
   where x.kind = 'alquiler';
  select count(*) into v_rsf from public.journal_entry e join public.purchase_accrual a on a.id = e.source_id
   where a.company_id = p_company and a.account_id = v_acc and a.month = v_ini and e.source_type = 'purchase_accrual' and e.status in ('propuesto', 'borrador');

  v_estado := case when v_cuotas_mal > 0 or v_alq > 0 then 'rojo' else 'sin_medir' end;  -- sin el registro de bienes, nunca verde
  return public._s01p_bloque('repite', 'Lo que se repite', v_estado,
    concat_ws(' · ',
      'Amortizaciones: sin medir, falta el registro de bienes',
      case when v_cuotas_mal > 0 then format('%s de %s cuotas con algo que mirar', v_cuotas_mal, v_cuotas)
           when v_cuotas > 0 then format('las %s cuotas del mes, pagadas y con sus intereses', v_cuotas) end,
      case when v_alq > 0 then format('%s facturas de alquiler sin llegar', v_alq) end,
      case when v_rsf > 0 then format('%s «recibido sin factura» por validar', v_rsf) end),
    jsonb_build_object('amortizaciones', 'sin_medir', 'cuotas', v_cuotas, 'cuotas_sin_casar', v_cuotas_mal, 'alquileres_sin_llegar', v_alq, 'recibido_sin_factura_por_validar', v_rsf),
    coalesce(v_cuotas_ej, '[]'::jsonb) || coalesce(v_alq_ej, '[]'::jsonb), 'compras/esperando');
end $$;

create or replace function public.conta_cierre_mes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_dia smallint; v_bloques jsonb; v_lock public.fiscal_period_lock; v_cambios int;
begin
  select month_close_day into v_dia from public.company where id = p_company;
  v_bloques := jsonb_build_array(
    public.conta_cierre_bloque_ventas(p_company, v_ini), public.conta_cierre_bloque_compras(p_company, v_ini),
    public.conta_cierre_bloque_plataformas(p_company, v_ini), public.conta_cierre_bloque_bancos(p_company, v_ini),
    public.conta_cierre_bloque_justificantes(p_company, v_ini), public.conta_cierre_bloque_laboral(p_company, v_ini),
    public.conta_cierre_bloque_repite(p_company, v_ini), public.conta_cierre_bloque_asientos(p_company, v_ini),
    public.conta_cierre_bloque_iva(p_company, v_ini));
  select * into v_lock from public.fiscal_period_lock where company_id = p_company and month = v_ini and reopened_at is null;
  select count(*) into v_cambios from public.conta_mes_cambio c where c.lock_id = v_lock.id;
  return jsonb_build_object(
    'mes', v_ini, 'dia_cierre', v_dia,
    'se_cierra_el', case when v_dia is not null then (v_ini + interval '1 month' + (v_dia - 1) * interval '1 day')::date end,
    'estado', case when v_lock.id is null then 'abierto' when v_cambios > 0 then 'cerrado_con_cambios' else 'cerrado' end,
    'cerrado', case when v_lock.id is not null then jsonb_build_object('el', v_lock.locked_at, 'por', v_lock.locked_by_name, 'tipo', v_lock.kind, 'cambios', v_cambios) end,
    'faltan', (select count(*) from jsonb_array_elements(v_bloques) b where b->>'estado' in ('rojo', 'ambar')),
    -- S01p·5: un bloque en rojo puede tener partes sin medir (Revolut en Bancos, las amortizaciones):
    -- se cuentan igual, y salen para justificar al cerrar.
    'sin_medir', (select count(*) from jsonb_array_elements(v_bloques) b where public._s01p_sin_medir(b)),
    -- Julio (S01p·4): «sin medir» no impide cerrar, pero no se calla: el mes
    -- sale «listo, con N sin medir» y cerrar pide el porqué de cada uno.
    'listo', not exists (select 1 from jsonb_array_elements(v_bloques) b where b->>'estado' in ('rojo', 'ambar')),
    'por_justificar', (select coalesce(jsonb_agg(b->>'codigo'), '[]'::jsonb) from jsonb_array_elements(v_bloques) b where public._s01p_sin_medir(b)),
    'no_aplican', (select count(*) from jsonb_array_elements(v_bloques) b where b->>'estado' = 'no_aplica'),
    'bloques', v_bloques);
end $$;
