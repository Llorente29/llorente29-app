-- scripts/conta/produccion/cuentas/r08-bancos.sql
--
-- R08 · Bancos: conciliar en un paso · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id; los ids, cortados a 8;
-- sin conceptos ni nombres). Corte fijo: lo creado antes del 20/11/2026 a las 00:00 de Madrid.
--   1. Los asientos de Bancos (los de un casado vivo), por estado del asiento: cuántos y por
--      cuánto; de los propuestos, cuántos no admite su periodo (IVA presentado, mes cerrado) y
--      cuántos ya salieron a ERP10.
--   2. La cadena de extractos de noviembre de cada banco, en orden (fecha final y llegada):
--      la apertura y el cierre de cada uno, lo nuevo que trae, el cierre del anterior y el
--      hueco que sale con la cadena (cierre − (cierre anterior + lo nuevo)), frente al que
--      guardó la lectura.
--   3. De cada banco con su 572: el cierre del último extracto y el saldo de la 572 en Sumied,
--      con lo validado y con lo propuesto.
with b as (
  select b.account_id, b.company_id, e.id, e.status, e.entry_date,
         (select coalesce(sum(l.debit), 0) from public.journal_line l where l.entry_id = e.id) importe
    from public.bank_match b join public.journal_entry e on e.id = b.journal_entry_id and e.account_id = b.account_id
   where b.status = 'vivo' and b.created_at < timestamptz '2026-11-20 00:00:00+01'
   group by b.account_id, b.company_id, e.id, e.status, e.entry_date
), st as (
  select s.*, (select coalesce(sum(m.amount), 0) from public.bank_movement m where m.statement_id = s.id) nuevo,
         (select count(*) from public.bank_movement m where m.statement_id = s.id) n
    from public.bank_statement s
   where s.period_to >= date '2026-10-25' and s.imported_at < timestamptz '2026-11-20 00:00:00+01'
), cad as (
  select st.*, lag(st.closing_balance) over (partition by st.treasury_account_id order by st.period_to, st.imported_at, st.id) cierre_anterior,
         row_number() over (partition by st.treasury_account_id order by st.period_to, st.imported_at, st.id) orden
    from st where st.closing_balance is not null
), ult as (
  select distinct on (s.treasury_account_id) s.treasury_account_id, s.company_id, s.account_id, s.closing_balance, s.period_to
    from public.bank_statement s where s.closing_balance is not null and s.imported_at < timestamptz '2026-11-20 00:00:00+01'
   order by s.treasury_account_id, s.period_to desc, s.imported_at desc, s.id desc
)
select clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · asientos de Bancos ' || status clave,
         count(*) || ' (' || sum(importe)::numeric(14,2) || ' €)'
         || case when status in ('propuesto', 'borrador') then
              ' · su periodo no los admite ' || count(*) filter (where public._conta_periodo_admite(id) is not null)
              || ' · ya salidos a ERP10 ' || count(*) filter (where exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = b.id and p.estado = 'salida'))
            else '' end valor
    from b group by account_id, company_id, status
  union all
  select 2, 'banco ' || left(treasury_account_id::text, 8) || ' · extracto ' || lpad(orden::text, 3, '0') || ' · ' || to_char(period_from, 'DD/MM') || '–' || to_char(period_to, 'DD/MM')
         || ' llegó ' || to_char(imported_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI'),
         'apertura ' || coalesce(opening_balance::text, '—') || ' · cierre ' || closing_balance || ' · nuevos ' || n || ' por ' || nuevo
         || ' · cierre anterior ' || coalesce(cierre_anterior::text, '—')
         || ' · hueco por la cadena ' || coalesce((closing_balance - (cierre_anterior + nuevo))::text, '—')
         || ' · la lectura dijo ' || coalesce(continuity, '—') || coalesce(' ' || continuity_gap, '')
    from cad
  union all
  select 3, 'banco ' || left(u.treasury_account_id::text, 8) || ' · empresa ' || left(u.company_id::text, 8) || ' · ' || coalesce(a.code, 'sin 572'),
         'último extracto ' || to_char(u.period_to, 'DD/MM') || ' cierra ' || u.closing_balance
         || ' · Sumied validado ' || coalesce((select sum(l.debit - l.credit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
              where l.company_account_id = a.id and e.status in ('validado', 'anulado') and e.entry_date <= u.period_to and e.source_type <> 'closing'), 0)
         || ' · con lo propuesto ' || coalesce((select sum(l.debit - l.credit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
              where l.company_account_id = a.id and e.status in ('validado', 'anulado', 'propuesto') and e.entry_date <= u.period_to and e.source_type <> 'closing'), 0)
    from ult u join public.treasury_account t on t.id = u.treasury_account_id
    left join public.company_account_link k on k.entity = 'bank_account' and k.entity_id = t.id::text and k.role = 'principal' and k.company_id = t.company_id
    left join public.company_account a on a.id = k.company_account_id
) t order by o, clave;
