-- ============================================================================
-- Folvy · Módulo de FORMACIÓN — CAPA 3-A (imágenes de sección + adopción)
-- ----------------------------------------------------------------------------
-- Encargo: renderizado didáctico (react-markdown, sin BBDD) + imagen genérica
-- por sección + imagen PROPIA por cuenta (la pieza diferencial). Depende de
-- C1 (20260806T1500) + C2 (20260807T1400 + fix 20260807T1500), ya en main.
--
-- 🔴 GUARDARRAÍL CRÍTICO (motivo del encargo): una cuenta NUNCA puede escribir
-- sobre una sección cuyo course.account_id IS NULL (la plantilla global) —
-- si pudiera, cambiaría la imagen a TODOS los clientes de Folvy a la vez.
--
-- VERIFICADO (no reescrito): course_section_write, ya en C1
-- (20260806T1500_formacion_c1.sql), YA exige
--   (c.account_id IS NOT NULL AND current_user_is_admin_or_manager_of(c.account_id))
--   OR current_user_is_admin()
-- — un admin/manager de cuenta normal no puede tocar una sección con
-- account_id NULL bajo ninguna circunstancia; solo un platform-admin. Esta
-- migración NO toca esa policy (funciona bien, tocarla sin necesidad sería el
-- mismo tipo de riesgo que arreglar algo que no está roto). Lo que sí hace
-- esta migración es: (a) verificarlo con una consulta contra el catálogo vivo
-- (no fiarse de la memoria de lo que se escribió en C1 — detecta drift si
-- alguien la tocó desde entonces), y (b) aplicar EL MISMO criterio al nuevo
-- bucket de imágenes (que hoy no existe y sí hay que crear).
--
-- ADOPCIÓN: no existía ningún mecanismo para que una cuenta tuviera su copia
-- propia de un curso global (confirmado: grep completo del repo, cero
-- resultados de "adopt" ligado a course). Existe un precedente directo y ya
-- probado en producción para este mismo problema en otro dominio:
-- src/modules/kitchen/services/ingredientAdoptionService.ts (adopción de
-- ingredient_template → recipe_item propio, anti-duplicado por código,
-- nunca escribe en el master). courseAdoptionService.ts (fichero nuevo,
-- fuera de esta migración) replica ese patrón para course. Aquí solo se
-- añade la columna de trazabilidad que ese servicio necesita.
--
-- Aplicar por SQL Editor a mano. Verificar cada objeto con query
-- independiente (regla §3) — las consultas de verificación reales (que sí
-- ejecutan la policy, no solo comprueban que existe) están al final de este
-- fichero, en un bloque separado que hay que correr aparte con un usuario de
-- prueba real (ver motivo en esa sección: RLS no aplica al superusuario del
-- SQL Editor, así que un test ingenuo daría un falso "todo bien").
--
-- Aplicada:
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) Trazabilidad de adopción — para poder "volver a la imagen de Folvy"
--    sin necesidad de casar por code+ord (frágil): la copia de la cuenta
--    sabe explícitamente de qué curso global salió.
-- ─────────────────────────────────────────────────────────────────────
alter table public.course
  add column if not exists adopted_from_course_id uuid references public.course(id);

comment on column public.course.adopted_from_course_id is
  'Si esta fila es una copia adoptada de una plantilla global, apunta al course.id original (account_id IS NULL). NULL en la plantilla global y en cursos creados desde cero por la cuenta.';

-- Anti-duplicado a nivel de datos (segunda red, la primera es el propio
-- servicio de adopción comprobando antes de insertar): una cuenta no puede
-- tener dos copias adoptadas del mismo curso global.
create unique index if not exists course_adopted_from_unique
  on public.course (account_id, adopted_from_course_id)
  where adopted_from_course_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Bucket de imágenes de sección — PRIVADO, mismo patrón que
--    course-signatures/course-certificates (C1): path = {account_id}/...
--    Convención para las genéricas de Folvy: carpeta reservada '_global'
--    (nunca colisiona con un account_id real, que siempre es uuid) — las
--    sube Julio fuera de esta app (dashboard/service role); esta migración
--    solo prepara la policy para que CUALQUIER trabajador autenticado pueda
--    LEERLAS, y que solo un platform-admin pueda ESCRIBIR ahí.
-- ─────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('course-section-images', 'course-section-images', false)
on conflict (id) do nothing;

-- CASE, no AND/OR: Postgres NO garantiza cortocircuito en AND/OR (el
-- planificador puede evaluar cualquier lado primero), así que
-- "'_global' = ... OR belongs_to_account(...::uuid)" podría intentar
-- castear '_global' a uuid y reventar con "invalid input syntax for type
-- uuid" aunque la primera condición ya fuera verdadera. CASE WHEN sí
-- garantiza evaluar en orden y cortar en la rama que aplica.
create policy "course_section_images_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-section-images'
    and case
      when (storage.foldername(name))[1] = '_global' then true
      else public.belongs_to_account(nullif((storage.foldername(name))[1], '')::uuid)
    end
  );

create policy "course_section_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-section-images'
    and case
      when (storage.foldername(name))[1] = '_global' then public.current_user_is_admin()
      else public.current_user_is_admin_or_manager_of(nullif((storage.foldername(name))[1], '')::uuid)
    end
  );

