-- ============================================================================
-- C04 · Libro diario — 4 · LO QUE SE LEE DEL LIBRO
-- ----------------------------------------------------------------------------
--   · journal_ledger (vista, con la RLS de quien lee): cada apunte con su
--     asiento y su cuenta. La lee el Mayor del C02, que deja de estar vacío.
--   · conta_sumas_saldos: Debe, Haber y saldo por cuenta en un periodo.
--   · conta_resultado_por_local: ingresos (7) menos gastos (6) por local y
--     marca; lo común, aparte o repartido con allocation_rule. La suma de los
--     locales es exactamente el resultado total (regla 9).
--   · conta_lectura: SELECT de lo nuevo para el agente «Libro diario» (en
--     producción; en staging el rol no existe).
-- Cuenta lo validado y lo anulado: un anulado y su contraasiento se compensan,
-- y los dos se ven (nada validado desaparece).
-- Vuelta atrás: supabase/vuelta-atras/20261010T0130_c04_lectura.down.sql
-- ============================================================================

create or replace view public.journal_ledger with (security_invoker = true) as
select l.id as line_id, l.account_id, l.company_id, l.entry_id, l.position,
       e.fiscal_year_id, e.series, e.number, e.entry_date, e.concept as entry_concept, e.status, e.source_type, e.source_id,
       e.reverses_entry_id, e.voided_by_entry_id, e.external_program, e.external_series, e.external_number,
       l.company_account_id, a.code as account_code, a.name as account_name, a.template_code,
       l.debit, l.credit, coalesce(l.concept, e.concept) as concept,
       l.location_id, l.is_common, l.brand_id, coalesce(l.party_id, e.party_id) as party_id,
       coalesce(l.document_ref, e.document_ref) as document_ref, coalesce(l.document_date, e.document_date) as document_date,
       l.tax_rate_id, l.tax_base, l.vat_book, l.vat_deductible, l.withholding_rate_id, l.withholding_base, l.withholding_model
  from public.journal_line l
  join public.journal_entry e on e.id = l.entry_id
  join public.company_account a on a.id = l.company_account_id
 where e.status in ('validado', 'anulado');
comment on view public.journal_ledger is
  'C04. El Mayor: cada apunte de un asiento validado (o anulado: su contraasiento lo compensa), con su cuenta. Con la RLS de quien lee.';
revoke all on public.journal_ledger from anon;
grant select on public.journal_ledger to authenticated;

create or replace function public.conta_sumas_saldos(p_company uuid, p_desde date, p_hasta date)
returns table (company_account_id uuid, code text, name text, template_code text, debe numeric, haber numeric, saldo numeric)
language sql stable security invoker set search_path = public as $$
  select l.company_account_id, l.account_code, l.account_name, l.template_code,
         sum(l.debit), sum(l.credit), sum(l.debit) - sum(l.credit)
    from public.journal_ledger l
   where l.company_id = p_company and l.entry_date between p_desde and p_hasta
   group by l.company_account_id, l.account_code, l.account_name, l.template_code
   order by l.account_code
$$;
comment on function public.conta_sumas_saldos(uuid, date, date) is 'C04. Sumas y saldos por cuenta de apunte en un periodo (lo validado; con la RLS de quien lee).';
revoke all on function public.conta_sumas_saldos(uuid, date, date) from public, anon;
grant execute on function public.conta_sumas_saldos(uuid, date, date) to authenticated;

