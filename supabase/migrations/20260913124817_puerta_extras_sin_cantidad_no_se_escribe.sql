-- PUERTA 3 DE 3 · la seccion Extras: sin cantidad no se escribe un efecto.
--
-- Encargo de Julio, 13/09 14:35 §1. El porque y la tabla de que exige cada
-- tipo estan en `que_significa_decidida_una_sola_definicion`.
--
-- Va en su propia migracion porque el primer intento con las tres juntas
-- ABORTO ENTERO —«cannot remove parameter defaults from existing function»—:
-- esta lleva `p_actor text default null::text` y yo la habia escrito sin el
-- defecto. No se aplico nada, comprobado por md5 de las tres antes de
-- reintentar. Se separa para que un fallo de firma no vuelva a arrastrar a las
-- otras dos.
--
-- Identica a la viva (md5 853fa68eee82bd425db429cfd84cc26e) salvo la guarda.

create or replace function public.kitchen_extras_poner_lo_que_lleva(
  p_account   uuid,
  p_opciones  uuid[],
  p_lleva     jsonb,
  p_actor     text default null::text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cosa      jsonb;
  v_opcion    uuid;
  v_escritos  int := 0;
  v_ficha     uuid;
  v_tipo      text;
  v_rationale text;
  v_mala      text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para poner el coste de los extras de la cuenta %', p_account
      using errcode = '42501';
  end if;

  if p_opciones is null or array_length(p_opciones, 1) is null then
    raise exception 'No se ha elegido ninguna copia a la que ponerle lo que lleva.'
      using errcode = '22023';
  end if;
  if p_lleva is null or jsonb_array_length(p_lleva) = 0 then
    raise exception 'No se ha dicho qué lleva el extra.'
      using errcode = '22023';
  end if;

  -- REGLA 9, Y AQUÍ ES UNA ESCRITURA. Si una opción no es de esta cuenta se
  -- aborta entera: escribir en el catálogo de otro cliente no se arregla luego.
  if exists (
    select 1 from unnest(p_opciones) o(id)
     where not exists (
       select 1 from modifier_option mo
        where mo.id = o.id and mo.account_id = p_account)
  ) then
    raise exception 'Alguna de las copias no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  -- Las fichas de destino, igual: por cuenta.
  if exists (
    select 1 from jsonb_array_elements(p_lleva) c
     where not exists (
       select 1 from recipe_item ri
        where ri.id = (c->>'ficha')::uuid and ri.account_id = p_account)
  ) then
    raise exception 'Alguna de las fichas no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  -- Y VIVAS (B84.3). Una ficha archivada tiene el precio del día en que se
  -- archivó y ya no sale en el selector: si llega aquí es por una llamada
  -- directa, y costear siete copias contra un precio congelado es escribir un
  -- número que nadie va a volver a mirar. Se dice CUÁL falla, no «alguna»: con
  -- siete copias y tres cosas, «alguna» no se puede ir a buscar.
  select ri.name into v_mala
    from jsonb_array_elements(p_lleva) c
    join recipe_item ri on ri.id = (c->>'ficha')::uuid
   where ri.account_id = p_account
     and (not ri.is_active or ri.archived_at is not null)
   limit 1;
  if v_mala is not null then
    raise exception 'La ficha «%» está archivada: su precio es el del día que se archivó. No se ha escrito nada.', v_mala
      using errcode = '42501';
  end if;

  v_rationale := 'Sección Extras · aplicado a ' || array_length(p_opciones, 1) || ' copias';

  foreach v_opcion in array p_opciones loop
    for v_cosa in select * from jsonb_array_elements(p_lleva) loop
      v_ficha := (v_cosa->>'ficha')::uuid;
      -- Un plato entero es UN impacto `bundle`; un ingrediente se añade.
      v_tipo := case when v_cosa->>'tipo' = 'plato' then 'bundle' else 'add_item' end;

      -- 🔴 SIN CANTIDAD NO DESCUENTA NADA (13/09). Esta puerta nunca lo ha
      -- dejado pasar porque su pantalla siempre manda la cantidad — o sea que
      -- los 73 `add_item` buenos lo son por buena conducta, no porque nada lo
      -- impidiera. Lo impide ahora.
      if not public._impacto_completo(
               v_tipo, v_ficha, nullif(v_cosa->>'cantidad','')::numeric) then
        raise exception
          'A «%» le falta la cantidad: asi no descontaria nada del almacen, aunque el extra quedara como decidido. No se ha escrito nada.',
          coalesce((select ri.name from recipe_item ri where ri.id = v_ficha), 'ese articulo')
          using errcode = '22023';
      end if;

      insert into modifier_recipe_impact (
        account_id, modifier_option_id, impact_type, target_recipe_item_id,
        quantity, unit_id, status, source, rationale,
        confirmed_by, confirmed_by_name, confirmed_at)
      values (
        p_account, v_opcion, v_tipo, v_ficha,
        nullif(v_cosa->>'cantidad','')::numeric,
        nullif(v_cosa->>'unidad','')::uuid,
        'confirmed', 'human', v_rationale,
        auth.uid(), p_actor, now())
      -- Si esa copia ya tenía justo esa ficha confirmada, se ACTUALIZA en vez
      -- de duplicar: el índice único parcial lo impediría, y reventar aquí
      -- dejaría el trabajo a medias por algo que es corregir, no duplicar.
      on conflict (modifier_option_id, target_recipe_item_id)
        where status = 'confirmed'
      do update set
        impact_type       = excluded.impact_type,
        quantity          = excluded.quantity,
        unit_id           = excluded.unit_id,
        rationale         = excluded.rationale,
        confirmed_by      = excluded.confirmed_by,
        confirmed_by_name = excluded.confirmed_by_name,
        confirmed_at      = excluded.confirmed_at,
        updated_at        = now();

      v_escritos := v_escritos + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'copias',   array_length(p_opciones, 1),
    'escritos', v_escritos,
    'cosas',    jsonb_array_length(p_lleva)
  );
end;
$function$;

comment on function public.kitchen_extras_poner_lo_que_lleva(uuid,uuid[],jsonb,text) is
  'Extras: aplica lo que lleva a N copias de un extra. Rechaza fichas de otra cuenta, archivadas, y efectos que no descontarian nada del almacen.';