-- DELETE: para que "usar foto propia" pueda borrar la foto custom anterior
-- al subir una nueva (higiene de storage, evita huérfanos). Mismo criterio
-- que INSERT. Sin UPDATE: cada subida es un archivo nuevo (timestamp en el
-- nombre), igual que course-signatures — nunca se sobrescribe un objeto.
create policy "course_section_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'course-section-images'
    and case
      when (storage.foldername(name))[1] = '_global' then public.current_user_is_admin()
      else public.current_user_is_admin_or_manager_of(nullif((storage.foldername(name))[1], '')::uuid)
    end
  );

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- 3) Guard — existencia (regla §3: no es suficiente sola, ver sección 4)
-- ─────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_qual text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'adopted_from_course_id'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta la columna course.adopted_from_course_id';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'course_adopted_from_unique'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta el índice course_adopted_from_unique';
  end if;

  if not exists (select 1 from storage.buckets where id = 'course-section-images') then
    raise exception 'MIGRACIÓN FALLIDA: falta el bucket course-section-images';
  end if;
  if exists (select 1 from storage.buckets where id = 'course-section-images' and public = true) then
    raise exception 'MIGRACIÓN FALLIDA: course-section-images quedó PÚBLICO -- debe ser privado';
  end if;

  if (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'course_section_images_%'
  ) <> 3 then
    raise exception 'MIGRACIÓN FALLIDA: faltan policies de storage.objects para course-section-images (esperadas 3)';
  end if;

  -- Drift-check del guardarraíl real (course_section_write, de C1 — NO
  -- tocada aquí): confirma contra el catálogo VIVO que sigue exigiendo
  -- account_id IS NOT NULL para escribir, no se fía de que "en C1 se
  -- escribió bien" siga siendo cierto hoy.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'course_section' and policyname = 'course_section_write';
  if v_qual is null then
    raise exception 'MIGRACIÓN FALLIDA: no existe la policy course_section_write -- el guardarraíl de esta capa depende de ella y no está';
  end if;
  if v_qual !~* 'account_id is not null' then
    raise exception 'GUARDARRAÍL EN RIESGO: course_section_write ya NO exige account_id IS NOT NULL para escribir -- alguien pudo haberla tocado desde C1. REVISAR ANTES DE SEGUIR, no continuar con esta capa hasta arreglarlo.';
  end if;
  raise notice 'Guardarraíl confirmado contra el catálogo vivo (course_section_write sigue exigiendo account_id IS NOT NULL). Texto: %', v_qual;
end
$guard$;

-- ============================================================================
-- 4) VERIFICACIÓN REAL DE RLS (ejecutar POR SEPARADO, con usuarios reales)
-- ============================================================================
-- El guard de arriba comprueba EXISTENCIA y el TEXTO de las policies — no que
-- SE COMPORTEN como dicen. La lección de C2: un guard que solo mira
-- pg_proc/pg_policies puede pasar en verde con un bug real. Aquí NO se puede
-- reproducir ese comportamiento con un truco sin sesión (como el DO block del
-- fix de C2, que reproducía ambigüedad de PL/pgSQL): esto es RLS, que evalúa
-- auth.uid() sobre el ROL de conexión — y el SQL Editor conecta como
-- POSTGRES SUPERUSUARIO, que se SALTA RLS por completo sin importar qué
-- auth.uid() se simule. Una prueba que solo simule auth.uid() sin cambiar de
-- rol daría un "todo permitido" falso, no una prueba real.
--
-- La forma correcta de probarlo de verdad EN EL SQL EDITOR (sin necesitar la
-- app): combinar `set local role authenticated` (así el rol de conexión deja
-- de ser postgres y RLS SÍ se aplica) con `request.jwt.claims` (así
-- auth.uid() devuelve el user_id que se indique). Con transacción + rollback
-- no queda ningún rastro.
--
-- Sustituye los marcadores por IDs reales de tu propia BBDD antes de correr
-- esto (no hace falta crear usuarios de prueba, se usan los que ya existen):
--   <manager_de_cuenta_A>   → user_id de un admin/manager real de una cuenta
--   <cuenta_A>              → esa misma cuenta
--   <seccion_de_curso_global> → id de una fila de course_section cuyo course
--                                padre tenga account_id IS NULL
--
-- NOTA: esto es control de transacción SQL de verdad (begin/rollback), NO un
-- bloque DO — un DO no puede hacer COMMIT/ROLLBACK de sí mismo. Se corre tal
-- cual, línea a línea, en el SQL Editor; el propio Editor muestra "UPDATE 0"
-- o "UPDATE 1" tras cada UPDATE, que es la prueba.
--
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<manager_de_cuenta_A>')::text, true);
--
--   -- PRUEBA 1 — debe decir "UPDATE 0": un manager de cuenta_A NO puede
--   -- escribir sobre una sección de un curso GLOBAL.
--   update public.course_section set media_url = 'PRUEBA-DEBE-FALLAR'
--    where id = '<seccion_de_curso_global>';
--
--   -- PRUEBA 2 — debe decir "UPDATE 1": ese mismo manager SÍ puede escribir
--   -- sobre una sección de UN CURSO PROPIO de su cuenta.
--   update public.course_section set media_url = media_url  -- no-op, solo para ver si RLS deja pasar
--    where id = '<seccion_de_curso_propio_de_cuenta_A>';
-- rollback;
-- reset role;
--
-- Si la PRUEBA 1 dice "UPDATE 1" (o más), el guardarraíl está roto — parar y
-- avisar antes de publicar nada más sobre este mecanismo.
--
-- Confirmación end-to-end real: abrir CoursesPage con un curso propio de la
-- cuenta y usar "Usar foto propia" / "Volver a la imagen de Folvy" en una
-- sección; y por separado, confirmar que NO aparece ese control (o aparece
-- deshabilitado con aviso) en una sección de un curso global sin adoptar.
