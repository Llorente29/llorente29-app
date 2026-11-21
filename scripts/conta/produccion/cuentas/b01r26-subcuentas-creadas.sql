-- scripts/conta/produccion/cuentas/b01r26-subcuentas-creadas.sql
--
-- B01r26 · las subcuentas creadas en Diez (1850) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Solo añade una tabla: antes no existe y después está vacía. Nada más cambia.
--   1. La tabla existe, menos 1: −1 → 0.
--   2. Subcuentas apuntadas como creadas en Diez: 0 → 0.
--   3. Traspasos a Diez: igual (la 1850 no confirma ninguno).
select clave, valor from (
  -- quieta: el catálogo solo lo cambia una migración
  select 1 o, 'Tabla de la 1850 que existe, menos 1' clave,
    ((case when to_regclass('public.conta_diez_subcuenta_creada') is null then 0 else 1 end) - 1)::text valor
  union all
  -- quieta: con la tabla recién creada, solo escribe en ella «Crearlas en Diez», que pulsa Julio
  select 2, 'Subcuentas apuntadas como creadas en Diez',
    (case when to_regclass('public.conta_diez_subcuenta_creada') is null then 0
          -- la tabla aún no existe antes de la tanda: se cuenta en una consulta que solo se ejecuta si existe
          else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_diez_subcuenta_creada', false, true, '')))[1]::text::int end)::text
  union all
  -- quieta: un traspaso solo lo confirma Julio en su pantalla
  select 3, 'Traspasos a Diez', (select count(*) from public.conta_diez_traspaso)::text
) x order by o;
