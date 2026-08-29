-- 20260828T1252_kds_recipe_gramaje_bruto_cae_al_neto.sql
-- ============================================================================
-- REGISTRO DE LO QUE YA CORRE. Aplicado a mano en produccion el 28/08 ~12:50.
-- ============================================================================
-- Transcripcion de la definicion viva. Reaplicar la version del repo encima
-- devolveria los guiones a la pantalla de cocina.
--
-- QUE HACE. `kds_recipe` leia `rl.quantity_gross` a pelo. Cuando una linea de
-- escandallo no tiene bruto declarado, ese campo es null, y Cook Mode pintaba
-- "—" donde habia un gramaje perfectamente conocido: el neto.
--
--   237 lineas de 1.490, en 43 recetas de 155. Mas de una de cada cuatro.
--   Ninguna estaba sin datos: las 237 tienen neto. No faltaba el dato,
--   faltaba el fallback.
--
-- ES UN CASO DE LIBRO DE «UN DATO SE CALCULA EN UN SITIO». Tres funciones
-- resuelven la misma cascada bruto->neto y solo una se la habia saltado:
--
--   explode_recipe_to_raws      COALESCE(v_line.quantity_gross, v_line.quantity_net)   consumo de stock
--   kitchen_recipe_breakdown    COALESCE(v_line.quantity_gross, v_line.quantity_net)   escandallo y coste
--   kds_recipe                  rl.quantity_gross                                      <- la unica sin coalesce
--
-- Por eso NO descuadraba ningun numero: el stock y el coste estaban bien
-- (verificado, no supuesto). Solo dejaba a un cocinero adivinando el gramaje.
-- Un fallo que no mueve ninguna cifra no lo encuentra ningun cuadre; lo
-- encuentra alguien mirando la pantalla.
--
-- MARCHA ATRAS: volver a `rl.quantity_gross` en las dos claves, 'qty_base' y
-- 'qty_total'. No hay mas cambios.
--
-- Verificado en vivo por Julio el 28/08: «Korean Fried Chicken and fries»
-- muestra 224 g de solomillo, 60 g de salsa coreana y 6 g de cebollino donde
-- antes habia guiones.
--
-- FIDELIDAD: salida literal de
--   SELECT pg_get_functiondef('public.kds_recipe(uuid,numeric,text,uuid)'::regprocedure);
-- verificada byte a byte contra produccion: md5 f24491266172d575c40ccd5b3e21cb84
-- (3.028 caracteres). Aplicar este fichero hoy es un no-op.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kds_recipe(p_menu_item_id uuid, p_qty numeric DEFAULT 1, p_token text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ri      uuid;
  v_account uuid;
  v_qty     numeric := greatest(coalesce(p_qty, 1), 1);
  v_loc     uuid := p_location_id;
  v_device  kds_device;
  v_result  jsonb;
begin
  select mi.recipe_item_id, mi.account_id into v_ri, v_account
  from menu_item mi where mi.id = p_menu_item_id;
  if v_ri is null then
    return jsonb_build_object('found', false);
  end if;

  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'kds_recipe: token no válido'; end if;
    if v_loc is null then v_loc := v_device.location_id; end if;
    if v_device.account_id <> v_account then
      raise exception 'kds_recipe: el plato no pertenece a la cuenta del dispositivo';
    end if;
    
  else
    if not belongs_to_account(v_account) then
      raise exception 'kds_recipe: sin acceso';
    end if;
  end if;

  select jsonb_build_object(
    'found', true,
    'qty', v_qty,
    'photo_url', coalesce(
      (select kitchen_photo_url from recipe_item where id = v_ri),
      (select photo_url from menu_item where id = p_menu_item_id)
    ),
    'allergens', (
      select coalesce(jsonb_agg(jsonb_build_object('code', allergen_code, 'state', state)
                                order by allergen_code), '[]'::jsonb)
      from recipe_item_allergen where recipe_item_id = v_ri and state in ('contains','may_contain')
    ),
    'ingredients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', child.name,
        'unit', u.abbreviation,
        'qty_base', coalesce(rl.quantity_gross, rl.quantity_net),   -- 28/08/2026: sin bruto declarado, el bruto ES el neto
        'qty_total', round(coalesce(rl.quantity_gross, rl.quantity_net) * v_qty, 3),
        'cut', ct.name
      ) order by rl.position), '[]'::jsonb)
      from recipe_line rl
      join recipe_item child on child.id = rl.child_item_id
      left join kitchen_unit u on u.id = rl.unit_id
      left join kitchen_cut_type ct on ct.id = rl.cut_type_id
      where rl.parent_item_id = v_ri
    ),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', st.position, 'text', st.text, 'kind', st.kind,
        'duration_min', st.duration_min, 'temperature_c', st.temperature_c,
        'photo_url', st.photo_url,
        'ingredients', (
          select coalesce(jsonb_agg(ci.name order by ci.name), '[]'::jsonb)
          from recipe_item_step_line sln
          join recipe_line rl2 on rl2.id = sln.line_id
          join recipe_item ci on ci.id = rl2.child_item_id
          where sln.step_id = st.id
        )
      ) order by st.position), '[]'::jsonb)
      from recipe_item_step st where st.recipe_item_id = v_ri
    )
  ) into v_result;

  return v_result;
end;
$function$
;
