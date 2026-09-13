-- DECIDIR UNA VEZ PARA TODAS LAS IGUALES. Encargo de Julio, 13/09 10:40.
--
-- POR QUE. Medido hoy: 107 respuestas activas sin decidir, pero solo 62 nombres
-- distintos entre ellas. 69 de las 107 comparten nombre con otra, y 24 nombres
-- se llevan por delante esas 69 — el 65 %. «Salsa Harissa (Picante)» sale 7
-- veces, «Salsa Yogur» 6, «Sin Salsa Harisa» 5.
--
-- Nadie va a entrar 107 veces a decir que la salsa de yogur lleva salsa de
-- yogur. A 62 si, y a las primeras 24 en una tarde. La deuda no son 107
-- decisiones: son 62.
--
-- LAS TRES CONDICIONES, y no se negocian:
--   1. LA LISTA DELANTE, antes de aplicar, con la pregunta y la marca de cada
--      una, y cada fila se puede desmarcar. La funcion de escritura recibe los
--      ids ELEGIDOS: nunca «todas las que se llamen asi».
--   2. SOLO MARCAS PROPIAS. Una igual que viva en una cedida se queda fuera y
--      se dice por que — la carta de las cedidas la reescribe Last cada noche.
--   3. RASTRO POR FILA, no uno para el lote: cada respuesta guarda quien y
--      cuando, como si se hubiera hecho a mano. Un lote que deja una sola marca
--      convierte 7 decisiones en 1 a la hora de auditarlas.
--
-- Y OJO AL CRUCE DE MARCAS, que sale en la medida: varias de esas repetidas
-- estan en DOS marcas propias (la misma salsa en Meraki Pita y en Mila's). Eso
-- esta bien mientras las dos sean propias y el articulo sea el mismo — y por
-- eso la lista va delante y no se aplica nada a ciegas.

create or replace function public.kitchen_las_iguales(
  p_account   uuid,
  p_option_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clave text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select lower(btrim(o.name)) into v_clave
    from modifier_option o
   where o.id = p_option_id and o.account_id = p_account;
  if v_clave is null then
    return jsonb_build_object('iguales', '[]'::jsonb, 'fuera', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    -- LAS QUE SE PUEDEN RESOLVER: mismo nombre, activas, SIN decidir todavia y
    -- en marca propia. Las que ya tienen efecto no salen: pisar una decision
    -- que alguien tomo a mano, sin pedirlo, seria lo contrario de esto.
    'iguales', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'precio', coalesce(o.price_impact,0))
             order by b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and coalesce(o.is_active, true) and coalesce(g.is_active, true)
         and coalesce(b.ownership_type, 'own') = 'own'
         and not exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status = 'confirmed')),
    -- LAS QUE SE QUEDAN FUERA, Y POR QUE. No se esconden (regla 7): quien mira
    -- tiene que poder ver que hay 3 mas que no se tocan, y el motivo.
    'fuera', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'motivo', case
                 when coalesce(b.ownership_type,'own') <> 'own' then 'cedida'
                 when exists (select 1 from modifier_recipe_impact i
                               where i.modifier_option_id = o.id and i.status='confirmed')
                   then 'ya_decidida'
                 else 'apagada' end)
             order by b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and (coalesce(b.ownership_type,'own') <> 'own'
              or not coalesce(o.is_active, true) or not coalesce(g.is_active, true)
              or exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status='confirmed'))));
end;
$$;

comment on function public.kitchen_las_iguales(uuid,uuid) is
  'Las otras respuestas que se llaman IGUAL y siguen sin decidir, en marcas propias, para poder resolverlas de una vez. Y las que se quedan fuera, con su motivo.';


