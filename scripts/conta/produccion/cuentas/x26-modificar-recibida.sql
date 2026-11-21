-- scripts/conta/produccion/cuentas/x26-modificar-recibida.sql
--
-- X26 · «Modificar» una recibida contabilizada (1900) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1900 solo añade (una tabla y dos funciones): no cambia ningún asiento. Se mide que el diario y el libro de IVA no
-- se mueven: por cuenta (regla 9), cuántos asientos validados de recibidas y cuántas filas del libro de IVA; y cuántas
-- empresas tienen la cadena de huellas íntegra (la que «Modificar» vuelve a encadenar).
-- Corte fijo: lo creado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || e.account_id || ' · asientos validados de recibidas' clave, count(*)::text valor
    from public.journal_entry e
   where e.status = 'validado' and e.source_type = 'supplier_invoice' and e.created_at < timestamptz '2026-11-22 00:00:00+01'
   group by e.account_id
  union all
  select 2, 'cuenta ' || v.account_id || ' · filas del libro de IVA', count(*)::text
    from public.vat_book_entry v where v.created_at < timestamptz '2026-11-22 00:00:00+01' group by v.account_id
  union all
  select 3, 'todas las cuentas · empresas con la cadena de huellas rota', count(*)::text
    from public.company c where c.created_at < timestamptz '2026-11-22 00:00:00+01' and public._conta_cadena_rota(c.id) <> 0
) t order by o, clave;
