-- ============================================================================
-- Formación C5 — Pieza B: course.cover_url.
-- Encargo: docs/ENCARGO_CODE_formacion_c5_portadas.md §B.
--
-- Solo la columna. La asignación de las 13 portadas a las plantillas
-- globales es la migración YA ENTREGADA por Julio
-- (20260809T0200_asignar_portadas_cursos.sql, que ya trae su propio guard de
-- "no falles si cover_url no existe todavía" — por eso este archivo va
-- ANTES en el orden de aplicación: crea la columna que esa otra necesita).
--
-- ⚠️ RECON propio: esa migración de Julio asigna
-- '/formacion/portadas/prl.svg' a prl_riesgos_laborales, pero ese fichero
-- NO existe hoy en public/formacion/portadas/ (están los otros 12 SVG + 4
-- JPG de foto real, pero no prl.svg). No lo arreglo aquí — no es mi
-- migración — pero el resolver de portada (courseImagesService, capa 1/2/3)
-- se ha construido para que una imagen rota caiga al fondo por categoría en
-- vez de romper la tarjeta o dejarla en blanco, así que no bloquea nada
-- mientras Julio añade el fichero o cambia esa fila.
--
-- No copia cover_url a las copias ya adoptadas: al no existir la columna
-- todavía en NINGÚN curso (ni plantillas ni copias), no hay nada que
-- heredar en el momento de aplicar esta migración. adoptCourseForAccount ya
-- copia cover_url en las adopciones FUTURAS (mismo commit). Las copias que
-- adopten un curso que Julio aún no ha repoblado con portada simplemente
-- caen a la capa 2 (imagen de sección) o 3 (fondo de categoría) — nunca se
-- ven vacías, por diseño.
-- ============================================================================

alter table public.course
  add column if not exists cover_url text;

comment on column public.course.cover_url is
  'Portada del catálogo (16:9). Puede ser una ruta pública estática (/formacion/portadas/*, servida por Vercel desde public/) '
  'o un path del bucket privado course-section-images ({account_id}/covers/..., portada propia del cliente vía "Cambiar portada"). '
  'Resolución en 3 capas si es NULL: 1) cover_url, 2) primera course_section con media_url, 3) fondo por categoría en la UI. '
  'Se resuelve con courseImagesService.getSignedSectionImageUrls -- MISMA función que ya distingue ruta pública de path de Storage, sin resolver nuevo.';

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'cover_url'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.cover_url';
  end if;
  raise notice 'course.cover_url OK.';
end
$guard$;
-- ============================================================================
