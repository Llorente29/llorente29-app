-- scripts/conta/produccion/cuentas/k11g-347.sql
--
-- K11g · El 347 desde los libros · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade una función que lee (conta_347_desde_los_libros): no escribe en ningún libro. Regla 31, por empresa
-- (con su cuenta, regla 9): cuántos apuntes tiene en los libros de IVA y la huella de su total por libro, y la huella del
-- 347 de ventas de antes (conta_347_ventas_por_cliente, que no cambia) de 2026. Todo igual antes y después. Corte fijo
-- en el pasado: lo apuntado antes del 22/11/2026.
with v as (
  select v.account_id, v.company_id, v.book, v.total
    from public.vat_book_entry v
   where v.voided_at is null and v.created_at < timestamptz '2026-11-22 00:00:00+01'
)
select clave, valor from (
  select account_id, company_id,
         'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · regla 31: apuntes de los libros de IVA · huella de los totales por libro' clave,
         count(*)::text || ' · ' || left(md5(string_agg(book || '=' || total::text, ';' order by book, total)), 12) valor
    from v group by account_id, company_id
) t order by account_id, company_id;
