-- PUERTAS 1 Y 2 DE 3 · el tablero 5 y la oferta en lote.
--
-- Encargo de Julio, 13/09 14:35 §1. La tercera (Extras) fue en su propia
-- migracion por un choque de firma; el porque y la tabla de que exige cada
-- tipo estan en `que_significa_decidida_una_sola_definicion`.
--
-- ── LA BANDA, dicho antes de aplicar ──────────────────────────────────────
-- Dentro de la banda, con autorizacion expresa del CEO. La condicion 1 no se
-- cumple al pie de la letra (las dos son VOLATILE), y lo que de verdad protege
-- esta medido: CERO llamadores dentro de la base —ni funcion, ni cron, ni
-- disparador—, las llaman dos pantallas de oficina, y un `create or replace`
-- de funcion NO toma cierre exclusivo sobre `modifier_recipe_impact`. Por eso
-- el CHECK de la tabla espera a las 23:45.
--
-- Identicas a las vivas salvo la guarda:
--   kitchen_guardar_pregunta       md5 a51310938ed9111601128ecbf16e3f2d
--   kitchen_aplicar_a_las_iguales  md5 1f33b171dbd29c9596ea5cfd8230d7db

create or replace function public.kitchen_guardar_pregunta(
  p_account     uuid,
  p_group_id    uuid,
  p_brand_id    uuid,
  p_nombre      text,
  p_tipo        text,
  p_obligatoria boolean,
  p_max         integer,
  p_repetible   boolean,
  p_respuestas  jsonb,
  p_actor       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group      uuid := p_group_id;
  v_nueva      boolean := (p_group_id is null);
  v_nombre     text := btrim(coalesce(p_nombre, ''));
  v_r          jsonb;
  v_efecto     jsonb;
  v_opcion     uuid;
  v_pos        int := 0;
  v_vistas     uuid[] := '{}';
  v_creadas    int := 0;
  v_actual     int := 0;
  v_retiradas  int := 0;
  v_efectos    int := 0;
  v_mala       text;
  v_etiqueta   boolean := false;
  v_tipo_imp   text;
begin
  -- ── PERMISO ─────────────────────────────────────────────────────────────
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para editar las preguntas de la cuenta %', p_account
      using errcode = '42501';
  end if;

  -- ── LA MARCA: de esta cuenta Y PROPIA ───────────────────────────────────
  if not exists (select 1 from brand b
                  where b.id = p_brand_id and b.account_id = p_account) then
    raise exception 'Esa marca no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;
  select b.name into v_mala from brand b
   where b.id = p_brand_id and coalesce(b.ownership_type, 'own') <> 'own';
  if v_mala is not null then
    raise exception 'La carta de «%» la manda Last: aquí no se crean ni se editan preguntas. No se ha escrito nada.', v_mala
      using errcode = '42501';
  end if;

  -- ── LO QUE SE EDITA, si se edita ────────────────────────────────────────
  if not v_nueva then
    if not exists (select 1 from modifier_group g
                    where g.id = v_group and g.account_id = p_account
                      and g.brand_id = p_brand_id) then
      raise exception 'Esa pregunta no es de esta cuenta o no es de esa marca. No se ha escrito nada.'
        using errcode = '42501';
    end if;
  end if;

  if v_nombre = '' then
    raise exception 'La pregunta necesita el texto que lee el cliente.'
      using errcode = '22023';
  end if;
  if p_respuestas is null or jsonb_array_length(p_respuestas) = 0 then
    raise exception 'La pregunta necesita al menos una respuesta.'
      using errcode = '22023';
  end if;

  -- Dos respuestas con el mismo nombre son indistinguibles para el cliente.
  select lower(btrim(r->>'nombre')) into v_mala
    from jsonb_array_elements(p_respuestas) r
   group by lower(btrim(r->>'nombre')) having count(*) > 1 limit 1;
  if v_mala is not null then
    raise exception 'Hay dos respuestas llamadas «%». No se ha escrito nada.', v_mala
      using errcode = '22023';
  end if;

  -- ── LAS FICHAS DE DESTINO: de esta cuenta, VIVAS y sin archivar ─────────
  -- Igual que en la sección Extras: una ficha archivada tiene el precio del día
  -- en que se archivó, y costear contra ese número es escribir algo que nadie
  -- va a volver a mirar. Se dice CUÁL falla, no «alguna».
  select ri.name into v_mala
    from jsonb_array_elements(p_respuestas) r
    join recipe_item ri on ri.id = nullif(r->'efecto'->>'ficha','')::uuid
   where ri.account_id <> p_account
      or not ri.is_active or ri.archived_at is not null
   limit 1;
  if v_mala is not null then
    raise exception 'La ficha «%» está archivada o no es de esta cuenta. No se ha escrito nada.', v_mala
      using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_respuestas) r
     where nullif(r->'efecto'->>'ficha','') is not null
       and not exists (select 1 from recipe_item ri
                        where ri.id = (r->'efecto'->>'ficha')::uuid)
  ) then
    raise exception 'Alguna ficha no existe. No se ha escrito nada.' using errcode = '42501';
  end if;

  -- ── LA PREGUNTA ─────────────────────────────────────────────────────────
  if v_nueva then
    insert into modifier_group (account_id, brand_id, name, min_selections,
                                max_selections, allow_repetition, group_type, is_active)
    values (p_account, p_brand_id, v_nombre,
            case when p_obligatoria then 1 else 0 end,
            greatest(1, coalesce(p_max, 1)),
            coalesce(p_repetible, false),
            coalesce(p_tipo, 'choice'), true)
    returning id into v_group;
  else
    -- LA ETIQUETA VIEJA SE LIMPIA AL GUARDAR: «esta pregunta venía de una
    -- importación antigua; al guardarla pasa a ser tuya». Solo en propias —
    -- aquí ya no puede ser otra cosa, la marca se comprobó arriba.
    select (g.external_source is not null) into v_etiqueta
      from modifier_group g where g.id = v_group;

    update modifier_group
       set name             = v_nombre,
           min_selections   = case when p_obligatoria then 1 else 0 end,
           max_selections   = greatest(1, coalesce(p_max, 1)),
           allow_repetition = coalesce(p_repetible, false),
           group_type       = coalesce(p_tipo, group_type),
           is_active        = true,
           external_source  = null,
           external_id      = null,
           updated_at       = now()
     where id = v_group;
  end if;

  -- ── LAS RESPUESTAS ──────────────────────────────────────────────────────
  for v_r in select * from jsonb_array_elements(p_respuestas) loop
    v_pos    := v_pos + 1;
    v_opcion := nullif(v_r->>'id', '')::uuid;
    v_efecto := case when v_r->'efecto' = 'null'::jsonb then null else v_r->'efecto' end;

    if v_opcion is not null then
      -- Existente: tiene que ser de ESTA pregunta. Mover una opción de una
      -- pregunta a otra por id no es editar, es otra cosa.
      if not exists (select 1 from modifier_option o
                      where o.id = v_opcion and o.account_id = p_account
                        and o.modifier_group_id = v_group) then
        raise exception 'Una de las respuestas no es de esta pregunta. No se ha escrito nada.'
          using errcode = '42501';
      end if;
      update modifier_option
         set name           = btrim(v_r->>'nombre'),
             price_impact   = coalesce(nullif(v_r->>'precio','')::numeric, 0),
             position       = v_pos,
             is_active      = true,
             deactivated_at = null,
             deactivated_by = null,
             updated_at     = now()
       where id = v_opcion;
      v_actual := v_actual + 1;
    else
      -- NUEVA. Sin efecto declarado no entra: seria la fila 111.
      if v_efecto is null or nullif(v_efecto->>'tipo','') is null then
        raise exception 'La respuesta «%» es nueva y no dice qué lleva. No se ha escrito nada.',
          btrim(v_r->>'nombre') using errcode = '22023';
      end if;
      insert into modifier_option (account_id, modifier_group_id, name,
                                   price_impact, position, is_active)
      values (p_account, v_group, btrim(v_r->>'nombre'),
              coalesce(nullif(v_r->>'precio','')::numeric, 0), v_pos, true)
      returning id into v_opcion;
      v_creadas := v_creadas + 1;
    end if;

    v_vistas := array_append(v_vistas, v_opcion);

    -- ── QUÉ LLEVA ─────────────────────────────────────────────────────────
    -- Una respuesta tiene UN efecto. Se borra el confirmado que hubiera y se
    -- escribe el declarado: asi «cambiar de opinion» no deja dos verdades.
    -- Si no viene efecto y la respuesta ya existia, se deja como estaba.
    if v_efecto is not null and nullif(v_efecto->>'tipo','') is not null then
      v_tipo_imp := v_efecto->>'tipo';
      if v_tipo_imp not in ('add_item','remove_item','replace_item','multiply','bundle','none') then
        raise exception 'El efecto «%» no existe. No se ha escrito nada.', v_tipo_imp
          using errcode = '22023';
      end if;

      -- 🔴 SIN CANTIDAD NO DESCUENTA NADA (13/09). La puerta, no solo la
      -- pantalla: el 13/09 se guardaron dos «anade» con ficha y sin cantidad
      -- y el contador las dio por decididas mientras el consumo era CERO.
      -- Que exige cada tipo lo dice `_impacto_completo`, en un solo sitio.
      if not public._impacto_completo(
               v_tipo_imp,
               nullif(v_efecto->>'ficha','')::uuid,
               nullif(v_efecto->>'cantidad','')::numeric) then
        raise exception
          'A «%» le falta el articulo o la cantidad: asi no descontaria nada del almacen, aunque la pregunta quedara como decidida. No se ha escrito nada.',
          btrim(v_r->>'nombre') using errcode = '22023';
      end if;

      delete from modifier_recipe_impact
       where modifier_option_id = v_opcion and account_id = p_account
         and status = 'confirmed';

      insert into modifier_recipe_impact (
        account_id, modifier_option_id, impact_type, target_recipe_item_id,
        quantity, unit_id, status, source, rationale,
        confirmed_by, confirmed_by_name, confirmed_at)
      values (
        p_account, v_opcion, v_tipo_imp,
        nullif(v_efecto->>'ficha','')::uuid,
        nullif(v_efecto->>'cantidad','')::numeric,
        nullif(v_efecto->>'unidad','')::uuid,
        'confirmed', 'human',
        'Tablero 5 · ' || v_nombre,
        auth.uid(), p_actor, now());

      v_efectos := v_efectos + 1;
    end if;
  end loop;

  -- ── LAS QUE YA NO ESTÁN ─────────────────────────────────────────────────
  -- No se borran: se retiran, con sello de persona. Una opción borrada se
  -- lleva por delante el historial de lo que se vendió con ella.
  update modifier_option
     set is_active = false, deactivated_at = now(),
         deactivated_by = 'persona', updated_at = now()
   where modifier_group_id = v_group and account_id = p_account
     and is_active and not (id = any(v_vistas));
  get diagnostics v_retiradas = row_count;

  return jsonb_build_object(
    'pregunta_id',            v_group,
    'nombre',                 v_nombre,
    'creada',                 v_nueva,
    'respuestas_creadas',     v_creadas,
    'respuestas_actualizadas',v_actual,
    'respuestas_retiradas',   v_retiradas,
    'efectos_escritos',       v_efectos,
    'etiqueta_vieja_limpiada',v_etiqueta);
