-- scripts/conta/produccion/cuentas/e10-factura-larga.sql
--
-- E10 · La factura larga se lee entera · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id; los ids cortados a 8, sin nombres ni NIF):
--   1. Las llegadas sin leer, por clase y causa (document_inbox en «error»): entre ellas, las que llegaron
--      cortadas («documento · cortada») y las de antes del E02, sin clase (las dos del 17/11). Son las que se
--      vuelven a leer con «Leerla» cuando ocr-albaran esté desplegado.
--   2. Las lecturas en modo factura que se cortaron (goods_receipt_ai_session en «failed» con causa «cortada»).
--   3. Las lecturas por partes (validation.lineas): ninguna antes del E10.
-- La tanda solo añade una función: todo da igual antes, con la tanda y después de deshacerla.
-- Corte fijo: lo llegado antes del 23/11/2026 a las 12:00 de Madrid.
with l as (
  select 'cuenta ' || left(i.account_id::text, 8) || ' · empresa ' || left(coalesce(i.company_id::text, 'sin'), 8) as k, i.*
    from public.document_inbox i
   where i.created_at < timestamptz '2026-11-23 12:00:00+01'
), s as (
  select 'cuenta ' || left(x.account_id::text, 8) as k, x.*
    from public.goods_receipt_ai_session x
   where x.created_at < timestamptz '2026-11-23 12:00:00+01'
)
select clave, valor from (
  select 1 o, k || ' · llegadas sin leer · ' || coalesce(read_failure, 'sin clase') || coalesce(' · ' || read_failure_cause, '') clave, count(*)::text valor
    from l where status = 'error' group by k, read_failure, read_failure_cause
  union all
  select 2, k || ' · lecturas cortadas (failed, cortada)', count(*)::text
    from s where status = 'failed' and validation->'fallo'->>'causa' = 'cortada' group by k
  union all
  select 3, k || ' · lecturas por partes (validation.lineas)', count(*)::text
    from s where validation ? 'lineas' group by k
  union all
  select 4, 'tabla entera · llegadas sin leer', count(*)::text from l where status = 'error'
  union all
  select 4, 'tabla entera · lecturas por partes', count(*)::text from s where validation ? 'lineas'
) t order by o, clave;
