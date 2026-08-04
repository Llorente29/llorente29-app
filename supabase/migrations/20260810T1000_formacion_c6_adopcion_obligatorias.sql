-- ============================================================================
-- Formación C6 — Pieza C: adopción automática de las obligatorias.
-- Encargo: docs/ENCARGO_CODE_formacion_c6_catalogo_zonas.md §C.
--
-- Mismo patrón que 20260617T2360_ingredient_family_onboarding.sql (RECON
-- obligatorio del encargo, verificado): función SECURITY DEFINER idempotente
-- + trigger AFTER INSERT ON accounts que la invoca + backfill aparte para
-- las cuentas que ya existen (esa migración también separa el backfill del
-- alta de la función, por la misma razón: no mezclar DDL con una operación
-- pesada de datos en la misma transacción implícita).
--
-- Duplica en PL/pgSQL el clonado que hace courseAdoptionService.ts
-- (course + course_section + course_question/course_option +
-- course_practical_item) porque un trigger de BBDD no puede invocar código
-- de cliente. ⚠️ MANTENIMIENTO: si cambia qué campos copia la adopción
-- manual (courseAdoptionService.ts), replicar el cambio AQUÍ también — no
-- hay una única fuente de verdad posible mientras la adopción manual siga
-- siendo TypeScript y esta sea SQL.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) RECON verificado: el índice anti-duplicado de C4 sigue vivo.
-- ────────────────────────────────────────────────────────────────────────────
do $recon$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'course' and indexname = 'course_adopted_from_unique'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course_adopted_from_unique (C3-A) -- el anti-duplicado ya no está protegido a nivel de datos';
  end if;
end
$recon$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) adopt_mandatory_courses(p_account_id) — adopta TODAS las plantillas
--    globales is_mandatory=true, status='published' y aplicables al tipo de
--    negocio de la cuenta, que la cuenta no tenga ya adoptadas. Idempotente:
--    NOT EXISTS contra course_adopted_from_unique antes de cada clonado (y el
--    propio índice como red final si hay una carrera).
--
--    🔒 Solo status='published': un curso en draft puede tener contenido sin
--    revisar. Empujarlo automáticamente a cada cuenta nueva contradice "el
--    contenido tiene que estar validado" (guía §7). Si Julio publica un
--    obligatorio más tarde, las cuentas YA existentes no lo reciben solas
--    (el trigger solo dispara al ALTA) -- hay que re-correr el backfill de
--    la sección 3 para ponerlas al día. Aviso explícito, no silencioso.
--
--    🔒 business_types: hoy los 9 de cumplimiento son {todos}, así que
--    aplican siempre -- pero el filtro se aplica igual (no queda para
--    "cuando haga falta"), tal como pide el encargo.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.adopt_mandatory_courses(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_type text;
  v_global record;
  v_new_course_id uuid;
  v_question record;
  v_new_question_id uuid;
  v_adopted_count integer := 0;
begin
  select business_type into v_business_type from public.accounts where id = p_account_id;

  for v_global in
    select g.* from public.course g
    where g.account_id is null
      and g.is_mandatory = true
      and g.status = 'published'
      and (
        g.business_types = '{}'::text[]
        or 'todos' = any(g.business_types)
        or (v_business_type is not null and v_business_type = any(g.business_types))
      )
      and not exists (
        select 1 from public.course c2
        where c2.account_id = p_account_id and c2.adopted_from_course_id = g.id
      )
    order by g.recommended_order nulls last, g.title
  loop
    insert into public.course (
      account_id, adopted_from_course_id, code, title, summary, legal_basis,
      delivery_mode, reeval_months, is_mandatory, appcc_prerequisite,
      estimated_minutes, pass_threshold_pct, version, status,
      category, business_types, level, recommended_order, requires_practical, cover_url
    ) values (
      p_account_id, v_global.id, v_global.code, v_global.title, v_global.summary, v_global.legal_basis,
      v_global.delivery_mode, v_global.reeval_months, v_global.is_mandatory, v_global.appcc_prerequisite,
      v_global.estimated_minutes, v_global.pass_threshold_pct, 1, v_global.status,
      v_global.category, v_global.business_types, v_global.level, v_global.recommended_order,
      v_global.requires_practical, v_global.cover_url
    )
    -- Carrera con otra sesión adoptando el mismo curso a la vez para la misma
    -- cuenta: el índice único gana, esta fila se descarta sin reventar la
    -- función (mismo criterio de "rechazarlo también en la BBDD" del
    -- encargo). ⚠️ course_adopted_from_unique es un ÍNDICE PARCIAL (CREATE
    -- UNIQUE INDEX ... WHERE adopted_from_course_id IS NOT NULL), NO una
    -- constraint con nombre propio -- "ON CONFLICT ON CONSTRAINT
    -- course_adopted_from_unique" fallaría en tiempo de EJECUCIÓN (no al
    -- crear la función: plpgsql no resuelve esto hasta el primer plan). La
    -- inferencia correcta para un índice parcial es columnas + WHERE
    -- idéntico al del índice.
    on conflict (account_id, adopted_from_course_id) where (adopted_from_course_id is not null) do nothing
    returning id into v_new_course_id;

    if v_new_course_id is null then
      continue; -- otra sesión ganó la carrera para este curso: nada que clonar
    end if;

    insert into public.course_section (course_id, ord, title, body, media_url)
    select v_new_course_id, s.ord, s.title, s.body, s.media_url
    from public.course_section s
    where s.course_id = v_global.id;

    for v_question in
      select * from public.course_question where course_id = v_global.id order by ord
    loop
      insert into public.course_question (course_id, ord, text)
      values (v_new_course_id, v_question.ord, v_question.text)
      returning id into v_new_question_id;

      insert into public.course_option (question_id, text, is_correct, explanation)
      select v_new_question_id, o.text, o.is_correct, o.explanation
      from public.course_option o
      where o.question_id = v_question.id;
    end loop;

    insert into public.course_practical_item (course_id, ord, text, help_text)
    select v_new_course_id, p.ord, p.text, p.help_text
    from public.course_practical_item p
    where p.course_id = v_global.id;

    v_adopted_count := v_adopted_count + 1;
  end loop;

  return v_adopted_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Trigger al alta de cuenta — mismo patrón que
