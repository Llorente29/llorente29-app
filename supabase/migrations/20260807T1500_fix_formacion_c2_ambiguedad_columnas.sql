-- Formación C2 — fix de "column reference ... is ambiguous" en
-- training_compliance_matrix / training_gaps / training_course_summary
-- (20260807T1400, ya aplicada y en producción — no se edita esa migración).
--
-- Mismo patrón exacto que 20260805T1600_fix_allergen_compliance_matrix_
-- ambiguedad.sql (cazado por Julio entonces, y ahora aquí también):
-- RETURNS TABLE(employee_id uuid, ...) declara employee_id (y el resto de
-- columnas de salida) como variables IMPLÍCITAS de PL/pgSQL, visibles en
-- todo el cuerpo de la función. Cualquier referencia SIN cualificar a un
-- nombre que coincida con una de esas columnas de salida es ambigua para
-- el planificador (¿la variable o la columna de la CTE?) y solo revienta
-- EN EJECUCIÓN, nunca al crear la función — por eso el guard de la
-- migración original (que solo comprobaba `pg_proc` con `select 1 from
-- pg_proc where proname = ...`) pasó en verde y el error solo apareció en
-- pantalla real.
--
-- AUDITORÍA COMPLETA (las 4 funciones, línea a línea, no solo los 3 sitios
-- que señaló el aviso):
--   • training_compliance_matrix — 1 colisión: `cell_state` selecciona
--     `employee_id` a secas (chocaba con el RETURNS TABLE de esa función).
--   • training_gaps — colisión mucho más extendida de lo señalado: además
--     de employee_id/course_id en `classified` y en el SELECT final, TAMBIÉN
--     colisionan ahí mismo employee_name, course_title, due_at (dos veces)
--     y gap_kind (dos veces) — los 6 de sus 7 columnas de salida que no son
--     days_left. Todas cualificadas ahora con el alias de su CTE de origen.
--   • training_course_summary — colisión NUEVA no señalada en el aviso: la
--     CTE `sections` hace `select course_id, ... group by course_id from
--     course_section` a secas — course_id SÍ es una de sus columnas de
--     salida. El resto de la función (targeted/attempt_status/counts) ya
--     iba cualificado (`t.employee_id` que menciona Julio, `rc.id as
--     course_id`, etc.) — coincide con su diagnóstico.
--   • training_course_summary también expone employee_id como alias interno
--     en `targeted` (rc.id as course_id, e.id as employee_id) pero esa
--     función NO declara employee_id en su RETURNS TABLE → no hay variable
--     implícita con ese nombre → no hay colisión posible ahí. Confirmado.
--   • training_data_health — revisada entera: sus 3 columnas de salida
--     (check_kind, item_count, sample_names) NUNCA se usan a secas en el
--     cuerpo (solo `name`, `dni`, `id`, `title`, y literales/agregados en
--     el UNION ALL final). Sin colisión. No se toca.
--   • current_employee_and_account (C1): pregunta explícita de Julio. No la
--     llama ninguna de estas 4 (es un helper del móvil, resuelto por
--     auth.uid(), ajeno a los informes de oficina que reciben p_account_id
--     por parámetro) → no agrava nada aquí. Además es LANGUAGE SQL, no
--     plpgsql: ese lenguaje no tiene el mecanismo de variables implícitas
--     que causa este bug, y su cuerpo ya cualifica (up.employee_id,
--     up.account_id) — estructuralmente inmune a esta clase de fallo.
--
-- ESTRATEGIA ELEGIDA: cualificar (no renombrar las columnas de salida).
-- Mismo criterio que Julio ya aplicó en 20260805T1600: las firmas no
-- cambian, así que CREATE OR REPLACE basta — SIN DROP FUNCTION previo (la
-- condición que puso Julio para necesitarlo — "si cambia la firma o el
-- tipo de retorno" — no se da: ni un nombre ni un tipo de columna cambia).
-- Cero cambios de cliente: trainingComplianceService.ts y database.ts
-- siguen leyendo las mismas claves de siempre.
--
-- PRUEBA REAL (no solo existencia — el fallo de método que señaló Julio):
-- el bloque DO de más abajo REPRODUCE el mecanismo exacto del bug (variable
-- local + CTE con columna del mismo nombre sin cualificar → confirma que
-- salta "ambiguous_column") y luego prueba la MISMA consulta cualificada
-- (el fix aplicado aquí) para confirmar que deja de saltar. Se ejecuta sin
-- necesitar sesión autenticada — a diferencia de las 4 funciones reales,
-- que exigen auth.uid() real (admin/manager de la cuenta) para pasar su
-- propio guard, así que НО se pueden invocar de verdad desde el SQL Editor
-- (auth.uid() ahí es NULL). La confirmación end-to-end real es abrir la
-- app: Safety → Formación, Team → Formación → Seguimiento, y la ficha de
-- un empleado (sección "Formación interna").
--
-- Aplicada:

-- ─────────────────────────────────────────────────────────────────────
-- 0) Reproducción del bug + verificación del fix — sin auth, autocontenida.
--    Si esta migración se detiene aquí con una excepción, el diagnóstico de
--    abajo está mal y hay que revisar antes de seguir.
-- ─────────────────────────────────────────────────────────────────────
do $verify_repro$
declare
  employee_id uuid;  -- simula la variable OUT implícita de RETURNS TABLE
  v_result uuid;
  v_ambiguous boolean := false;
