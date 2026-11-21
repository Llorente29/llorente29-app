-- scripts/conta/produccion/cuentas/x20-subcuenta-con-codigo.sql
--
-- X20 · Crear una subcuenta como en ERP10 (0930) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade una función. Se mide que el plan de las empresas sigue igual (tabla entera, a
-- propósito: regla 9, excepción). Corte fijo: lo creado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · company_account' clave, count(*)::text valor
    from public.company_account where created_at < timestamptz '2026-11-22 00:00:00+01'
  union all
  select 2, 'tabla entera · company_account_log subcuentas creadas', count(*)::text
    from public.company_account_log where que = 'subcuenta_creada' and done_at < timestamptz '2026-11-22 00:00:00+01'
) t order by o, clave;
