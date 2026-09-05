-- Cirugia sobre la definicion VIVA: el core sale de ella por sustitucion, no
-- reescrito a mano. El repo lleva el CREATE OR REPLACE completo y replayable;
-- aqui se aplica asi para no transcribir 12k caracteres. Se verifica por md5
-- justo despues: si no casa con el fichero del repo, no vale.
do $do$
declare
  v_def  text;
  v_core text;
  v_guardia constant text :=
'  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION ''autoinventory_queue: sin acceso a la cuenta %'', p_account_id;
  END IF;

';
begin
  -- 1) CORE = lo vivo, en LF, sin guardia y con nombre nuevo
  v_def := replace(
    pg_get_functiondef('public.autoinventory_queue(uuid,uuid,integer,numeric,numeric,numeric,numeric)'::regprocedure),
    chr(13), '');

  if position(v_guardia in v_def) = 0 then
    raise exception 'no encuentro el guardia literal en autoinventory_queue; abortado';
  end if;

  v_core := replace(v_def, v_guardia, '');
  v_core := replace(v_core,
    'CREATE OR REPLACE FUNCTION public.autoinventory_queue(',
    'CREATE OR REPLACE FUNCTION public._autoinventory_queue_core(');

  if position('RAISE EXCEPTION' in v_core) > 0 then
    raise exception 'el core conserva un RAISE; abortado';
  end if;

  execute v_core;
end
$do$;

-- 2) La publica se queda con el guardia y delega. Misma firma exacta: sin DROP,
--    sin sobrecarga posible.
CREATE OR REPLACE FUNCTION public.autoinventory_queue(p_account_id uuid, p_location_id uuid, p_window_days integer DEFAULT 30, p_coverage_target numeric DEFAULT 80, p_w_value numeric DEFAULT 0.35, p_w_rotation numeric DEFAULT 0.35, p_w_risk numeric DEFAULT 0.30)
 RETURNS TABLE(recipe_item_id uuid, name text, code text, base_unit text, qty_on_hand numeric, stock_value numeric, rotation_eur numeric, risk_eur numeric, must_count boolean, critical_reason text, score numeric, score_value numeric, score_rotation numeric, score_risk numeric, abc_rich text, coverage_pct numeric, in_scope boolean, rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'autoinventory_queue: sin acceso a la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  SELECT * FROM public._autoinventory_queue_core(
    p_account_id, p_location_id, p_window_days, p_coverage_target,
    p_w_value, p_w_rotation, p_w_risk);
END;
$function$;

-- 3) El generador pasa a llamar al core. Dos ocurrencias, las dos CTE `sel`.
do $do$
declare v_def text; v_n int;
begin
  v_def := replace(
    pg_get_functiondef('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)'::regprocedure),
    chr(13), '');

  v_n := (length(v_def) - length(replace(v_def,
            'FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q',
            ''))) / length('FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q');
  if v_n <> 2 then
    raise exception 'esperaba 2 llamadas a autoinventory_queue y encuentro %; abortado', v_n;
  end if;

  execute replace(v_def,
    'FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q',
    'FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q');
end
$do$;