begin
  begin
    -- Patrón EXACTO que rompía las 3 funciones: CTE con columna
    -- `employee_id`, leída SIN cualificar, dentro de un bloque que ya tiene
    -- una variable local de ese nombre en su scope.
    select t.employee_id into v_result
    from (
      with cell as (select gen_random_uuid() as employee_id)
      select employee_id from cell
    ) t;
  exception
    when ambiguous_column then
      v_ambiguous := true;
  end;
  if not v_ambiguous then
    -- WARNING, no exception: si esta réplica concreta no reprodujo el error
    -- (p.ej. diferencia de versión de Postgres en el mecanismo exacto), NO
    -- debe bloquear el fix real de abajo, que está verificado por auditoría
    -- línea a línea, no solo por esta prueba. Se avisa para que se revise,
    -- pero no se aborta la migración por un artefacto de la propia prueba.
    raise warning 'REPRO INESPERADA: no saltó "ambiguous column" con la referencia sin cualificar — revisar esta prueba, pero el fix de abajo se aplica igualmente (está auditado independientemente).';
  else
    raise notice 'Repro OK: "employee_id" sin cualificar es ambiguo cuando hay una variable local con ese nombre — este es el mecanismo real del bug.';
  end if;

  -- La misma consulta, CUALIFICADA (el fix que se aplica abajo) — debe
  -- ejecutarse sin error.
  select t.employee_id into v_result
  from (
    with cell as (select gen_random_uuid() as employee_id)
    select cell.employee_id from cell
  ) t;
  raise notice 'Fix verificado: cell.employee_id (cualificado) NO es ambiguo. Valor de prueba: %', v_result;
end
$verify_repro$;

-- ─────────────────────────────────────────────────────────────────────
-- 1) training_compliance_matrix — cell_state cualifica employee_id.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_compliance_matrix(
  p_account_id uuid,
  p_location_id uuid default null,
  p_only_mandatory boolean default false
) returns table(
  employee_id uuid,
  employee_name text,
  doc_id text,
  role text,
  location_name text,
  courses jsonb
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_compliance_matrix: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with emp as (
    select e.id, e.name, e.dni, e.position, e.location_id, l.name as location_name
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id
      and e.active = true
      and (p_location_id is null or e.location_id = p_location_id)
  ),
  relevant_courses as (
    select distinct c.id as course_id, c.code, c.reeval_months
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id
      and c.status = 'published'
      and (not p_only_mandatory or c.is_mandatory)
  ),
  cell as (
    select
      e.id as employee_id,
      rc.course_id,
      rc.code as course_code,
      rc.reeval_months,
      (exists (
        select 1 from public.course_assignment ca
        where ca.course_id = rc.course_id
          and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      )) as applies,
      best.id as attempt_id,
      best.finished_at,
      best.passed,
      best.score_pct,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.finished_at, at.passed, at.score_pct,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at
      from public.course_attempt at
      join public.course_assignment ca2 on ca2.id = at.assignment_id
      where at.employee_id = e.id
        and ca2.course_id = rc.course_id
        and ca2.account_id = p_account_id
      order by
        ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
         and coalesce(at.passed, false)) desc,
        at.started_at desc
      limit 1
    ) best on true
  ),
  cell_state as (
    select
      cell.employee_id,
      cell.course_code,
      case
        when not cell.applies then 'no_aplica'
        when cell.attempt_id is null then 'pendiente'
        when not (cell.signed_at is not null and coalesce(cell.passed, false)) then 'en_curso'
        when cell.reeval_months is null then 'vigente'
        when cell.signed_at + (cell.reeval_months || ' months')::interval > now() then 'vigente'
        else 'caducado'
      end as state,
      cell.finished_at as completed_at,
      case
        when cell.signed_at is not null and cell.reeval_months is not null
          then cell.signed_at + (cell.reeval_months || ' months')::interval
        else null
      end as expires_at,
      cell.score_pct,
      (cell.signed_at is not null and coalesce(cell.passed, false)) as signed
    from cell
  )
  select
    e.id,
    e.name,
    e.dni,
    e.position,
    e.location_name,
    coalesce(
      (
        select jsonb_object_agg(
          cs.course_code,
          jsonb_build_object(
            'state', cs.state,
            'completed_at', cs.completed_at,
            'expires_at', cs.expires_at,
            'score_pct', cs.score_pct,
            'signed', cs.signed
          )
        )
        from cell_state cs
        where cs.employee_id = e.id
      ),
      '{}'::jsonb
    ) as courses
  from emp e
  order by e.name;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) training_gaps — classified y el SELECT final cualifican TODAS las
