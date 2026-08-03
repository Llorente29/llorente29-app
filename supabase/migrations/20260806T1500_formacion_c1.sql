-- ============================================================================
-- Folvy · Módulo de FORMACIÓN — CAPA 1 (motor + curso de alérgenos end-to-end)
-- ----------------------------------------------------------------------------
-- Diseño aprobado: docs/folvy_formacion_diseno.md · Encargo: docs/ENCARGO_CODE_formacion_c1.md
--
-- Crea el motor de cursos internos con evidencia firmada:
--   course → course_section / course_question / course_option (contenido)
--   course_assignment → course_attempt → course_signature → course_certificate (flujo)
--
-- ⚠️ APLICAR ANTES que 20260806T1600_seed_curso_alergenos.sql (esa migración
--    depende de estas tablas y lo comprueba con un guard propio).
--
-- NO TOCA: employee_formations (certificados externos, fuera de alcance C1),
-- FORMATION_CATALOG (hardcodeado en personal.ts, migración a tabla es C3).
--
-- Base legal de la evidencia (regla dura, no negociable): al firmar HAY sesión
-- real de Supabase Auth (enlace mágico QR → verifyOtp). auth.uid() se resuelve
-- SIEMPRE server-side dentro de las RPC; nunca se acepta un employee_id
-- enviado por el cliente para decidir de quién es la firma o el intento.
--
-- Corrección del test: 100% server-side (submit_course_attempt). El cliente
-- nunca recibe is_correct/explanation antes de responder — y por eso
-- course_question/course_option NO son legibles directamente por el rol
-- worker vía RLS: el móvil del empleado accede EXCLUSIVAMENTE a través de
-- start_course_attempt/submit_course_attempt (SECURITY DEFINER, bypasan RLS
-- como dueño 'postgres'). Solo admin/manager/platform-admin leen las tablas
-- de autoría directamente (para el editor de oficina).
--
-- Aplicada:
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. TABLAS
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.course (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id),
  code text not null,
  title text not null,
  summary text,
  legal_basis text,
  delivery_mode text not null check (delivery_mode in ('folvy_imparte', 'solo_archivo', 'mixto')),
  reeval_months int,
  is_mandatory boolean not null default true,
  appcc_prerequisite boolean not null default false,
  estimated_minutes int,
  pass_threshold_pct int not null default 70,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  created_by uuid
);

comment on table public.course is 'Curso interno (Formación C1). account_id NULL = plantilla global Folvy (patrón ingredient_template).';

-- Único: code global (account_id IS NULL) — permite el ON CONFLICT (code)
-- WHERE account_id IS NULL de la semilla. Y code único DENTRO de cada cuenta
-- para sus propios cursos (evita duplicados al crear desde oficina).
create unique index if not exists course_code_global_unique on public.course (code) where account_id is null;
create unique index if not exists course_code_account_unique on public.course (account_id, code) where account_id is not null;

create table if not exists public.course_section (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id) on delete cascade,
  ord int not null,
  title text not null,
  body text not null,
  media_url text
);

create table if not exists public.course_question (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id) on delete cascade,
  ord int not null,
  text text not null
);

create table if not exists public.course_option (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.course_question(id) on delete cascade,
  text text not null,
  is_correct boolean not null default false,
  explanation text
);

create table if not exists public.course_assignment (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course(id),
  account_id uuid not null references public.accounts(id),
  employee_id uuid references public.employees(id),
  role text,
  location_id uuid references public.locations(id),
  due_at timestamptz,
  origin text not null check (origin in ('manual', 'onboarding', 'reeval_periodica', 'reeval_evento')),
  source_incident_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint course_assignment_target_check check (
    employee_id is not null or role is not null or location_id is not null
  )
);

comment on table public.course_assignment is 'A quién va dirigido el curso: por empleado directo, por puesto (role) o por local. Al menos uno de los tres.';

create index if not exists course_assignment_account_employee_idx on public.course_assignment (account_id, employee_id);

