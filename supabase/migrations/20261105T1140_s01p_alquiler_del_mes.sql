-- supabase/migrations/20261105T1140_s01p_alquiler_del_mes.sql
--
-- S01p·14 y S01p·15 · Los alquileres que no mandan factura se apuntan solos
-- cada mes desde su contrato (Julio, 04/11 y 05/11): «Los que no la mandan se
-- apuntan cada mes desde su contrato, con su retención del 115. El contrato es
-- el justificante.» El que manda factura la espera, como cualquier recibida.
--
-- 1. El contrato de alquiler es un recurring_contract de tipo «alquiler» (el
--    tipo ya existía, sin usar), con lo que hace falta para el apunte: el local,
--    el tipo de IVA, la retención, las cuentas, el día, desde cuándo se apunta
--    solo (propose_from), el principio y el fin, desde cuándo lleva retención
--    (withholding_since) y «exento de retención», que solo se puede marcar con
--    su certificado (sin certificado, no hay exención). Columnas nuevas que
--    admiten nulos, o con su valor por defecto.
-- 2. El alquiler esperado (supplier_expected_invoice) tiene fin (ends_on): un
--    contrato terminado no se pide desde el mes siguiente. Y si lo cubre un
--    contrato que se apunta solo (covered_by_recurring_id, preparado en la V02
--    para esto), tampoco se le pide la factura: conta_esperadas_del_mes deja de
--    pedírsela, y con ella «Esperando factura», los avisos y el cierre.
-- 3. _conta_alquiler_proponer(contrato, mes): el apunte del mes, propuesto, el
--    día del contrato (el 1, como hasta septiembre). Renta a la 621, IVA a la
--    472 con su libro de recibidas, retención del 115 a la 4751 y el resto a la
--    cuenta del arrendador, todo en su local. Una vez por mes: si ya hay uno
--    vivo de ese contrato y ese mes, no hace otro. Cada mes es una fila de
--    recurring_contract_month (tabla nueva), el origen de su asiento. Sin contrato subido, lo dice
--    («falta el contrato») y lo propone igual.
-- 4. La pasada de cada día (_conta_alquileres_proponer_todas, 05:23): el mes
--    en curso de cada contrato activo. Si falla en una empresa, sigue con las
--    demás y el cron la cuenta como fallida (regla 8).
-- 5. «Lo que se repite» del cierre separa los alquileres que se apuntan solos
--    (propuesto por validar, validado, o «falta proponerlo» en rojo) de los que
--    esperan factura (la que falta, en rojo), y dice los terminados («terminado
--    el 30/09: no se pide»): no se esconden (regla 7).
--
-- cambia: public.conta_esperadas_del_mes · prueba: supabase/staging/sql/20261105_s01p_alquiler_del_mes_prueba.sql
-- cambia: public.conta_cierre_bloque_repite · prueba: supabase/staging/sql/20261105_s01p_alquiler_del_mes_prueba.sql
-- cambia: public.recurring_contract · prueba: supabase/staging/sql/20261105_s01p_alquiler_del_mes_prueba.sql
--   (columnas nuevas que admiten nulos o con valor por defecto, y su CHECK)
-- cambia: public.supplier_expected_invoice · prueba: supabase/staging/sql/20261105_s01p_alquiler_del_mes_prueba.sql
--   (una columna nueva que admite nulos: ends_on)
--
-- Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_esperadas_del_mes(uuid,date)', '20261105T1140_s01p_alquiler_del_mes');
select public._respaldar_funcion('public.conta_cierre_bloque_repite(uuid,date)', '20261105T1140_s01p_alquiler_del_mes');

