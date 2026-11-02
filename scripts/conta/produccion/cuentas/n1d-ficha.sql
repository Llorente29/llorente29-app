-- scripts/conta/produccion/cuentas/n1d-ficha.sql
--
-- N1 · PR 2 · paso 1 (02/11) · LO QUE CUENTA LA TANDA (0817, 0830, 0831),
-- antes y después. SOLO LEE.
-- quieta: los catálogos nacen con su contenido oficial y nadie escribe en ellos desde la aplicación.
select clave, valor from (
  select 1 o, 'catálogos oficiales con su fuente (antes 0, después 9)' clave,
    (case when to_regclass('public.lab_catalogo_fuente') is null then '0'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.lab_catalogo_fuente', false, true, '')))[1]::text end) valor
  union all
  select 2, 'filas de los catálogos (antes 0, después 846)',
    (case when to_regclass('public.lab_catalogo') is null then '0'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.lab_catalogo', false, true, '')))[1]::text end)
  union all
  select 3, 'funciones de la ficha (antes 0, después 3: leer, poner la categoría y poner el IBAN)',
    ((to_regprocedure('public.lab_ficha(uuid)') is not null)::int + (to_regprocedure('public.lab_poner_categoria(uuid,text,text)') is not null)::int
     + (to_regprocedure('public.lab_poner_iban(uuid,text)') is not null)::int)::text
  union all
  select 4, 'el volcado dice «no traía centro» (antes 0, después 1)',
    (position('no traía centro' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0)::int::text
) t order by o;
