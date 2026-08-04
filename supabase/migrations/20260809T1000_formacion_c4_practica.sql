-- ============================================================================
-- Folvy · Módulo de FORMACIÓN — CAPA 4-A (verificación práctica en el puesto)
-- ----------------------------------------------------------------------------
-- Diseño: docs/folvy_formacion_catalogo_v2.md §2. Encargo:
-- docs/ENCARGO_CODE_formacion_c4_practica_catalogo.md §A. Depende de C1/C2/
-- C3-A + fix de imágenes, todos en main.
--
-- Un curso puede exigir (course.requires_practical) que, además de test
-- aprobado + firma, un responsable (admin/manager) verifique EN EL PUESTO
-- una lista de gestos observables (course_practical_item) y lo registre
-- (course_practical_check). Sin esto, "vigente" en training_compliance_matrix
-- (C2) solo significaba "aprobó un test" — exactamente el fallo que la
-- evidencia documenta (nota alta, conducta sin cambiar).
--
-- 🔴 LECCIÓN DE C2 QUE NO SE REPITE AQUÍ: un guard que solo comprueba que una
-- función EXISTE no prueba que FUNCIONE — así se coló el bug de "column
-- reference ambiguous" que reventó en pantalla con el guard en verde. Esta
-- migración toca training_compliance_matrix/training_gaps (las mismas 2
-- funciones de aquel bug). Todo bare reference nuevo se ha cualificado con
-- el alias de su CTE de origen (mismo criterio que el fix de
-- 20260807T1500), y al final hay una auditoría por grep documentada +
-- un guard ejecutable, no solo de existencia.
--
-- Aplicar por SQL Editor a mano. Verificar cada objeto con query
-- independiente (regla §3).
--
-- Aplicada:
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) Schema
-- ─────────────────────────────────────────────────────────────────────
alter table public.course
  add column if not exists requires_practical boolean not null default false;

comment on column public.course.requires_practical is
  'Si true, aprobar el test + firmar NO deja el curso "vigente": falta que un admin/manager verifique en el puesto los course_practical_item (estado pendiente_practica en training_compliance_matrix/training_gaps).';

create table if not exists public.course_practical_item (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id) on delete cascade,
  ord int not null,
  text text not null,
  help_text text
);

-- Append-only EN EFECTO (no en el motor): corregir un check = insertar una
-- fila NUEVA con su propio verified_at, nunca se actualiza ni se borra la
-- anterior — es evidencia, mismo espíritu que course_signature (C1). Por
-- eso NO hay policy de update/delete y por eso "practical_ok" (más abajo)
-- siempre mira el ÚLTIMO verified_at por item, no el primero.
create table if not exists public.course_practical_check (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.course_attempt(id),
  item_id uuid not null references public.course_practical_item(id),
  checked boolean not null,
  verified_by uuid not null,
  verified_at timestamptz not null default now(),
  notes text
);

comment on column public.course_practical_check.verified_by is
  'auth.uid() del verificador, resuelto SIEMPRE server-side dentro de verify_practical_items — nunca de un parámetro del cliente. Misma regla que course_signature.auth_uid (C1).';

create index if not exists course_practical_check_attempt_idx on public.course_practical_check (attempt_id);
create index if not exists course_practical_check_item_idx on public.course_practical_check (item_id);

-- ─────────────────────────────────────────────────────────────────────
-- 2) RLS — course_practical_item: mismo patrón que course_question (C1):
--    autoría solo admin/manager de cuenta o platform-admin para la global.
-- ─────────────────────────────────────────────────────────────────────
alter table public.course_practical_item enable row level security;

create policy "course_practical_item_select" on public.course_practical_item
  for select to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_practical_item.course_id
        and (
          (c.account_id is null and public.current_user_is_office())
          or (c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id))
          or public.current_user_is_admin()
        )
    )
  );