-- Resultado por local y marca. p_repartir: lo común se reparte con la regla
-- vigente el último día del periodo; lo que no se puede repartir (sin regla, o
-- la regla no suma 100) se queda en la fila «común» y lo dice `nota`.
create or replace function public.conta_resultado_por_local(p_company uuid, p_desde date, p_hasta date, p_repartir boolean default false)
returns table (location_id uuid, brand_id uuid, ingresos numeric, gastos numeric, resultado numeric, nota text)
language plpgsql security invoker set search_path = public as $$
-- Las columnas de salida (location_id, ingresos, gastos…) se llaman igual que
-- las de _c04_res: dentro de las consultas manda la columna. Sin esto, la rama
-- del reparto fallaba con 42702 «ingresos is ambiguous» (e2e 123, 07/10).
#variable_conflict use_column
declare v_suma numeric;
begin
  create temp table if not exists _c04_res (location_id uuid, brand_id uuid, ingresos numeric, gastos numeric) on commit drop;
  truncate _c04_res;
  insert into _c04_res
  select l.location_id, l.brand_id,
         sum(case when l.template_code like '7%' then l.credit - l.debit else 0 end),
         sum(case when l.template_code like '6%' then l.debit - l.credit else 0 end)
    from public.journal_ledger l
   where l.company_id = p_company and l.entry_date between p_desde and p_hasta
     and (l.template_code like '6%' or l.template_code like '7%')
   group by l.location_id, l.brand_id;

  if p_repartir then
    select sum(r.pct) into v_suma from public.allocation_rule r
     where r.company_id = p_company and p_hasta between r.valid_from and coalesce(r.valid_to, p_hasta);
    if v_suma = 100 then
      -- Lo común (sin local) se reparte por la regla; el último local se lleva el
      -- redondeo para que la suma sea exacta.
      insert into _c04_res
      select x.location_id, null, x.ing, x.gas from (
        select r.location_id,
               case when row_number() over (order by r.pct, r.location_id desc) = count(*) over ()
                    then c.ingresos - coalesce(sum(round(c.ingresos * r.pct / 100, 2)) over (order by r.pct, r.location_id desc rows between unbounded preceding and 1 preceding), 0)
                    else round(c.ingresos * r.pct / 100, 2) end as ing,
               case when row_number() over (order by r.pct, r.location_id desc) = count(*) over ()
                    then c.gastos - coalesce(sum(round(c.gastos * r.pct / 100, 2)) over (order by r.pct, r.location_id desc rows between unbounded preceding and 1 preceding), 0)
                    else round(c.gastos * r.pct / 100, 2) end as gas
          from public.allocation_rule r
          cross join (select coalesce(sum(ingresos), 0) ingresos, coalesce(sum(gastos), 0) gastos from _c04_res where location_id is null) c
         where r.company_id = p_company and p_hasta between r.valid_from and coalesce(r.valid_to, p_hasta)) x;
      delete from _c04_res where location_id is null;
    end if;
  end if;

  return query
  select r.location_id, r.brand_id, sum(r.ingresos), sum(r.gastos), sum(r.ingresos) - sum(r.gastos),
         case when r.location_id is null and p_repartir then 'Común sin repartir: la regla de reparto no suma 100 % en esas fechas.'
              when r.location_id is null then 'Común: el informe puede repartirlo con tu regla de reparto.' end
    from _c04_res r
   group by r.location_id, r.brand_id
   order by r.location_id nulls last, r.brand_id nulls last;
end $$;
comment on function public.conta_resultado_por_local(uuid, date, date, boolean) is
  'C04. Ingresos (grupo 7) menos gastos (grupo 6) por local y marca en un periodo. Lo común sale aparte o, con p_repartir, por allocation_rule. La suma de las filas es el resultado total.';
revoke all on function public.conta_resultado_por_local(uuid, date, date, boolean) from public, anon;
grant execute on function public.conta_resultado_por_local(uuid, date, date, boolean) to authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'C04 0130: no existe el rol conta_lectura (normal en staging): no se da ningún permiso.';
    return;
  end if;
  grant select on table public.journal_entry, public.journal_line, public.journal_ledger, public.sales_day_summary,
                        public.payroll_summary, public.allocation_rule, public.entry_template, public.entry_template_line,
                        public.journal_correction, public.journal_dismissal to conta_lectura;
  -- El agente «Libro diario» recalcula cada huella (scripts/conta/agente-libro.sql).
  grant execute on function public.journal_entry_canonico(uuid) to conta_lectura;
  raise notice 'C04 0130: conta_lectura puede leer el libro diario.';
end $$;
