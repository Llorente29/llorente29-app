-- ============================================================================
-- Formación C4 — Pieza B: taxonomía del catálogo.
-- Diseño: docs/folvy_formacion_catalogo_v2.md §6 · docs/folvy_formacion_guia_contenido.md §5.bis
-- Encargo: docs/ENCARGO_CODE_formacion_c4_practica_catalogo.md, sección B.
--
-- Tres ejes independientes + un orden de recomendación. Ningún riesgo de la
-- clase de bug de C2: esta migración NO toca training_compliance_matrix ni
-- training_gaps, ni ninguna función RETURNS TABLE. Es solo DDL (ADD COLUMN +
-- CHECK) más un UPDATE de datos, verificado con un guard que relee las filas
-- backfilleadas (no solo comprueba que las columnas existen).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Columnas nuevas.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.course
  add column if not exists category text
    check (category in ('cumplimiento', 'cocina', 'delivery', 'sala', 'equipo', 'producto', 'sostenibilidad')),
  add column if not exists business_types text[] not null default '{todos}'
    check (business_types <@ array['restaurante','bar_cafeteria','dark_kitchen','delivery','hotel','cadena','catering','todos']::text[]),
  add column if not exists level text
    check (level in ('base', 'especialista', 'mando')),
  add column if not exists recommended_order int;

comment on column public.course.category is
  'Eje 1 del catálogo (guía §5.bis): de qué trata. NULL = curso sin clasificar (deuda declarada, no bloquea nada).';
comment on column public.course.business_types is
  'Eje 2: a qué tipo de negocio le sirve. Vacío o que contenga ''todos'' = aplica a cualquiera. '
  'REGLA DURA: un curso category=''cumplimiento'' NUNCA se filtra por esto en el catálogo — si la ley obliga, obliga a todos.';
comment on column public.course.level is
  'Eje 3: a quién va dirigido dentro del local (base/especialista/mando). NULL = sin clasificar.';
comment on column public.course.recommended_order is
  'Orden del itinerario sugerido a un empleado nuevo (menor primero). NULL = sin posición sugerida.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Backfill de los 9 cursos de cumplimiento YA sembrados (C1-C3A). Por code
--    (estable frente a qué migración concreta insertó/actualizó la fila).
--    NO toca delivery_mode: PRL mantiene 'solo_archivo' tal cual ya estaba.
-- ────────────────────────────────────────────────────────────────────────────
update public.course
set category = 'cumplimiento',
    business_types = '{todos}',
    level = 'base',
    recommended_order = case code
      when 'manipulador_alimentos'      then 10
      when 'alergenos_intolerancias'    then 20
      when 'appcc_prerrequisitos'       then 30
      when 'igualdad_acoso'             then 40
      when 'lgtbi_no_discriminacion'    then 50
      when 'proteccion_datos_rgpd'      then 60
      when 'canal_denuncias'            then 70
      when 'primeros_auxilios'          then 80
      when 'prl_riesgos_laborales'      then 90
    end
where account_id is null
  and code in (
    'manipulador_alimentos', 'alergenos_intolerancias', 'appcc_prerrequisitos',
    'igualdad_acoso', 'lgtbi_no_discriminacion', 'proteccion_datos_rgpd',
    'canal_denuncias', 'primeros_auxilios', 'prl_riesgos_laborales'
  );

-- Los cursos de delivery ya sembrados por Julio (embolsado, temperatura en
-- ruta, incidencias, KDS) y cualquier curso de cuenta quedan FUERA de este
-- backfill a propósito: el encargo pide explícitamente "backfill de los 9
-- cursos existentes" (los de cumplimiento). Quedan sin categoría (NULL) hasta
-- que se clasifiquen — deuda declarada, no un olvido.

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) GUARD — no solo "existe la columna": relee los 9 cursos backfilleados y
--    falla si alguno quedó mal. Lección de C2: un guard de existencia no
--    prueba que el UPDATE funcionó de verdad.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_found int;
  v_bad int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'category'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.category';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'business_types'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.business_types';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'level'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.level';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'recommended_order'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.recommended_order';
  end if;

  select count(*) into v_found
  from public.course
  where account_id is null
    and code in (
      'manipulador_alimentos', 'alergenos_intolerancias', 'appcc_prerrequisitos',
      'igualdad_acoso', 'lgtbi_no_discriminacion', 'proteccion_datos_rgpd',
      'canal_denuncias', 'primeros_auxilios', 'prl_riesgos_laborales'
    );
  if v_found <> 9 then
    raise exception 'MIGRACIÓN FALLIDA: se esperaban 9 cursos de cumplimiento por code, se encontraron % — revisa si algún code cambió', v_found;
  end if;

  select count(*) into v_bad
  from public.course
  where account_id is null
    and code in (
      'manipulador_alimentos', 'alergenos_intolerancias', 'appcc_prerrequisitos',
      'igualdad_acoso', 'lgtbi_no_discriminacion', 'proteccion_datos_rgpd',
      'canal_denuncias', 'primeros_auxilios', 'prl_riesgos_laborales'
    )
    and (
      category is distinct from 'cumplimiento'
      or level is distinct from 'base'
      or recommended_order is null
      or not (business_types @> array['todos']::text[])
    );
  if v_bad <> 0 then
    raise exception 'MIGRACIÓN FALLIDA: % de los 9 cursos de cumplimiento quedaron sin taxonomía correcta tras el backfill', v_bad;
  end if;

  raise notice 'Taxonomía OK: 9/9 cursos de cumplimiento con category=cumplimiento, business_types={todos}, level=base y recommended_order asignado.';
end $$;
-- ============================================================================
