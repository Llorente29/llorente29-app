-- ============================================================================
-- Formación C7 — Generar curso desde el escandallo.
-- Encargo: docs/ENCARGO_CODE_formacion_c7_curso_desde_escandallo.md
-- RECON confirmado contra el esquema vivo (04/08 + hoy): recipe_item,
-- recipe_item_step (position/text/kind/duration_min/temperature_c/photo_url/
-- video_url), recipe_line, recipe_item_step_line (puente step_id/line_id),
-- recipe_item_allergen (ya calculado).
--
-- Solo DDL (columna + índice + una función). SIN backfill -- no hay nada que
-- corregir retroactivamente, es una capacidad nueva. SIN COMMIT/ROLLBACK en
-- ningún DO (lección de C6, [[feedback_sql_editor_transaccion_unica]]).
--
-- ⚠️ DECISIÓN DE ARQUITECTURA (diverge de la lectura literal del encargo,
-- explicada aquí porque no es obvia): esta RPC NO copia fotos. Postgres/
-- PL-pgSQL no tiene forma de mover bytes entre buckets de Storage -- no
-- existe un storage.copy_object() en SQL; los bytes viven fuera de Postgres
-- (S3-compatible), solo su METADATA está en storage.objects. Confirmado por
-- RECON: en todo el repo, ninguna migración toca storage.objects más allá de
-- policies RLS. La copia recipe-uploads -> course-section-images (el
-- hallazgo de C4/documentado en el encargo) solo puede hacerse desde
-- TypeScript (download + upload), nunca desde SQL.
--
-- Por eso el reparto de trabajo es:
--   1) Esta RPC hace TODO lo que sí es dato puro, de forma ATÓMICA (una sola
--      transacción real, a diferencia de courseAdoptionService.ts que hace
--      inserts secuenciales desde cliente): cabecera + secciones + test +
--      gesto práctico. Recibe el contenido YA CALCULADO como jsonb (el
--      cliente ya tiene servicios TS limpios y tipados para leer pasos/
--      líneas/alérgenos -- listStepsByRecipe, getRecipeBreakdown,
--      listItemAllergens -- reescribir esas consultas en PL/pgSQL sería
--      duplicar lógica ya probada sin necesidad).
--   2) El cliente, DESPUÉS de que esta RPC devuelva los ids de sección, copia
--      las fotos y hace un UPDATE de media_url normal (permitido por la RLS
--      de siempre, course_section_write) -- fuera de esta migración, en
--      courseFromRecipeService.ts.
--
-- Autorización: current_user_is_admin_or_manager_of(account_id) -- el mismo
-- nivel que exige escribir en course hoy (course_write, C1). belongs_to_account
-- (que menciona el encargo) es un wrapper MÁS LAXO -- "pertenece a la
-- cuenta" sin exigir rol -- pensado para policies de SELECT; usarlo aquí
-- solo dejaría crear cursos a cualquier empleado, no solo admin/manager.
-- Se documenta la sustitución en vez de aplicarla en silencio.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) course.source_recipe_item_id + anti-duplicado.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.course
  add column if not exists source_recipe_item_id uuid references public.recipe_item(id);

comment on column public.course.source_recipe_item_id is
  'Si este curso se generó desde un plato (C7), el recipe_item de origen. NULL = curso no generado (plantilla o creado a mano). '
  'Copia, no referencia: el contenido del curso NO se actualiza solo si cambia la receta -- hay que Regenerar explícitamente.';