create table if not exists public.course_attempt (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.course_assignment(id),
  employee_id uuid not null references public.employees(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score_pct numeric,
  passed boolean,
  answers jsonb not null default '{}'::jsonb,
  time_spent_seconds int
);

comment on column public.course_attempt.answers is 'Respuestas dadas por el empleado: { "<question_id>": "<option_id>" }. Auditable.';

create index if not exists course_attempt_assignment_idx on public.course_attempt (assignment_id);

-- Evidencia legal — APPEND-ONLY E INMUTABLE. Solo INSERT (vía sign_course_attempt,
-- SECURITY DEFINER); a propósito NO hay policy de UPDATE ni DELETE para ningún
-- rol, así que ni el propio empleado ni un admin pueden tocar una firma ya
-- creada. Corregir = firmar de nuevo (nueva fila, la vieja se conserva).
create table if not exists public.course_signature (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.course_attempt(id),
  employee_id uuid not null references public.employees(id),
  signature_png text not null,
  signer_name text not null,
  signer_doc_id text not null,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  auth_method text not null default 'employee_session',
  auth_uid uuid,
  course_version int not null
);

comment on table public.course_signature is 'Firma manuscrita electrónica (no cualificada). auth_uid = auth.uid() resuelto server-side en sign_course_attempt, NUNCA de un parámetro del cliente. course_version = versión del curso en el momento de firmar (si el curso cambia después, el acta sigue diciendo qué firmó exactamente esta persona).';
comment on column public.course_signature.signature_png is 'Path dentro del bucket privado course-signatures (NO el PNG en sí). Servida por URL firmada.';

create index if not exists course_signature_attempt_idx on public.course_signature (attempt_id);

create table if not exists public.course_certificate (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.course_attempt(id),
  pdf_url text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid,
  serial text not null,
  unique (serial)
);

comment on column public.course_certificate.pdf_url is 'Path dentro del bucket privado course-certificates. Servido por URL firmada.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. HELPERS RLS
-- ────────────────────────────────────────────────────────────────────────────

-- ¿El usuario actual es admin o manager de ALGUNA cuenta (no una en concreto)?
-- Necesario para que cualquier oficina pueda VER las plantillas globales de
-- Folvy (account_id IS NULL) sin acoplarlo a una cuenta específica —
-- current_user_is_admin_or_manager_of(p_account_id) exige comparar contra un
-- account_id concreto y NULL = NULL nunca es true en SQL.
create or replace function public.current_user_is_office()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.active = true
      and up.role = any (array['admin', 'manager'])
  ) or public.current_user_is_admin();
$$;

-- Resuelve el empleado (y su cuenta) del usuario autenticado actual, vía
-- user_profiles (user_id -> employee_id + account_id directo, sin pasar por
-- employees/locations). Usado por las 4 RPC de móvil: NUNCA reciben
-- employee_id como parámetro del cliente, siempre lo resuelven aquí.
create or replace function public.current_employee_and_account(out employee_id uuid, out account_id uuid)
language sql stable security definer
set search_path to 'public'
as $$
  select up.employee_id, up.account_id
  from public.user_profiles up
  where up.user_id = auth.uid()
    and up.active = true
    and up.employee_id is not null
  limit 1;
$$;

grant execute on function public.current_user_is_office() to authenticated;
grant execute on function public.current_employee_and_account() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — course / course_section / course_question / course_option
-- ────────────────────────────────────────────────────────────────────────────
-- Autoría: SOLO admin/manager (oficina) o platform-admin. El worker/empleado
-- NUNCA lee estas 4 tablas directamente — así es IMPOSIBLE leer is_correct
-- desde el cliente antes de responder el test. El móvil pasa siempre por
-- start_course_attempt / submit_course_attempt (SECURITY DEFINER).

alter table public.course enable row level security;

create policy "course_select" on public.course
  for select to authenticated
  using (
    (account_id is null and public.current_user_is_office())
    or (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  );

create policy "course_write" on public.course
  for all to authenticated
  using (
    (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  )
  with check (
    (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  );

alter table public.course_section enable row level security;

create policy "course_section_select" on public.course_section
  for select to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_section.course_id
        and (
          (c.account_id is null and public.current_user_is_office())
          or (c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id))
          or public.current_user_is_admin()
        )
    )
  );

create policy "course_section_write" on public.course_section
  for all to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_section.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.course c where c.id = course_section.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  );

alter table public.course_question enable row level security;

create policy "course_question_select" on public.course_question
  for select to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_question.course_id
        and (
          (c.account_id is null and public.current_user_is_office())
          or (c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id))
          or public.current_user_is_admin()
        )
    )
  );