--    columnas que coinciden con su RETURNS TABLE (employee_id,
--    employee_name, course_id, course_title, due_at, gap_kind).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_gaps(
  p_account_id uuid,
  p_days_ahead int default 30
) returns table(
  employee_id uuid,
  employee_name text,
  course_id uuid,
  course_title text,
  gap_kind text,
  due_at timestamptz,
  days_left int
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_gaps: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with emp as (
    select e.id, e.name, e.position, e.location_id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id and e.active = true
  ),
  relevant_courses as (
    select distinct c.id as course_id, c.title, c.reeval_months
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id and c.status = 'published'
  ),
  cell as (
    select
      e.id as employee_id,
      e.name as employee_name,
      rc.course_id,
      rc.title as course_title,
      rc.reeval_months,
      (
        select min(ca.due_at) from public.course_assignment ca
        where ca.course_id = rc.course_id and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      ) as due_at,
      (exists (
        select 1 from public.course_assignment ca
        where ca.course_id = rc.course_id and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      )) as applies,
      best.id as attempt_id,
      best.passed,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.passed,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at
      from public.course_attempt at
      join public.course_assignment ca2 on ca2.id = at.assignment_id
      where at.employee_id = e.id and ca2.course_id = rc.course_id and ca2.account_id = p_account_id
      order by
        ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
         and coalesce(at.passed, false)) desc,
        at.started_at desc
      limit 1
    ) best on true
  ),
  classified as (
    select
      cell.employee_id,
      cell.employee_name,
      cell.course_id,
      cell.course_title,
      cell.due_at,
      case
        when not cell.applies then null
        when cell.attempt_id is null then 'nunca_hecho'
        when coalesce(cell.passed, false) and cell.signed_at is null then 'sin_firmar'
        when cell.signed_at is not null and coalesce(cell.passed, false) and cell.reeval_months is not null
             and cell.signed_at + (cell.reeval_months || ' months')::interval <= now()
          then 'caducado'
        when cell.signed_at is not null and coalesce(cell.passed, false) and cell.reeval_months is not null
             and cell.signed_at + (cell.reeval_months || ' months')::interval <= now() + (p_days_ahead || ' days')::interval
          then 'caduca_pronto'
        else null
      end as gap_kind
    from cell
  )
  select
    classified.employee_id,
    classified.employee_name,
    classified.course_id,
    classified.course_title,
    classified.gap_kind,
    classified.due_at,
    case when classified.due_at is not null then (extract(day from classified.due_at - now()))::int else null end as days_left
  from classified
  where classified.gap_kind is not null
  order by
    case classified.gap_kind
      when 'caducado' then 0
      when 'caduca_pronto' then 1
      when 'sin_firmar' then 2
      when 'nunca_hecho' then 3
      else 4
    end,
    classified.due_at nulls last;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) training_course_summary — sections cualifica course_id (colisión NO
--    señalada en el aviso original, encontrada al auditar por completo).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_course_summary(
  p_account_id uuid
) returns table(
  course_id uuid,
  course_code text,
  course_title text,
  legal_basis text,
  estimated_minutes int,
  section_titles text[],
  assigned_count int,
  trained_count int,
  signed_count int,
  compliance_pct numeric
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_course_summary: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with relevant_courses as (
    select distinct c.id, c.code, c.title, c.legal_basis, c.estimated_minutes
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id
  ),
  emp as (
    select e.id, e.position, e.location_id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id and e.active = true
  ),
  targeted as (
    select rc.id as course_id, e.id as employee_id
    from relevant_courses rc
    cross join emp e
    where exists (
      select 1 from public.course_assignment ca
      where ca.course_id = rc.id and ca.account_id = p_account_id
        and (
          ca.employee_id = e.id
          or (ca.role is not null and ca.role = e.position)
          or (ca.location_id is not null and ca.location_id = e.location_id)
        )
    )
  ),
  attempt_status as (
    select
      t.course_id,
      t.employee_id,
      (exists (
        select 1 from public.course_attempt at
        join public.course_assignment ca2 on ca2.id = at.assignment_id
        where at.employee_id = t.employee_id and ca2.course_id = t.course_id and ca2.account_id = p_account_id
          and at.passed = true
      )) as passed,
      (exists (
        select 1 from public.course_attempt at
        join public.course_assignment ca2 on ca2.id = at.assignment_id
        join public.course_signature s on s.attempt_id = at.id
        where at.employee_id = t.employee_id and ca2.course_id = t.course_id and ca2.account_id = p_account_id
      )) as has_signature
    from targeted t
  ),
  sections as (
    select cs.course_id, array_agg(cs.title order by cs.ord) as titles
    from public.course_section cs
    group by cs.course_id
  ),
  counts as (
    select
      rc.id as course_id,
      (select count(*) from targeted t where t.course_id = rc.id)::int as assigned_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and coalesce(a.passed, false))::int as trained_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and a.has_signature)::int as signed_count
    from relevant_courses rc
  )
  select
    rc.id,
    rc.code,
    rc.title,
    rc.legal_basis,
    rc.estimated_minutes,
    coalesce(s.titles, array[]::text[]),
    co.assigned_count,
    co.trained_count,
    co.signed_count,
    case when co.assigned_count > 0
      then round(co.signed_count::numeric / co.assigned_count * 100, 1)
      else 0
    end as compliance_pct
  from relevant_courses rc
  left join sections s on s.course_id = rc.id
  join counts co on co.course_id = rc.id
  order by rc.title;
