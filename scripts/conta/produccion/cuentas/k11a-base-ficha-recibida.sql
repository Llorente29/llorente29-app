-- scripts/conta/produccion/cuentas/k11a-base-ficha-recibida.sql
--
-- K11a · La base de la ficha de la recibida · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Regla 31, por cuenta (regla 9: account_id, sus 8 primeras cifras): las recibidas VALIDADAS (con su asiento
-- validado), cuántas son y la huella de todos sus asientos (cada apunte: cuenta, debe, haber, tipo de IVA, base,
-- libro, deducible, local y marca, por posición). La tanda no escribe en ninguna recibida ni en ningún asiento: las
-- columnas nuevas nacen vacías (vacío = 100 % deducible, sin plataforma), así que la huella es la misma antes y
-- después. Escrito sin las columnas de la tanda, para que valga antes de aplicarla. Corte fijo: lo creado antes del
-- 23/11/2026 a las 00:00 de Madrid.
with v as (
  select i.account_id, e.id as entry_id
    from public.supplier_invoice i
    join public.journal_entry e on e.account_id = i.account_id and e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado'
   where i.status not in ('anulada', 'descartada') and i.created_at < timestamptz '2026-11-23 00:00:00+01'
     and e.created_at < timestamptz '2026-11-23 00:00:00+01'
), h as (
  select v.account_id, count(distinct v.entry_id) as recibidas,
         md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', v.entry_id, l.position, c.code, l.debit, l.credit, coalesce(l.tax_rate_id::text, ''),
                               coalesce(l.tax_base::text, ''), coalesce(l.vat_book, ''), coalesce(l.vat_deductible, ''), coalesce(l.location_id::text, ''),
                               coalesce(l.brand_id::text, '')), ';' order by v.entry_id, l.position)) as huella
    from v join public.journal_line l on l.entry_id = v.entry_id
    join public.company_account c on c.id = l.company_account_id
   group by v.account_id
)
select clave, valor from (
  select h.account_id, 'cuenta ' || left(h.account_id::text, 8) || ' · regla 31: recibidas validadas · huella de sus asientos' clave,
         h.recibidas || ' · ' || h.huella valor from h
) t order by account_id;
