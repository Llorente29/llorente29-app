-- ==========================================================================
-- BUSCAR: UNA SOLA CAJA, Y POR INGREDIENTE TAMBIEN
--
-- Encargo de Julio, 13/09 20:05: «escribo harissa y salen la pregunta, las
-- respuestas y los platos».
--
-- POR QUE BUSCAR POR INGREDIENTE NO ES UN LUJO. Medido hoy en Foodint con
-- «harissa», que es el ejemplo que puso Julio:
--
--   · Hay DOS fichas que se llaman asi: «Pasta Harissa» y «Salsa Mayo
--     Harissa».
--   · Una de las respuestas que la llevan se llama **«Sin Salsa Harisa»** —
--     con la errata, tal cual esta en produccion, con una sola ese.
--
-- O sea que buscando por NOMBRE esa respuesta no aparece jamas, y buscando
-- por lo que LLEVA aparece la primera. Esa es toda la razon de esta pantalla:
-- el nombre lo escribio una persona con prisa; la ficha dice la verdad.
--
-- CADA FILA DICE POR QUE HA SALIDO. Sin eso, escribes «harissa» y te sale un
-- plato que no menciona la harissa en ninguna parte, y no sabes si es un
-- acierto o un fallo de la busqueda. El motivo va en la fila, no en una nota
-- al pie.
--
-- LOS TOTALES SON LOS DE VERDAD, LA LISTA VA CORTADA. Con «harissa» hay unos
-- 60 platos detras. Se enseñan los primeros y se dice cuantos hay EN TOTAL,
-- porque un umbral ordena, no esconde (regla 7): el contador nunca puede
-- decir menos de lo que hay.
--
-- REGLA 9 EN TODAS LAS RAMAS: cada consulta lleva `account_id`. El catalogo
-- plantilla del sistema comparte tablas Y NOMBRES con produccion, y aqui se
-- ancla por NOMBRE, que es justo el caso en el que muerde.
--
-- BANDA: `CREATE OR REPLACE FUNCTION` nueva, no la llama nadie todavia, no
-- toma ningun cierre y no toca ninguna funcion de la tanda de las 23:45.
-- ==========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.kitchen_buscar(
  p_account uuid, p_texto text, p_tope integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_q    text;
  v_like text;
  v_tope int := greatest(least(coalesce(p_tope, 12), 100), 1);
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para buscar en la cuenta %', p_account
      using errcode = '42501';
  end if;

  v_q := btrim(coalesce(p_texto, ''));
  -- Con una letra sale media carta y no sirve de nada. Se dice por que, en
  -- vez de devolver una lista vacia que parece una averia.
  if length(v_q) < 2 then
    return jsonb_build_object(
      'texto', v_q, 'tope', v_tope,
      'preguntas', '[]'::jsonb, 'respuestas', '[]'::jsonb, 'platos', '[]'::jsonb,
      'fichas', '[]'::jsonb,
      'cuantas', jsonb_build_object('preguntas', 0, 'respuestas', 0, 'platos', 0, 'fichas', 0),
      'corto', true);
  end if;

  v_like := '%' || replace(replace(v_q, '\', '\\'), '%', '\%') || '%';

  return (
    with fichas as (
      select ri.id, btrim(ri.name) as nombre
        from recipe_item ri
       where ri.account_id = p_account and ri.name ilike v_like
    ),
    -- Una respuesta sale por su NOMBRE o por LO QUE LLEVA. El motivo se guarda
    -- porque es lo que la fila tiene que decir.
    respuestas as (
      select o.id, btrim(o.name) as nombre, g.id as pregunta_id, btrim(g.name) as pregunta,
             coalesce(b.name, 'Sin marca') as marca,
             (coalesce(b.ownership_type,'own') <> 'own') as cedida,
             coalesce(o.is_active, true) as activa,
             (o.name ilike v_like) as por_nombre,
             (select f.nombre from modifier_recipe_impact i
                join fichas f on f.id = i.target_recipe_item_id
               where i.modifier_option_id = o.id and i.account_id = p_account
                 and i.status = 'confirmed'
               order by f.nombre limit 1) as ficha
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and (o.name ilike v_like
              or exists (select 1 from modifier_recipe_impact i
                           join fichas f on f.id = i.target_recipe_item_id
                          where i.modifier_option_id = o.id and i.account_id = p_account
                            and i.status = 'confirmed'))
    ),
    preguntas as (
      select g.id, btrim(g.name) as nombre,
             coalesce(b.name, 'Sin marca') as marca,
             (coalesce(b.ownership_type,'own') <> 'own') as cedida,
             coalesce(g.is_active, true) as activa,
             (g.name ilike v_like) as por_nombre,
             (select count(*) from respuestas r where r.pregunta_id = g.id) as respuestas_que_salen,
             (select count(*) from modifier_option o
               where o.modifier_group_id = g.id and coalesce(o.is_active,true)) as respuestas
        from modifier_group g
        left join brand b on b.id = g.brand_id
       where g.account_id = p_account
         and (g.name ilike v_like
              or exists (select 1 from respuestas r where r.pregunta_id = g.id))
    ),
    platos as (
      select mi.id, btrim(mi.name) as nombre,
             coalesce(b.name, 'Sin marca') as marca,
             (coalesce(b.ownership_type,'own') <> 'own') as cedida,
             (mi.name ilike v_like) as por_nombre,
             (select count(*) from modifier_group_assignment a
                join preguntas p2 on p2.id = a.modifier_group_id
               where a.menu_item_id = mi.id and a.account_id = p_account) as preguntas_que_salen
        from menu_item mi
        left join brand b on b.id = mi.brand_id
       where mi.account_id = p_account
         and mi.archived_at is null
         and (mi.name ilike v_like
              or exists (select 1 from modifier_group_assignment a
                           join preguntas p2 on p2.id = a.modifier_group_id
                          where a.menu_item_id = mi.id and a.account_id = p_account))
    )
    select jsonb_build_object(
      'texto', v_q, 'tope', v_tope, 'corto', false,
      -- LOS TOTALES SON LOS DE VERDAD. La lista de abajo va cortada; esto no.
      'cuantas', jsonb_build_object(
        'fichas',     (select count(*) from fichas),
        'preguntas',  (select count(*) from preguntas),
        'respuestas', (select count(*) from respuestas),
        'platos',     (select count(*) from platos)),
      'fichas', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nombre', f.nombre)
                                  order by f.nombre), '[]'::jsonb)
                   from (select * from fichas order by nombre limit v_tope) f),
      'preguntas', (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', p.id, 'nombre', p.nombre, 'marca', p.marca,
                              'cedida', p.cedida, 'activa', p.activa,
                              'respuestas', p.respuestas,
                              'porque', case when p.por_nombre then 'se_llama_asi'
                                             else 'lleva_eso' end,
                              'cuantas_respuestas_salen', p.respuestas_que_salen)
                            order by (not p.por_nombre), p.marca, p.nombre), '[]'::jsonb)
                     from (select * from preguntas
                            order by (not por_nombre), marca, nombre limit v_tope) p),
      'respuestas', (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', r.id, 'nombre', r.nombre,
                              'pregunta', r.pregunta, 'pregunta_id', r.pregunta_id,
                              'marca', r.marca, 'cedida', r.cedida, 'activa', r.activa,
                              'ficha', r.ficha,
                              'porque', case when r.por_nombre and r.ficha is not null then 'las_dos'
                                             when r.por_nombre then 'se_llama_asi'
                                             else 'lleva_eso' end)
                            order by (not r.por_nombre), r.marca, r.pregunta, r.nombre), '[]'::jsonb)
                      from (select * from respuestas
                             order by (not por_nombre), marca, pregunta, nombre limit v_tope) r),
      'platos', (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', pl.id, 'nombre', pl.nombre, 'marca', pl.marca,
                              'cedida', pl.cedida,
                              'porque', case when pl.por_nombre then 'se_llama_asi'
                                             else 'su_pregunta_lleva_eso' end,
                              'cuantas_preguntas_salen', pl.preguntas_que_salen)
                            order by (not pl.por_nombre), pl.marca, pl.nombre), '[]'::jsonb)
                  from (select * from platos
                         order by (not por_nombre), marca, nombre limit v_tope) pl))
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.kitchen_buscar(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitchen_buscar(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.kitchen_buscar(uuid, text, integer) TO authenticated;

COMMIT;