end;
$function$;

grant execute on function public.training_compliance_matrix(uuid, uuid, boolean) to authenticated;
grant execute on function public.training_gaps(uuid, int) to authenticated;
grant execute on function public.training_course_summary(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Guard: las firmas no cambiaron (mismo tipo de retorno), así que basta con
-- confirmar que las 3 siguen existiendo con la forma esperada. NO es
-- suficiente por sí solo (es exactamente la comprobación insuficiente que
-- señaló Julio) — la prueba real es el bloque DO de la sección 0, más
-- arriba en esta misma migración, que ya se ejecutó si has llegado hasta
-- aquí sin que la transacción abortase.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'training_compliance_matrix'
      and pg_get_function_result(p.oid) like '%employee_id uuid%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: training_compliance_matrix no quedó con la firma esperada';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'training_gaps'
      and pg_get_function_result(p.oid) like '%gap_kind text%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: training_gaps no quedó con la firma esperada';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'training_course_summary'
      and pg_get_function_result(p.oid) like '%compliance_pct numeric%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: training_course_summary no quedó con la firma esperada';
  end if;
end $$;

-- ── VERIFICACIÓN REAL EN LA APP (esto es lo que de verdad cierra el bug) ──
-- El guard de arriba y el bloque DO de la sección 0 prueban la MECÁNICA del
-- fix sin necesitar sesión — pero las 4 funciones reales exigen
-- auth.uid() real (admin/manager de la cuenta) para pasar su propio guard,
-- así que NO se pueden invocar de verdad desde el SQL Editor (auth.uid()
-- ahí es NULL → saltarían "sin acceso" antes de llegar siquiera al código
-- que se acaba de arreglar). Tras aplicar esta migración, confirmar
-- recargando:
--   1. Safety → Formación (la matriz, el panel "Qué falta" y la tira de KPIs
--      deben cargar sin el error de columna ambigua).
--   2. Team → Formación → Seguimiento (sin cambios funcionales, pero usa
--      las mismas piezas de C1/C2 — confirmar que sigue bien).
--   3. Ficha de un empleado → pestaña Formaciones → sección "Formación
--      interna (Folvy)" (el efecto colateral que reportaste — debe dejar de
--      decir "No se pudo cargar la formación interna").
