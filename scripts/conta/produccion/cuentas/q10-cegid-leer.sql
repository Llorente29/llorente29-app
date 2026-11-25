-- scripts/conta/produccion/cuentas/q10-cegid-leer.sql
--
-- Q10 · Leer la facturación de Cegid (1840) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: el conector «diezrec» (0 → 1) y las tres tablas (no están → están, vacías). Lo demás,
-- igual: los conectores que ya había (su huella).
select clave, valor from (
  select 1 o, 'conector diezrec' clave, (select count(*) from public.connector where code = 'diezrec')::text valor
  union all
  select 2, 'tablas de lo leído de Cegid',
    -- quieta: solo las crea esta tanda; las llena conta-cegid-leer cuando Julio pulsa «Leer de Cegid», no el real
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('conta_cegid_cliente', 'conta_cegid_concepto', 'conta_cegid_factura'))::text
  union all
  select 3, 'quietos · huella de los demás conectores',
    -- quieta: el catálogo de conectores solo lo cambia una migración
    coalesce(md5(string_agg(code || '=' || name, '|' order by code)), '-') from public.connector where code <> 'diezrec'
) t order by o, clave;