create policy "course_question_write" on public.course_question
  for all to authenticated
  using (
    exists (
      select 1 from public.course c where c.id = course_question.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.course c where c.id = course_question.course_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  );

alter table public.course_option enable row level security;

create policy "course_option_select" on public.course_option
  for select to authenticated
  using (
    exists (
      select 1 from public.course_question q
      join public.course c on c.id = q.course_id
      where q.id = course_option.question_id
        and (
          (c.account_id is null and public.current_user_is_office())
          or (c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id))
          or public.current_user_is_admin()
        )
    )
  );

create policy "course_option_write" on public.course_option
  for all to authenticated
  using (
    exists (
      select 1 from public.course_question q
      join public.course c on c.id = q.course_id
      where q.id = course_option.question_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.course_question q
      join public.course c on c.id = q.course_id
      where q.id = course_option.question_id
        and ((c.account_id is not null and public.current_user_is_admin_or_manager_of(c.account_id)) or public.current_user_is_admin())
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — course_assignment / course_attempt / course_signature / course_certificate
-- ────────────────────────────────────────────────────────────────────────────

alter table public.course_assignment enable row level security;

create policy "course_assignment_select" on public.course_assignment
  for select to authenticated
  using (
    public.current_user_is_admin_or_manager_of(account_id)
    or (employee_id is not null and public.current_user_is_employee(employee_id, account_id))
  );

create policy "course_assignment_write" on public.course_assignment
  for all to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id))
  with check (public.current_user_is_admin_or_manager_of(account_id));

alter table public.course_attempt enable row level security;

-- Solo SELECT: escritura exclusiva vía start_course_attempt/submit_course_attempt
-- (SECURITY DEFINER, dueño postgres, bypasan RLS). Ni el propio empleado puede
-- insertar/tocar su intento directo — cierra cualquier vía de manipular la nota.
create policy "course_attempt_select" on public.course_attempt
  for select to authenticated
  using (
    exists (
      select 1 from public.course_assignment ca
      where ca.id = course_attempt.assignment_id
        and (
          public.current_user_is_admin_or_manager_of(ca.account_id)
          or public.current_user_is_employee(course_attempt.employee_id, ca.account_id)
        )
    )
  );

alter table public.course_signature enable row level security;

-- Solo SELECT: sin policy de insert/update/delete para ningún rol — el único
-- camino de escritura es sign_course_attempt (SECURITY DEFINER). Append-only
-- real: ni siquiera un admin puede corregir/borrar una firma desde el cliente.
create policy "course_signature_select" on public.course_signature
  for select to authenticated
  using (
    exists (
      select 1 from public.course_attempt at2
      join public.course_assignment ca on ca.id = at2.assignment_id
      where at2.id = course_signature.attempt_id
        and (
          public.current_user_is_admin_or_manager_of(ca.account_id)
          or public.current_user_is_employee(course_signature.employee_id, ca.account_id)
        )
    )
  );

alter table public.course_certificate enable row level security;

create policy "course_certificate_select" on public.course_certificate
  for select to authenticated
  using (
    exists (
      select 1 from public.course_attempt at2
      join public.course_assignment ca on ca.id = at2.assignment_id
      where at2.id = course_certificate.attempt_id
        and (
          public.current_user_is_admin_or_manager_of(ca.account_id)
          or public.current_user_is_employee(at2.employee_id, ca.account_id)
        )
    )
  );

-- INSERT: el propio empleado generando SU diploma (attempt superado), o
-- admin/manager generando el acta/diploma desde oficina. Sin update/delete
-- (mismo espíritu de evidencia que la firma: un diploma emitido no se toca;
-- si hace falta reemitirlo, es una fila nueva).
create policy "course_certificate_insert" on public.course_certificate
  for insert to authenticated
  with check (
    exists (
      select 1 from public.course_attempt at2
      join public.course_assignment ca on ca.id = at2.assignment_id
      where at2.id = course_certificate.attempt_id
        and at2.passed = true
        and (
          public.current_user_is_admin_or_manager_of(ca.account_id)
          or public.current_user_is_employee(at2.employee_id, ca.account_id)
        )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. STORAGE — buckets PRIVADOS (dato personal: firma manuscrita y diploma con DNI)
-- ────────────────────────────────────────────────────────────────────────────
-- Convención de path: {account_id}/{employee_id}/{archivo}. Sin policy de
-- update/delete en ninguno de los dos buckets (inmutable, igual que las filas).

insert into storage.buckets (id, name, public)
values ('course-signatures', 'course-signatures', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('course-certificates', 'course-certificates', false)
on conflict (id) do nothing;

create policy "course_signatures_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-signatures'
    and public.current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid)
  );

create policy "course_signatures_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-signatures'
    and (
      public.current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
      or public.current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid)
    )
  );