create or replace function public.kitchen_aplicar_a_las_iguales(
  p_account   uuid,
  p_opciones  uuid[],
  p_efecto    jsonb,     -- {tipo, ficha, cantidad, unidad}
  p_actor     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo   text := nullif(p_efecto->>'tipo','');
  v_ficha  uuid := nullif(p_efecto->>'ficha','')::uuid;
  v_mala   text;
  v_op     uuid;
  v_n      int := 0;
  v_nombres text[] := '{}';
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para decidir qué llevan los extras de la cuenta %', p_account
      using errcode = '42501';
  end if;

  if p_opciones is null or array_length(p_opciones,1) is null then
    raise exception 'No se ha elegido ninguna respuesta.' using errcode = '22023';
  end if;
  if v_tipo is null then
    raise exception 'No se ha dicho qué lleva.' using errcode = '22023';
  end if;
  if v_tipo not in ('add_item','remove_item','replace_item','multiply','bundle','none') then
    raise exception 'El efecto «%» no existe. No se ha escrito nada.', v_tipo using errcode = '22023';
  end if;

  -- CONDICION 2 · SOLO PROPIAS, y se ABORTA entero si alguna no lo es. Un lote
  -- que se salta filas en silencio es peor que uno que falla: quien lo lanza
  -- cree que ha resuelto 7 y ha resuelto 4.
  select b.name into v_mala
    from unnest(p_opciones) x(id)
    join modifier_option o on o.id = x.id
    join modifier_group g on g.id = o.modifier_group_id
    left join brand b on b.id = g.brand_id
   where o.account_id <> p_account
      or coalesce(b.ownership_type,'own') <> 'own'
   limit 1;
  if v_mala is not null then
    raise exception 'La carta de «%» la manda Last: sus respuestas no se tocan aquí. No se ha escrito nada.', v_mala
      using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_opciones) x(id)
              where not exists (select 1 from modifier_option o
                                 where o.id = x.id and o.account_id = p_account)) then
    raise exception 'Alguna respuesta no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  -- La ficha, viva y de la cuenta. Mismo criterio que el resto: una archivada
  -- tiene el precio del dia en que se archivo.
  if v_ficha is not null then
    select ri.name into v_mala from recipe_item ri
     where ri.id = v_ficha
       and (ri.account_id <> p_account or not ri.is_active or ri.archived_at is not null);
    if v_mala is not null then
      raise exception 'La ficha «%» está archivada o no es de esta cuenta. No se ha escrito nada.', v_mala
        using errcode = '42501';
    end if;
    if not exists (select 1 from recipe_item ri where ri.id = v_ficha) then
      raise exception 'Esa ficha no existe. No se ha escrito nada.' using errcode = '42501';
    end if;
  end if;

  -- CONDICION 3 · RASTRO POR FILA. Se escribe una a una, con su quien y su
  -- cuando, igual que si se hubieran hecho a mano de una en una.
  foreach v_op in array p_opciones loop
    delete from modifier_recipe_impact
     where modifier_option_id = v_op and account_id = p_account and status = 'confirmed';

    insert into modifier_recipe_impact (
      account_id, modifier_option_id, impact_type, target_recipe_item_id,
      quantity, unit_id, status, source, rationale,
      confirmed_by, confirmed_by_name, confirmed_at)
    values (
      p_account, v_op, v_tipo, v_ficha,
      nullif(p_efecto->>'cantidad','')::numeric,
      nullif(p_efecto->>'unidad','')::uuid,
      'confirmed', 'human',
      'Decidido a la vez para las respuestas que se llaman igual',
      auth.uid(), p_actor, now());

    v_n := v_n + 1;
    select array_append(v_nombres, b.name || ' · ' || g.name) into v_nombres
      from modifier_option o
      join modifier_group g on g.id = o.modifier_group_id
      left join brand b on b.id = g.brand_id
     where o.id = v_op;
  end loop;

  return jsonb_build_object(
    'resueltas', v_n,
    'donde',     to_jsonb(v_nombres),
    'efecto',    v_tipo,
    'actor',     p_actor);
end;
$$;

comment on function public.kitchen_aplicar_a_las_iguales(uuid,uuid[],jsonb,text) is
  'Aplica el mismo «qué lleva» a las respuestas ELEGIDAS que se llaman igual. Solo marcas propias, aborta entero si alguna no lo es, y deja rastro por fila.';

revoke all on function public.kitchen_las_iguales(uuid,uuid) from public;
grant execute on function public.kitchen_las_iguales(uuid,uuid) to authenticated;
revoke all on function public.kitchen_aplicar_a_las_iguales(uuid,uuid[],jsonb,text) from public;
grant execute on function public.kitchen_aplicar_a_las_iguales(uuid,uuid[],jsonb,text) to authenticated;
