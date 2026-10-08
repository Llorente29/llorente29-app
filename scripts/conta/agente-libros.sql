-- scripts/conta/agente-libros.sql
--
-- Agente «Libro diario», parte del C05 (libros y balances). SOLO LEE: corre
-- con default_transaction_read_only=on, en staging-conta y en producción (rol
-- conta_lectura). El workflow solo lo lanza si public.vat_book_entry existe
-- (antes del C05 no hay qué mirar). Lo juzga scripts/conta/lib/libros.mjs.
--
-- Regla 9: cada fila lleva account_id y company_id. Sin nombres ni conceptos
-- (el informe va a un repositorio público): códigos de cuenta, líneas,
-- fechas e importes.
--
--   1. cuadre_mes           · a cada fin de mes del ejercicio abierto, Activo = PN + Pasivo con el modelo de la empresa.
--   2. sin_sitio            · ninguna cuenta con saldo sin línea en el modelo (la 774 en pymes, con su porqué).
--   3. fuera_con_saldo      · cuentas que el mapeo propio deja fuera y tienen saldo (aviso).
--   4. por_defecto          · cuántas cuentas con saldo van «colocadas por defecto» (aviso, con su lista).
--   5. otros_resultados     · 678/778 con saldo: la memoria tiene que explicarlos (aviso, C05b).
--   6. pyg_129              · tras la regularización validada, 6 y 7 a cero (el resultado está en la 129).
--   7. libro_diario         · por trimestre: cuotas del libro registro = movimiento de la 477 / 472 (sin la liquidación ni lo traído).
--   8. cerrado_con_asientos · ningún asiento validado en un ejercicio después de cerrarlo.

