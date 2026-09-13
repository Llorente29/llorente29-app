-- RETIRAR, CON SU SELLO. Encargo de Julio, 13/09 15:35 §3.
--
-- Se RETIRA, no se borra: lo retirado se ve, lleva quien y cuando, y se puede
-- volver a encender. Una respuesta BORRADA se lleva por delante el historial
-- de todo lo que se vendio con ella.
--
-- ── LA BANDA: cumple las tres ─────────────────────────────────────────────
--   1. NO ESTA EN EL CAMINO DEL PEDIDO. Funcion nueva, nadie la nombra.
--   2. NO TOMA CIERRE EXCLUSIVO. Escribe FILAS de `modifier_option` y
--      `modifier_group` —escritura normal— y no altera ninguna tabla.
--   3. SE DICE ANTES.
--
-- ── POR QUE `modifier_group` NO LLEVA SELLO PROPIO ────────────────────────
-- `modifier_option` tiene `deactivated_at` y `deactivated_by`; `modifier_group`
-- NO los tiene. En vez de inventarle dos columnas —que seria un ALTER TABLE, y
-- eso ya no cumpliria la condicion 2 de la banda—, una pregunta retirada es una
-- pregunta apagada CON TODAS SUS RESPUESTAS SELLADAS. El quien y el cuando
-- viven donde ya habia sitio para ellos.
--
-- Y al volver a encender una pregunta solo se reencienden las respuestas que
-- apago una PERSONA (`deactivated_by = 'persona'`): las que apago Last siguen
-- apagadas, porque encenderlas seria pelearse con el volcado de las 03:20.
--
-- Este es el primer intento de esta migracion que llega: el anterior abortó
-- ENTERO por `get diagnostics v_opciones = v_opciones + row_count`, que no es
-- valido —GET DIAGNOSTICS asigna un item a una variable, no una suma—. No se
-- aplico nada, comprobado antes de reintentar.

create or replace function public.kitchen_retirar(
  p_account   uuid,
  p_opciones  uuid[]  default null,
  p_pregunta  uuid    default null,
  p_actor     text    default null,
  p_encender  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mala      text;
  v_opciones  int := 0;
  v_preguntas int := 0;
  v_n         int := 0;
  v_nombre    text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para retirar de la cuenta %', p_account
      using errcode = '42501';
  end if;

  if (p_opciones is null or array_length(p_opciones,1) is null) and p_pregunta is null then
    raise exception 'No se ha dicho qué retirar.' using errcode = '22023';
  end if;

  -- EN CEDIDAS NO SE RETIRA NADA. Last las reescribe cada noche a las 03:20:
  -- lo retirado volveria, y nadie se enteraria de que ha vuelto.
  select b.name into v_mala
    from modifier_option o
    join modifier_group g on g.id = o.modifier_group_id
    left join brand b on b.id = g.brand_id
   where o.id = any(coalesce(p_opciones,'{}'::uuid[]))
     and (o.account_id <> p_account or coalesce(b.ownership_type,'own') <> 'own')
   limit 1;
  if v_mala is null and p_pregunta is not null then
    select b.name into v_mala from modifier_group g
      left join brand b on b.id = g.brand_id
     where g.id = p_pregunta
       and (g.account_id <> p_account or coalesce(b.ownership_type,'own') <> 'own');
  end if;
  if v_mala is not null then
    raise exception 'La carta de «%» la manda Last y la reescribe cada noche: lo que retirases aquí volvería a las 03:20. No se ha escrito nada.', v_mala
      using errcode = '42501';
  end if;

  -- ── LAS RESPUESTAS SUELTAS ──────────────────────────────────────────────
  if p_opciones is not null and array_length(p_opciones,1) is not null then
    if p_encender then
      update modifier_option
         set is_active = true, deactivated_at = null, deactivated_by = null,
             updated_at = now()
       where id = any(p_opciones) and account_id = p_account;
    else
      update modifier_option
         set is_active = false, deactivated_at = now(),
             deactivated_by = 'persona', updated_at = now()
       where id = any(p_opciones) and account_id = p_account;
    end if;
    get diagnostics v_n = row_count;
    v_opciones := v_opciones + v_n;
  end if;

  -- ── LA PREGUNTA ENTERA ──────────────────────────────────────────────────
  if p_pregunta is not null then
    select g.name into v_nombre from modifier_group g
     where g.id = p_pregunta and g.account_id = p_account;
    if v_nombre is null then
      raise exception 'Esa pregunta no es de esta cuenta. No se ha escrito nada.'
        using errcode = '42501';
    end if;

    if p_encender then
      update modifier_group set is_active = true, updated_at = now()
       where id = p_pregunta and account_id = p_account;
      get diagnostics v_preguntas = row_count;
      update modifier_option
         set is_active = true, deactivated_at = null, deactivated_by = null,
             updated_at = now()
       where modifier_group_id = p_pregunta and account_id = p_account
         and deactivated_by = 'persona';
      get diagnostics v_n = row_count;
    else
      update modifier_group set is_active = false, updated_at = now()
       where id = p_pregunta and account_id = p_account;
      get diagnostics v_preguntas = row_count;
      update modifier_option
         set is_active = false, deactivated_at = now(),
             deactivated_by = 'persona', updated_at = now()
       where modifier_group_id = p_pregunta and account_id = p_account
         and coalesce(is_active, true);
      get diagnostics v_n = row_count;
    end if;
    v_opciones := v_opciones + v_n;
  end if;

  return jsonb_build_object(
    'encendido',  p_encender,
    'respuestas', v_opciones,
    'preguntas',  v_preguntas,
    'pregunta',   v_nombre,
    'actor',      p_actor);
end;
$$;

comment on function public.kitchen_retirar(uuid,uuid[],uuid,text,boolean) is
  'Retira (o vuelve a encender) respuestas sueltas o una pregunta entera. Se RETIRA, no se borra: sello de persona en cada respuesta. Al reencender una pregunta solo revive lo que apago una persona, no lo que apago Last. En marcas cedidas aborta.';

revoke all on function public.kitchen_retirar(uuid,uuid[],uuid,text,boolean) from public;
grant execute on function public.kitchen_retirar(uuid,uuid[],uuid,text,boolean) to authenticated;
