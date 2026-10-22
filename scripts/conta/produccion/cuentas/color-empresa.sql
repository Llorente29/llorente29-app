-- scripts/conta/produccion/cuentas/color-empresa.sql
--
-- S02 · LO QUE CUENTA LA TANDA «EL COLOR DE LA EMPRESA» (0440), antes y
-- después. SOLO LEE. Antes: sin columna ni comprobación. Después: con las dos y
-- ninguna empresa con color (la tanda no toca filas). Y que no se pierde ni se
-- mueve ninguna empresa.
-- TABLA ENTERA, a propósito y dicho (regla 9): la columna es de todas las cuentas.
select clave, valor from (
  select 1 o, 'columna company.color' clave,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color')::text valor union all
  select 2, 'comprobación company_color_formato',
         exists (select 1 from pg_constraint where conname = 'company_color_formato' and conrelid = 'public.company'::regclass)::text union all
  select 3, 'empresas (todas las cuentas)', (select count(*) from public.company)::text union all
  select 4, 'empresas con color (todas las cuentas)',
         (select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color')
                      then (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.company where color is not null', false, true, '')))[1]::text
                      else 'sin columna' end)
) t order by o;
