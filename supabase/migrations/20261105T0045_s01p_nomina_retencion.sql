-- supabase/migrations/20261105T0045_s01p_nomina_retencion.sql
--
-- S01p·12 · La nómina de octubre no se podía validar (Julio, 05/11 00:40): la
-- línea de la 4751 que propuso la 2310 no llevaba su retención (tipo, base y
-- modelo). Las nóminas de Casa Lola (payroll, validadas) la llevan: tipo
-- «trabajo», la base y el modelo 111.
--
--   1. _s01p_nomina_proponer (misma firma, con respaldo) pone en la 4751 el tipo
--      de rendimientos del trabajo, la base de IRPF que se le pase (base_irpf)
--      y el modelo 111; sin base de IRPF, no propone nada.
--   2. _s01p_nomina_retencion_poner: la retención en la 4751 de un asiento de
--      nómina propuesto que no la lleva (solo esa línea; lo demás no se toca).
--   3. Foodint: la línea de la 4751 del asiento propuesto de octubre (31/10,
--      serie 9), con su retención: base 7.268,20 (la base de IRPF de las 6
--      nóminas sumada, tal como sale en cada PDF; la persona de baja no tiene
--      base de IRPF: 0), modelo 111. Ni se borra ni se vuelve a proponer el
--      asiento. Cambia una fila que existe: va con autorizo.
--
-- cambia: public._s01p_nomina_proponer · prueba: supabase/staging/sql/20261105_s01p_nomina_retencion_prueba.sql
--
-- Nada en el camino del pedido.

select public._respaldar_funcion('public._s01p_nomina_proponer(uuid,date,uuid,jsonb,jsonb,text)', '20261105T0045_s01p_nomina_retencion');

create or replace function public._s01p_nomina_proponer(p_company uuid, p_fecha date, p_local uuid, p_cifras jsonb, p_cuentas jsonb, p_concepto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_y uuid; v_e uuid; v_bruto numeric := (p_cifras->>'bruto')::numeric; v_sst numeric := (p_cifras->>'ss_trabajador')::numeric;
  v_irpf numeric := (p_cifras->>'irpf')::numeric; v_liq numeric := (p_cifras->>'liquido')::numeric; v_sse numeric := (p_cifras->>'ss_empresa')::numeric;
  l record; v_pos int := 0; v_cta uuid; v_n int; v_base_irpf numeric := (p_cifras->>'base_irpf')::numeric; v_trabajo uuid;
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
  -- S01p·12: la retención de la 4751 lleva su tipo (rendimientos del trabajo), su base (la base de
  -- IRPF de las nóminas, tal como sale en cada una) y su modelo (111), como las nóminas de Casa Lola.
  if v_irpf <> 0 and v_base_irpf is null then raise exception 'S01p nómina: falta la base de IRPF de las nóminas: no se propone nada.'; end if;
  select id into v_trabajo from public.withholding_rate where code = 'trabajo' and is_system and valid_to is null;
  if v_irpf <> 0 and v_trabajo is null then raise exception 'S01p nómina: no está el tipo de retención de rendimientos del trabajo.'; end if;
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
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_acc, p_company, v_e, v_pos, v_cta, l.debe, l.haber, case when l.en_local then p_local end, not l.en_local,
            case when l.cuenta = p_cuentas->>'irpf' then v_trabajo end,
            case when l.cuenta = p_cuentas->>'irpf' then v_base_irpf end,
            case when l.cuenta = p_cuentas->>'irpf' then '111' end);
  end loop;
  return v_e;
end $$;

create or replace function public._s01p_nomina_retencion_poner(p_entry uuid, p_cuenta text, p_base numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_trabajo uuid; v_n int;
begin
  select id into v_trabajo from public.withholding_rate where code = 'trabajo' and is_system and valid_to is null;
  if v_trabajo is null then raise exception 'S01p nómina: no está el tipo de retención de rendimientos del trabajo.'; end if;
  if not exists (select 1 from public.journal_entry where id = p_entry and status = 'propuesto' and source_type = 'payroll' and series = 9) then
    raise exception 'S01p nómina: ese asiento no es una nómina propuesta: no se toca.';
  end if;
  select count(*) into v_n from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
   where jl.entry_id = p_entry and a.code = p_cuenta and jl.credit > 0 and jl.withholding_rate_id is null and jl.withholding_base is null and jl.withholding_model is null;
  if v_n <> 1 then raise exception 'S01p nómina: tenía que haber una línea de la % sin retención y hay %: no se toca.', p_cuenta, v_n; end if;
  update public.journal_line jl set withholding_rate_id = v_trabajo, withholding_base = p_base, withholding_model = '111'
    from public.company_account a
   where a.id = jl.company_account_id and jl.entry_id = p_entry and a.code = p_cuenta and jl.credit > 0 and jl.withholding_rate_id is null;
end $$;
revoke all on function public._s01p_nomina_retencion_poner(uuid, text, numeric) from public, anon, authenticated, service_role;

-- ── Foodint: la 4751 del asiento propuesto de octubre ──────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p nómina: sin la cuenta de Foodint, no hay nada que corregir.';
    return;
  end if;
  select count(*), min(id::text)::uuid into v_n, v_id from public.journal_entry
   where company_id = v_e and account_id = v_acc and source_type = 'payroll' and series = 9 and entry_date = date '2026-10-31'
     and status = 'propuesto' and created_by_name = 'Julio (tanda S01p)';
  if v_n <> 1 then raise exception 'S01p nómina: tenía que haber un asiento propuesto de la nómina de octubre y hay %: no se toca.', v_n; end if;
  if (select sum(debit) from public.journal_line where entry_id = v_id) <> 10082.28
     or not exists (select 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
                     where jl.entry_id = v_id and a.code = '47510000' and jl.credit = 145.36) then
    raise exception 'S01p nómina: el asiento ya no es el medido (10.082,28 €, 145,36 € en la 47510000): no se toca.';
  end if;
  -- La línea, a la vista del analizador (cambia una fila que existe): la retención de la 4751.
  update public.journal_line jl set withholding_rate_id = w.id, withholding_base = 7268.20, withholding_model = '111'
    from public.company_account a, public.withholding_rate w
   where a.id = jl.company_account_id and jl.entry_id = v_id and a.code = '47510000' and jl.credit = 145.36
     and jl.withholding_rate_id is null and w.code = 'trabajo' and w.is_system and w.valid_to is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S01p nómina: tenía que corregirse una línea y se corrigen %: no se toca.', v_n; end if;
  -- Y ya se puede validar: ninguno de los motivos de journal_entry_validar lo para (regla 10: el camino
  -- de una propuesta acaba en validar; aquí se comprueba sin validarlo, que lo valida Julio).
  if exists (select 1 from public.conta_motivos_para_validar(v_id)) then
    raise exception 'S01p nómina: con la retención puesta, el asiento sigue sin poder validarse: %',
      (select string_agg(m.motivo, ' · ' order by m.orden) from public.conta_motivos_para_validar(v_id) m);
  end if;
  raise notice 'S01p nómina: la 4751 del asiento de octubre, con su retención (trabajo, base 7.268,20, 111); se puede validar.';
end $$;
