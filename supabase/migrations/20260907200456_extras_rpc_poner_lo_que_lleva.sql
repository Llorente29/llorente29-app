-- ══════════════════════════════════════════════════════════════════════════
-- Sección Extras · el flujo «Decir qué lleva»
-- ══════════════════════════════════════════════════════════════════════════
--
-- ESCRIBIR EN N COPIAS ES UNA SOLA TRANSACCIÓN (regla 13). Y no es formalismo:
-- «Salsa Yogur» son SIETE copias. Escribiéndolas de una en una desde el
-- navegador, si falla la quinta quedan cuatro puestas y tres no, sin nada que
-- lo deshaga y sin que la pantalla sepa decir cuál es cuál. O entran las siete
-- o no entra ninguna.
--
-- `source = 'human'` SIEMPRE (decisión 1 del §5): esa columna dice QUIÉN lo
-- dijo, y lo dijo una persona. La procedencia —de qué pantalla salió— va en
-- `rationale`, que es texto libre y está para esto. Son dos ejes y no se
-- mezclan en una columna; ensanchar el CHECK habría hecho que «¿cuántos los
-- puso un humano?» dejara de tener respuesta.
--
-- LO QUE ESCRIBE: un impacto CONFIRMADO por copia y por cosa que lleva. Un
-- extra puede llevar varias («pan, carne y salsa»), y desde el 07/09 el modelo
-- y la pantalla lo aguantan. El índice único parcial impide que la misma copia
-- reciba dos veces la misma ficha, que sumaría el coste dos veces.

create or replace function public.kitchen_extras_poner_lo_que_lleva(
  p_account   uuid,
  p_opciones  uuid[],          -- las copias elegidas
  p_lleva     jsonb,           -- [{ficha, cantidad, unidad, tipo}]
  p_actor     text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cosa      jsonb;
  v_opcion    uuid;
  v_escritos  int := 0;
  v_ficha     uuid;
  v_tipo      text;
  v_rationale text;
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

  v_rationale := 'Sección Extras · aplicado a ' || array_length(p_opciones, 1) || ' copias';

  foreach v_opcion in array p_opciones loop
    for v_cosa in select * from jsonb_array_elements(p_lleva) loop
      v_ficha := (v_cosa->>'ficha')::uuid;
      -- Un plato entero es UN impacto `bundle`; un ingrediente se añade.
      v_tipo := case when v_cosa->>'tipo' = 'plato' then 'bundle' else 'add_item' end;

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

comment on function public.kitchen_extras_poner_lo_que_lleva(uuid, uuid[], jsonb, text) is
  'Sección Extras. Pone lo que lleva un extra en TODAS las copias elegidas, en una sola transacción (regla 13): o entran todas o no entra ninguna. source=human siempre —dice quién lo dijo— y la procedencia va en rationale. Un plato entero es un impacto bundle; un ingrediente, add_item.';

revoke execute on function public.kitchen_extras_poner_lo_que_lleva(uuid, uuid[], jsonb, text) from public, anon;

-- ── GUARDA ────────────────────────────────────────────────────────────────
do $guarda$
declare v_oid oid; v_src text;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kitchen_extras_poner_lo_que_lleva';

  if v_oid is null then
    raise exception 'GUARDA: la funcion no existe despues de aplicar.';
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'GUARDA: sigue siendo ejecutable por public/anon (regla 16).';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = v_oid;

  if v_src not like '%mo.account_id = p_account%' then
    raise exception 'GUARDA: no comprueba que las copias sean de la cuenta (regla 9).';
  end if;
  if v_src not like '%ri.account_id = p_account%' then
    raise exception 'GUARDA: no comprueba que las fichas sean de la cuenta (regla 9).';
  end if;
  if v_src not like '%''human''%' then
    raise exception 'GUARDA: source deberia ser human siempre (decision 1 del encargo).';
  end if;

  -- El índice único parcial tiene que existir ANTES: el ON CONFLICT lo usa.
  if not exists (
    select 1 from pg_class c
     where c.relname = 'modifier_recipe_impact_un_confirmado_por_ficha') then
    raise exception 'GUARDA: falta el indice unico parcial; el ON CONFLICT no tendria donde apoyarse.';
  end if;
end
$guarda$;
