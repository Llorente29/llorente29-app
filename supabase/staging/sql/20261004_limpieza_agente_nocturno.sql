-- supabase/staging/sql/20261004_limpieza_agente_nocturno.sql
--
-- SOLO STAGING-CONTA. Encargo de Julio (04/10): que el agente nocturno deje de
-- salir rojo.
--
-- 1. Borra la empresa «Llorente29 Food, S.L.» que Julio dio de alta a mano en
--    la cuenta A (03/10, 12:06). Los 5 fallos ROJOS del agente eran todos suyos
--    (111 sin 190, 115 sin 180, 202 sin 200, sin 347, IVA de ventas en nada).
--    Todo lo que cuelga de `company` cae en cascada (20 tablas, todas con
--    ON DELETE CASCADE; ninguna con company_id sin clave ajena: medido).
--    La vuelve a dar de alta cuando quiera, con el alta nueva.
-- 2. Rellena en la empresa de prueba B lo que no rompe ninguna prueba: forma
--    jurídica, constitución, registro, contacto, DEHú, plantilla y auditoría de
--    2026. NO toca actividad ni socios: la prueba e2e del C00 «cuenta B» cuenta
--    con que falten («Falta … a qué te dedicas», «Aún no has puesto socios ni
--    cargos»). Datos inventados, con la forma de los reales.
--
-- Regla 9: todo anclado por id Y account_id. Si algo no es exactamente lo
-- esperado, para y no queda nada (una transacción por fichero).

do $$
declare
  a_cuenta   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta   constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  llorente   constant uuid := 'e115801e-6840-4284-a822-559b853f25d6';
  b_empresa  constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  n int;
begin
  -- Guarda: esto es staging (ni Foodint ni Folvy Interno al otro lado).
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Hay cuentas de producción en esta base: no es staging-conta. No se toca nada.';
  end if;

  -- 1. Llorente29 Food, S.L., de la cuenta A, la que dio de alta Julio.
  delete from public.company
   where id = llorente and account_id = a_cuenta
     and tax_id = 'B56496938' and legal_name = 'Llorente29 Food, S.L.'
     and created_by = '2d1a4a73-99b6-4ffc-bd6f-9ef1da94647d';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Llorente29: esperaba borrar 1 empresa y serían %. No se toca nada.', n; end if;
  raise notice 'Borrada «Llorente29 Food, S.L.» (cuenta A) y todo lo suyo, en cascada.';

  -- 2. Empresa de prueba B: lo que no rompe la prueba e2e.
  update public.company
     set legal_form_code = 'nif_b',
         incorporated_on = date '2019-03-01',
         registry_name = 'Las Palmas', registry_volume = '2000', registry_folio = '1',
         registry_sheet = 'GC-50000', registry_entry = '1.ª',
         phone = '928000000',
         dehu_email = 'avisos.sur@prueba.folvy.test',
         updated_at = now()
   where id = b_empresa and account_id = b_cuenta and legal_name = 'Cocina de Prueba Sur, S.L.';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Empresa B: esperaba 1 fila y son %. No se toca nada.', n; end if;

  update public.fiscal_year
     set average_staff_fixed = 6, average_staff_temporary = 2, is_audited = false
   where company_id = b_empresa and account_id = b_cuenta and code = '2026';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Ejercicio 2026 de B: esperaba 1 fila y son %. No se toca nada.', n; end if;
  raise notice 'Empresa B: forma jurídica, constitución, registro, teléfono, DEHú, plantilla 6+2 y no auditada.';
end $$;

-- Cómo queda (sale en el registro del workflow).
select c.legal_name, c.legal_form_code, c.incorporated_on, c.registry_name, c.phone, c.dehu_email,
       y.code as ejercicio, y.average_staff_fixed, y.average_staff_temporary, y.is_audited,
       (select count(*) from public.company_activity a where a.company_id = c.id) as actividades,
       (select count(*) from public.company_person p where p.company_id = c.id) as personas
  from public.company c left join public.fiscal_year y on y.company_id = c.id
 where c.account_id = 'c01b0000-0000-4000-8000-00000000000b';
select count(*) as empresas_llorente29_que_quedan
  from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B56496938';
