-- E25 · Foodint estrena fila en kitchen_settings, con 45 dias de retencion.
-- (04/09/2026)
--
-- DE DONDE SALE EL 45, que no es un numero redondo: Uber da 30 dias para
-- disputar y Glovo un mes natural; y la incidencia tarda hasta 22 dias en
-- aparecer en la liquidacion (p90 = 13, medido sobre 855 lineas). 22 + 30 = 52
-- en el peor caso teorico, pero con `hold_until` reteniendo lo que ya esta
-- reclamado, 45 cubre el caso real con margen.
--
-- POR QUE HACIA FALTA: Foodint era la unica cuenta SIN fila (Folvy Interno 180,
-- Kitchen Grill 365). Sin fila, C9 L2 nace inerte justo en la cuenta para la
-- que se construye.
--
-- TODAS LAS COLUMNAS EXPLICITAS, no los defaults implicitos: asi lo que hay en
-- la fila es lo que alguien decidio, y se lee sin tener que ir al catalogo.
--
-- ES INOFENSIVO, y esto se comprobo antes de escribirlo, no despues. Solo
-- CUATRO columnas las lee alguna funcion viva:
--   target_food_cost_pct   -> menu_item_economics (LEFT JOIN) y
--                             menu_item_channel_economics (select escalar).
--                             Queda NULL: sin fila daba NULL, con fila da NULL.
--   target_plate_cost_pct  -> las mismas dos. Queda NULL por lo mismo.
--   reliability_min_pct    -> sales_mapping_reliability, que hace COALESCE(.,90)
--                             DOS veces. Sin fila daba 90; con fila a 90 da 90.
--   photo_retention_days   -> solo las dos funciones de C9 L2, nuevas.
-- `food_cost_dashboard` aparecia al buscar por texto pero NO lee la columna: la
-- nombra en un COMENTARIO que dice que su umbral es interino precisamente
-- porque «Foodint NO TIENE FILA en kitchen_settings». Esta fila es lo que ese
-- comentario estaba esperando (frente A7).
--
-- DIVERGENCIA ANOTADA: las otras dos cuentas tienen target_plate_cost_pct = 33.
-- Foodint se queda en NULL a proposito -- ponerlo a 33 CAMBIARIA el
-- comportamiento de hoy, y esta fila tiene que ser neutra. Si se quiere ese
-- objetivo, se pone aparte y a sabiendas.
--
-- VUELTA ATRAS: `delete from kitchen_settings where account_id = '51ad...'`.
-- Una fila, sin dependientes.

insert into public.kitchen_settings (
  account_id,
  indirect_cost_pct_default,
  target_food_cost_pct,
  currency,
  created_by,
  created_by_name,
  audit_threshold_default,
  audit_mode_default,
  audit_shadow_min_samples,
  photo_retention_days,
  transcription_language,
  ai_default_model,
  ai_escalation_enabled,
  version_alert_pct,
  cost_window_days_default,
  allow_negative_yield,
  max_recipe_depth_warning,
  price_rounding,
  labor_target_pct,
  cost_strategy_default,
  reliability_min_pct,
  target_plate_cost_pct
)
select
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  0,                       -- indirect_cost_pct_default
  null,                    -- target_food_cost_pct: NULL a proposito (neutro)
  'EUR',                   -- currency
  null,                    -- created_by
  'E25 · migracion c9_l2', -- created_by_name
  0.70,                    -- audit_threshold_default
  'shadow',                -- audit_mode_default
  14,                      -- audit_shadow_min_samples
  45,                      -- photo_retention_days  <-- LA DECISION
  'es-ES',                 -- transcription_language
  'haiku',                 -- ai_default_model
  true,                    -- ai_escalation_enabled
  10,                      -- version_alert_pct
  30,                      -- cost_window_days_default
  false,                   -- allow_negative_yield
  4,                       -- max_recipe_depth_warning
  'none',                  -- price_rounding
  null,                    -- labor_target_pct
  'avg_window',            -- cost_strategy_default
  90,                      -- reliability_min_pct
  null                     -- target_plate_cost_pct: NULL a proposito (neutro)
where not exists (
  select 1 from public.kitchen_settings
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
);

do $verif$
declare v_n int; v_dias int; v_rel numeric;
begin
  select count(*) into v_n from public.kitchen_settings
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
  if v_n <> 1 then
    raise exception 'E25: Foodint tiene % filas en kitchen_settings, se esperaba 1.', v_n;
  end if;

  select photo_retention_days, reliability_min_pct into v_dias, v_rel
    from public.kitchen_settings
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

  if v_dias <> 45 then
    raise exception 'E25: photo_retention_days quedo en % y no en 45.', v_dias;
  end if;

  -- Lo que de verdad hay que comprobar es que NO cambia nada: el umbral que ve
  -- sales_mapping_reliability tiene que seguir siendo 90, como sin fila.
  if coalesce(v_rel, 90) <> 90 then
    raise exception 'E25: reliability_min_pct quedo en % y cambiaria el umbral vivo.', v_rel;
  end if;

  -- Y las dos que alimentan menu_item_economics tienen que seguir NULL.
  if exists (select 1 from public.kitchen_settings
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
                and (target_food_cost_pct is not null or target_plate_cost_pct is not null)) then
    raise exception 'E25: target_food_cost_pct o target_plate_cost_pct no son NULL; la fila no seria neutra.';
  end if;
end
$verif$;