-- ── 1 · El contrato de alquiler ─────────────────────────────────────────────
alter table public.recurring_contract
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists vat_rate_id uuid references public.tax_rate(id),
  add column if not exists withholding_rate_id uuid references public.withholding_rate(id),
  add column if not exists vat_account text,
  add column if not exists withholding_account text,
  add column if not exists creditor_account text,
  add column if not exists day_of_month smallint,
  add column if not exists propose_from date,
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists withholding_since date,
  add column if not exists withholding_exempt boolean not null default false,
  add column if not exists exempt_document_name text,
  add column if not exists exempt_document_uploaded_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_contract_alquiler_dia') then
    alter table public.recurring_contract add constraint recurring_contract_alquiler_dia
      check (day_of_month is null or day_of_month between 1 and 28);
  end if;
  -- Julio (05/11): «Sin certificado no se puede marcar. Así no vuelve a pasar.»
  if not exists (select 1 from pg_constraint where conname = 'recurring_contract_exento_con_certificado') then
    alter table public.recurring_contract add constraint recurring_contract_exento_con_certificado
      check (not withholding_exempt or (exempt_document_name is not null and exempt_document_uploaded_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_contract_alquiler_fechas') then
    alter table public.recurring_contract add constraint recurring_contract_alquiler_fechas
      check (starts_on is null or ends_on is null or ends_on >= starts_on);
  end if;
end $$;
comment on column public.recurring_contract.propose_from is
  'S01p·14 · Alquiler: el primer mes que se apunta solo (antes, lo apuntado viene de otro sitio: en Foodint, de Diez hasta septiembre). Sin él, no se propone nada.';
comment on column public.recurring_contract.withholding_since is
  'S01p·15 · Alquiler: desde qué día lleva retención del 115 (antes, no la llevaba). Nulo = siempre.';
comment on column public.recurring_contract.withholding_exempt is
  'S01p·15 · Alquiler exento de retención: solo con su certificado de Hacienda (exempt_document_*).';

alter table public.supplier_expected_invoice add column if not exists ends_on date;
comment on column public.supplier_expected_invoice.ends_on is
  'S01p·15 · Hasta cuándo se espera (un contrato terminado): desde el mes siguiente no se pide. Se sigue viendo, con su fecha de fin.';

-- Cada mes apuntado de un contrato: el origen de su asiento (un asiento por origen, ux_journal_entry_origen).
create table if not exists public.recurring_contract_month (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  contract_id uuid not null references public.recurring_contract(id) on delete cascade,
  month       date not null check (month = date_trunc('month', month)::date),
  created_at  timestamptz not null default now(),
  unique (contract_id, month)
);
comment on table public.recurring_contract_month is
  'S01p·14 · Un mes de un contrato que se apunta solo (el alquiler del mes): el origen (source_id) de su asiento.';
alter table public.recurring_contract_month enable row level security;
drop policy if exists recurring_contract_month_select on public.recurring_contract_month;
create policy recurring_contract_month_select on public.recurring_contract_month for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.recurring_contract_month from anon;
grant select on public.recurring_contract_month to authenticated;

-- ── 2 · Lo que se espera del mes: ni lo terminado ni lo que se apunta solo ──
create or replace function public.conta_esperadas_del_mes(p_company uuid, p_mes date)
returns table(expected_id uuid, supplier_id uuid, supplier_name text, label text, periodo date, ultima date, pedida text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_mes date := date_trunc('month', p_mes)::date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return query
  select x.id, x.supplier_id, s.name, coalesce(x.label, s.name), v_mes,
         greatest((select max(i.invoice_date) from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'),
                  (select max(e.entry_date) from public.journal_entry e
                     join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                     join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                        and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                    where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado')),
         (select r.status from public.supplier_invoice_request r where r.supplier_id = x.supplier_id and r.period = v_mes order by r.created_at desc limit 1)
    from public.supplier_expected_invoice x
    join public.supplier s on s.id = x.supplier_id and s.account_id = v_acc
   where x.company_id = p_company and x.account_id = v_acc and x.active
     -- S01p·15: un contrato terminado no se pide desde el mes siguiente a su fin.
     and (x.ends_on is null or x.ends_on >= v_mes)
     -- S01p·14: lo que cubre un contrato que se apunta solo no espera factura.
     and not exists (select 1 from public.recurring_contract c
                      where c.id = x.covered_by_recurring_id and c.account_id = v_acc and c.is_active and c.kind = 'alquiler'
                        and c.propose_from is not null and c.propose_from <= v_mes)
     and not exists (select 1 from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'
                        and i.invoice_date >= v_mes and i.invoice_date < (v_mes + interval '1 month')::date)
     and not exists (select 1 from public.journal_entry e
                       join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                       join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                          and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                      where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
                        and e.entry_date >= v_mes and e.entry_date < (v_mes + interval '1 month')::date)
   order by s.name;
end $$;

-- ── 3 · El apunte del mes, desde el contrato ───────────────────────────────
-- El asiento vivo de ese contrato y ese mes, si lo hay.
create or replace function public._conta_alquiler_del_mes(p_contract uuid, p_mes date)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.recurring_contract_month m
    join public.journal_entry e on e.source_type = 'manual' and e.source_id = m.id and e.company_id = m.company_id and e.status <> 'anulado'
   where m.contract_id = p_contract and m.month = date_trunc('month', p_mes)::date
   order by e.created_at limit 1
$$;
revoke all on function public._conta_alquiler_del_mes(uuid, date) from public, anon, authenticated;

create or replace function public._conta_alquiler_proponer(p_contract uuid, p_mes date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.recurring_contract; v_mes date := date_trunc('month', p_mes)::date; v_dia date; v_y uuid; v_e uuid;
  v_iva_pct numeric; v_ret_pct numeric; v_base numeric; v_iva numeric; v_ret numeric := 0; v_con_ret boolean;
  v_cta record; v_pos int := 0; v_razon text; l record; v_m uuid;
begin
  select * into c from public.recurring_contract where id = p_contract;
  if c.id is null or c.kind <> 'alquiler' then raise exception 'S01p alquiler: ese contrato de alquiler no está.'; end if;
  if not c.is_active or c.propose_from is null or v_mes < date_trunc('month', c.propose_from)::date
     or (c.starts_on is not null and v_mes < date_trunc('month', c.starts_on)::date)
     or (c.ends_on is not null and v_mes > c.ends_on) then
    return null;   -- ese mes no le toca
  end if;
  v_e := public._conta_alquiler_del_mes(c.id, v_mes);
  if v_e is not null then return v_e; end if;   -- una vez por mes
  if c.location_id is null or c.vat_rate_id is null or c.creditor_account is null or c.expense_account is null then
    raise exception 'S01p alquiler: a «%» le falta el local, el IVA o las cuentas: no se propone.', c.name;
  end if;
  v_dia := make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, coalesce(c.day_of_month, 1));
  select id into v_y from public.fiscal_year where company_id = c.company_id and v_dia between starts_on and ends_on;
  if v_y is null then raise exception 'S01p alquiler: no hay ejercicio para el %.', to_char(v_dia, 'DD/MM/YYYY'); end if;

  select rate into v_iva_pct from public.tax_rate where id = c.vat_rate_id;
  v_con_ret := not c.withholding_exempt and (c.withholding_since is null or v_dia >= c.withholding_since);
  if v_con_ret then
    if c.withholding_rate_id is null or c.withholding_account is null then
      raise exception 'S01p alquiler: «%» lleva retención y le falta su tipo o su cuenta: no se propone.', c.name;
    end if;
    select rate into v_ret_pct from public.withholding_rate where id = c.withholding_rate_id;
  end if;
  v_base := c.amount;
  v_iva := round(v_base * v_iva_pct / 100, 2);
  if v_con_ret then v_ret := round(v_base * v_ret_pct / 100, 2); end if;

  v_razon := format('Alquiler de %s desde su contrato: renta %s + IVA %s %%%s = %s.',
                    to_char(v_mes, 'MM/YYYY'), public._s01p_euros(v_base), trim(to_char(v_iva_pct, 'FM990.##')),
                    case when v_con_ret then format(' − retención %s %% del 115', trim(to_char(v_ret_pct, 'FM990.##')))
                         when c.withholding_exempt then ', exento de retención (con su certificado)'
                         else format(', sin retención (la lleva desde el %s)', to_char(c.withholding_since, 'DD/MM/YYYY')) end,
                    public._s01p_euros(v_base + v_iva - v_ret))
              || case when c.document_uploaded_at is null then ' Falta el contrato.' else '' end;

  insert into public.recurring_contract_month (account_id, company_id, contract_id, month) values (c.account_id, c.company_id, c.id, v_mes)
  on conflict (contract_id, month) do update set month = excluded.month returning id into v_m;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    party_id, document_ref, document_date, confidence, reason, created_by_name)
  values (c.account_id, c.company_id, v_y, 2, v_dia, format('Alquiler %s · %s', to_char(v_mes, 'MM/YYYY'), c.name), 'manual', v_m, 'propuesto',
          c.party_id, format('ALQ-%s', to_char(v_mes, 'YYYYMM')), v_dia, 'seguro', v_razon, 'Sumied (alquiler del mes)')
  returning id into v_e;

  for l in select * from (values
      (c.expense_account, v_base, 0::numeric, 'gasto'), (c.vat_account, v_iva, 0::numeric, 'iva'),
      (c.withholding_account, 0::numeric, v_ret, 'retencion'), (c.creditor_account, 0::numeric, v_base + v_iva - v_ret, 'arrendador')) x(cuenta, debe, haber, que)
    where debe <> 0 or haber <> 0 loop
    select a.id into v_cta from public.company_account a where a.company_id = c.company_id and a.code = l.cuenta;
    if v_cta.id is null then raise exception 'S01p alquiler: la cuenta % no está en la empresa.', l.cuenta; end if;
    v_pos := v_pos + 1;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     party_id, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (c.account_id, c.company_id, v_e, v_pos, v_cta.id, l.debe, l.haber, format('Alquiler %s', to_char(v_mes, 'MM/YYYY')), c.location_id, false,
            case when l.que = 'arrendador' then c.party_id end,
            case when l.que = 'iva' then c.vat_rate_id end, case when l.que = 'iva' then v_base end,
            case when l.que = 'iva' then 'received' end, case when l.que = 'iva' then 'yes' end, 1,
            case when l.que = 'retencion' then c.withholding_rate_id end, case when l.que = 'retencion' then v_base end,
            case when l.que = 'retencion' then '115' end);
  end loop;
  return v_e;
end $$;
revoke all on function public._conta_alquiler_proponer(uuid, date) from public, anon, authenticated;

-- ── 4 · La pasada de cada día ───────────────────────────────────────────────
create or replace function public._conta_alquileres_proponer_todas()
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_mal text[] := '{}';
begin
  for c in select id, name from public.recurring_contract where kind = 'alquiler' and is_active and propose_from is not null loop
    begin perform public._conta_alquiler_proponer(c.id, (now() at time zone 'Europe/Madrid')::date);
    exception when others then v_mal := v_mal || format('%s: %s', c.name, sqlerrm); end;
  end loop;
  -- Los demás contratos ya han pasado; esto solo hace que cron la cuente como fallida (regla 8).
  if cardinality(v_mal) > 0 then raise exception 'S01p alquiler: la pasada ha fallado en %', array_to_string(v_mal, ' · '); end if;
end $$;
revoke all on function public._conta_alquileres_proponer_todas() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 's01p-alquiler-del-mes') then perform cron.unschedule('s01p-alquiler-del-mes'); end if;
    perform cron.schedule('s01p-alquiler-del-mes', '23 4 * * *', 'select public._conta_alquileres_proponer_todas()');
  end if;
end $$;

-- ── 5 · «Lo que se repite»: se apunta solo, espera factura, terminado ──────
create or replace function public.conta_cierre_bloque_repite(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_cuotas int; v_cuotas_mal int; v_cuotas_ej jsonb; v_alq int; v_alq_ej jsonb; v_rsf int; v_estado text;
  v_solo int; v_solo_falta int; v_solo_validar int; v_solo_ej jsonb; v_term int; v_term_ej jsonb; v_term_txt text;
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
  -- Los alquileres que esperan factura (conta_esperadas_del_mes ya no cuenta los que se apuntan solos ni los terminados).
  select count(*), jsonb_agg(jsonb_build_object('alquiler', n.supplier_name, 'ultima', n.ultima, 'como', 'espera factura',
                 'que', format('falta la de %s%s', to_char(v_ini, 'MM/YYYY'),
                               case when n.ultima > v_fin then format(' (la última, del %s, es de un mes posterior)', to_char(n.ultima, 'DD/MM')) else '' end)))
    into v_alq, v_alq_ej
    from public.conta_esperadas_del_mes(p_company, v_ini) n join public.supplier_expected_invoice x on x.id = n.expected_id
   where x.kind = 'alquiler';
  -- S01p·14: los que se apuntan solos, desde su contrato: propuesto (por validar), validado, o falta proponerlo.
  with s as (
    select c.name, e.status,
           case when e.id is null then 'falta proponerlo: no hay apunte del mes'
                when e.status = 'validado' then null
                else 'propuesto, por validar' end
           || case when c.document_uploaded_at is null then ' · falta el contrato' else '' end que
      from public.recurring_contract c
      left join lateral (select x.id, x.status from public.journal_entry x where x.id = public._conta_alquiler_del_mes(c.id, v_ini)) e on true
     where c.company_id = p_company and c.account_id = v_acc and c.kind = 'alquiler' and c.is_active
       and c.propose_from is not null and date_trunc('month', c.propose_from)::date <= v_ini
       and (c.starts_on is null or date_trunc('month', c.starts_on)::date <= v_ini) and (c.ends_on is null or c.ends_on >= v_ini))
  select count(*), count(*) filter (where status is null), count(*) filter (where status in ('propuesto', 'borrador')),
         jsonb_agg(jsonb_build_object('alquiler', name, 'como', 'se apunta solo', 'que', coalesce(que, 'validado'))) filter (where que is not null)
    into v_solo, v_solo_falta, v_solo_validar, v_solo_ej
    from s;
  -- S01p·15: los terminados se dicen, no se esconden (regla 7).
  select count(*), string_agg(distinct to_char(x.ends_on, 'DD/MM'), ', '),
         jsonb_agg(jsonb_build_object('alquiler', coalesce(x.label, sp.name), 'como', 'terminado', 'que', format('terminado el %s: no se pide', to_char(x.ends_on, 'DD/MM/YYYY'))))
    into v_term, v_term_txt, v_term_ej
    from public.supplier_expected_invoice x join public.supplier sp on sp.id = x.supplier_id
   where x.company_id = p_company and x.account_id = v_acc and x.kind = 'alquiler' and x.active
     and x.ends_on is not null and x.ends_on < v_ini and x.ends_on >= (v_ini - interval '12 months')::date;
  select count(*) into v_rsf from public.journal_entry e join public.purchase_accrual a on a.id = e.source_id
   where a.company_id = p_company and a.account_id = v_acc and a.month = v_ini and e.source_type = 'purchase_accrual' and e.status in ('propuesto', 'borrador');

  v_estado := case when v_cuotas_mal > 0 or v_alq > 0 or v_solo_falta > 0 then 'rojo' else 'sin_medir' end;  -- sin el registro de bienes, nunca verde
  return public._s01p_bloque('repite', 'Lo que se repite', v_estado,
    concat_ws(' · ',
      'Amortizaciones: sin medir, falta el registro de bienes',
      case when v_cuotas_mal > 0 then format('%s de %s cuotas con algo que mirar', v_cuotas_mal, v_cuotas)
           when v_cuotas > 0 then format('las %s cuotas del mes, pagadas y con sus intereses', v_cuotas) end,
      case when v_alq > 0 then format('%s %s de alquiler sin llegar', v_alq, case when v_alq = 1 then 'factura' else 'facturas' end) end,
      case when v_solo_falta > 0 then format('%s %s que se apunta solo sin proponer', v_solo_falta, case when v_solo_falta = 1 then 'alquiler' else 'alquileres' end) end,
      case when v_solo_validar > 0 then format('%s %s del mes por validar', v_solo_validar, case when v_solo_validar = 1 then 'alquiler' else 'alquileres' end) end,
      case when v_solo > 0 and v_solo_falta = 0 and v_solo_validar = 0 then format('%s %s del mes, validado', v_solo, case when v_solo = 1 then 'alquiler' else 'alquileres' end) end,
      case when v_term > 0 then format('%s %s terminado el %s: no se pide', v_term, case when v_term = 1 then 'alquiler' else 'alquileres' end, v_term_txt) end,
      case when v_rsf > 0 then format('%s «recibido sin factura» por validar', v_rsf) end),
    jsonb_build_object('amortizaciones', 'sin_medir', 'cuotas', v_cuotas, 'cuotas_sin_casar', v_cuotas_mal, 'alquileres_sin_llegar', v_alq,
                       'alquileres_solos', v_solo, 'alquileres_solos_sin_proponer', v_solo_falta, 'alquileres_solos_por_validar', v_solo_validar,
                       'alquileres_terminados', v_term, 'recibido_sin_factura_por_validar', v_rsf),
    coalesce(v_cuotas_ej, '[]'::jsonb) || coalesce(v_alq_ej, '[]'::jsonb) || coalesce(v_solo_ej, '[]'::jsonb) || coalesce(v_term_ej, '[]'::jsonb),
    'compras/esperando');
end $$;
