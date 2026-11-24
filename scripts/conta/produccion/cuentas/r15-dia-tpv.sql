-- scripts/conta/produccion/cuentas/r15-dia-tpv.sql
--
-- R15 · Los días del TPV · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id; los ids cortados a 8,
-- sin nombres ni NIF):
--   1. los días del TPV por estado (guardado o contabilizado);
--   2. de los contabilizados, los que tienen facturas con NIF y los que tienen
--      devoluciones (días y facturas): son los que el R15b rehará en el formato bueno (una
--      línea por factura con NIF y por devolución);
--   3. los días con una factura sin NIF por encima del límite de la simplificada (art. 4
--      del Reglamento de facturación: 3.000 € en hostelería, 400 € si no).
-- Corte fijo: lo subido antes del 22/11/2026 a las 00:00 de Madrid. La tanda solo añade:
-- todo tiene que dar igual antes, con la tanda y después de deshacerla.
with d as (
  select d.account_id, d.company_id, d.id, d.estado,
         (select count(*) from public.conta_tpv_documento x where x.dia_id = d.id and x.cliente_nif is not null) nif,
         (select count(*) from public.conta_tpv_documento x where x.dia_id = d.id and x.total < 0) dev,
         (select count(*) from public.conta_tpv_documento x where x.dia_id = d.id and x.cliente_nif is null
             and x.total > case when c.sector = 'hosteleria' then 3000 else 400 end) sobre
    from public.conta_tpv_dia d join public.company c on c.id = d.company_id and c.account_id = d.account_id
   where d.subido_en < timestamptz '2026-11-22 00:00:00+01'
)
select clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · días del TPV · ' || estado clave, count(*)::text valor
    from d group by account_id, company_id, estado
  union all
  select 2, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · contabilizados con facturas con NIF',
         count(*) filter (where nif > 0) || ' días · ' || sum(nif) || ' facturas'
    from d where estado = 'contabilizado' group by account_id, company_id
  union all
  select 2, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · contabilizados con devoluciones',
         count(*) filter (where dev > 0) || ' días · ' || sum(dev) || ' devoluciones'
    from d where estado = 'contabilizado' group by account_id, company_id
  union all
  select 2, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · contabilizados con NIF o devoluciones (los que cambiará el R15b)',
         (count(*) filter (where nif > 0 or dev > 0))::text
    from d where estado = 'contabilizado' group by account_id, company_id
  union all
  select 3, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · días con un ticket por encima del límite de la simplificada',
         count(*) filter (where sobre > 0) || ' días · ' || sum(sobre) || ' tickets'
    from d group by account_id, company_id
  union all
  select 4, 'tabla entera · días del TPV', count(*)::text from d
) t order by o, clave;
