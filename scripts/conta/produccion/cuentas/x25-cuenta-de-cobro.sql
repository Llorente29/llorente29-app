-- scripts/conta/produccion/cuentas/x25-cuenta-de-cobro.sql
--
-- X25 · La «Cuenta de cobro» en la ficha del cliente (1800) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1800 solo cambia el disparador de company_account_link (su huella); no toca ningún enlace. Se mide, por cuenta
-- (regla 9: cada cifra con su account_id), cuántos enlaces «pago» de clientes y de proveedores hay, y la huella.
-- Corte fijo: lo creado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || l.account_id || ' · enlaces «pago» de ' || l.entity clave, count(*)::text valor
    from public.company_account_link l
   where l.role = 'pago' and l.entity in ('customer', 'supplier') and l.created_at < timestamptz '2026-11-22 00:00:00+01'
   group by l.account_id, l.entity
  union all
  select 2, 'tabla entera · company_account_link', count(*)::text
    from public.company_account_link where created_at < timestamptz '2026-11-22 00:00:00+01'
  union all
  select 3, 'función · company_account_misma_cuenta()', md5(p.prosrc)
    from pg_proc p where p.oid = 'public.company_account_misma_cuenta()'::regprocedure
) t order by o, clave;
