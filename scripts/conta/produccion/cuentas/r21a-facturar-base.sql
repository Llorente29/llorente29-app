-- scripts/conta/produccion/cuentas/r21a-facturar-base.sql
--
-- R21 · PR 1 · «Facturar el mes» · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade dos tablas nuevas (vacías) y sus funciones: no toca lo que ya hay. Se cuenta, de TABLA ENTERA
-- (regla 9: así siempre hay una fila, también en staging) y dicho así, lo que la pantalla usa y la tanda no cambia: las
-- decisiones del banco y lo mandado a Cegid. Corte fijo: lo anterior al 28/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · decisiones de cobros del banco y de la tarjeta' clave, count(*)::text valor
    from public.conta_banco_decision d where d.at < timestamptz '2026-11-28 00:00:00+01'
  union all
  select 2, 'tabla entera · líneas mandadas a Cegid', count(*)::text
    from public.conta_cegid_incidencia i where i.mandada_at < timestamptz '2026-11-28 00:00:00+01'
) t order by o, clave;