create policy "course_certificates_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-certificates'
    and (
      public.current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
      or public.current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid)
    )
  );

create policy "course_certificates_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-certificates'
    and (
      public.current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
      or public.current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- my_pending_courses() — para el móvil. Nunca recibe employee_id por parámetro:
-- se resuelve SIEMPRE de auth.uid(). Devuelve las asignaciones que alcanzan a
-- este empleado (directas, por puesto o por local) con su estado calculado.
create or replace function public.my_pending_courses()
returns table (
  assignment_id uuid,
  course_id uuid,
  course_code text,
  course_title text,
  delivery_mode text,
  estimated_minutes int,
  reeval_months int,
  due_at timestamptz,
  status text,
  attempt_id uuid,
  score_pct numeric,
  passed boolean,
  signed_at timestamptz
)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_employee_id uuid;
  v_account_id uuid;
begin
  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  return query
  select
    ca.id as assignment_id,
    c.id as course_id,
    c.code as course_code,
    c.title as course_title,
    c.delivery_mode,
    c.estimated_minutes,
    c.reeval_months,
    ca.due_at,
    case
      when sig.id is not null then 'firmado'
      when att.finished_at is not null and coalesce(att.passed, false) = false then 'suspendido'
      when att.started_at is not null and att.finished_at is null then 'en_curso'
      else 'pendiente'
    end as status,
    att.id as attempt_id,
    att.score_pct,
    att.passed,
    sig.signed_at
  from public.course_assignment ca
  join public.course c on c.id = ca.course_id
  join public.employees e on e.id = v_employee_id
  left join lateral (
    select a.* from public.course_attempt a
    where a.assignment_id = ca.id and a.employee_id = v_employee_id
    order by a.started_at desc
    limit 1
  ) att on true
  left join lateral (
    select s.* from public.course_signature s
    where s.attempt_id = att.id
    order by s.signed_at desc
    limit 1
  ) sig on true
  where ca.account_id = v_account_id
    and (
      ca.employee_id = v_employee_id
      or (ca.role is not null and ca.role = e.position)
      or (ca.location_id is not null and ca.location_id = e.location_id)
    )
  order by ca.due_at nulls last, c.title;
end;
$$;

-- start_course_attempt(p_assignment_id) — crea (o retoma) el intento y
-- devuelve curso + secciones + preguntas SIN is_correct/explanation.
create or replace function public.start_course_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_employee_id uuid;
  v_account_id uuid;
  v_assignment public.course_assignment%rowtype;
  v_emp_position text;
  v_emp_location_id uuid;
  v_course public.course%rowtype;
  v_attempt_id uuid;
  v_sections jsonb;
  v_questions jsonb;
begin
  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  select e.position, e.location_id into v_emp_position, v_emp_location_id
  from public.employees e where e.id = v_employee_id;

  select ca.* into v_assignment
  from public.course_assignment ca
  where ca.id = p_assignment_id
    and ca.account_id = v_account_id
    and (
      ca.employee_id = v_employee_id
      or (ca.role is not null and ca.role = v_emp_position)
      or (ca.location_id is not null and ca.location_id = v_emp_location_id)
    );
  if not found then
    raise exception 'Asignación no encontrada o no pertenece a este empleado';
  end if;

  select c.* into v_course from public.course c where c.id = v_assignment.course_id;
  if not found then
    raise exception 'Curso no encontrado';
  end if;

  -- Reutiliza un intento en curso (no finalizado) en vez de duplicar por cada
  -- refresco de pantalla.
  select a.id into v_attempt_id
  from public.course_attempt a
  where a.assignment_id = p_assignment_id and a.employee_id = v_employee_id and a.finished_at is null
  order by a.started_at desc
  limit 1;

  if v_attempt_id is null then
    insert into public.course_attempt (assignment_id, employee_id, answers)
    values (p_assignment_id, v_employee_id, '{}'::jsonb)
    returning id into v_attempt_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'ord', s.ord, 'title', s.title, 'body', s.body, 'mediaUrl', s.media_url
  ) order by s.ord), '[]'::jsonb) into v_sections
  from public.course_section s where s.course_id = v_course.id;

  -- ⚠️ Deliberadamente SIN is_correct ni explanation: la solución no sale del
  -- servidor hasta submit_course_attempt.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'ord', q.ord, 'text', q.text,
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by o.id), '[]'::jsonb)
      from public.course_option o where o.question_id = q.id
    )
  ) order by q.ord), '[]'::jsonb) into v_questions
  from public.course_question q where q.course_id = v_course.id;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'course', jsonb_build_object(
      'id', v_course.id, 'code', v_course.code, 'title', v_course.title,
      'summary', v_course.summary, 'legalBasis', v_course.legal_basis,
      'deliveryMode', v_course.delivery_mode, 'estimatedMinutes', v_course.estimated_minutes,
      'passThresholdPct', v_course.pass_threshold_pct, 'version', v_course.version
    ),
    'sections', v_sections,
    'questions', v_questions
  );
