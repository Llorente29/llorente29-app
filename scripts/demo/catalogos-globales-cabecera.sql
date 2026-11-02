-- ============================================================================
-- DM1 · 2b-2 · CATÁLOGOS GLOBALES DE FOLVY, tal y como están en producción.
-- ----------------------------------------------------------------------------
-- Generado por .github/workflows/volcar-catalogos-globales.yml con
-- scripts/demo/catalogos-globales-volcar.sql (solo lectura). No se edita a mano:
-- se vuelve a volcar. Solo filas que no son de ninguna cuenta, con sus id de
-- producción (los lotes y la foto de Casa Lola los usan). Se puede pasar dos
-- veces: cada INSERT lleva ON CONFLICT DO NOTHING.
-- Guarda: no carga en una base con cuentas de producción.
-- ============================================================================

do $guarda$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Catálogos globales: esta base tiene cuentas de producción. No se carga nada.';
  end if;
end $guarda$;

