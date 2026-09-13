-- LO QUE LEEN LOS TABLEROS 5 Y 3. Dos lecturas, no diez viajes.
--
-- Van por RPC y no por `from()` suelto por dos motivos: la pantalla necesita
-- cosas de seis tablas a la vez (pregunta, respuestas, efecto, marca, platos,
-- categorías) y hacerlo a mano son seis idas y vueltas que se pueden quedar a
-- medias; y porque asi la regla de que CEDIDA SE MIDE POR LA MARCA vive en un
-- solo sitio y no se puede escribir distinto en cada pantalla.
--
-- Devuelven CLAVES y datos, no frases: el castellano vive en el front, donde se
-- puede leer y probar sin abrir la base.

create or replace function public.kitchen_pregunta_para_editar(
  p_account  uuid,
  p_group_id uuid          -- null = pregunta nueva: solo vienen las marcas
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_marcas jsonb;
  v_p      jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  -- Las marcas SALEN TODAS, propias y cedidas, con su bandera. Esconder las
  -- cedidas del selector dejaria a quien las busca pensando que se han
  -- perdido; se ven y se dice por que no se tocan (regla 7).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'nombre', b.name,
           'cedida', (coalesce(b.ownership_type,'own') <> 'own'),
           'platos', (select count(*) from menu_item mi
                       where mi.brand_id = b.id and mi.archived_at is null))
         order by (coalesce(b.ownership_type,'own') <> 'own'), b.name), '[]'::jsonb)
    into v_marcas
    from brand b
   where b.account_id = p_account and coalesce(b.is_active, true)
     and upper(btrim(coalesce(b.name,''))) <> 'FOODINT';

  if p_group_id is null then
    return jsonb_build_object('marcas', v_marcas, 'pregunta', null);
  end if;

  select jsonb_build_object(
           'id', g.id, 'nombre', g.name, 'marca_id', g.brand_id,
           'marca_nombre', b.name,
           'cedida', (coalesce(b.ownership_type,'own') <> 'own'),
           'tipo', g.group_type,
           'obligatoria', (coalesce(g.min_selections,0) > 0),
           'max', coalesce(g.max_selections,1),
           'repetible', coalesce(g.allow_repetition,false),
           'etiqueta_vieja', (g.external_source is not null),
           'platos', (select coalesce(jsonb_agg(a.menu_item_id), '[]'::jsonb)
                        from modifier_group_assignment a
                       where a.modifier_group_id = g.id),
           'respuestas', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', o.id, 'nombre', o.name,
                      'precio', coalesce(o.price_impact,0),
                      -- El efecto CONFIRMADO, si lo hay. Una respuesta puede
                      -- tener propuestas sin confirmar: esas no cuentan como
                      -- decididas ni aqui ni en el tablero 1.
                      'efecto', (
                        select jsonb_build_object(
                                 'tipo', i.impact_type,
                                 'ficha', i.target_recipe_item_id,
                                 'ficha_nombre', ri.name,
                                 'cantidad', i.quantity,
                                 'unidad', i.unit_id)
                          from modifier_recipe_impact i
                          left join recipe_item ri on ri.id = i.target_recipe_item_id
                         where i.modifier_option_id = o.id and i.status = 'confirmed'
                         limit 1),
                      -- En cuantas preguntas MAS vive un extra con este nombre.
                      -- Es lo que avisa de que tocarlo aqui no lo arregla alli.
                      'en_cuantas_preguntas', (
                        select count(distinct o2.modifier_group_id)
                          from modifier_option o2
                         where o2.account_id = p_account
                           and lower(btrim(o2.name)) = lower(btrim(o.name))
                           and coalesce(o2.is_active,true)))
                    order by o.position, o.name), '[]'::jsonb)
               from modifier_option o
              where o.modifier_group_id = g.id and coalesce(o.is_active,true)))
    into v_p
    from modifier_group g
    left join brand b on b.id = g.brand_id
   where g.id = p_group_id and g.account_id = p_account;

  return jsonb_build_object('marcas', v_marcas, 'pregunta', v_p);
end;
$$;

comment on function public.kitchen_pregunta_para_editar(uuid,uuid) is
  'Tablero 5: las marcas y, si se edita, la pregunta entera con sus respuestas y el efecto confirmado de cada una.';


create or replace function public.kitchen_platos_de_la_marca(
  p_account  uuid,
  p_brand_id uuid,
  p_group_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'platos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', mi.id, 'nombre', mi.name,
               'categoria_id', mi.menu_category_id,
               'categoria', coalesce(mc.name, 'Sin categoría'),
               -- Si YA la tiene, para que la pantalla arranque con la verdad
               -- puesta y «lo que cambia» se pueda calcular contra ella.
               'ya_la_tiene', (p_group_id is not null and exists (
                 select 1 from modifier_group_assignment a
                  where a.modifier_group_id = p_group_id
                    and a.menu_item_id = mi.id)),
               -- Cuantas preguntas tiene ya ese plato: 9 preguntas en un plato
               -- es una carta que el cliente no termina de leer.
               'cuantas_preguntas', (
                 select count(*) from modifier_group_assignment a2
                  where a2.menu_item_id = mi.id))
             order by coalesce(mc.name,'zzz'), mi.name), '[]'::jsonb)
        from menu_item mi
        left join menu_category mc on mc.id = mi.menu_category_id
       where mi.account_id = p_account and mi.brand_id = p_brand_id
         and mi.archived_at is null),
    'categorias', (
      select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', coalesce(mi.menu_category_id::text, 'sin'),
                 'nombre', coalesce(mc.name, 'Sin categoría'),
                 'cuantos_platos', count(*)) as x
          from menu_item mi
          left join menu_category mc on mc.id = mi.menu_category_id
         where mi.account_id = p_account and mi.brand_id = p_brand_id
           and mi.archived_at is null
         group by mi.menu_category_id, mc.name) s));
end;
$$;

comment on function public.kitchen_platos_de_la_marca(uuid,uuid,uuid) is
  'Tablero 3: los platos vivos de una marca con su categoria, si ya tienen la pregunta, y cuantas preguntas lleva ya cada uno.';


create or replace function public.kitchen_buscar_ficha(
  p_account uuid,
  p_texto   text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  -- SOLO FICHAS VIVAS. Una archivada tiene el precio del dia en que se
  -- archivo, y la funcion de guardar la rechaza: ofrecerla en el buscador
  -- seria enseñar algo que va a fallar al guardar.
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', ri.id, 'nombre', ri.name, 'unidad', ri.base_unit_id)
           order by ri.name), '[]'::jsonb)
      from recipe_item ri
     where ri.account_id = p_account
       and ri.is_active and ri.archived_at is null
       and (coalesce(btrim(p_texto),'') = ''
            or ri.name ilike '%' || btrim(p_texto) || '%')
     limit 40);
end;
$$;

comment on function public.kitchen_buscar_ficha(uuid,text) is
  'El buscador de articulos del escandallo para «que lleva». Solo fichas vivas: una archivada la rechaza el guardado.';

revoke all on function public.kitchen_pregunta_para_editar(uuid,uuid) from public;
grant execute on function public.kitchen_pregunta_para_editar(uuid,uuid) to authenticated;
revoke all on function public.kitchen_platos_de_la_marca(uuid,uuid,uuid) from public;
grant execute on function public.kitchen_platos_de_la_marca(uuid,uuid,uuid) to authenticated;
revoke all on function public.kitchen_buscar_ficha(uuid,text) from public;
grant execute on function public.kitchen_buscar_ficha(uuid,text) to authenticated;
