-- ==========================================================================
-- LA BUSQUEDA AGRUPA LAS RESPUESTAS POR NOMBRE
--
-- Correccion de la migracion de hace veinte minutos, encontrada al probarla
-- contra los datos de verdad y no contra un ejemplo inventado (regla 31).
--
-- QUE SALIA MAL. Buscando «harissa» con tope 5, las CINCO respuestas que
-- enseñaba eran la MISMA «Salsa Harissa (Picante)», copiada en cinco
-- preguntas distintas. Y «Sin Salsa Harisa» --la que solo aparece por su
-- ficha, con la errata en el nombre, que es EL CASO QUE JUSTIFICA LA
-- PANTALLA-- se caia del corte, porque el orden pone delante las que casan
-- por nombre.
--
-- O sea: mi propio ejemplo no salia en mi propia busqueda. Una pantalla que
-- falla justo en el caso que la explica no es una pantalla a medias, es una
-- pantalla que enseña lo contrario de lo que dice.
--
-- QUE CAMBIA. Las respuestas se agrupan por nombre, con sus copias y en
-- cuantas preguntas y marcas estan. Es ademas como ya piensa el resto del
-- gestor --«decidir una vez para todas las iguales»--, asi que desde un
-- resultado se llega a la pantalla que resuelve las copias de golpe.
--
-- Y LAS DOS CIFRAS, no una: `respuestas` son las FILAS que hay y
-- `respuestas_distintas` los NOMBRES. Enseñar nombres y llamarlos
-- «respuestas» haria creer que hay dos donde hay dieciocho copias.
--
-- MEDIDO DESPUES DE APLICAR, con «harissa»: 18 filas y **2** nombres —
-- «Salsa Harissa (Picante)» (13 copias, sale por las dos cosas) y «Sin Salsa
-- Harisa» (5 copias, sale SOLO por su ficha). En el texto que se aplico yo
-- habia escrito «6 nombres». Me lo invente: no lo habia contado. Queda dicho
-- aqui en vez de corregido en silencio, porque inventarse una cifra en un
-- comentario es el mismo error que inventarsela en una pantalla.
--
-- Lo demas no se toca. La primera migracion se queda como esta: se aplico
-- asi y su fichero lo dice.
--
-- BANDA: `CREATE OR REPLACE FUNCTION`, sin cierres, sin llamadores todavia.
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
      'cuantas', jsonb_build_object('preguntas', 0, 'respuestas', 0,
                                    'respuestas_distintas', 0, 'platos', 0, 'fichas', 0),
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
    ),
    -- LAS RESPUESTAS, AGRUPADAS POR NOMBRE. Sin esto la lista es inutil: con
    -- «harissa» las cinco primeras son la MISMA «Salsa Harissa (Picante)»
    -- copiada en cinco preguntas, y «Sin Salsa Harisa» --la que solo aparece
    -- por su ficha, que es el caso que justifica la pantalla-- se cae del
    -- corte. Agrupar por nombre es ademas como ya piensa el resto del gestor:
    -- «decidir una vez para todas las iguales».
    agrupadas as (
      select (array_agg(r.id order by r.marca, r.pregunta))[1] as id,
             min(r.nombre) as nombre,
             count(*) as copias,
             count(distinct r.pregunta_id) as preguntas,
             count(distinct r.marca) as marcas,
             bool_or(r.activa) as alguna_activa,
             bool_and(r.activa) as todas_activas,
             bool_or(r.por_nombre) as por_nombre,
             (array_agg(r.ficha) filter (where r.ficha is not null))[1] as ficha,
             (array_agg(r.marca order by r.marca))[1] as marca
        from respuestas r
       group by lower(btrim(r.nombre))
    )
    select jsonb_build_object(
      'texto', v_q, 'tope', v_tope, 'corto', false,
      -- LOS TOTALES SON LOS DE VERDAD. La lista de abajo va cortada; esto no.
      'cuantas', jsonb_build_object(
        'fichas',     (select count(*) from fichas),
        'preguntas',  (select count(*) from preguntas),
        -- Las dos cifras: las filas que hay y los nombres distintos. La
        -- pantalla ensena nombres; el total de filas va al lado para que
        -- nadie crea que hay 6 respuestas cuando hay 18 copias de 6.
        'respuestas', (select count(*) from respuestas),
        'respuestas_distintas', (select count(*) from agrupadas),
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
                              'copias', r.copias, 'preguntas', r.preguntas,
                              'marcas', r.marcas, 'marca', r.marca,
                              'alguna_activa', r.alguna_activa,
                              'todas_activas', r.todas_activas,
                              'ficha', r.ficha,
                              'porque', case when r.por_nombre and r.ficha is not null then 'las_dos'
                                             when r.por_nombre then 'se_llama_asi'
                                             else 'lleva_eso' end)
                            order by (not r.por_nombre), r.nombre), '[]'::jsonb)
                      from (select * from agrupadas
                             order by (not por_nombre), nombre limit v_tope) r),
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
