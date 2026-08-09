-- 20260809T1510_team_labor_model_peak_margins.sql
-- Aplicada: NO — propuesta, pendiente de que Julio la ejecute y verifique.
--
-- ENCARGO CODE F10 — Bloque A.2. Columnas TIPADAS (no JSON) para dos de los
-- 5 parámetros de "Cubrir el resto":
--   peak_weekday / peak_weekend — parámetro 1, dotación mínima en el pico,
--     separada entre semana y fin de semana. NULL/0 = sin suelo (comportamiento
--     actual, no cambia nada hasta que Julio lo configure desde el panel).
--   pre_open_minutes / post_close_minutes — parámetro 4 (parte), minutos de
--     trabajo declarado no productivo antes de abrir / después de cerrar.
--     Sustituyen a open_close_extra, que se documenta como superado pero NO
--     se borra (regla NO DESTRUCCIÓN) ni se usa ya en generate_week_schedule
--     tras esta migración — team_labor_requirement lo sigue leyendo para su
--     propio cálculo de personal necesario en la hora de apertura/cierre, eso
--     no cambia aquí.
--
-- Motivo del tipado frente a JSON: el ritmo (per_person_hour) llevaba semanas
-- mal (15 vs 20 vs 12, ver folvy_team_f10_rediseno_motor_horarios.md §1.8)
-- precisamente porque vivía enterrado sin ser visible. Columna tipada +
-- pantalla que la muestra (Bloque B) es la misma disciplina para estos 4.

alter table public.team_labor_model
  add column if not exists peak_weekday integer,
  add column if not exists peak_weekend integer,
  add column if not exists pre_open_minutes integer not null default 0,
  add column if not exists post_close_minutes integer not null default 0;

comment on column public.team_labor_model.peak_weekday is
  'Dotación mínima (personas) en la hora de mayor demanda, lunes a jueves. NULL/0 = sin suelo. ENCARGO F10 Bloque A.2, parámetro 1.';
comment on column public.team_labor_model.peak_weekend is
  'Dotación mínima (personas) en la hora de mayor demanda, viernes a domingo. NULL/0 = sin suelo. ENCARGO F10 Bloque A.2, parámetro 1. NOTA: generate_week_schedule v3 usa sábado+domingo (5,6) como "fin de semana" al calcular el suelo — viernes cuenta como entre semana. Ajustar si Julio quiere otra frontera.';
comment on column public.team_labor_model.pre_open_minutes is
  'Minutos de trabajo no productivo antes de abrir (mise en place), sumados al turno que abre. Sustituye a open_close_extra (superado, no borrado). ENCARGO F10 Bloque A.2, parámetro 4.';
comment on column public.team_labor_model.post_close_minutes is
  'Minutos de trabajo no productivo después de cerrar (limpieza/caja), sumados al turno que cierra. Sustituye a open_close_extra (superado, no borrado). ENCARGO F10 Bloque A.2, parámetro 4.';
comment on column public.team_labor_model.open_close_extra is
  'SUPERADO 09/08/2026 por pre_open_minutes/post_close_minutes (más explícitos: separan apertura de cierre). NO se borra (regla NO DESTRUCCIÓN) y team_labor_requirement lo sigue usando para el cálculo de personal necesario; generate_week_schedule v3 ya no lo lee.';

-- Guard: aborta si alguna columna no quedó creada.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='team_labor_model'
       and column_name in ('peak_weekday','peak_weekend','pre_open_minutes','post_close_minutes')
     having count(*) = 4
  ) then
    raise exception 'FALLO: no se crearon las 4 columnas de team_labor_model';
  end if;
end $$;
