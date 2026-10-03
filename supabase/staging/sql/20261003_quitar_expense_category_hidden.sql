-- ============================================================================
-- Staging-conta · Quitar expense_category_hidden. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Respuesta 2 de Julio (C00): la tabla del C01 para ocultar tipos de gasto se
-- quita de su migración (20261002T0100) antes de llegar a producción; el C00
-- oculta filas de cualquier tabla general por empresa, en general_row_setting.
-- En producción no existe ni existirá. Aquí se aplicó con el C01, así que se
-- quita para que staging-conta sea lo que dicen las migraciones.
--
-- Guardas: solo en staging-conta (ninguna cuenta fuera de las de prueba) y
-- solo si está vacía (medido el 03/10: 0 filas, 0 claves ajenas que apunten
-- a ella, 0 vistas). Si algo de eso no se cumple, aborta sin tocar nada.
-- ============================================================================

do $$
begin
  if exists (select 1 from public.accounts where id not in
      ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b')) then
    raise exception 'ABORTADO: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;
  if to_regclass('public.expense_category_hidden') is null then
    raise notice 'expense_category_hidden ya no existe: nada que hacer.';
    return;
  end if;
  if exists (select 1 from public.expense_category_hidden) then
    raise exception 'ABORTADO: expense_category_hidden tiene filas; no se borra nada con datos.';
  end if;
  drop table public.expense_category_hidden;
  raise notice 'expense_category_hidden quitada (estaba vacía).';
end $$;
