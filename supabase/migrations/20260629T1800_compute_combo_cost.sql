-- compute_combo_cost — coste de CARTA de un combo (suma de componentes).
-- Opción representativa por slot: default; si ninguna, la de MAYOR coste.
-- Honestidad: fiable | provisional (0/needs_review, suma 0 pero avisa) |
-- incomplete (sin escandallo) | empty (sin opciones). incomplete/empty solo
-- BLOQUEA el margen si el slot es OBLIGATORIO (min_selections>=1); los
-- opcionales no impiden ver el coste base. Lectura pura (STABLE).

CREATE OR REPLACE FUNCTION public.compute_combo_cost(p_combo_item_id uuid)
RETURNS TABLE(
  cost              numeric,
  price             numeric,
  margin            numeric,
  fc_pct            numeric,
  slots_total       integer,
  slots_reliable    integer,
  slots_provisional integer,
  slots_incomplete  integer,
  is_incomplete     boolean,
  detail            jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_price      numeric;
  v_cost       numeric := 0;
  v_total      integer := 0;
  v_reliable   integer := 0;
  v_provisional integer := 0;
  v_incomplete integer := 0;
  v_detail     jsonb := '[]'::jsonb;
  r            record;
BEGIN
  SELECT mi.account_id, mi.price INTO v_account_id, v_price
  FROM menu_item mi WHERE mi.id = p_combo_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'compute_combo_cost: combo % no existe', p_combo_item_id;
  END IF;

  FOR r IN
    SELECT cs.id AS slot_id, cs.name AS slot_name, cs.position,
           cs.min_selections AS min_sel
    FROM combo_slot cs
    WHERE cs.combo_item_id = p_combo_item_id
      AND cs.account_id = v_account_id
      AND cs.is_active = true
    ORDER BY cs.position, cs.name
  LOOP
    v_total := v_total + 1;

    DECLARE
      v_opt_name   text;
      v_opt_cost   numeric;
      v_opt_state  text;
      v_required   boolean := (r.min_sel >= 1);
    BEGIN
      SELECT o.name, o.cost, o.state
      INTO v_opt_name, v_opt_cost, v_opt_state
      FROM (
        SELECT
          mi.name AS name,
          COALESCE(ri.computed_cost, 0) AS cost,
          CASE
            WHEN cso.menu_item_id IS NULL OR mi.recipe_item_id IS NULL THEN 'incomplete'
            WHEN ri.computed_cost IS NULL OR ri.computed_cost = 0 OR ri.needs_review THEN 'provisional'
            ELSE 'reliable'
          END AS state,
          cso.is_default AS is_default,
          COALESCE(ri.computed_cost, 0) AS sort_cost
        FROM combo_slot_option cso
        LEFT JOIN menu_item mi ON mi.id = cso.menu_item_id
        LEFT JOIN recipe_item ri ON ri.id = mi.recipe_item_id
        WHERE cso.combo_slot_id = r.slot_id
          AND cso.account_id = v_account_id
          AND cso.is_active = true
      ) o
      ORDER BY o.is_default DESC NULLS LAST, o.sort_cost DESC NULLS LAST
      LIMIT 1;

      IF v_opt_name IS NULL THEN
        v_opt_state := 'empty';
        v_opt_cost := 0;
        IF v_required THEN v_incomplete := v_incomplete + 1; END IF;
      ELSIF v_opt_state = 'incomplete' THEN
        IF v_required THEN v_incomplete := v_incomplete + 1; END IF;
      ELSIF v_opt_state = 'provisional' THEN
        v_provisional := v_provisional + 1;
        v_cost := v_cost + COALESCE(v_opt_cost, 0);
      ELSE
        v_reliable := v_reliable + 1;
        v_cost := v_cost + COALESCE(v_opt_cost, 0);
      END IF;

      v_detail := v_detail || jsonb_build_object(
        'slot_id',   r.slot_id,
        'slot_name', r.slot_name,
        'required',  v_required,
        'option',    v_opt_name,
        'cost',      round(COALESCE(v_opt_cost, 0)::numeric, 4),
        'state',     v_opt_state
      );
    END;
  END LOOP;

  cost              := round(v_cost, 4);
  price             := v_price;
  margin            := NULL;
  fc_pct            := NULL;
  slots_total       := v_total;
  slots_reliable    := v_reliable;
  slots_provisional := v_provisional;
  slots_incomplete  := v_incomplete;
  is_incomplete     := (v_incomplete > 0);
  detail            := v_detail;

  IF NOT is_incomplete THEN
    margin := round(COALESCE(v_price, 0) - v_cost, 4);
    fc_pct := CASE WHEN COALESCE(v_price, 0) > 0
                   THEN round(v_cost / v_price * 100, 2)
                   ELSE NULL END;
  END IF;

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_combo_cost(uuid) TO authenticated;
