-- 20260911080249_extras_p2_la_oficina_agota_con_la_misma_regla.sql
--
-- LA OFICINA AGOTA UN EXTRA CON LA MISMA REGLA QUE LA COCINA
--
-- La tablet ya agota por NOMBRE y cierra todas las copias (extras_p1). La
-- oficina seguia cerrando UNA: llamaba al core con una sola opcion, y el core
-- agrupa por `external_id`, que medido no agrupa nada (210 refs para 210
-- opciones). Dos reglas distintas para lo mismo es como empezo el lio de
-- aprobar recuentos.
--
-- Misma firma, asi que CREATE OR REPLACE no crea sobrecarga (regla 2). El
-- front lee `option_refs`, `label` y `dispatched`: los tres siguen ahi. Se
-- anaden `opciones` y `sin_ref` para poder decir en pantalla cuantas se han
-- cerrado y cuantas se quedan fuera por no tener referencia de canal.
--
-- LO QUE ESTO NO ARREGLA, Y HAY QUE DECIRLO. El nombre agrupa las 52 familias
-- con copias («Salsa Yogur» son 13), pero NO junta dos nombres distintos del
-- mismo producto. Los cuatro extras de Coca-Cola de Foodint se llaman «Coca
-- cola », «Coca cola Zero », «Coca Cola Zero. (33cl)» y «Coca Cola. (33cl)»:
-- para esta regla son cuatro extras, no uno. La llave que los juntaria es
-- `modifier_option.recipe_item_id` —el escandallo, igual que en productos— y
-- esta VACIA en las 236 opciones activas de la cuenta.
--
-- ENSAYO, revertido, como la oficina (auth.uid() de un admin de Foodint):
--   Extra: «Salsa Yogur» · 13 copias
--   A · oficina agota .... opciones=9 refs=9 sin_ref=4 dispatched=true
--   B · filas de agotado en ese local ... 9
--   C · oficina reactiva . opciones=9
--
-- md5 de `prosrc`: 10de5d78df0d38a6c0a413ce29869d97 (3.130 caracteres).

BEGIN;

CREATE OR REPLACE FUNCTION public.set_modifier_option_availability(
  p_option_id uuid, p_is_available boolean, p_location_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT 'stock_out'::text,
  p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_reason_code text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare
  v_acct   uuid;
  v_clave  text;
  v_res    jsonb;
  v_refs   text[] := '{}';
  v_n      int := 0;
  v_sin    int := 0;
  v_label  text;
  v_r      record;
  v_secret text;
begin
  select account_id, lower(btrim(name)), name
    into v_acct, v_clave, v_label
    from modifier_option where id = p_option_id;
  if v_acct is null then
    raise exception 'set_modifier_option_availability: opcion % no encontrada', p_option_id;
  end if;
  if not (v_acct = any(public.current_user_account_ids())) then
    raise exception 'set_modifier_option_availability: sin acceso a la cuenta %', v_acct;
  end if;
  if p_location_id is not null and not exists (
      select 1 from locations l where l.id = p_location_id and l.account_id = v_acct) then
    raise exception 'set_modifier_option_availability: el local % no es de esta cuenta', p_location_id;
  end if;

  -- (02/09) ALCANCE POR LOCAL, ver current_user_location_ids().
  perform public._assert_location_in_scope(p_location_id, 'set_modifier_option_availability');

  -- TODAS LAS COPIAS DEL MISMO EXTRA, POR NOMBRE (11/09/2026). Las que no
  -- tienen `external_id` no se pueden empujar al canal: se saltan y se cuentan
  -- en `sin_ref` en vez de callarse (regla 7).
  for v_r in select * from public._extras_group_options(v_acct, v_clave)
  loop
    if v_r.external_id is null then
      v_sin := v_sin + 1;
      continue;
    end if;
    v_res := public._set_modifier_option_availability_core(
      v_r.option_id, p_is_available, p_location_id, p_reason, p_available_until,
      p_reason_code, v_acct, auth.uid(), 'oficina', 'web');
    v_refs := v_refs || array(select jsonb_array_elements_text(v_res->'option_refs'));
    v_n := v_n + 1;
  end loop;

  if array_length(v_refs, 1) > 0 then
    select decrypted_secret into v_secret from vault.decrypted_secrets
     where name = 'availability_dispatch_secret';
    if v_secret is not null then
      -- Se manda SOLO option_refs: sin `matriculas`, para que el despachador no
      -- confunda un ref de opcion con un sku de producto. expires_at lo pone el
      -- despachador desde available_until, igual que en los productos.
      perform net.http_post(
        url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_acct,
          'option_refs', to_jsonb(v_refs),
          'location_id', p_location_id,
          'available_until', p_available_until,
          'enable', p_is_available,
          'reason', p_reason));
    else
      raise warning 'set_modifier_option_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object(
    'label', coalesce(v_label, '(opcion)'),
    'opciones', v_n,
    'option_refs', coalesce(to_jsonb(v_refs), '[]'::jsonb),
    'sin_ref', v_sin,
    'available_until', p_available_until,
    'dispatched', v_secret is not null and coalesce(array_length(v_refs,1),0) > 0);
end;
$fn$;

COMMIT;
