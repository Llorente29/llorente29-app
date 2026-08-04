-- ============================================================================
-- Formación — Auditoría externa 1.5, backfill de datos: rescata AHORA (sin
-- esperar a un "Regenerar" futuro) el content_snapshot de toda firma
-- existente cuyo curso todavía no se ha regenerado desde este fix -- su
-- contenido sigue vivo en course_section/course_question, así que se puede
-- capturar directamente.
--
-- Aplicar DESPUÉS de 20260815T1000_formacion_fix_contenido_firmado.sql, como
-- ejecución APARTE en el SQL Editor (DDL y datos en ficheros separados).
-- Sin COMMIT/ROLLBACK. Aislamiento por firma con BEGIN...EXCEPTION WHEN
-- OTHERS anidado.
-- ============================================================================

do $backfill$
declare
  r record;
  v_snapshot jsonb;
  v_rescatadas integer := 0;
  v_sin_curso integer := 0;
  v_fallidas integer := 0;
begin
  if to_regprocedure('public.build_course_content_snapshot(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: aplica primero 20260815T1000_formacion_fix_contenido_firmado.sql';
  end if;

  for r in
    select cs.id as signature_id, cas.course_id
    from public.course_signature cs
    join public.course_attempt ca on ca.id = cs.attempt_id
    join public.course_assignment cas on cas.id = ca.assignment_id
    where cs.content_snapshot is null
  loop
    begin
      if r.course_id is null then
        v_sin_curso := v_sin_curso + 1;
        continue;
      end if;

      v_snapshot := public.build_course_content_snapshot(r.course_id);

      update public.course_signature
      set content_snapshot = v_snapshot
      where id = r.signature_id;

      v_rescatadas := v_rescatadas + 1;
    exception when others then
      v_fallidas := v_fallidas + 1;
      raise warning 'Backfill de content_snapshot falló para firma %: %', r.signature_id, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill de content_snapshot: % firma(s) rescatada(s), % sin curso resoluble, % con error.',
    v_rescatadas, v_sin_curso, v_fallidas;
end
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte, tras aplicar) — no debería quedar ninguna
-- firma sin snapshot salvo las "sin curso resoluble" que haya avisado arriba:
--
--   select count(*) as sin_snapshot from course_signature where content_snapshot is null;
-- ============================================================================
