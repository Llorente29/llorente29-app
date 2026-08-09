-- 20260809T0940_break_policy_tope_diario_plan.sql
-- Aplicada: 09/08/2026 por MCP (apply_migration) — VERIFICADA en vivo.
--
-- MOTIVO: max_daily_minutes lo leen a la vez DOS consumidores con propósitos
-- distintos, verificado en vivo el 09/08:
--   · generate_week_schedule  → "qué turno puedo PROPONER" (planificación)
--   · team_compliance_scan    → "qué jornada levanta bandera legal" (cumplimiento)
-- Subirlo de 540 a 570 para permitir el turno corrido de 9,5 h (14:45–00:15, el
-- que Julio pone de verdad en el día pico) habría silenciado 19 de los 54 avisos
-- EXCESO_JORNADA_DIARIA de los últimos 90 días. Se separan las dos nociones:
-- el límite legal NO se toca.
--
-- Verificación post-ejecución (09/08):
--   break_policy → max_daily_minutes=540 · max_daily_minutes_plan=570
--   team_compliance_scan 90d → EXCESO_JORNADA_DIARIA sigue en 54 (no se silenció nada)

alter table public.break_policy
  add column if not exists max_daily_minutes_plan integer;

comment on column public.break_policy.max_daily_minutes_plan is
  'Tope de jornada diaria para PLANIFICACION (generador de cuadrantes). Si es null se cae a max_daily_minutes. NO lo usa team_compliance_scan, que mantiene max_daily_minutes como limite legal (art. 34.3 ET).';

update public.break_policy
   set max_daily_minutes_plan = 570,
       updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and location_id is null;

-- Guard: aborta si la columna no quedó creada (no fiarse del "Success").
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='break_policy'
       and column_name='max_daily_minutes_plan'
  ) then
    raise exception 'FALLO: max_daily_minutes_plan no se creo';
  end if;
end $$;
