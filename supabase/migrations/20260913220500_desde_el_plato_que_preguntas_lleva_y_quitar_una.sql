-- ==========================================================================
-- DESDE EL PLATO: QUE PREGUNTAS LLEVA, Y QUITAR UNA SIN SALIR DE AHI
--
-- Encargo de Julio, 13/09 20:05. Hasta hoy el gestor solo iba en un sentido:
-- desde la PREGUNTA se veia en que platos estaba (tablero 3). Al reves no
-- habia nada — y al reves es como se mira de verdad cuando un plato pregunta
-- algo que no deberia.
--
-- Medido en Foodint hoy: 282 asignaciones repartidas en 159 platos.
--
-- DOS PUERTAS, Y UNA ES ESTRECHA A PROPOSITO:
--
--   `kitchen_preguntas_de_un_plato`  · lee. El plato y sus preguntas en su
--      orden, con lo que pregunta cada una, cuantas respuestas tiene y
--      cuantas de esas siguen sin decidir.
--
--   `kitchen_quitar_pregunta_de_plato` · escribe UNA asignacion. Existe
--      `kitchen_poner_pregunta_en_platos`, que manda la lista ENTERA de
--      platos de una pregunta; usarla desde aqui obligaria a esta pantalla
--      --que solo conoce UN plato-- a reconstruir la lista de los demas y
--      reenviarla. Si entre medias otro pone la pregunta en un plato nuevo,
--      ese plato se perderia sin que nadie lo viera. Una puerta estrecha no
--      puede cometer ese error porque no sabe nada de los demas platos.
--
-- LA MISMA RAYA QUE EN EL RESTO, Y NO ES MIA: el importador de Last declara
-- en su cabecera que LAST manda «nombre, precio, opciones, EN QUE PLATOS
-- VAN». O sea que quitar una pregunta de un plato de marca cedida se
-- desharia solo en la pasada de madrugada. Se bloquea, con el mismo mensaje
-- que ya da `kitchen_poner_pregunta_en_platos`, y la pantalla lo dice ANTES
-- de que nadie lo intente — un boton apagado sin una frase al lado no es una
-- puerta cerrada, es una averia aparente.
--
-- (Y aqui NO va «03:20»: el cron es 03:20 UTC, que son las 05:20 de Madrid.
--  En un texto que lee una persona no se escribe una hora de reloj salvo que
--  estemos seguros del huso. «De madrugada» es verdad siempre. Julio, 21:05.)
--
-- BANDA: las dos son `CREATE OR REPLACE FUNCTION`, no toman ningun cierre, y
-- no las llama ningun cron, disparador ni funcion del camino del pedido —
-- son nuevas, asi que no las llama nadie todavia. Se aplican en cuanto esten.
-- No tocan NINGUNA de las funciones de la tanda de las 23:45.
-- ==========================================================================

BEGIN;

-- ── LEER: que preguntas lleva este plato ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_preguntas_de_un_plato(
  p_account uuid, p_menu_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_plato jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para mirar los platos de la cuenta %', p_account
      using errcode = '42501';
  end if;

  -- EL PLATO. Regla 9: por cuenta, siempre. El catalogo plantilla comparte
  -- tablas Y NOMBRES con produccion.
  select jsonb_build_object(
           'id', mi.id,
           'nombre', btrim(mi.name),
           'precio', coalesce(mi.price, 0),
           'marca', coalesce(b.name, 'Sin marca'),
           'marca_id', b.id,
           'cedida', (coalesce(b.ownership_type, 'own') <> 'own'),
           'activo', coalesce(mi.is_active, true),
           'archivado', (mi.archived_at is not null))
    into v_plato
    from menu_item mi
    left join brand b on b.id = mi.brand_id
   where mi.id = p_menu_item_id and mi.account_id = p_account;

  if v_plato is null then
    raise exception 'Ese plato no es de esta cuenta.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'plato', v_plato,
    'preguntas', (
      select coalesce(jsonb_agg(x order by (x->>'posicion')::int, x->>'nombre'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', g.id,
                   'nombre', btrim(g.name),
                   'tipo', case g.group_type when 'choice' then 'elige'
                                             when 'extras' then 'anade'
                                             when 'removal' then 'quita'
                                             else coalesce(g.group_type, 'elige') end,
                   'min', coalesce(g.min_selections, 0),
                   'max', coalesce(g.max_selections, 1),
                   'obligatoria', (coalesce(g.min_selections, 0) > 0),
                   'repetible', coalesce(g.allow_repetition, false),
                   'activa', coalesce(g.is_active, true),
                   'posicion', coalesce(a.position, 0),
                   -- SOLO ACTIVAS: una respuesta retirada no se vende, asi que
                   -- no cuenta ni para el total ni para lo que falta.
                   'de_pago', exists (select 1 from modifier_option o
                                       where o.modifier_group_id = g.id
                                         and coalesce(o.is_active, true)
                                         and coalesce(o.price_impact, 0) > 0),
                   'respuestas', (select count(*) from modifier_option o
                                   where o.modifier_group_id = g.id
                                     and coalesce(o.is_active, true)),
                   -- SIN DECIDIR = sin ficha QUE DESCUENTE ALGO. La misma
                   -- frase que el resto del gestor, en su unico sitio.
                   'sin_decidir', (select count(*) from modifier_option o
                                    where o.modifier_group_id = g.id
                                      and coalesce(o.is_active, true)
                                      and not exists (
                                        select 1 from modifier_recipe_impact i
                                         where i.modifier_option_id = o.id
                                           and i.status = 'confirmed'
                                           and public._impacto_completo(
                                                 i.impact_type,
                                                 i.target_recipe_item_id,
                                                 i.quantity))),
                   -- Y en cuantos platos MAS esta, que es lo que decide si
                   -- quitarla de aqui es un gesto pequeno o se lleva la unica.
                   'otros_platos', (select count(*) from modifier_group_assignment a2
                                     where a2.modifier_group_id = g.id
                                       and a2.account_id = p_account
                                       and a2.menu_item_id <> p_menu_item_id),
                   'se_puede_quitar', (coalesce(b.ownership_type, 'own') = 'own'),
                   'por_que_no', case
                     when coalesce(b.ownership_type, 'own') <> 'own'
                       then 'La carta de «' || coalesce(b.name, 'esta marca')
                            || '» la manda Last: sus preguntas se ponen y se quitan allí. '
                            || 'Si la quitaras aquí, volvería de madrugada.'
                     else null end) as x
            from modifier_group_assignment a
            join modifier_group g on g.id = a.modifier_group_id
            left join brand b on b.id = g.brand_id
           where a.menu_item_id = p_menu_item_id
             and a.account_id = p_account
             and g.account_id = p_account
        ) q),
    'cuantas', (select count(*) from modifier_group_assignment a
                 where a.menu_item_id = p_menu_item_id and a.account_id = p_account));
