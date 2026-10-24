-- scripts/conta/produccion/cuentas/n7-laboral.sql
--
-- N7 (24/10) · LO QUE CUENTA LA TANDA DE LABORAL, antes y después. SOLO LEE.
-- Las nóminas se cuentan por cuenta (regla 9): las de Foodint y las de todas,
-- con su etiqueta.
--
-- Después del real: las dos columnas existen, ninguna nómina las tiene
-- rellenas (0 y 0), la función existe, y las nóminas no cambian de número.
select clave, valor from (
  select 1 o, 'payroll_cost · columnas irpf y employee_ss' clave,
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'payroll_cost' and column_name in ('irpf', 'employee_ss'))::text valor union all
  select 2, 'función fuente_nominas_mes_v1',
         (to_regprocedure('public.fuente_nominas_mes_v1(uuid, date)') is not null)::text union all
  select 3, 'payroll_cost · nóminas de Foodint',
         (select count(*) from public.payroll_cost where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 4, 'payroll_cost · nóminas de todas las cuentas (tabla entera)',
         (select count(*) from public.payroll_cost)::text
) t order by o;
