-- ============================================================================
-- Formación C6 — backfill de obligatorias para cuentas que ya existen.
-- Aplicar DESPUÉS de 20260810T1000_formacion_c6_adopcion_obligatorias.sql,
-- como una ejecución APARTE en el SQL Editor (no pegar los dos ficheros
-- juntos): así, si este backfill tuviera algún problema, no se lleva por
-- delante el DDL de la otra migración (que ya habrá quedado confirmado en
-- su propia transacción).
--
-- 🔴 Corrige el bug real de la primera versión de esta migración (aviso de
-- Julio, verificado en producción): el SQL Editor de Supabase envuelve todo
-- el script pegado en UNA transacción explícita. Un DO con COMMIT/ROLLBACK
-- dentro del bucle revienta ahí con "invalid transaction termination"
-- (2D000) -- válido solo en una sesión suelta (psql) con autocommit, PG11+,
-- que NO es este contexto. Abortó la transacción entera y se llevó por
-- delante también la función y el trigger que creaba el otro fichero.
--
-- Arreglo: nada de COMMIT/ROLLBACK. El aislamiento por cuenta (que una
-- cuenta con datos raros no tumbe el backfill de las demás) se consigue con
-- un BEGIN...EXCEPTION WHEN OTHERS anidado -- crea un SAVEPOINT implícito y
-- hace ROLLBACK TO SAVEPOINT solo de esa iteración si algo falla, sin
-- terminar ni tocar la transacción de fuera. Esto SÍ es legal dentro de un
-- DO en el SQL Editor.
-- ============================================================================

do $backfill$
declare
  r record;
  v_n integer;
  v_total integer := 0;
  v_accounts integer := 0;
  v_failed integer := 0;
begin
  if to_regprocedure('public.adopt_mandatory_courses(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta adopt_mandatory_courses -- aplica primero 20260810T1000_formacion_c6_adopcion_obligatorias.sql';
  end if;

  for r in select id, name from public.accounts order by created_at loop
    begin
      v_n := public.adopt_mandatory_courses(r.id);
      v_total := v_total + v_n;
      v_accounts := v_accounts + 1;
      if v_n > 0 then
        raise notice 'Cuenta % (%): % curso(s) obligatorio(s) adoptado(s).', r.name, r.id, v_n;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'adopt_mandatory_courses falló para la cuenta % (%): %', r.name, r.id, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill de obligatorias: % cursos adoptados sobre % cuenta(s) revisada(s), % con error.', v_total, v_accounts, v_failed;
end
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — no solo "la función corrió sin explotar": relee el estado
-- real y avisa (RAISE WARNING, no EXCEPTION -- una cuenta que falló arriba
-- ya se reportó individualmente; esto no debe abortar ni deshacer lo que sí
-- se adoptó bien) si queda alguna combinación cuenta/obligatoria aplicable
-- sin adoptar.
-- ────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.accounts a
  join public.course g
    on g.account_id is null
   and g.is_mandatory = true
   and g.status = 'published'
   and (
     g.business_types = '{}'::text[]
     or 'todos' = any(g.business_types)
     or (a.business_type is not null and a.business_type = any(g.business_types))
   )
  where not exists (
    select 1 from public.course c2
    where c2.account_id = a.id and c2.adopted_from_course_id = g.id
  );

  if v_missing <> 0 then
    raise warning 'Backfill incompleto: % combinación(es) cuenta/obligatoria aplicable siguen sin adoptar (revisa los WARNING de arriba).', v_missing;
  else
    raise notice 'Verificación OK: todas las cuentas tienen adoptadas todas sus obligatorias publicadas aplicables.';
  end if;
end
$verify$;
-- ============================================================================
