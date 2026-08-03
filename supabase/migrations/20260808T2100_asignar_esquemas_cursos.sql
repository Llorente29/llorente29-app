-- ============================================================================
-- Folvy · Formación — ASIGNAR ESQUEMAS a las secciones de los cursos
-- ----------------------------------------------------------------------------
-- Enlaza los SVG de public/formacion/ con la sección que ilustran.
--
-- CRITERIO PEDAGÓGICO (docs/folvy_formacion_guia_contenido.md §4):
--   · ESQUEMA para lo invisible o abstracto (zona de peligro, contaminación
--     cruzada, por qué el calor no destruye el alérgeno).
--   · FOTO REAL para lo que hay que reconocer o ejecutar → esas quedan para
--     que cada cliente suba las suyas ("Usar foto propia", C3-A).
--   Por eso NO todas las secciones llevan imagen: una imagen que no enseña
--   nada distrae. Se ilustran las 6 ideas que más cuesta entender.
--
-- Los ficheros viven en el REPO (public/formacion/), no en Storage: son
-- contenido de producto de Folvy, versionados y servidos por CDN. Las fotos
-- propias del cliente sí van a Storage, namespaceadas por cuenta.
--
-- ⚠️ REQUIERE que los SVG estén desplegados (merge a main + deploy de Vercel).
--    Si se aplica antes, las rutas existirán en BD pero darán 404 hasta el deploy.
--
-- IDEMPOTENTE: sólo escribe media_url donde está vacío o ya apunta al mismo
-- fichero. NUNCA pisa una imagen que haya puesto un cliente (esas viven en las
-- copias de cuenta, no en la plantilla global, pero se protege igualmente).
--
-- Aplicada:
-- ============================================================================

do $img$
declare
  v_updated int := 0;
  v_total   int := 0;
begin

  -- Helper implícito: sólo plantillas globales (account_id is null).

  -- ── Manipulador ─────────────────────────────────────────────────────────
  update public.course_section s
     set media_url = '/formacion/zona-peligro-temperaturas.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'manipulador_alimentos' and s.ord = 2
     and coalesce(s.media_url, '') in ('', '/formacion/zona-peligro-temperaturas.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  update public.course_section s
     set media_url = '/formacion/lavado-de-manos.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'manipulador_alimentos' and s.ord = 3
     and coalesce(s.media_url, '') in ('', '/formacion/lavado-de-manos.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  update public.course_section s
     set media_url = '/formacion/orden-camara-frigorifica.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'manipulador_alimentos' and s.ord = 4
     and coalesce(s.media_url, '') in ('', '/formacion/orden-camara-frigorifica.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  -- ── Alérgenos ───────────────────────────────────────────────────────────
  update public.course_section s
     set media_url = '/formacion/contaminacion-cruzada.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'alergenos_intolerancias' and s.ord = 1
     and coalesce(s.media_url, '') in ('', '/formacion/contaminacion-cruzada.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  update public.course_section s
     set media_url = '/formacion/freidora-compartida-alergenos.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'alergenos_intolerancias' and s.ord = 4
     and coalesce(s.media_url, '') in ('', '/formacion/freidora-compartida-alergenos.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  update public.course_section s
     set media_url = '/formacion/anafilaxia-senales.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'alergenos_intolerancias' and s.ord = 6
     and coalesce(s.media_url, '') in ('', '/formacion/anafilaxia-senales.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  -- ── APPCC (reutiliza el de zona de peligro en su sección de PCC) ─────────
  update public.course_section s
     set media_url = '/formacion/zona-peligro-temperaturas.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'appcc_prerrequisitos' and s.ord = 3
     and coalesce(s.media_url, '') in ('', '/formacion/zona-peligro-temperaturas.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  -- ── Primeros auxilios ───────────────────────────────────────────────────
  update public.course_section s
     set media_url = '/formacion/anafilaxia-senales.svg'
    from public.course c
   where c.id = s.course_id and c.account_id is null
     and c.code = 'primeros_auxilios' and s.ord = 5
     and coalesce(s.media_url, '') in ('', '/formacion/anafilaxia-senales.svg');
  get diagnostics v_updated = row_count; v_total := v_total + v_updated;

  raise notice 'Esquemas asignados a % secciones.', v_total;

  if v_total = 0 then
    raise warning 'No se actualizó ninguna sección. ¿Están sembrados los cursos con estos codes y ords?';
  end if;
end
$img$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO) ───────────────────────────────────
-- select c.code, s.ord, s.title, s.media_url
--   from course_section s join course c on c.id = s.course_id
--  where c.account_id is null and s.media_url is not null
--  order by c.code, s.ord;
-- Esperado: 8 filas (6 esquemas distintos, 2 reutilizados en otro curso).
