-- ============================================================================
-- Formación — Onboarding formativo y calendario, NÚCLEO.
-- Diseño aprobado: docs/folvy_formacion_onboarding_diseno.md.
-- Decisiones de Julio (respuesta al diseño):
--   1) Rol por employees.position (texto), MISMA lógica de coincidencia que
--      my_pending_courses/training_compliance_matrix. NO se añade
--      staff_role_id ahora — deuda declarada con disparador explícito: se
--      migra cuando se toque la ficha de empleado (es pieza propia:
--      migración + backfill de texto libre + UI).
--   2) days_from_hire se cuenta desde employees.start_date (no created_at).
--   3) Backfill de empleados existentes: due_at = start_date + days_from_hire
--      (fechas honestamente vencidas), pero NO bloquea retroactivamente — ver
--      fichero de backfill aparte.
--   4) El semáforo avisa, no bloquea el cuadrante (fuera de alcance de esta
--      entrega: toca el módulo de turnos, RECON propio).
--
-- Solo DDL + un seed pequeño (3 filas de training_path + ~11 de
-- training_path_item — mismo tamaño que un seed de curso, no un backfill).
-- El backfill real (recorrer empleados existentes) va en fichero aparte
-- (lección de C6: [[feedback_sql_editor_transaccion_unica]]). SIN
-- COMMIT/ROLLBACK en ningún DO.
--
-- ⚠️ DESVIACIÓN DOCUMENTADA del esquema tal cual estaba escrito en el diseño:
-- "business_type NULL" (singular) se implementa como business_types text[]
-- (igual que course.business_types, C4) — el propio itinerario por defecto
-- necesita que "Embolsado" aplique a delivery Y dark_kitchen a la vez; un
-- campo singular no lo permite. Mismo motivo, mismo patrón ya usado.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tablas.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_path (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id), -- NULL = itinerario global de Folvy (mismo patrón que course.account_id)
  name text not null,
  roles text[] not null default '{}',           -- vacío = aplica a cualquier employees.position
  business_types text[] not null default '{}',  -- vacío = aplica a cualquier accounts.business_type
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.training_path is
  'Itinerario de incorporación (día 1 / 30 / 90 días). account_id NULL = plantilla global de Folvy, igual que course. '
  'roles/business_types vacíos = aplica a todos; si tienen valores, coincidencia OR interna (employees.position = ANY(roles)).';