end;
$fn$;

-- ── ESCRIBIR: quitar UNA pregunta de ESTE plato ───────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_quitar_pregunta_de_plato(
  p_account uuid, p_group_id uuid, p_menu_item_id uuid, p_actor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_pregunta text; v_plato text; v_marca text; v_cedida boolean;
  v_quitadas int := 0; v_quedan int;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para quitar preguntas de los platos de la cuenta %', p_account
      using errcode = '42501';
  end if;

  select btrim(g.name), coalesce(b.name, 'Sin marca'),
         (coalesce(b.ownership_type, 'own') <> 'own')
    into v_pregunta, v_marca, v_cedida
    from modifier_group g
    left join brand b on b.id = g.brand_id
   where g.id = p_group_id and g.account_id = p_account;
  if v_pregunta is null then
    raise exception 'Esa pregunta no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  select btrim(mi.name) into v_plato
    from menu_item mi
   where mi.id = p_menu_item_id and mi.account_id = p_account;
  if v_plato is null then
    raise exception 'Ese plato no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  if v_cedida then
    raise exception 'La carta de «%» la manda Last: aquí no se quitan preguntas de los platos. Lo que quitases volvería de madrugada. No se ha escrito nada.', v_marca
      using errcode = '42501';
  end if;

  delete from modifier_group_assignment a
   where a.modifier_group_id = p_group_id
     and a.menu_item_id = p_menu_item_id
     and a.account_id = p_account;
  get diagnostics v_quitadas = row_count;

  if v_quitadas = 0 then
    raise exception 'La pregunta «%» no estaba en «%». No se ha escrito nada.', v_pregunta, v_plato
      using errcode = '22023';
  end if;

  select count(*) into v_quedan
    from modifier_group_assignment a
   where a.menu_item_id = p_menu_item_id and a.account_id = p_account;

  -- Devuelve CONTENIDO, no un visto (regla 8). Con el numero que la pantalla
  -- necesita para actualizarse sin recargar y sin inventarselo restando.
  return jsonb_build_object(
    'pregunta', v_pregunta,
    'plato', v_plato,
    'marca', v_marca,
    'quitadas', v_quitadas,
    'le_quedan', v_quedan,
    -- Y donde sigue viva, que es lo que evita el susto de «la he borrado».
    'sigue_en_platos', (select count(*) from modifier_group_assignment a2
                         where a2.modifier_group_id = p_group_id
                           and a2.account_id = p_account),
    'actor', p_actor);
end;
$fn$;

REVOKE ALL ON FUNCTION public.kitchen_preguntas_de_un_plato(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitchen_preguntas_de_un_plato(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kitchen_preguntas_de_un_plato(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.kitchen_quitar_pregunta_de_plato(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitchen_quitar_pregunta_de_plato(uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.kitchen_quitar_pregunta_de_plato(uuid, uuid, uuid, text) TO authenticated;

COMMIT;