--    trg_seed_ingredient_families_on_account_insert.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_adopt_mandatory_courses_on_account_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.adopt_mandatory_courses(new.id);
  return new;
end;
$function$;

drop trigger if exists adopt_mandatory_courses_after_insert_accounts on public.accounts;
create trigger adopt_mandatory_courses_after_insert_accounts
  after insert on public.accounts
  for each row execute function public.trg_adopt_mandatory_courses_on_account_insert();

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real (que adopte de verdad) se prueba en
-- la sección 3 (backfill), que relee el resultado tras correr.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regprocedure('public.adopt_mandatory_courses(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función adopt_mandatory_courses';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'adopt_mandatory_courses_after_insert_accounts'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta el trigger adopt_mandatory_courses_after_insert_accounts';
  end if;
  raise notice 'adopt_mandatory_courses + trigger OK.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) BACKFILL — cuentas que ya existen. UNA TRANSACCIÓN POR CUENTA (aviso del
--    encargo: adoptar clona curso+secciones+preguntas+opciones+gestos; con
--    varias cuentas y 9 obligatorias puede ser pesado). Ejecutar este bloque
--    tal cual, en la SQL Editor, en modo top-level (no dentro de otra función):
--    los DO en top-level SÍ pueden hacer COMMIT/ROLLBACK internamente desde
--    Postgres 11.
--
--    Errores por cuenta se registran con RAISE WARNING y NO detienen el
--    backfill de las demás -- una cuenta con un dato raro no debe bloquear a
--    las 50 siguientes.
-- ────────────────────────────────────────────────────────────────────────────
do $backfill$
declare
  r record;
  v_n integer;
  v_total integer := 0;
  v_accounts integer := 0;
begin
  for r in select id, name from public.accounts order by created_at loop
    begin
      v_n := public.adopt_mandatory_courses(r.id);
      v_total := v_total + v_n;
      v_accounts := v_accounts + 1;
      if v_n > 0 then
        raise notice 'Cuenta % (%): % curso(s) obligatorio(s) adoptado(s).', r.name, r.id, v_n;
      end if;
      commit;
    exception when others then
      rollback;
      raise warning 'adopt_mandatory_courses falló para la cuenta % (%): %', r.name, r.id, sqlerrm;
    end;
  end loop;
  raise notice 'Backfill de obligatorias: % cursos adoptados en % cuenta(s) revisada(s).', v_total, v_accounts;
end
$backfill$;
-- ============================================================================