create table if not exists public.training_path_item (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.training_path(id) on delete cascade,
  course_id uuid not null references public.course(id),
  phase text not null check (phase in ('dia_1', 'dias_30', 'dias_90')),
  days_from_hire int not null,
  is_blocking boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.training_path_item.is_blocking is
  'Si true, el empleado no debería manipular alimentos sin haberlo superado (criterio legal: formación ANTES de la exposición al riesgo). '
  'Gobierna el semáforo rojo — nunca el bloqueo automático del cuadrante (decisión de Julio: avisa, no bloquea).';

create unique index if not exists training_path_item_unique on public.training_path_item (path_id, course_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) RLS — mismo patrón que course_select/course_write (C1).
-- ────────────────────────────────────────────────────────────────────────────
alter table public.training_path enable row level security;

create policy "training_path_select" on public.training_path
  for select to authenticated
  using (
    (account_id is null and public.current_user_is_office())
    or (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  );

create policy "training_path_write" on public.training_path
  for all to authenticated
  using (
    (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  )
  with check (
    (account_id is not null and public.current_user_is_admin_or_manager_of(account_id))
    or public.current_user_is_admin()
  );

alter table public.training_path_item enable row level security;

create policy "training_path_item_select" on public.training_path_item
  for select to authenticated
  using (
    exists (
      select 1 from public.training_path p
      where p.id = training_path_item.path_id
        and (
          (p.account_id is null and public.current_user_is_office())
          or (p.account_id is not null and public.current_user_is_admin_or_manager_of(p.account_id))
          or public.current_user_is_admin()
        )
    )
  );

create policy "training_path_item_write" on public.training_path_item
  for all to authenticated
  using (
    exists (
      select 1 from public.training_path p
      where p.id = training_path_item.path_id
        and ((p.account_id is not null and public.current_user_is_admin_or_manager_of(p.account_id)) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.training_path p
      where p.id = training_path_item.path_id
        and ((p.account_id is not null and public.current_user_is_admin_or_manager_of(p.account_id)) or public.current_user_is_admin())
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3) assign_onboarding_training(p_employee_id) — resuelve el itinerario
--    aplicable (por position + business_type de la cuenta del empleado, vía
--    su local) y crea los course_assignment que falten. Idempotente: nunca
--    duplica (NOT EXISTS por course_id) y nunca borra lo ya asignado.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_onboarding_training(p_employee_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_position text;
  v_start_date date;
  v_item record;
  v_count integer := 0;
begin
  -- employees NO tiene account_id propio -- se resuelve vía su local (mismo
  -- patrón que training_compliance_matrix, C2).
  select l.account_id, e.position, e.start_date
    into v_account_id, v_position, v_start_date
  from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;

  if v_account_id is null then
    -- Empleado sin local asignado todavía (o local sin cuenta): no hay forma
    -- de resolver itinerario. No es un error -- se resolverá cuando se le
    -- asigne local, o con el trigger de UPDATE si el local se fija después
    -- (no cubierto aquí: cambio de local no dispara re-resolución en esta
    -- entrega -- deuda declarada, mismo criterio que "no las tres a medias").
    return 0;
  end if;

  for v_item in
    select pi.course_id, pi.days_from_hire
    from public.training_path p
    join public.training_path_item pi on pi.path_id = p.id
    where p.active = true
      and (p.account_id = v_account_id or p.account_id is null)
      and (p.roles = '{}' or (v_position is not null and v_position <> '' and v_position = any(p.roles)))
      and (
        p.business_types = '{}'
        or exists (select 1 from public.accounts a where a.id = v_account_id and a.business_type = any(p.business_types))
      )
      and not exists (
        select 1 from public.course_assignment ca
        where ca.employee_id = p_employee_id and ca.course_id = pi.course_id
      )
  loop
    insert into public.course_assignment (account_id, course_id, employee_id, origin, due_at)
    values (
      v_account_id, v_item.course_id, p_employee_id, 'onboarding',
      case when v_start_date is null then null else (v_start_date + v_item.days_from_hire)::timestamptz end
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

grant execute on function public.assign_onboarding_training(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Triggers — alta de empleado y cambio de puesto. Mismo patrón que
--    trg_seed_ingredient_families_on_account_insert / trg_adopt_mandatory_courses
--    (C6): función SECURITY DEFINER + trigger sobre la tabla.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_assign_onboarding_training_on_employee_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assign_onboarding_training(new.id);
  return new;
end;
$function$;

drop trigger if exists assign_onboarding_training_after_insert_employees on public.employees;
create trigger assign_onboarding_training_after_insert_employees
  after insert on public.employees
  for each row execute function public.trg_assign_onboarding_training_on_employee_insert();

-- Cambio de puesto: solo position dispara re-resolución (es el único campo
-- que usa el matching, decisión 1). Nunca borra lo ya asignado — solo añade
-- lo que falte del nuevo puesto.
create or replace function public.trg_assign_onboarding_training_on_employee_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.position is distinct from old.position then
    perform public.assign_onboarding_training(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists assign_onboarding_training_after_update_employees on public.employees;
create trigger assign_onboarding_training_after_update_employees
  after update on public.employees
  for each row execute function public.trg_assign_onboarding_training_on_employee_update();

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 5) SEED — itinerario por defecto de Folvy (global, account_id NULL).
--    Idempotente por nombre de path y (path_id, course_id) del item.
--    Defensivo por código de curso: si un curso todavía no existe (p.ej.
--    escandallo_fichas_tecnicas, en borrador de Julio a la hora de escribir
--    esto), avisa y sigue sin ese item -- no aborta el resto del seed.
-- ────────────────────────────────────────────────────────────────────────────
do $seed$
declare
  v_general_id uuid;
  v_cocina_id uuid;
  v_delivery_id uuid;
  v_course_id uuid;
  v_row record;
  v_missing text[] := '{}';
begin
  select id into v_general_id from public.training_path where account_id is null and name = 'Itinerario general de incorporación';
  if v_general_id is null then
    insert into public.training_path (account_id, name, roles, business_types)
    values (null, 'Itinerario general de incorporación', '{}', '{}')
    returning id into v_general_id;
  end if;

  select id into v_cocina_id from public.training_path where account_id is null and name = 'Itinerario de incorporación — cocina';
  if v_cocina_id is null then
    insert into public.training_path (account_id, name, roles, business_types)
    values (null, 'Itinerario de incorporación — cocina', array['Jefe de cocina', 'Cocinero', 'Ayudante cocina'], '{}')
    returning id into v_cocina_id;
  end if;

  select id into v_delivery_id from public.training_path where account_id is null and name = 'Itinerario de incorporación — delivery';
  if v_delivery_id is null then
    insert into public.training_path (account_id, name, roles, business_types)
    values (null, 'Itinerario de incorporación — delivery', '{}', array['delivery', 'dark_kitchen'])
    returning id into v_delivery_id;
  end if;

  for v_row in
    select * from (values
      ('manipulador_alimentos',   'dia_1',   0,  true),
      ('alergenos_intolerancias', 'dia_1',   0,  true),
      ('appcc_prerrequisitos',    'dias_30', 30, false),
      ('prl_riesgos_laborales',   'dias_30', 30, false),
      ('estacion_kds',            'dias_30', 30, false),
      ('igualdad_acoso',          'dias_90', 90, false),
      ('lgtbi_no_discriminacion', 'dias_90', 90, false),
      ('proteccion_datos_rgpd',   'dias_90', 90, false),
      ('canal_denuncias',         'dias_90', 90, false)
    ) as t(code, phase, days, blocking)
  loop
    select id into v_course_id from public.course where code = v_row.code and account_id is null;
    if v_course_id is null then
      v_missing := array_append(v_missing, v_row.code);
      continue;
    end if;
    insert into public.training_path_item (path_id, course_id, phase, days_from_hire, is_blocking)
    values (v_general_id, v_course_id, v_row.phase, v_row.days, v_row.blocking)
    on conflict (path_id, course_id) do update
      set phase = excluded.phase, days_from_hire = excluded.days_from_hire, is_blocking = excluded.is_blocking;
  end loop;

  select id into v_course_id from public.course where code = 'escandallo_fichas_tecnicas' and account_id is null;
  if v_course_id is not null then
    insert into public.training_path_item (path_id, course_id, phase, days_from_hire, is_blocking)
    values (v_cocina_id, v_course_id, 'dias_90', 90, false)
    on conflict (path_id, course_id) do update
      set phase = excluded.phase, days_from_hire = excluded.days_from_hire, is_blocking = excluded.is_blocking;
  else
    v_missing := array_append(v_missing, 'escandallo_fichas_tecnicas');
  end if;

  select id into v_course_id from public.course where code = 'embolsado_delivery' and account_id is null;
  if v_course_id is not null then
    insert into public.training_path_item (path_id, course_id, phase, days_from_hire, is_blocking)
    values (v_delivery_id, v_course_id, 'dias_30', 30, false)
    on conflict (path_id, course_id) do update
      set phase = excluded.phase, days_from_hire = excluded.days_from_hire, is_blocking = excluded.is_blocking;
  else
    v_missing := array_append(v_missing, 'embolsado_delivery');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise warning 'Itinerario por defecto: % curso(s) todavía no existen, sus items no se sembraron: %. Vuelve a aplicar este bloque (o solo la sección 5) cuando existan.', array_length(v_missing, 1), v_missing;
  end if;
end
$seed$;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real (que assign_onboarding_training
-- resuelva bien un empleado real) se verifica en el fichero de backfill, que
-- relee el resultado -- no aquí.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regclass('public.training_path') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la tabla training_path';
  end if;
  if to_regclass('public.training_path_item') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la tabla training_path_item';
  end if;
  if to_regprocedure('public.assign_onboarding_training(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función assign_onboarding_training';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'assign_onboarding_training_after_insert_employees') then
    raise exception 'MIGRACIÓN FALLIDA: falta el trigger de alta de empleado';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'assign_onboarding_training_after_update_employees') then
    raise exception 'MIGRACIÓN FALLIDA: falta el trigger de cambio de puesto';
  end if;
  if (select count(*) from public.training_path where account_id is null) < 3 then
    raise exception 'MIGRACIÓN FALLIDA: faltan itinerarios globales por defecto (esperados 3)';
  end if;
  raise notice 'Onboarding núcleo OK: tablas + RLS + assign_onboarding_training + triggers + % itinerarios globales.', (select count(*) from public.training_path where account_id is null);
end
$guard$;
-- ============================================================================