end;
$$;

comment on function public.kitchen_guardar_pregunta(uuid,uuid,uuid,text,text,boolean,integer,boolean,jsonb,text) is
  'Tablero 5: crea o edita una pregunta con sus respuestas y lo que lleva cada una. Candados: marca cedida, respuesta nueva sin efecto, ficha archivada o de otra cuenta, efecto que no descuenta nada, y nombres repetidos.';


create or replace function public.kitchen_aplicar_a_las_iguales(
  p_account   uuid,
  p_opciones  uuid[],
  p_efecto    jsonb,
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

  -- 🔴 SIN CANTIDAD NO DESCUENTA NADA (13/09). Aqui pesa el doble: un efecto
  -- a medias repartido en lote son N respuestas que dicen «decidida» y
  -- descuentan cero, no una.
  if not public._impacto_completo(v_tipo, v_ficha,
                                  nullif(p_efecto->>'cantidad','')::numeric) then
    raise exception
      'Al efecto le falta el articulo o la cantidad: asi no descontaria nada del almacen, aunque las respuestas quedaran como decididas. No se ha escrito nada.'
      using errcode = '22023';
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
  'Aplica el mismo «que lleva» a las respuestas ELEGIDAS que se llaman igual. Solo marcas propias, aborta entero si alguna no lo es o si el efecto no descontaria nada, y deja rastro por fila.';