with
fy as (
  -- El ejercicio abierto de cada empresa que contiene hoy (o el último abierto).
  select distinct on (y.company_id) y.*
    from public.fiscal_year y
   where y.status = 'open'
   order by y.company_id, (current_date between y.starts_on and y.ends_on) desc, y.starts_on desc
),
modelo as (
  select f.account_id, f.company_id, f.id as fiscal_year_id, f.starts_on, f.ends_on,
         coalesce((select c.model from public.annual_accounts_choice c where c.fiscal_year_id = f.id),
                  case when (select ca.plan from public.company_account ca where ca.company_id = f.company_id limit 1) = 'general' then 'abreviado' else 'pymes' end) as modelo
    from fy f
),
mov as (
  -- Lo validado (y lo anulado, que su contraasiento compensa) del ejercicio abierto, por cuenta y mes.
  select m.account_id, m.company_id, coalesce(l.template_code, l.account_code) as tpl, l.account_code as code,
         date_trunc('month', l.entry_date)::date as mes, l.source_type, sum(l.debit) as debe, sum(l.credit) as haber
    from modelo m
    join public.journal_ledger l on l.company_id = m.company_id and l.entry_date between m.starts_on and m.ends_on
   group by 1, 2, 3, 4, 5, 6
),
cuentas as (
  -- Cada cuenta con movimiento en el ejercicio y su saldo a hoy (sin el asiento
  -- de cierre, que deja el balance a cero). Las de saldo 0 también: hacen
  -- falta para el cuadre de los meses pasados.
  select account_id, company_id, tpl, code, sum(debe) - sum(haber) as saldo
    from mov where source_type <> 'closing' or tpl !~ '^[1-5]'
   group by 1, 2, 3, 4
),
saldo as (select * from cuentas where saldo <> 0),
efectivo as (
  -- Dónde cae cada cuenta con saldo: el prefijo más largo manda; lo propio de
  -- la empresa sustituye a la serie del mismo prefijo y signo; dejar fuera tapa.
  select s.*, mo.modelo, top.line_code, top.origin, top.excluded,
         (select l.side from public.annual_accounts_line l where l.model = mo.modelo and l.statement = 'balance' and l.code = top.line_code) as lado
    from cuentas s
    join modelo mo on mo.company_id = s.company_id
    left join lateral (
      select m.line_code, m.origin, m.excluded
        from public.annual_accounts_mapping m
       where m.model = mo.modelo and m.statement = 'balance' and s.tpl like m.account_prefix || '%'
         and (m.company_id is null or m.company_id = s.company_id)
         and (m.by_balance is null or m.by_balance = case when s.saldo >= 0 then 'deudor' else 'acreedor' end)
         and not (m.company_id is null and exists (
               select 1 from public.annual_accounts_mapping p
                where p.company_id = s.company_id and p.model = m.model and p.statement = m.statement
                  and p.account_prefix = m.account_prefix and coalesce(p.by_balance, '') = coalesce(m.by_balance, '')))
       order by length(m.account_prefix) desc, (m.company_id is not null) desc, m.excluded desc
       limit 1) top on true
),
meses as (
  select mo.account_id, mo.company_id, mo.modelo, (date_trunc('month', g) + interval '1 month - 1 day')::date as fin_mes
    from modelo mo, generate_series(mo.starts_on, least(mo.ends_on, current_date), interval '1 month') g
)
select json_build_object(
  'contado', json_build_object(
    'empresas', (select count(*) from modelo),
    'cuentas_con_saldo', (select count(*) from saldo),
    'anotaciones', (select count(*) from public.vat_book_entry where voided_at is null),
    'ejercicios_cerrados', (select count(*) from public.fiscal_year where status = 'closed')),

  'cuadre_mes', (select coalesce(json_agg(x order by x->>'fin_mes'), '[]') from (
    select json_build_object('account_id', me.account_id, 'company_id', me.company_id, 'modelo', me.modelo, 'fin_mes', me.fin_mes,
           -- Activo (Debe − Haber) menos PN y pasivo (Haber − Debe) = la suma de Debe − Haber de todo lo colocado.
           'diferencia', round(sum(e.s), 2)) as x
      from meses me
      join lateral (
        -- Saldos a ese fin de mes, colocados con el mismo mapeo efectivo; lo que no tiene sitio no suma a ningún lado.
        select ef.lado, sum(mv.debe - mv.haber) as s
          from mov mv join efectivo ef on ef.company_id = mv.company_id and ef.code = mv.code
         where mv.company_id = me.company_id and mv.mes <= me.fin_mes and ef.line_code is not null and not ef.excluded
         group by ef.lado) e on true
     group by me.account_id, me.company_id, me.modelo, me.fin_mes
    having round(sum(e.s), 2) <> 0) t),

  'sin_sitio', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'modelo', e.modelo,
           'cuenta', e.code, 'saldo', round(e.saldo, 2),
           'porque', case when e.modelo = 'pymes' and e.tpl like '774%' then 'el modelo de pymes no tiene «Diferencia negativa de combinaciones de negocio»: va en rojo, nunca escondida en otra línea'
                          else 'ninguna línea del modelo la nombra' end)), '[]')
      from efectivo e where e.saldo <> 0 and e.line_code is null and e.tpl ~ '^[1-7]'),

  'fuera_con_saldo', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'modelo', e.modelo,
           'cuenta', e.code, 'saldo', round(e.saldo, 2))), '[]')
      from efectivo e where e.saldo <> 0 and e.excluded),

  'por_defecto', (select coalesce(json_agg(json_build_object('account_id', x.account_id, 'company_id', x.company_id, 'modelo', x.modelo,
           'cuentas', x.cuentas, 'n', x.n)), '[]')
      from (select account_id, company_id, modelo, count(*) as n, json_agg(code order by code) as cuentas
              from efectivo where saldo <> 0 and origin = 'defecto' and not excluded group by 1, 2, 3) x),

  'otros_resultados', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id,
           'cuenta', e.code, 'saldo', round(e.saldo, 2))), '[]')
      from saldo e where e.tpl ~ '^(678|778)'),

  'pyg_129', (select coalesce(json_agg(json_build_object('account_id', c.account_id, 'company_id', c.company_id, 'ejercicio', y.code,
           'cuentas', x.n, 'saldo', x.s)), '[]')
      from public.fiscal_year_closing c
      join public.fiscal_year y on y.id = c.fiscal_year_id
      join public.journal_entry r on r.id = c.regularization_entry_id and r.status = 'validado'
      join lateral (
        select count(*) as n, round(sum(abs(t.s)), 2) as s from (
          select coalesce(l.template_code, l.account_code) as tpl, sum(l.debit - l.credit) as s
            from public.journal_ledger l
           where l.company_id = c.company_id and l.entry_date between y.starts_on and y.ends_on
             and coalesce(l.template_code, l.account_code) ~ '^[67]'
           group by 1 having sum(l.debit - l.credit) <> 0) t) x on x.n > 0),

  'libro_diario', (select coalesce(json_agg(x order by x->>'trimestre'), '[]') from (
    select json_build_object('account_id', q.account_id, 'company_id', q.company_id, 'trimestre', q.trimestre, 'libro', q.libro,
           'en_libro', q.en_libro, 'en_diario', q.en_diario) as x
      from (
        select mo.account_id, mo.company_id, to_char(t.desde, 'YYYY') || '-' || extract(quarter from t.desde) || 'T' as trimestre, lb.libro,
               coalesce((select round(sum(v.tax_amount), 2) from public.vat_book_entry v
                          where v.company_id = mo.company_id and v.voided_at is null and v.source_type <> 'migrated'
                            and v.issue_date between t.desde and t.hasta
                            and (case when lb.libro = 'issued' then v.book = 'issued' else v.book in ('received', 'investment') end)), 0) as en_libro,
               coalesce((select round(sum(case when lb.libro = 'issued' then l.credit - l.debit else l.debit - l.credit end), 2)
                           from public.journal_ledger l
                          where l.company_id = mo.company_id and l.entry_date between t.desde and t.hasta
                            and l.source_type not in ('vat_settlement', 'migrated', 'closing', 'opening')
                            and coalesce(l.template_code, l.account_code) like case when lb.libro = 'issued' then '477%' else '472%' end), 0) as en_diario
          from modelo mo
          cross join lateral (select g::date as desde, (g + interval '3 month - 1 day')::date as hasta
                                from generate_series(date_trunc('quarter', mo.starts_on), least(mo.ends_on, current_date), interval '3 month') g) t
          cross join (values ('issued'), ('received')) lb(libro)) q
     where q.en_libro <> q.en_diario) z),

  'cerrado_con_asientos', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'ejercicio', y.code,
           'serie', e.series, 'numero', e.number, 'fecha', e.entry_date, 'validado', e.validated_at, 'cerrado', y.closed_at)), '[]')
      from public.fiscal_year y
      join public.journal_entry e on e.fiscal_year_id = y.id and e.status in ('validado', 'anulado')
     where y.status = 'closed' and y.closed_at is not null and e.validated_at > y.closed_at)
);
