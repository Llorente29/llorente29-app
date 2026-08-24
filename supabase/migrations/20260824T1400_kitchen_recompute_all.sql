-- 20260824T1400_kitchen_recompute_all.sql
--
-- "Recostear todo": recálculo masivo de costes, a mano desde Ajustes de Cocina
-- y automático cada noche.
--
-- EL PROBLEMA QUE OBLIGA A REFACTORIZAR
-- kitchen_recompute_item empieza con:
--     IF NOT public.belongs_to_account(v_item.account_id) THEN RAISE ...
-- y belongs_to_account resuelve por auth.uid(). pg_cron no tiene sesión de
-- usuario, así que auth.uid() es NULL y la guarda RECHAZA todo. Un cron que
-- llamara a kitchen_recompute_item fallaría en el primer item, siempre.
--
-- No duplico la fórmula de coste (sería dos verdades, que es justo el error que
-- pagamos esta mañana con is_available). El cuerpo se mueve tal cual a
-- _kitchen_recompute_item_unguarded y kitchen_recompute_item pasa a ser
-- "guarda + delegar": misma firma, mismo comportamiento, mismos llamadores.
-- La privada NO se expone a PostgREST (revoke a anon/authenticated).

begin;

-- ── 1 · El motor, sin guarda. Cuerpo idéntico al de kitchen_recompute_item. ──
create or replace function public._kitchen_recompute_item_unguarded(p_item_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
  v_yield           numeric := NULL;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;

  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      v_total     := v_total / v_yield;
      v_packaging := v_packaging / v_yield;
    END IF;
  END IF;

  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END,
        completeness    = COALESCE(completeness, '{}'::jsonb)
                          || jsonb_build_object(
                               'cost_incomplete', v_incomplete,
                               'cost_incomplete_reason',
                                 CASE WHEN v_incomplete THEN 'unmeasurable_line' ELSE NULL END)
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

revoke all on function public._kitchen_recompute_item_unguarded(uuid) from public, anon, authenticated;

-- ── 2 · La pública: la guarda de siempre + delegar. Firma intacta. ──────────
create or replace function public.kitchen_recompute_item(p_item_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_account uuid;
begin
  select account_id into v_account from recipe_item where id = p_item_id;
  if v_account is null then
    raise exception 'kitchen_recompute_item: item % no existe', p_item_id;
  end if;
  if not public.belongs_to_account(v_account) then
    raise exception 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  end if;
  return public._kitchen_recompute_item_unguarded(p_item_id);
end;
$function$;

-- ── 3 · Recostear todo de una cuenta ────────────────────────────────────────
-- ORDEN: primero 'recipe', luego 'dish', para que una sub-receta esté
-- actualizada antes que el plato que la usa. El ORDER BY es estable
-- (tipo, nombre, id) y NO depende del coste, así que paginar por OFFSET no
-- reordena nada a mitad de la pasada.
--
-- p_limit/p_offset existen para que la UI pueda enseñar "45/108": la pantalla
-- llama por tandas y va sumando. `total` viene SIEMPRE completo, no el de la
-- tanda. Sin p_limit (el cron) recostea la cuenta entera de una vez.
--
-- Un item que falla NO aborta: se captura, se anota en `errors` y sigue el
-- siguiente. Por eso el bucle no puede ir dentro de una única sub-transacción.
create or replace function public.kitchen_recompute_all(
  p_account_id uuid,
  p_limit      int default null,
  p_offset     int default 0
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row       record;
  v_total     int := 0;
  v_processed int := 0;
  v_failed    int := 0;
  v_errors    jsonb := '[]'::jsonb;
  v_is_server boolean;
begin
  -- pg_cron corre como 'postgres'; PostgREST entra siempre como 'authenticator'.
  -- Ese es el discriminante: nunca "auth.uid() is null", que un anónimo cumple.
  v_is_server := session_user in ('postgres', 'supabase_admin');

  if not v_is_server then
    if auth.uid() is null
       or not public.current_user_is_admin_or_manager_of(p_account_id) then
      raise exception 'kitchen_recompute_all: sin acceso a la cuenta %', p_account_id;
    end if;
  end if;

  select count(*) into v_total
    from recipe_item ri
   where ri.account_id = p_account_id
     and ri.type in ('recipe', 'dish')
     and ri.archived_at is null;

  for v_row in
    select ri.id, ri.name, ri.type
      from recipe_item ri
     where ri.account_id = p_account_id
       and ri.type in ('recipe', 'dish')
       and ri.archived_at is null
     order by (ri.type = 'dish'), ri.name, ri.id
     limit p_limit offset coalesce(p_offset, 0)
  loop
    begin
      perform public._kitchen_recompute_item_unguarded(v_row.id);
      v_processed := v_processed + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'item_id', v_row.id, 'name', v_row.name, 'type', v_row.type,
        'error', sqlerrm, 'sqlstate', sqlstate);
      raise warning 'kitchen_recompute_all: fallo en % (%): %', v_row.name, v_row.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'account_id', p_account_id,
    'total',      v_total,
    'processed',  v_processed,
    'failed',     v_failed,
    'errors',     v_errors);
end;
$function$;

revoke all on function public.kitchen_recompute_all(uuid, int, int) from public, anon;
grant execute on function public.kitchen_recompute_all(uuid, int, int) to authenticated;

-- ── 4 · El barrido nocturno de todas las cuentas activas ────────────────────
create or replace function public.cron_kitchen_recompute_all()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_acc      record;
  v_res      jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_started  timestamptz := clock_timestamp();
begin
  for v_acc in
    select a.id, a.name from accounts a
     where a.status = 'active'
       and a.suspended_at is null
       and a.archived_at  is null
       and a.deleted_at   is null
     order by a.name
  loop
    -- Una cuenta que reviente no puede llevarse por delante a las demás.
    begin
      v_res := public.kitchen_recompute_all(v_acc.id);
    exception when others then
      v_res := jsonb_build_object('account_id', v_acc.id, 'fatal', sqlerrm);
      raise warning 'cron_kitchen_recompute_all: cuenta % (%) abortada: %', v_acc.name, v_acc.id, sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('account', v_acc.name) || v_res;
  end loop;

  return jsonb_build_object(
    'ran_at',      v_started,
    'duration_ms', round(extract(epoch from clock_timestamp() - v_started) * 1000),
    'accounts',    v_out);
end;
$function$;

revoke all on function public.cron_kitchen_recompute_all() from public, anon, authenticated;

-- ── 5 · pg_cron a las 04:00 ─────────────────────────────────────────────────
-- Cae justo antes de 'sale-line-cost-sweep' (04:50), que reparte coste a las
-- líneas de venta: así el barrido de la noche usa costes ya frescos.
-- 'autoinventory_daily' comparte el minuto; son trabajos ligeros y distintos.
select cron.unschedule('kitchen-recompute-nightly')
 where exists (select 1 from cron.job where jobname = 'kitchen-recompute-nightly');

select cron.schedule('kitchen-recompute-nightly', '0 4 * * *',
                     $cron$select public.cron_kitchen_recompute_all()$cron$);

commit;
