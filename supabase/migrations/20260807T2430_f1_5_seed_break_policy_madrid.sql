-- Aplicada 2026-08-07. Verificado: 1 fila sembrada para Llorente29.
-- F1.5 · Politica por defecto con el convenio de Hosteleria de Madrid:
--  · jornada continuada > 6 h -> 15 min RETRIBUIDOS (computan como trabajo efectivo)
--  · tope: no mas de 5 h seguidas sin pausa · partida: minimo 1,5 h entre tramos
--  · 12 h entre jornadas (ET 34.3) · max 9 h diarias (ET) · franja nocturna 22:00-06:00 (ET 36.1)
insert into public.break_policy (
  account_id, location_id, mode, rules,
  max_continuous_minutes, split_min_gap_minutes, min_rest_between_shifts_minutes, max_daily_minutes,
  night_start, night_end, night_worker_pct_threshold, convenio_label)
select '51ad1792-6629-4ef7-833a-b57b09a86710', null, 'fichado',
  '[{"min_shift_minutes":360,"break_minutes":15,"paid_minutes":15,"label":"Descanso jornada continuada"}]'::jsonb,
  300, 90, 720, 540, '22:00', '06:00', 33.33, 'Hosteleria Madrid 2023-2025'
where not exists (
  select 1 from public.break_policy
  where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and location_id is null);