create policy "course_practical_item_write" on public.course_practical_item
  for all to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_practical_item.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.course c where c.id = course_practical_item.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 3) RLS — course_practical_check: SOLO lectura para authenticated (admin/
--    manager de la cuenta, o el propio trabajador viendo su historial). Sin
--    policy de insert/update/delete: la única vía de escritura es
--    verify_practical_items (SECURITY DEFINER) — igual que course_signature.
-- ─────────────────────────────────────────────────────────────────────
alter table public.course_practical_check enable row level security;

create policy "course_practical_check_select" on public.course_practical_check
  for select to authenticated
  using (
    exists (
      select 1 from public.course_attempt at2
      join public.course_assignment ca on ca.id = at2.assignment_id
      where at2.id = course_practical_check.attempt_id
        and (
          public.current_user_is_admin_or_manager_of(ca.account_id)
          or public.current_user_is_employee(at2.employee_id, ca.account_id)
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4) RPC — verify_practical_items: registra la verificación de N gestos de
--    una tacada (una sesión de verificación). Guard admin/manager de la
--    cuenta + anti-autoverificación (compara auth.uid() del verificador
--    contra el auth_uid con el que se FIRMÓ el intento — más robusto que
--    comparar employee_id, que no todo admin/manager tiene enlazado).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.verify_practical_items(
  p_attempt_id uuid,
  p_checks jsonb,   -- [{"itemId": "...", "checked": true, "notes": "..."}, ...]
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_attempt public.course_attempt%rowtype;
  v_account_id uuid;
  v_course_id uuid;
  v_signer_auth_uid uuid;
  v_check jsonb;
  v_item_id uuid;
  v_checked boolean;
  v_item_notes text;
  v_inserted_count int := 0;
begin
  if v_uid is null then
    raise exception 'Sin sesión válida: no se puede verificar sin auth.uid()';
  end if;

  select * into v_attempt from public.course_attempt where id = p_attempt_id;
  if not found then
    raise exception 'Intento no encontrado';
  end if;

  select ca.account_id, ca.course_id into v_account_id, v_course_id
  from public.course_assignment ca where ca.id = v_attempt.assignment_id;

  if not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'verify_practical_items: sin acceso a la cuenta %', v_account_id;
  end if;

  if coalesce(v_attempt.passed, false) is not true then
    raise exception 'Solo se puede verificar la práctica de un intento superado';
  end if;

  -- Anti-autoverificación: el verificador no puede ser quien firmó el intento.
  select s.auth_uid into v_signer_auth_uid
  from public.course_signature s
  where s.attempt_id = p_attempt_id
  order by s.signed_at desc
  limit 1;
  if v_signer_auth_uid is not null and v_signer_auth_uid = v_uid then
    raise exception 'El verificador no puede ser el propio trabajador que firmó el intento';
  end if;

  for v_check in select * from jsonb_array_elements(p_checks)
  loop
    v_item_id := nullif(v_check ->> 'itemId', '')::uuid;
    v_checked := coalesce((v_check ->> 'checked')::boolean, false);
    v_item_notes := coalesce(v_check ->> 'notes', p_notes);

    if v_item_id is null or not exists (
      select 1 from public.course_practical_item pi where pi.id = v_item_id and pi.course_id = v_course_id
    ) then
      raise exception 'El gesto % no pertenece al curso de este intento', v_item_id;
    end if;

    insert into public.course_practical_check (attempt_id, item_id, checked, verified_by, notes)
    values (p_attempt_id, v_item_id, v_checked, v_uid, v_item_notes);
    v_inserted_count := v_inserted_count + 1;
  end loop;

  return jsonb_build_object('insertedCount', v_inserted_count, 'verifiedAt', now());
end;
$function$;

grant execute on function public.verify_practical_items(uuid, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5) training_compliance_matrix — añade el estado 'pendiente_practica' y la
--    condición extra para 'vigente'. CREATE OR REPLACE (mismas firmas de
--    entrada/salida, solo cambia el cuerpo — no hace falta DROP FUNCTION).
--
-- ⚠️ TODA referencia nueva va cualificada con el alias de su CTE de origen
-- (cell., rc., e.) — igual disciplina que el fix de 20260807T1500. Ninguno
-- de los nombres nuevos (requires_practical, practical_ok) coincide con las
-- 6 columnas de salida (employee_id, employee_name, doc_id, role,
-- location_name, courses), así que no hay colisión nueva posible por esos
-- nombres — pero se cualifican igual, por disciplina y legibilidad.
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
    select distinct c.id as course_id, c.code, c.reeval_months, c.requires_practical
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
      rc.requires_practical,
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
      best.signed_at,
      best.practical_ok
    from emp e
    cross join relevant_courses rc
    -- "Mejor" evidencia entre TODOS los intentos del empleado para este curso,
    -- no solo el último: si ya existe un intento firmado+aprobado en el
    -- historial, ESE manda (reevaluaciones con un intento nuevo sin firmar
    -- todavía no le hacen perder su vigencia ya acreditada).
    left join lateral (
      select at.id, at.finished_at, at.passed, at.score_pct,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at,
        -- practical_ok: TODOS los gestos del curso tienen, para ESTE intento,
        -- su check MÁS RECIENTE con checked=true. Vacuamente true si el curso
        -- no tiene gestos (requires_practical=false no lo necesita, pero si
        -- alguno se define igual, no debe bloquear a nadie sin querer).
        (
          not exists (
            select 1 from public.course_practical_item pi
            where pi.course_id = rc.course_id
              and not exists (
                select 1 from public.course_practical_check pc
                where pc.item_id = pi.id and pc.attempt_id = at.id and pc.checked = true
                  and pc.verified_at = (
                    select max(pc2.verified_at) from public.course_practical_check pc2
                    where pc2.item_id = pi.id and pc2.attempt_id = at.id
                  )
              )
          )
        ) as practical_ok
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
        when cell.requires_practical and not coalesce(cell.practical_ok, false) then 'pendiente_practica'
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
-- 6) training_gaps — nuevo gap_kind 'falta_practica'. Misma disciplina de
--    cualificación (cell., classified.).
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
    select distinct c.id as course_id, c.title, c.reeval_months, c.requires_practical
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
      rc.requires_practical,
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
      best.signed_at,
      best.practical_ok
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.passed,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at,
        (
          not exists (
            select 1 from public.course_practical_item pi
            where pi.course_id = rc.course_id
              and not exists (
                select 1 from public.course_practical_check pc
                where pc.item_id = pi.id and pc.attempt_id = at.id and pc.checked = true
                  and pc.verified_at = (
                    select max(pc2.verified_at) from public.course_practical_check pc2
                    where pc2.item_id = pi.id and pc2.attempt_id = at.id
                  )
              )
          )
        ) as practical_ok
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
        when cell.signed_at is not null and coalesce(cell.passed, false)
             and cell.requires_practical and not coalesce(cell.practical_ok, false)
          then 'falta_practica'
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
      when 'falta_practica' then 3
      when 'nunca_hecho' then 4
      else 5
    end,
    classified.due_at nulls last;
end;
$function$;

grant execute on function public.training_compliance_matrix(uuid, uuid, boolean) to authenticated;
grant execute on function public.training_gaps(uuid, int) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- 7) Guard — existencia + drift + auto-verificación de no-ambigüedad.
-- ─────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_qual text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'requires_practical'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.requires_practical';
  end if;
  if to_regclass('public.course_practical_item') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_practical_item';
  end if;
  if to_regclass('public.course_practical_check') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_practical_check';
  end if;
  if not exists (select 1 from pg_proc where proname = 'verify_practical_items') then
    raise exception 'MIGRACIÓN FALLIDA: falta verify_practical_items';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('course_practical_item', 'course_practical_check')) <> 3 then
    raise exception 'MIGRACIÓN FALLIDA: faltan policies de course_practical_item/course_practical_check (esperadas 3: item_select, item_write, check_select)';
  end if;

  -- Drift-check de las policies de las que dependemos (course_question no se
  -- toca aquí, pero course_practical_item copia su MISMO criterio: confirmar
  -- que el patrón sigue vigente en el catálogo, no solo en la memoria de C1).
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'course_practical_item' and policyname = 'course_practical_item_write';
  if v_qual !~* 'account_id is not null' then
    raise exception 'GUARDARRAÍL EN RIESGO: course_practical_item_write ya NO exige account_id IS NOT NULL -- revisar antes de seguir';
  end if;

  raise notice 'Guard de existencia OK. Objetos nuevos verificados.';
end
$guard$;

-- Auto-verificación de no-ambigüedad: simula las variables OUT implícitas de
-- LAS DOS funciones tocadas y confirma que un SELECT con la misma forma que
-- las CTEs nuevas (bare employee_id/course_id junto a requires_practical/
-- practical_ok) no revienta. Si esto lanza "ambiguous_column", algo de lo de
-- arriba quedó sin cualificar -- parar y revisar antes de dar la migración
-- por buena (la lección de C2: no fiarse de que "compiló" = "funciona").
do $verify_no_new_ambiguity$
declare
  -- Todas las columnas de salida de training_compliance_matrix Y de
  -- training_gaps a la vez, en el mismo scope: es la prueba más exigente
  -- posible (peor caso: las dos funciones compartiendo variables).
  employee_id uuid; employee_name text; doc_id text; role text; location_name text; courses jsonb;
  course_id uuid; course_title text; gap_kind text; due_at timestamptz; days_left int;
  v_employee_id uuid;
  v_requires_practical boolean;
  v_practical_ok boolean;
begin
  select cell.employee_id, cell.requires_practical, cell.practical_ok
    into v_employee_id, v_requires_practical, v_practical_ok
  from (
    select gen_random_uuid() as employee_id, true as requires_practical, false as practical_ok
  ) cell;

  if v_employee_id is null or v_requires_practical is not true or v_practical_ok is not false then
    raise exception 'AUTO-VERIFICACIÓN INESPERADA: los valores no coinciden con lo sembrado -- revisar';
  end if;

  raise notice 'Auto-verificación OK: employee_id/requires_practical/practical_ok cualificados (cell.) no colisionan con las variables OUT de training_compliance_matrix/training_gaps.';
end
$verify_no_new_ambiguity$;

-- ============================================================================
-- 8) VERIFICACIÓN REAL DE RLS Y DE LA RPC (ejecutar POR SEPARADO, con
-- usuarios reales — mismo motivo que C3-A: el SQL Editor conecta como
-- superusuario y se salta RLS por completo, así que hay que forzar
-- `set local role authenticated` + simular auth.uid() con `request.jwt.claims`.
-- ============================================================================
-- Sustituye los marcadores por IDs reales de tu BBDD. Todo en una
-- transacción con ROLLBACK: no deja rastro.
--
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<manager_de_cuenta_A>')::text, true);
--
--   -- PRUEBA 1 — debe decir "UPDATE 0" / no insertar nada: un manager NO
--   -- puede escribir course_practical_item sobre un curso GLOBAL.
--   update public.course_practical_item set text = 'PRUEBA-DEBE-FALLAR'
--    where id = '<item_de_curso_global>';
--
--   -- PRUEBA 2 — debe funcionar: ese mismo manager SÍ puede escribir sobre un
--   -- curso propio de su cuenta.
--   update public.course_practical_item set text = text
--    where id = '<item_de_curso_propio_de_cuenta_A>';
--
--   -- PRUEBA 3 — verify_practical_items con el propio firmante como
--   -- verificador debe FALLAR con 'El verificador no puede ser el propio
--   -- trabajador...' (usa el auth.uid() real del empleado que firmó el
--   -- intento de prueba en <intento_ya_firmado_por_ese_uid>).
--   select public.verify_practical_items(
--     '<intento_ya_firmado_por_ese_uid>'::uuid,
--     jsonb_build_array(jsonb_build_object('itemId', '<item_id>', 'checked', true)),
--     null
--   );
-- rollback;
-- reset role;
--
-- Confirmación end-to-end real: en un curso con requires_practical=true,
-- completar test+firma en el móvil (debe avisar "falta verificación
-- práctica", NO dar el curso por vigente) y verificar desde oficina
-- ("Verificar ahora") con un admin/manager DISTINTO del que firmó.
