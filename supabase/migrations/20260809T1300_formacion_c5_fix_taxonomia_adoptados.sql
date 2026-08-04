-- ============================================================================
-- Formación C5 — Pieza A: fix de taxonomía (y comportamiento) en copias
-- adoptadas. Bug real visto en producción: docs/ENCARGO_CODE_formacion_c5_portadas.md §A.
--
-- Causa raíz: courseAdoptionService.ts clona course al adoptar una plantilla
-- global, pero se escribió en C3-A — antes de que C4 añadiera
-- category/business_types/level/recommended_order/requires_practical. La
-- copia nacía SIN esos campos. Esta migración es el arreglo retroactivo de
-- DATOS para las copias que ya existen; el arreglo de código (para las
-- adopciones futuras) va en el mismo commit, en courseAdoptionService.ts.
--
-- 🔴 HALLAZGO PROPIO (no estaba en el encargo): requires_practical es el
-- campo más grave de la lista, no uno más de taxonomía. embolsado_delivery,
-- temperatura_ruta_delivery y estacion_kds ya tienen requires_practical=true
-- en la plantilla global (ver sus migraciones de siembra). Cualquier cuenta
-- que haya adoptado una de ellas ANTES de este fix tiene una copia con
-- requires_practical=false: training_compliance_matrix la daría por
-- "vigente" sin que nadie verificara nunca la parte práctica. Es exactamente
-- el "vender un tie como victoria" que el propio módulo prohíbe en su PDF de
-- inspección.
--
-- Idempotente. "Solo donde el campo esté NULL" (regla del encargo) se aplica
-- literalmente a category/level/recommended_order, que sí son NULL-ables.
-- business_types y requires_practical NO pueden ser NULL (NOT NULL DEFAULT
-- en C4): para esos dos, el sentinel de "nunca se tocó" es su propio valor
-- por defecto ('{todos}' / false) — ver el razonamiento en cada bloque.
-- ============================================================================

do $fix$
declare
  v_n int;
  v_total int := 0;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course' and column_name = 'category'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course.category (C4) -- aplica esa migración antes que esta';
  end if;

  -- ── category / level / recommended_order: NULL-ables, sentinel real ──────
  update public.course as copy
  set category = origin.category
  from public.course as origin
  where copy.adopted_from_course_id = origin.id
    and copy.account_id is not null
    and copy.category is null
    and origin.category is not null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'category heredado en % copias', v_n;

  update public.course as copy
  set level = origin.level
  from public.course as origin
  where copy.adopted_from_course_id = origin.id
    and copy.account_id is not null
    and copy.level is null
    and origin.level is not null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'level heredado en % copias', v_n;

  update public.course as copy
  set recommended_order = origin.recommended_order
  from public.course as origin
  where copy.adopted_from_course_id = origin.id
    and copy.account_id is not null
    and copy.recommended_order is null
    and origin.recommended_order is not null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'recommended_order heredado en % copias', v_n;

  -- ── business_types: NOT NULL DEFAULT '{todos}'. Sentinel = "sigue en el
  --    valor por defecto" (hoy no existe ninguna UI para que un cliente lo
  --    edite, así que '{todos}' en una copia solo puede significar "nunca se
  --    tocó", nunca una elección deliberada) ──────────────────────────────
  update public.course as copy
  set business_types = origin.business_types
  from public.course as origin
  where copy.adopted_from_course_id = origin.id
    and copy.account_id is not null
    and copy.business_types = '{todos}'
    and origin.business_types <> '{todos}';
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'business_types heredado en % copias', v_n;

  -- ── requires_practical: NOT NULL DEFAULT false. Solo se corrige en la
  --    dirección segura (false -> true, cuando la plantilla exige práctica):
  --    la dirección contraria SÍ podría pisar una decisión real de un admin
  --    que desmarcó el toggle en su copia a propósito, y de eso no hay forma
  --    de distinguir "nunca se tocó" de "se puso a false aposta". Dejar un
  --    curso en falso-vigente es el riesgo mayor -> se corrige; lo contrario
  --    NO se toca. ⚠️ Julio: si algún cliente desmarcó esto deliberadamente
  --    en una copia adoptada de embolsado/temperatura_ruta/estacion_kds,
  --    esta migración lo revertiría a true. Avísame si es el caso antes de
  --    aplicarla.
  update public.course as copy
  set requires_practical = true
  from public.course as origin
  where copy.adopted_from_course_id = origin.id
    and copy.account_id is not null
    and copy.requires_practical = false
    and origin.requires_practical = true;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'requires_practical corregido (false->true) en % copias', v_n;

  -- ── course_practical_item: si la plantilla tiene gestos que la copia no
  --    tiene, clonarlos (idempotente: NOT EXISTS por course_id+ord). Hoy es
  --    un no-op (ningún curso sembrado tiene gestos todavía), pero sin esto
  --    una copia con requires_practical=true y CERO gestos calcularía
  --    practical_ok "vacuamente true" -- vigente sin verificar nada.
  insert into public.course_practical_item (course_id, ord, text, help_text)
  select copy.id, origin_item.ord, origin_item.text, origin_item.help_text
  from public.course as copy
  join public.course as origin on copy.adopted_from_course_id = origin.id
  join public.course_practical_item as origin_item on origin_item.course_id = origin.id
  where copy.account_id is not null
    and not exists (
      select 1 from public.course_practical_item existing
      where existing.course_id = copy.id and existing.ord = origin_item.ord
    );
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  raise notice 'course_practical_item clonados en % filas', v_n;

  raise notice 'Fix taxonomía copias adoptadas: % cambios en total.', v_total;
end
$fix$;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — no solo existencia: relee tras el UPDATE. Si queda alguna copia
-- adoptada con category NULL mientras su origen SÍ tiene category, el fix no
-- funcionó de verdad (lección de C2: probar la ejecución real).
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.course as copy
  join public.course as origin on copy.adopted_from_course_id = origin.id
  where copy.account_id is not null
    and (
      (copy.category is null and origin.category is not null)
      or (copy.level is null and origin.level is not null)
      or (copy.recommended_order is null and origin.recommended_order is not null)
      or (copy.business_types = '{todos}' and origin.business_types <> '{todos}')
      or (copy.requires_practical = false and origin.requires_practical = true)
    );
  if v_bad <> 0 then
    raise exception 'MIGRACIÓN FALLIDA: % copias adoptadas siguen sin heredar taxonomía/comportamiento de su origen', v_bad;
  end if;

  raise notice 'Guard OK: ninguna copia adoptada quedó sin heredar taxonomía/comportamiento de su origen.';
end
$guard$;
-- ============================================================================
