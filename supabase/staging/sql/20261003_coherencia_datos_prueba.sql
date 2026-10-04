-- ============================================================================
-- Staging-conta · Las empresas DE PRUEBA de A y B, coherentes con la regla de
-- los modelos (respuesta 3 del C00, puntos 2 y 4). SOLO STAGING.
-- ----------------------------------------------------------------------------
-- El agente de coherencia, la primera vez, encontró que las dos empresas de la
-- semilla (seed_c00_empresas_prueba.sql) no cumplían la regla nueva: 111 sin
-- 190, 202 sin 200, sin 347, y el restaurante de A sin el IVA de sus ventas al
-- 10 %. Son datos de prueba de antes de la regla: se ponen como queda ahora la
-- semilla. Se quedan en la prueba fija del agente como FALLOS REALES
-- (tests/conta/cumplimiento/datos/coherencia-staging-20261003.json).
--
-- NO se toca «Llorente29 Food, S.L.», que dio de alta Julio en la vista
-- previa: es el caso de la respuesta 3 y el agente lo tiene que seguir viendo.
--
-- Guardas: solo en staging-conta (ninguna cuenta fuera de las de prueba), y
-- cada empresa por su cuenta y su NIF de la semilla. Si no está, no hace nada.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c_cuenta constant uuid := 'c01c0000-0000-4000-8000-00000000000c';
  n integer;
begin
  if exists (select 1 from public.accounts where id not in (a_cuenta, b_cuenta, c_cuenta)) then
    raise exception 'ABORTADO: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;

  update public.company_tax_profile p
     set tax_forms = array['111', '115', '180', '190', '200', '202', '303', '347', '390'], sales_tax_rate_code = 'iva_reducido'
    from public.company c
   where c.id = p.company_id and c.account_id = a_cuenta and c.tax_id = 'B28000016' and p.account_id = a_cuenta;
  get diagnostics n = row_count;
  raise notice 'A (Taberna de Prueba Norte): % fila', n;

  update public.company_tax_profile p
     set tax_forms = array['111', '190', '200', '202', '347']
    from public.company c
   where c.id = p.company_id and c.account_id = b_cuenta and c.tax_id = 'B35000017' and p.account_id = b_cuenta;
  get diagnostics n = row_count;
  raise notice 'B (Cocina de Prueba Sur): % fila', n;
end $$;
