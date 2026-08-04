-- ============================================================================
-- Folvy · Formación — ASIGNAR PORTADAS a los cursos (cover_url)
-- ----------------------------------------------------------------------------
-- Portada por curso, con la estrategia mixta acordada:
--   · FOTO REAL donde tenemos una buena (4 cursos) — es lo que vende en demo.
--   · ILUSTRACIÓN SVG de marca en el resto (9 cursos) — coherente y sin huecos.
-- Sustituir una SVG por foto en el futuro = cambiar su cover_url. Sin rediseño.
--
-- ⚠️ REQUIERE el campo course.cover_url, que crea el encargo C5. Esta migración
--    NO falla si aún no existe: avisa y no hace nada (guard al principio).
-- ⚠️ REQUIERE que los ficheros estén desplegados (merge a main + deploy Vercel).
--    Aplicada antes, las rutas existirían en BD pero darían 404.
--
-- IDEMPOTENTE: solo escribe donde cover_url está vacío o ya apunta al mismo
-- fichero. NUNCA pisa una portada que haya puesto un cliente en su copia.
-- Solo toca PLANTILLAS GLOBALES (account_id is null).
--
-- Aplicada:
-- ============================================================================

do $cover$
declare
  v_n int; v_total int := 0;
  r record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name='course' and column_name='cover_url') then
    raise warning 'Falta course.cover_url (lo crea el encargo C5). No se ha asignado ninguna portada.';
    return;
  end if;

  for r in
    select * from (values
      -- ── FOTOS REALES (1200x675, seleccionadas por Julio) ────────────────
      ('embolsado_delivery',        '/formacion/portadas/embolsado.jpg'),
      ('temperatura_ruta_delivery', '/formacion/portadas/temperatura_ruta.jpg'),
      ('estacion_kds',              '/formacion/portadas/estacion_kds.jpg'),
      ('igualdad_acoso',            '/formacion/portadas/igualdad.jpg'),
      -- ── ILUSTRACIONES SVG DE MARCA (pendientes de foto mejor) ───────────
      ('manipulador_alimentos',     '/formacion/portadas/manipulador.svg'),
      ('alergenos_intolerancias',   '/formacion/portadas/alergenos.svg'),
      ('appcc_prerrequisitos',      '/formacion/portadas/appcc.svg'),
      ('lgtbi_no_discriminacion',   '/formacion/portadas/lgtbi.svg'),
      ('proteccion_datos_rgpd',     '/formacion/portadas/rgpd.svg'),
      ('canal_denuncias',           '/formacion/portadas/canal_denuncias.svg'),
      ('primeros_auxilios',         '/formacion/portadas/primeros_auxilios.svg'),
      ('prl_riesgos_laborales',     '/formacion/portadas/prl.svg'),
      ('incidencias_delivery',      '/formacion/portadas/incidencias.svg')
    ) as t(code, cover)
  loop
    execute format(
      'update public.course set cover_url = %L
        where code = %L and account_id is null
          and coalesce(cover_url, '''') in ('''', %L)',
      r.cover, r.code, r.cover);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  raise notice 'Portadas asignadas: % cursos.', v_total;
  if v_total = 0 then
    raise warning 'Ninguna portada asignada. ¿Están sembrados los cursos con estos codes?';
  end if;
end
$cover$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO) ───────────────────────────────────
-- select code, category,
--        case when cover_url like '%.jpg' then 'FOTO' else 'ilustración' end as tipo,
--        cover_url
--   from course where account_id is null
--  order by tipo, code;
-- Esperado: 13 filas · 4 FOTO · 9 ilustración.
