-- supabase/migrations/20261104T2310_s01p_nomina_octubre.sql
--
-- S01p · La nómina de octubre de Foodint, solo a contabilidad (Julio, S01p·9 y
-- S01p·11, 04/11): una sola vez, sin pantalla y sin pasar por el portal del
-- empleado. Ni payroll-extract, ni payroll_inbox, ni la ficha de nadie: solo el
-- asiento del devengo, PROPUESTO, que Julio valida en el libro diario. El PDF se
-- queda fuera de Sumied (opción A): el pago de noviembre se marcará «Sin
-- documento» con su porqué.
--
-- Los totales, leídos de las 6 nóminas de octubre de la gestoría (correo del
-- 27/10, reenviado el 04/11; definitivas, Julio 22:48). Empresa Llorente29 Food,
-- S.L.; centro Florencio Llorente 29 (Foodint Alcalá). Cada nómina cuadra:
-- devengado − deducciones = líquido.
--   Bruto devengado .................... 7.268,20  (640, Alcalá)
--   Seguridad Social a cargo empresa ... 2.814,08  (642, Alcalá)
--   Seguridad Social del trabajador ....   472,43
--   IRPF ...............................   145,36  (4751)
--   Líquido a pagar .................... 6.650,41  (465)
--   6 personas (una de baja por paternidad todo el mes: 0 de bruto, la empresa cotiza).
-- El asiento, como el de septiembre traído de Diez (4/1861): 640 y 642 al debe;
-- 476 (las dos Seguridades Sociales: 3.286,51), 4751 y 465 al haber. Serie 9
-- (Nóminas), 31/10.
--
-- El cómo, en una función (solo la llama una tanda), para que la prueba de
-- staging recorra el mismo camino con una cuenta de mentira (Julio, S01p·10).
-- Sin Foodint, no hace nada.

create or replace function public._s01p_nomina_proponer(p_company uuid, p_fecha date, p_local uuid, p_cifras jsonb, p_cuentas jsonb, p_concepto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_y uuid; v_e uuid; v_bruto numeric := (p_cifras->>'bruto')::numeric; v_sst numeric := (p_cifras->>'ss_trabajador')::numeric;
  v_irpf numeric := (p_cifras->>'irpf')::numeric; v_liq numeric := (p_cifras->>'liquido')::numeric; v_sse numeric := (p_cifras->>'ss_empresa')::numeric;
  l record; v_pos int := 0; v_cta uuid; v_n int;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'S01p nómina: esa empresa no está.'; end if;
  if v_bruto - v_sst - v_irpf <> v_liq then
    raise exception 'S01p nómina: no cuadra (bruto % − Seguridad Social % − IRPF % ≠ líquido %): no se propone nada.', v_bruto, v_sst, v_irpf, v_liq;
  end if;
  if not exists (select 1 from public.locations where id = p_local and account_id = v_acc) then raise exception 'S01p nómina: ese local no es de la cuenta.'; end if;
  -- Ya hay nómina del mes (un asiento vivo con 640): no se duplica.
  select count(*) into v_n from public.journal_entry e
   where e.company_id = p_company and e.status <> 'anulado' and date_trunc('month', e.entry_date) = date_trunc('month', p_fecha)
     and exists (select 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id where jl.entry_id = e.id and a.code like (p_cuentas->>'sueldos') || '%');
  if v_n > 0 then raise exception 'S01p nómina: ya hay % asiento(s) con sueldos en ese mes: no se propone otro.', v_n; end if;
  select id into v_y from public.fiscal_year where company_id = p_company and p_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'S01p nómina: no hay ejercicio para el %.', p_fecha; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_by_name)
  values (v_acc, p_company, v_y, 9, p_fecha, p_concepto, 'payroll', 'propuesto', 'seguro',
          format('Nóminas del mes, una sola vez a contabilidad (S01p): bruto %s, Seguridad Social de la empresa %s, del trabajador %s, IRPF %s, líquido %s; %s personas.',
                 v_bruto, v_sse, v_sst, v_irpf, v_liq, p_cifras->>'personas'), 'Julio (tanda S01p)')
  returning id into v_e;
  for l in select * from (values
      (p_cuentas->>'sueldos', v_bruto, 0::numeric, true), (p_cuentas->>'ss_empresa', v_sse, 0, true),
      (p_cuentas->>'ss', 0, v_sst + v_sse, false), (p_cuentas->>'irpf', 0, v_irpf, false), (p_cuentas->>'pendiente', 0, v_liq, false)) x(cuenta, debe, haber, en_local)
    where debe <> 0 or haber <> 0 loop
    select id into v_cta from public.company_account where company_id = p_company and code = l.cuenta;
    if v_cta is null then raise exception 'S01p nómina: la cuenta % no está en el plan de la empresa.', l.cuenta; end if;
    v_pos := v_pos + 1;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common)
    values (v_acc, p_company, v_e, v_pos, v_cta, l.debe, l.haber, case when l.en_local then p_local end, not l.en_local);
  end loop;
  return v_e;
end $$;
revoke all on function public._s01p_nomina_proponer(uuid, date, uuid, jsonb, jsonb, text) from public, anon, authenticated, service_role;
comment on function public._s01p_nomina_proponer(uuid, date, uuid, jsonb, jsonb, text) is
  'S01p. Propone (no valida) el asiento del devengo de las nóminas de un mes desde sus totales, sin tocar Laboral ni el portal del empleado; para si no cuadra o si el mes ya tiene sueldos. Solo una tanda.';

-- ── Foodint: octubre ──────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_alcala constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_id uuid;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p nómina: sin la cuenta de Foodint, no hay nada que proponer.';
    return;
  end if;
  v_id := public._s01p_nomina_proponer(v_e, date '2026-10-31', v_alcala,
    jsonb_build_object('bruto', 7268.20, 'ss_trabajador', 472.43, 'irpf', 145.36, 'liquido', 6650.41, 'ss_empresa', 2814.08, 'personas', 6),
    jsonb_build_object('sueldos', '64000000', 'ss_empresa', '64200000', 'ss', '47600000', 'irpf', '47510000', 'pendiente', '46500000'),
    'Nóminas de octubre de 2026 (6 personas; gestoría, 27/10)');
  raise notice 'S01p nómina: propuesto el asiento % (31/10, serie 9).', v_id;
end $$;
