-- scripts/conta/produccion/cuentas/b01r22-niveles.sql
--
-- B01·22 · El nivel de cada propuesta (0027) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0027 solo añade (dos columnas que admiten nulos, una tabla y dos funciones): no cambia ni un
-- movimiento ni un casado. Se mide que todo sigue igual: los movimientos y los casados vivos de
-- Foodint, y los ajustes de Bancos de todas las empresas.
select clave, valor from (
  -- corte: movimientos de Foodint creados antes del 13/11 a las 00:00
  select 1 o, 'Foodint: movimientos ' || s.estado clave,
    (select count(*)::text from public.bank_movement m
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.created_at < timestamptz '2026-11-13 00:00:00+01' and m.status = s.estado) valor
    from (values ('pendiente'), ('propuesto'), ('por_aclarar'), ('casado'), ('ignorado')) s(estado)
  union all
  -- corte: los casados vivos de Foodint creados antes del 13/11 (huella)
  select 2, 'Foodint: huella de los casados vivos',
    (select coalesce(md5(string_agg(b.id::text || ':' || b.movement_id::text, ',' order by b.id)), 'ninguno') from public.bank_match b
      where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.created_at < timestamptz '2026-11-13 00:00:00+01' and b.status = 'vivo')
  union all
  -- quieta: los ajustes de Bancos de todas las empresas (tabla entera, a propósito)
  select 3, 'Todas: huella de bank_settings',
    (select coalesce(md5(string_agg(x.company_id::text || ':' || x.treasury_series::text || ':' || x.validate_safe::text, ',' order by x.company_id)), 'ninguno') from public.bank_settings x)
) t order by o, clave;
