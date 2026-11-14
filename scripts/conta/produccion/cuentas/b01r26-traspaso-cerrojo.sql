-- scripts/conta/produccion/cuentas/b01r26-traspaso-cerrojo.sql
--
-- B01r26 · el cerrojo de la tanda (0757) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Solo añade: una columna que admite nulos y dos funciones. Nada más cambia.
--   1. Traspasos a Diez: igual antes y después (la 0757 no crea ni quita ninguno).
--   2. Traspasos con el cerrojo puesto: 0 → 0 (la columna nace vacía).
select clave, valor from (
  -- quieta: un traspaso solo lo confirma Julio en su pantalla
  select 1 o, 'Traspasos a Diez' clave, (select count(*) from public.conta_diez_traspaso)::text valor
  union all
  -- quieta: la columna nace vacía y solo la pone una tanda de conta-diez-traspaso
  select 2, 'Traspasos con el cerrojo puesto',
    (case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_traspaso' and column_name = 'tanda_hasta') then 0
          else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_diez_traspaso where tanda_hasta is not null', false, true, '')))[1]::text::int end)::text
) x order by o;