create unique index if not exists course_source_recipe_unique
  on public.course (source_recipe_item_id)
  where source_recipe_item_id is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) generate_course_from_recipe — crea o REGENERA (si ya existe un curso con
--    ese source_recipe_item_id) el curso. Todo el contenido llega ya resuelto
--    en jsonb; esta función solo persiste, con guard multi-tenant y
--    atomicidad real.
--
--    p_sections:  [{ "ord": int, "title": text, "body": text, "sourcePhotoPath": text|null }, ...]
--    p_questions: [{ "ord": int, "text": text, "options": [{"text","isCorrect","explanation"}, ...] }, ...]
--
--    Devuelve: { courseId, version, regenerated, sections: [{id, ord, sourcePhotoPath}] }
--    -- el cliente usa "sections" para saber qué course_section.id le
--    corresponde a cada foto de origen, y así poder copiarla y actualizar
--    media_url después.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.generate_course_from_recipe(
  p_recipe_item_id uuid,
  p_title text,
  p_summary text,
  p_estimated_minutes int,
  p_sections jsonb,
  p_questions jsonb,
  p_practical_item_text text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_existing_course_id uuid;
  v_existing_version int;
  v_version int;
  v_course_id uuid;
  v_sec jsonb;
  v_new_section_id uuid;
  v_q jsonb;
  v_new_question_id uuid;
  v_opt jsonb;
  v_sections_out jsonb := '[]'::jsonb;
  v_regenerated boolean;
begin
  select account_id into v_account_id from public.recipe_item where id = p_recipe_item_id;
  if v_account_id is null then
    raise exception 'generate_course_from_recipe: receta % no encontrada', p_recipe_item_id;
  end if;

  if not (public.current_user_is_admin_or_manager_of(v_account_id) or public.current_user_is_admin()) then
    raise exception 'generate_course_from_recipe: sin acceso a la cuenta %', v_account_id;
  end if;

  select id, version into v_existing_course_id, v_existing_version
  from public.course
  where source_recipe_item_id = p_recipe_item_id and account_id = v_account_id;

  v_regenerated := v_existing_course_id is not null;

  if v_regenerated then
    v_version := coalesce(v_existing_version, 1) + 1;

    -- Secciones y preguntas SÍ se reemplazan por completo: la evidencia legal
    -- real es course_signature.course_version (qué versión firmó cada uno),
    -- no las filas de contenido -- mismo criterio que ya usa el editor manual
    -- al republicar (updateCourse: publicar de nuevo = subir version).
    -- course_option cae en cascada al borrar su course_question (C1).
    delete from public.course_section where course_id = v_existing_course_id;
    delete from public.course_question where course_id = v_existing_course_id;

    update public.course
    set title = p_title,
        summary = p_summary,
        estimated_minutes = p_estimated_minutes,
        version = v_version,
        status = 'draft' -- contenido nuevo, vuelve a exigir revisión (regla dura del encargo: "siempre borrador")
    where id = v_existing_course_id;

    v_course_id := v_existing_course_id;
  else
    v_version := 1;
    insert into public.course (
      account_id, code, title, summary, delivery_mode, reeval_months, is_mandatory,
      appcc_prerequisite, estimated_minutes, version, status,
      category, business_types, level, recommended_order, requires_practical,
      source_recipe_item_id
    ) values (
      v_account_id,
      'producto_' || p_recipe_item_id::text,
      p_title, p_summary, 'folvy_imparte', null, false,
      false, p_estimated_minutes, v_version, 'draft',
      'producto', '{todos}', 'especialista', null, true,
      p_recipe_item_id
    )
    returning id into v_course_id;
  end if;

  for v_sec in select * from jsonb_array_elements(p_sections)
  loop
    insert into public.course_section (course_id, ord, title, body, media_url)
    values (v_course_id, (v_sec->>'ord')::int, v_sec->>'title', v_sec->>'body', null)
    returning id into v_new_section_id;

    v_sections_out := v_sections_out || jsonb_build_object(
      'id', v_new_section_id,
      'ord', (v_sec->>'ord')::int,
      'sourcePhotoPath', v_sec->'sourcePhotoPath'
    );
  end loop;

  for v_q in select * from jsonb_array_elements(p_questions)
  loop
    insert into public.course_question (course_id, ord, text)
    values (v_course_id, (v_q->>'ord')::int, v_q->>'text')
    returning id into v_new_question_id;

    for v_opt in select * from jsonb_array_elements(v_q->'options')
    loop
      insert into public.course_option (question_id, text, is_correct, explanation)
      values (v_new_question_id, v_opt->>'text', (v_opt->>'isCorrect')::boolean, v_opt->>'explanation');
    end loop;
  end loop;

  -- Gesto práctico: NUNCA se borra en un regenerar. course_practical_check
  -- (C4) referencia course_practical_item SIN on delete cascade a propósito
  -- (es evidencia append-only) -- borrar el item si ya tiene una verificación
  -- real reventaría con una violación de FK, o peor, si algún día se le
  -- añade CASCADE, borraría evidencia real de que alguien ya lo verificó. El
  -- texto del gesto es un literal fijo (no depende de la receta), así que
  -- "regenerar" no tiene nada que actualizar aquí: solo se inserta si el
  -- curso todavía no tiene ninguno.
  if p_practical_item_text is not null and not exists (
    select 1 from public.course_practical_item where course_id = v_course_id
  ) then
    insert into public.course_practical_item (course_id, ord, text)
    values (v_course_id, 1, p_practical_item_text);
  end if;

  return jsonb_build_object(
    'courseId', v_course_id,
    'version', v_version,
    'regenerated', v_regenerated,
    'sections', v_sections_out
  );
end;
$function$;

grant execute on function public.generate_course_from_recipe(uuid, text, text, int, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real NO puede probarse aquí (no hay
-- acceso a la BBDD viva desde donde escribo esto) -- ver la nota de
-- verificación manual al final del fichero, que Julio debe seguir tras
-- aplicar.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'source_recipe_item_id'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.source_recipe_item_id';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'course' and indexname = 'course_source_recipe_unique'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course_source_recipe_unique';
  end if;
  if to_regprocedure('public.generate_course_from_recipe(uuid, text, text, int, jsonb, jsonb, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función generate_course_from_recipe';
  end if;
  raise notice 'C7 DDL OK: source_recipe_item_id + índice + generate_course_from_recipe.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN MANUAL (Julio, tras aplicar) — "prueba la ejecución, no solo
-- la creación" (lección de C2, repetida en el encargo de C7). No pude
-- ejecutar esta función yo mismo: no tengo acceso a la BBDD viva. Desde la
-- UI (botón "Crear curso de este plato" en la ficha de un plato real de
-- Llorente29 con pasos y fotos):
--
--   1) Genera el curso. Debe aparecer en Formación, categoría "Producto y
--      recetas", en borrador.
--   2) Abre el curso: la sección "Qué vas a preparar" debe tener la foto del
--      plato VISIBLE (no un hueco ni un icono roto) -- es justo donde el
--      cruce de buckets fallaría en silencio si algo está mal.
--   3) Si algún paso tenía foto propia, esa sección también debe mostrarla.
--   4) Pulsa "Regenerar" sobre el mismo plato: version debe subir a 2, el
--      curso sigue en borrador, y si ya habías firmado un intento antes de
--      regenerar, su acta debe seguir mostrando "v1" (course_signature.course_version
--      no cambia con la regeneración).
--
-- select code, title, version, status, source_recipe_item_id
--   from course where source_recipe_item_id is not null order by created_at desc;
-- ============================================================================
