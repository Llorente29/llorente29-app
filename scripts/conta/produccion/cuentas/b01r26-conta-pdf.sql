-- scripts/conta/produccion/cuentas/b01r26-conta-pdf.sql
--
-- B01r26 · el enlace del PDF (1805) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Solo añade objetos: antes no existen y después están vacíos. Nada más cambia.
--   1. Las dos tablas nuevas existen (antes 0, después 2), menos 2: −2 → 0.
--   2. Llaves de PDF: 0 → 0 (solo las da un traspaso confirmado, y no hay ninguno).
--   3. Traspasos a Diez: 0 → 0 (la 1805 no confirma ninguno).
select clave, valor from (
  -- quieta: el catálogo solo lo cambia una migración
  select 1 o, 'Tablas de la 1805 que existen, menos 2' clave,
    ((case when to_regclass('public.conta_pdf_llave') is null then 0 else 1 end) + (case when to_regclass('public.conta_pdf_acceso') is null then 0 else 1 end) - 2)::text valor
  union all
  -- quieta: con la tabla recién creada, nadie da llaves hasta que Julio confirme un traspaso
  select 2, 'Llaves de PDF',
    (case when to_regclass('public.conta_pdf_llave') is null then 0
          -- la tabla aún no existe antes de la tanda: se cuenta en una consulta que solo se ejecuta si existe
          else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_pdf_llave', false, true, '')))[1]::text::int end)::text
  union all
  -- quieta: un traspaso solo lo confirma Julio en su pantalla
  select 3, 'Traspasos a Diez', (select count(*) from public.conta_diez_traspaso)::text
) x order by o;
