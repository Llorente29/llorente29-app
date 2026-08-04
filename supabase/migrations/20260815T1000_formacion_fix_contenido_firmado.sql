-- ============================================================================
-- Formación — Auditoría externa 1.5: el contenido firmado es destruible.
--
-- generate_course_from_recipe hace DELETE de course_section/course_question
-- al "Regenerar" -- el comentario original decía "la evidencia legal real es
-- course_signature.course_version, no las filas de contenido". Eso no se
-- sostiene: course_version es solo un número. Si se borra el contenido, el
-- acta puede decir "firmó la v1" pero no queda NADA que muestre qué decía la
-- v1 -- ni el texto de las secciones, ni las preguntas, ni qué opción era la
-- correcta.
--
-- ARREGLO (opción elegida, de las dos que planteaba el encargo): snapshot
-- del contenido DENTRO de la firma, no versionado de las tablas de
-- contenido. Un versionado real (course_section.version, course_question.version)
-- obligaría a añadir el filtro "versión actual" en CADA sitio que lee
-- contenido (editor, vista previa, móvil del empleado) -- mucho más
-- superficie de cambio para el mismo objetivo. El snapshot es más preciso
-- además: congela EXACTAMENTE lo que esa persona vio y firmó en ESE
-- instante, sin depender de que nadie edite el contenido "de la misma
-- versión" por error después.
--
-- course_signature.content_snapshot (jsonb) se rellena:
--   1) SIEMPRE al firmar (sign_course_attempt) -- de aquí en adelante, toda
--      firma nueva lleva su propio contenido congelado, pase lo que le pase
--      después al curso (editado a mano, o regenerado desde receta).
--   2) Como rescate, justo ANTES de borrar, en generate_course_from_recipe:
--      cualquier firma de ESTE curso que todavía no tenga snapshot (firmas
--      de antes de este fix) se congela con el contenido tal cual está en
--      ese instante -- lo último que puede verse antes de que el DELETE lo
--      destruya.
--   3) El backfill de las firmas YA existentes (cursos que nunca se han
--      regenerado desde este fix, con contenido todavía vivo) va en fichero
--      aparte -- es dato, no DDL.
--
-- De paso, ip/user_agent de course_signature: existían pero el INSERT nunca
-- los rellenaba. Mismo patrón ya probado en el repo
-- (20260618T0905_audit_writes.sql: request.headers vía PostgREST,
-- best-effort con BEGIN/EXCEPTION -- si no hay cabeceras en el contexto de
-- la llamada, se queda NULL, no rompe la firma).
--
-- Ninguna firma ni tipo de retorno cambia en sign_course_attempt ni en
-- generate_course_from_recipe -- CREATE OR REPLACE sin DROP.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) course_signature.content_snapshot
-- ────────────────────────────────────────────────────────────────────────────
alter table public.course_signature
  add column if not exists content_snapshot jsonb;

comment on column public.course_signature.content_snapshot is
  'Congelado en el momento de la firma: título, secciones (ord/title/body) y preguntas con sus opciones (text/isCorrect/explanation) tal como estaban entonces. '
  'Es lo que garantiza que el acta pueda mostrar qué firmó exactamente el empleado, incluso si el contenido vivo del curso se edita o se regenera después. NULL = firma anterior a este campo, sin rescatar todavía.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) build_course_content_snapshot(course) -- fuente única del snapshot,
--    para no reimplementarlo en sign_course_attempt y en
--    generate_course_from_recipe por separado. SQL puro (una sola
--    expresión), STABLE. Interna: sin grant a nadie, solo se llama desde
--    dentro de otras funciones SECURITY DEFINER.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.build_course_content_snapshot(p_course_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'title', c.title,
    'version', c.version,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('ord', s.ord, 'title', s.title, 'body', s.body) order by s.ord)
      from public.course_section s
      where s.course_id = c.id
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ord', q.ord,
        'text', q.text,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object('text', o.text, 'isCorrect', o.is_correct, 'explanation', o.explanation) order by o.id)
          from public.course_option o
          where o.question_id = q.id
        ), '[]'::jsonb)
      ) order by q.ord)
      from public.course_question q
      where q.course_id = c.id
    ), '[]'::jsonb)
  )
  from public.course c
  where c.id = p_course_id;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) sign_course_attempt -- añade content_snapshot + ip/user_agent reales
