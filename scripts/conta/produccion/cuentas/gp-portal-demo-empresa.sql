-- scripts/conta/produccion/cuentas/gp-portal-demo-empresa.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 1345, antes y después. SOLO LEE. Solo cuentas demo.
--   1. La empresa de Talleres Ruiz en Sumied (cuenta demo …b1): 0 → 1.
--   2. Clientes de la demo con su empresa enlazada: 0 → 1.
--   3. Sus impuestos presentados: 0 → 4.
--   4. Sus documentos de laboral (nóminas y seguros sociales): 0 → los de sus trabajadores.
--   5. Accesos al portal de la demo: 1 → 2 (Lucía Pardo).
--   6. preparar y conta_portal_cuenta, la versión nueva: 0 → 2.
select clave, valor from (
  select 1 o, 'la empresa de Talleres Ruiz (demo)' clave,
    (select count(*)::text from public.accounts where id = 'de000000-0000-4000-8000-0000000000b1' and is_demo is true) valor
  union all select 2, 'clientes de la demo con su empresa',
    (select count(*)::text from public.conta_gestoria_cliente g join public.accounts a on a.id = g.account_id and a.is_demo is true where g.cuenta_propia_account_id is not null)
  union all select 3, 'impuestos presentados de esa empresa',
    (select count(*)::text from public.tax_return where account_id = 'de000000-0000-4000-8000-0000000000b1' and status = 'filed')
  union all select 4, 'documentos de laboral de esa empresa',
    (select count(*)::text from public.documents d join public.employees e on e.id = d.employee_id where e.account_id = 'de000000-0000-4000-8000-0000000000b1')
  union all select 5, 'accesos al portal de la demo',
    (select count(*)::text from public.conta_portal_acceso x join public.accounts a on a.id = x.account_id and a.is_demo is true where x.revocado_at is null)
  union all select 6, 'funciones del portal en su versión nueva',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and ((p.proname = 'conta_portal_demo_preparar' and position('0000000000b1' in p.prosrc) > 0)
                                   or (p.proname = 'conta_portal_cuenta' and position('conta_gc_cliente' in p.prosrc) > 0)))
) q order by o;
