-- ============================================================================
-- Folvy · Formación — CAPTURAS DE LA APP en las secciones de curso
-- ----------------------------------------------------------------------------
-- Criterio pedagógico (guía §4): para EJECUTAR un procedimiento dentro de una
-- herramienta, lo que enseña es ver la herramienta. Estas no son fotos
-- decorativas: son la pantalla real que el trabajador va a tener delante.
--
-- ⚠️ PRIVACIDAD: las capturas provienen de la cuenta real y se han difuminado
--    los datos sensibles (nombre del local, importes de coste y de merma).
--    Se ven los conceptos (gramajes, food cost, fiabilidad del dato, botones),
--    no las cifras del negocio. Las van a ver empleados de TODOS los clientes.
--    → Si en el futuro se recapturan, hacerlo en `Folvy Interno` (sandbox).
--
-- ASIGNACIÓN:
--   escandallo_fichas_tecnicas · sección 2 → la ficha con ingredientes y coste
--   escandallo_fichas_tecnicas · sección 5 → el Teórico vs Real (AvT)
--   incidencias_delivery       · sección 2 → agotar/reactivar producto (el 86)
--
-- ⚠️ REQUIERE que los ficheros estén desplegados (merge + deploy de Vercel).
-- IDEMPOTENTE: solo escribe donde media_url está vacío o ya apunta al mismo
-- fichero. Nunca pisa una imagen puesta por un cliente. Solo plantillas globales.
-- Aplicada:
-- ============================================================================

do $caps$
declare
  v_n int; v_total int := 0;
  r record;
begin
  for r in
    select * from (values
      ('escandallo_fichas_tecnicas', 2, '/formacion/capturas/escandallo_ficha.png'),
      ('escandallo_fichas_tecnicas', 5, '/formacion/capturas/escandallo_avt.png'),
      ('incidencias_delivery',       2, '/formacion/capturas/estacion_disponibilidad.png')
    ) as t(code, ord, img)
  loop
    update public.course_section s
       set media_url = r.img
      from public.course c
     where c.id = s.course_id
       and c.account_id is null
       and c.code = r.code
       and s.ord  = r.ord
       and coalesce(s.media_url, '') in ('', r.img);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  raise notice 'Capturas asignadas a % secciones.', v_total;
  if v_total = 0 then
    raise warning 'Ninguna captura asignada. ¿Están sembrados los cursos y con esos ord?';
  end if;
end
$caps$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO) ───────────────────────────────────
-- select c.code, s.ord, s.title, s.media_url
--   from course_section s join course c on c.id = s.course_id
--  where c.account_id is null and s.media_url like '/formacion/capturas/%'
--  order by c.code, s.ord;
-- Esperado: 3 filas.