--    (best-effort, mismo patrón que audit_writes.sql). Resto IDÉNTICO.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.sign_course_attempt(
  p_attempt_id uuid,
  p_signature_path text,
  p_signer_name text,
  p_signer_doc_id text
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_employee_id uuid;
  v_account_id uuid;
  v_attempt public.course_attempt%rowtype;
  v_course_id uuid;
  v_course_version int;
  v_signature_id uuid;
  v_signed_at timestamptz;
  v_headers json;
  v_ip text;
  v_ua text;
begin
  if v_uid is null then
    raise exception 'Sin sesión de empleado válida: no se puede firmar sin auth.uid()';
  end if;

  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  select * into v_attempt from public.course_attempt where id = p_attempt_id;
  if not found then
    raise exception 'Intento no encontrado';
  end if;
  if v_attempt.employee_id <> v_employee_id then
    raise exception 'Este intento no pertenece al empleado autenticado';
  end if;
  if coalesce(v_attempt.passed, false) is not true then
    raise exception 'Solo se puede firmar un intento superado';
  end if;

  select ca.course_id into v_course_id from public.course_assignment ca where ca.id = v_attempt.assignment_id;
  select version into v_course_version from public.course where id = v_course_id;

  -- IP/UA reales desde las cabeceras de la request (best-effort -- si el
  -- contexto de la llamada no las trae, se queda NULL, no rompe la firma).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ua := v_headers ->> 'user-agent';
    v_ip := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
    v_ua := null;
  end;

  insert into public.course_signature (
    attempt_id, employee_id, signature_png, signer_name, signer_doc_id,
    auth_method, auth_uid, course_version, content_snapshot, ip, user_agent
  ) values (
    p_attempt_id, v_employee_id, p_signature_path, p_signer_name, p_signer_doc_id,
    'employee_session', v_uid, v_course_version, public.build_course_content_snapshot(v_course_id), v_ip, v_ua
  )
  returning id, signed_at into v_signature_id, v_signed_at;

  begin
    perform public.check_phase_completion_for_assignment(v_attempt.assignment_id);
  exception when others then
    raise warning 'sign_course_attempt: check_phase_completion_for_assignment falló para asignación %: %', v_attempt.assignment_id, sqlerrm;
  end;

  return jsonb_build_object('signatureId', v_signature_id, 'signedAt', v_signed_at);
end;
$$;

grant execute on function public.sign_course_attempt(uuid, text, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) generate_course_from_recipe -- antes de borrar secciones/preguntas al
--    regenerar, rescata cualquier firma de este curso que todavía no tenga
--    snapshot (firmas de antes de este fix), congelándola con el contenido
--    tal cual está en ese instante. Resto IDÉNTICO.
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

    -- 🔴 Rescate: cualquier firma de este curso sin snapshot todavía se
    -- congela AHORA, con el contenido que está a punto de borrarse. Tras
    -- este UPDATE, todas las firmas ya existentes de este curso tienen su
    -- propio content_snapshot, independiente de lo que le pase al DELETE
    -- de más abajo.
    update public.course_signature cs
    set content_snapshot = public.build_course_content_snapshot(v_existing_course_id)
    where cs.content_snapshot is null
      and cs.attempt_id in (
        select ca4.id
        from public.course_attempt ca4
        join public.course_assignment ca5 on ca5.id = ca4.assignment_id
        where ca5.course_id = v_existing_course_id
      );

    -- Secciones y preguntas SÍ se reemplazan por completo -- la evidencia
    -- legal de qué firmó cada uno ya no depende de estas filas (vive en
    -- content_snapshot desde el paso anterior), así que regenerar puede
    -- seguir reemplazando el contenido vivo sin perder el histórico.
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
-- GUARD — existencia. La ejecución real (que un acta muestre su snapshot
-- tras regenerar el curso) se comprueba en pantalla -- ver verificación al
-- final del fichero.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course_signature' and column_name = 'content_snapshot'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course_signature.content_snapshot';
  end if;
  if to_regprocedure('public.build_course_content_snapshot(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta build_course_content_snapshot';
  end if;
  if to_regprocedure('public.sign_course_attempt(uuid, text, text, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta sign_course_attempt';
  end if;
  if to_regprocedure('public.generate_course_from_recipe(uuid, text, text, int, jsonb, jsonb, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta generate_course_from_recipe';
  end if;
  raise notice 'Contenido firmado protegido: content_snapshot en sign_course_attempt + rescate previo al DELETE en generate_course_from_recipe.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte, tras aplicar):
--
-- 1) Firma un curso de prueba, comprueba que la firma lleva snapshot:
--
--   select id, signed_at, ip, user_agent, jsonb_pretty(content_snapshot)
--     from course_signature order by signed_at desc limit 1;
--
-- 2) Sobre un curso generado desde receta con al menos una firma antigua
--    (content_snapshot NULL), pulsa "Regenerar" y comprueba que esa firma
--    antigua queda rescatada:
--
--   select cs.id, cs.signed_at, (cs.content_snapshot is not null) as rescatada
--     from course_signature cs
--     join course_attempt ca on ca.id = cs.attempt_id
--     join course_assignment cas on cas.id = ca.assignment_id
--    where cas.course_id = 'CURSO_UUID'::uuid
--    order by cs.signed_at;
-- ============================================================================