end;
$$;

-- submit_course_attempt(p_attempt_id, p_answers) — corrige SIEMPRE server-side.
-- p_answers: { "<question_id>": "<option_id>" }. Devuelve nota + explicaciones
-- (recién ahora, tras responder).
create or replace function public.submit_course_attempt(
  p_attempt_id uuid,
  p_answers jsonb,
  p_time_spent_seconds int default null
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_employee_id uuid;
  v_account_id uuid;
  v_attempt public.course_attempt%rowtype;
  v_course_id uuid;
  v_threshold int;
  v_total int;
  v_correct int;
  v_score numeric;
  v_passed boolean;
  v_results jsonb;
begin
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
  if v_attempt.finished_at is not null then
    raise exception 'Este intento ya se corrigió';
  end if;

  select ca.course_id into v_course_id from public.course_assignment ca where ca.id = v_attempt.assignment_id;
  select pass_threshold_pct into v_threshold from public.course where id = v_course_id;

  -- Nota: el join de la opción DADA exige go.question_id = q.id (no solo
  -- go.id = <valor>) — si no, un cliente podría enviar el id de una opción
  -- correcta de OTRA pregunta y colarla como respuesta válida de esta. La
  -- opción correcta (co) se resuelve con LATERAL + LIMIT 1: defensa ante
  -- datos mal cargados con más de un is_correct=true por pregunta (el editor
  -- de oficina debería impedirlo, pero la nota no puede depender de eso).
  select
    count(*),
    count(*) filter (where coalesce(go.is_correct, false)),
    jsonb_agg(jsonb_build_object(
      'questionId', q.id,
      'givenOptionId', go.id,
      'isCorrect', coalesce(go.is_correct, false),
      'explanation', go.explanation,
      'correctOptionId', co.id,
      'correctText', co.text
    ) order by q.ord)
  into v_total, v_correct, v_results
  from public.course_question q
  left join public.course_option go
    on go.question_id = q.id and go.id = nullif(p_answers ->> q.id::text, '')::uuid
  left join lateral (
    select o.id, o.text from public.course_option o
    where o.question_id = q.id and o.is_correct = true
    order by o.id limit 1
  ) co on true
  where q.course_id = v_course_id;

  v_score := round((coalesce(v_correct, 0)::numeric / greatest(coalesce(v_total, 0), 1)) * 100, 2);
  v_passed := v_score >= v_threshold;

  update public.course_attempt
  set finished_at = now(),
      score_pct = v_score,
      passed = v_passed,
      answers = p_answers,
      time_spent_seconds = coalesce(p_time_spent_seconds, time_spent_seconds)
  where id = p_attempt_id;

  return jsonb_build_object(
    'scorePct', v_score, 'passed', v_passed,
    'total', v_total, 'correct', v_correct,
    'passThresholdPct', v_threshold,
    'results', v_results
  );
end;
$$;

-- sign_course_attempt(...) — inserta la firma. Falla si el intento no está
-- passed. El empleado se resuelve SIEMPRE de auth.uid() dentro de la función;
-- si no hay sesión (auth.uid() null), no hay firma válida posible.
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

  insert into public.course_signature (
    attempt_id, employee_id, signature_png, signer_name, signer_doc_id,
    auth_method, auth_uid, course_version
  ) values (
    p_attempt_id, v_employee_id, p_signature_path, p_signer_name, p_signer_doc_id,
    'employee_session', v_uid, v_course_version
  )
  returning id, signed_at into v_signature_id, v_signed_at;

  return jsonb_build_object('signatureId', v_signature_id, 'signedAt', v_signed_at);
end;
$$;

grant execute on function public.my_pending_courses() to authenticated;
grant execute on function public.start_course_attempt(uuid) to authenticated;
grant execute on function public.submit_course_attempt(uuid, jsonb, int) to authenticated;
grant execute on function public.sign_course_attempt(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. GUARD — aborta con excepción si algo no quedó como debía (regla §3: no
--    fiarse del "Success" del SQL Editor).
-- ────────────────────────────────────────────────────────────────────────────

do $guard$
begin
  if to_regclass('public.course') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course'; end if;
  if to_regclass('public.course_section') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_section'; end if;
  if to_regclass('public.course_question') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_question'; end if;
  if to_regclass('public.course_option') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_option'; end if;
  if to_regclass('public.course_assignment') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_assignment'; end if;
  if to_regclass('public.course_attempt') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_attempt'; end if;
  if to_regclass('public.course_signature') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_signature'; end if;
  if to_regclass('public.course_certificate') is null then raise exception 'MIGRACIÓN FALLIDA: falta la tabla course_certificate'; end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_code_global_unique') then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_code_global_unique';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_code_account_unique') then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_code_account_unique';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_assignment_account_employee_idx') then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_assignment_account_employee_idx';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_attempt_assignment_idx') then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_attempt_assignment_idx';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_signature_attempt_idx') then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_signature_attempt_idx';
  end if;

  if not exists (select 1 from pg_proc where proname = 'current_user_is_office') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función current_user_is_office';
  end if;
  if not exists (select 1 from pg_proc where proname = 'current_employee_and_account') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función current_employee_and_account';
  end if;
  if not exists (select 1 from pg_proc where proname = 'my_pending_courses') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función my_pending_courses';
  end if;
  if not exists (select 1 from pg_proc where proname = 'start_course_attempt') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función start_course_attempt';
  end if;
  if not exists (select 1 from pg_proc where proname = 'submit_course_attempt') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función submit_course_attempt';
  end if;
  if not exists (select 1 from pg_proc where proname = 'sign_course_attempt') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función sign_course_attempt';
  end if;

  if not exists (select 1 from storage.buckets where id = 'course-signatures') then
    raise exception 'MIGRACIÓN FALLIDA: falta el bucket course-signatures';
  end if;
  if not exists (select 1 from storage.buckets where id = 'course-certificates') then
    raise exception 'MIGRACIÓN FALLIDA: falta el bucket course-certificates';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename like 'course%') <> 14 then
    raise exception 'MIGRACIÓN FALLIDA: faltan policies en las tablas course* (esperadas 14, encontradas %)',
      (select count(*) from pg_policies where schemaname = 'public' and tablename like 'course%');
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'course_%') < 4 then
    raise exception 'MIGRACIÓN FALLIDA: faltan policies de storage.objects para course-signatures/course-certificates';
  end if;
end
$guard$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO, en otra pestaña/Run — regla §3) ─────
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name like 'course%' order by 1;
-- Esperado: course, course_assignment, course_attempt, course_certificate,
--           course_option, course_question, course_section, course_signature.
--
-- select proname from pg_proc
--  where proname in ('current_user_is_office','current_employee_and_account',
--                     'my_pending_courses','start_course_attempt',
--                     'submit_course_attempt','sign_course_attempt')
--  order by 1;
-- Esperado: las 6 filas.
--
-- select id, public from storage.buckets where id like 'course-%' order by 1;
-- Esperado: course-certificates | false · course-signatures | false.
--
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename like 'course%' order by 1, 2;
-- Esperado: 2 policies (select+all) en course/course_section/course_question/
--           course_option/course_assignment; 1 (select) en course_attempt y
--           course_signature; 2 (select+insert) en course_certificate.
