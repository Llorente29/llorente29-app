-- TABLEROS 5 Y 3 · Crear una pregunta, decir qué lleva cada respuesta, y
-- ponerla en platos. Sin pasar por la base.
--
-- POR QUÉ AHORA. Hay 110 opciones activas vendiéndose sin que nadie haya dicho
-- qué descuentan (93 propias + 17 cedidas, medido el 13/09). El tablero 1 ya
-- las enseña; esto es lo que permite hacer algo con ellas.
--
-- ── LA RAYA QUE NO SE CRUZA ────────────────────────────────────────────────
-- EN CEDIDAS NO SE ESCRIBE NUNCA. Last es la carta de las cedidas y el
-- importador las reescribe cada noche: lo que se guardara aquí desaparecería a
-- las 05:20 sin que nadie se entere. Y CEDIDA SE MIDE POR LA MARCA
-- (`ownership_type <> 'own'`), no por el origen de la fila: la etiqueta
-- `lastapp` en una marca propia es de la importación del 12/06, y bloquear por
-- origen dejaría a Julio sin editar 40 preguntas suyas.
--
-- ── LA GUARDA VIVE AQUÍ, NO EN LA PANTALLA ─────────────────────────────────
-- Una pantalla que no ofrece el botón no es una guarda: es una cortesía. Estas
-- funciones rechazan la marca cedida, la ficha de otra cuenta y la respuesta
-- nueva sin efecto aunque las llame otro.
--
-- ── UNA RESPUESTA NUEVA SIN EFECTO ES DEUDA NUEVA ──────────────────────────
-- Crear una opción sin decir qué descuenta es fabricar la fila 111 mientras
-- limpiamos las 110. Se rechaza. En cambio EDITAR una pregunta vieja no obliga
-- a decidirlo todo de golpe: si una respuesta que ya existía viene sin efecto,
-- se deja como estaba. Exigirlo convertiría «corregir un precio» en «resolver
-- nueve fichas», y entonces nadie corrige el precio.
--
-- ── QUÉ CUENTA COMO DECIDIDO ───────────────────────────────────────────────
-- Cualquier impacto `confirmed`, INCLUIDO `none` («no lleva nada»), porque eso
-- es una respuesta y no un hueco. Es exactamente como lo cuenta el tablero 1,
-- a propósito: si aquí contara distinto, guardar bajaría un número que la otra
-- pantalla no vería bajar.
--
-- `modifier_option.recipe_item_id` NO SE USA: está muerto (0 de 241) y el
-- efecto vive en `modifier_recipe_impact`.

create or replace function public.kitchen_guardar_pregunta(
  p_account     uuid,
  p_group_id    uuid,        -- null = pregunta nueva
  p_brand_id    uuid,
  p_nombre      text,
  p_tipo        text,        -- group_type
  p_obligatoria boolean,
  p_max         integer,
  p_repetible   boolean,
  p_respuestas  jsonb,       -- [{id?, nombre, precio, efecto:{tipo,ficha,cantidad,unidad}}]
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
  'Tablero 5: crea o edita una pregunta de una marca PROPIA con sus respuestas y lo que lleva cada una. Rechaza cedidas, fichas ajenas o archivadas, y respuestas nuevas sin efecto.';


create or replace function public.kitchen_poner_pregunta_en_platos(
  p_account  uuid,
  p_group_id uuid,
  p_platos   uuid[],
  p_actor    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand    uuid;
  v_nombre   text;
  v_marca    text;
  v_puestos  int := 0;
  v_quitados int := 0;
  v_mala     text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para poner preguntas en los platos de la cuenta %', p_account
      using errcode = '42501';
  end if;

  select g.brand_id, g.name into v_brand, v_nombre
    from modifier_group g where g.id = p_group_id and g.account_id = p_account;
  if v_brand is null then
    raise exception 'Esa pregunta no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  select b.name into v_marca from brand b where b.id = v_brand;
  if exists (select 1 from brand b
              where b.id = v_brand and coalesce(b.ownership_type,'own') <> 'own') then
    raise exception 'La carta de «%» la manda Last: aquí no se ponen preguntas en platos. No se ha escrito nada.', v_marca
      using errcode = '42501';
  end if;

  -- LOS PLATOS, DE LA MISMA MARCA. Poner una pregunta de Dos Coyotes en un
  -- plato de Milanesa Haus no es un error de dedo: es una carta rota.
  select mi.name into v_mala
    from unnest(coalesce(p_platos, '{}'::uuid[])) x(id)
    left join menu_item mi on mi.id = x.id
   where mi.id is null or mi.account_id <> p_account or mi.brand_id <> v_brand
      or mi.archived_at is not null
   limit 1;
  if v_mala is not null or exists (
       select 1 from unnest(coalesce(p_platos,'{}'::uuid[])) x(id)
        where not exists (select 1 from menu_item mi where mi.id = x.id)) then
    raise exception 'El plato «%» no es de esta marca, no es de esta cuenta o está archivado. No se ha escrito nada.',
      coalesce(v_mala, '?') using errcode = '42501';
  end if;

  delete from modifier_group_assignment a
   where a.modifier_group_id = p_group_id and a.account_id = p_account
     and not (a.menu_item_id = any(coalesce(p_platos, '{}'::uuid[])));
  get diagnostics v_quitados = row_count;

  insert into modifier_group_assignment (account_id, modifier_group_id, menu_item_id, position)
  select p_account, p_group_id, x.id, 0
    from unnest(coalesce(p_platos, '{}'::uuid[])) x(id)
  on conflict (modifier_group_id, menu_item_id) do nothing;
  get diagnostics v_puestos = row_count;

  -- Devuelve CONTENIDO, no un visto (regla 8): «Publicado. Avisadas 4 personas»
  -- dice algo; «Hecho» no.
  return jsonb_build_object(
    'pregunta',  v_nombre,
    'marca',     v_marca,
    'puestos',   v_puestos,
    'quitados',  v_quitados,
    'total',     coalesce(array_length(p_platos, 1), 0),
    'actor',     p_actor);
end;
$$;

comment on function public.kitchen_poner_pregunta_en_platos(uuid,uuid,uuid[],text) is
  'Tablero 3: pone una pregunta en un conjunto de platos de SU MISMA marca propia. La lista es la verdad: lo que no viene, se quita.';

revoke all on function public.kitchen_guardar_pregunta(uuid,uuid,uuid,text,text,boolean,integer,boolean,jsonb,text) from public;
grant execute on function public.kitchen_guardar_pregunta(uuid,uuid,uuid,text,text,boolean,integer,boolean,jsonb,text) to authenticated;
revoke all on function public.kitchen_poner_pregunta_en_platos(uuid,uuid,uuid[],text) from public;
grant execute on function public.kitchen_poner_pregunta_en_platos(uuid,uuid,uuid[],text) to authenticated;
