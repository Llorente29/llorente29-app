-- 20260809T0945_generate_week_schedule_usa_tope_plan.sql
-- Aplicada: 09/08/2026 por MCP (apply_migration)
--
-- generate_week_schedule pasa a leer break_policy.max_daily_minutes_plan
-- (con fallback a max_daily_minutes) para su tope de jornada. team_compliance_scan
-- NO se toca: sigue con max_daily_minutes como límite legal.
--
-- MÉTODO: se parte de la definición VIVA (pg_get_functiondef) y se sustituye una
-- sola expresión. Nunca se reescribe el cuerpo a mano (regla: fusionar, no
-- sobrescribir; producción va por delante del repo).

do $$
declare
  v_def  text;
  v_new  text;
  v_from text := 'coalesce(bp.max_daily_minutes,540)';
  v_to   text := 'coalesce(bp.max_daily_minutes_plan, bp.max_daily_minutes, 540)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname = 'generate_week_schedule';

  if v_def is null then
    raise exception 'FALLO: no se encontro generate_week_schedule';
  end if;

  if position(v_from in v_def) = 0 then
    raise exception 'FALLO: la expresion a sustituir no aparece en la definicion viva — ABORTA sin tocar nada';
  end if;

  v_new := replace(v_def, v_from, v_to);

  if v_new = v_def then
    raise exception 'FALLO: el reemplazo no cambio nada';
  end if;

  execute v_new;
end $$;

-- Guard: aborta si la función viva no quedó con la nueva expresión.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.prokind='f' and p.proname='generate_week_schedule'
       and pg_get_functiondef(p.oid) like '%max_daily_minutes_plan%'
  ) then
    raise exception 'FALLO: generate_week_schedule no quedo actualizada';
  end if;
end $$;

notify pgrst, 'reload schema';