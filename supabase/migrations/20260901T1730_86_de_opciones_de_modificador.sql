-- 20260901T1730_86_de_opciones_de_modificador.sql
--
-- EL 86 LLEGA A LAS OPCIONES DE MODIFICADOR, POR LOCAL.
--
-- 01/09, en servicio: Alcalá se queda sin milanesa de ternera. Los nueve
-- productos se marcan, pero «Milanesa de ternera» sigue vendiéndose desde los
-- dos grupos de modificador — y ésa es la RUTA NORMAL del cliente. Estuvo
-- entrando comida que no existe mientras la pantalla decía que estaba resuelto.
--
-- ── LO QUE SE CREÍA UN MURO Y NO LO ERA ────────────────────────────────────
-- El primer RECON concluyó que no se podía: Folvy publica las opciones sin
-- `sku_ref` y el 86 empuja contra `sku_ref`. Falso de raíz: la API de
-- inventario de HubRise acepta `sku_ref` O `option_ref` en cada entrada, y el
-- `ref` que Folvy YA publica en cada opción (optRef(o)) es ese option_ref. No
-- hace falta sku_ref ni republicar catálogo. Se buscaba un campo que no hacía
-- falta. (Corregido por Julio con la documentación delante.)
--
-- ── SE ANCLA POR external_id, Y ES LO QUE SALVA EL ARREGLO ─────────────────
-- Las opciones están DUPLICADAS: «Milanesa de ternera» son CUATRO filas, dos
-- por grupo, y cada par comparte el mismo `external_id`:
--   d1187ae1 / 400c899f  ->  external_id 43f73ae6…  (primer bocadillo)
--   a8596939 / f1477e0b  ->  external_id 93845643…  (segundo bocadillo)
-- Anclar por id de opción habría agotado LA MITAD y habríamos creído que
-- estaba resuelto mientras seguía entrando comida. Anclando por external_id
-- —que es como ya ancla product_availability— las cuatro caen de una vez.
--
-- ── POR LOCAL, Y NO SE TOCA is_active ──────────────────────────────────────
-- `modifier_option.is_active` es GLOBAL: apagarla dejaría a Carabanchel sin
-- ternera, que sí la tiene. El 86 va por `product_availability`, que ancla por
-- external_id + location_id, y el inventario de HubRise es por local.
--
-- ── LA CASCADA DESDE EL ALMACÉN QUEDA ESCRITA PERO HOY NO DISPARA ──────────
-- Se pidió que agotar una caja de ternera cayera sobre productos Y opciones.
-- El camino queda hecho, pero hoy no alcanza a nada: las 225 opciones activas
-- de Foodint tienen `recipe_item_id` a NULL. No falta código, falta el enlace
-- del que colgar la cascada, y eso es trabajo de catálogo. Cuando se enlacen,
-- esto funciona sin tocar nada.
--
-- APLICADA fuera de ventana: TERCERA excepción del 01/09, autorizada por Julio,
-- con comida entrando que no existe en pleno servicio.

begin;

-- ── 1 · Qué se está agotando ───────────────────────────────────────────────
-- La misma tabla y el mismo anclaje que los productos. Hace falta distinguirlos
-- porque el PATCH a HubRise manda `sku_ref` para un producto y `option_ref`
-- para una opción: sin esta columna, el dispatch no sabe cuál de los dos.
alter table product_availability
  add column if not exists target_kind text not null default 'product';

alter table product_availability drop constraint if exists product_availability_target_kind_chk;
alter table product_availability add constraint product_availability_target_kind_chk
  check (target_kind in ('product', 'modifier_option'));

comment on column product_availability.target_kind is
  'product -> se empuja como sku_ref · modifier_option -> como option_ref. Mismo anclaje external_id + location_id para los dos.';

-- ── 2 · El registro admite el alcance nuevo ────────────────────────────────
alter table availability_event drop constraint if exists availability_event_scope_check;
alter table availability_event add constraint availability_event_scope_check
  check (scope in ('product', 'brand', 'location', 'modifier_option'));

-- ── 3 · El núcleo, sin guarda de sesión ────────────────────────────────────
-- Sin guarda a propósito: lo llaman el envoltorio (que ya validó) y la cascada
-- del almacén. Al no tenerla, LOS PERMISOS SON SU ÚNICA PROTECCIÓN.
create or replace function public._set_modifier_option_availability_core(
  p_option_id       uuid,
  p_is_available    boolean,
  p_location_id     uuid,
  p_reason          text,
  p_available_until timestamptz,
  p_reason_code     text,
  p_account_id      uuid,
  p_actor           uuid,
  p_origin          text,
  p_surface         text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $core$
declare
  v_account_id  uuid;
  v_external_id text;
  v_name        text;
  v_refs        text[];
  v_action      text;
  v_reason_code text;
begin
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception '_set_modifier_option_availability_core: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_modifier_option_availability_core: reason_code no valido %', p_reason_code;
  end if;

  select mo.account_id, mo.external_id, mo.name
    into v_account_id, v_external_id, v_name
  from modifier_option mo where mo.id = p_option_id;

  if v_account_id is null then
    raise exception '_set_modifier_option_availability_core: opcion % no encontrada', p_option_id;
  end if;
  if v_account_id <> p_account_id then
    raise exception '_set_modifier_option_availability_core: opcion % no pertenece a la cuenta %', p_option_id, p_account_id;
  end if;
  -- Sin external_id no hay ref que empujar: HubRise publica optRef(o) =
  -- external_id, y sin el, el PATCH no encontraria nada. Se falla en voz alta
  -- en vez de escribir una fila que no llega a ninguna parte.
  if v_external_id is null then
    raise exception '_set_modifier_option_availability_core: la opcion "%" no tiene external_id, no se puede agotar en el canal', v_name;
  end if;

  -- TODAS las opciones que comparten ese external_id: las gemelas incluidas.
  select array_agg(distinct mo.external_id)
    into v_refs
  from modifier_option mo
  where mo.account_id = v_account_id and mo.external_id = v_external_id;

  if p_is_available then
    delete from product_availability pa
     where pa.account_id = v_account_id
       and pa.target_kind = 'modifier_option'
       and pa.external_id = v_external_id
       and (p_location_id is null or pa.location_id = p_location_id or pa.location_id is null);
  else
    delete from product_availability pa
     where pa.account_id = v_account_id
       and pa.target_kind = 'modifier_option'
       and pa.external_id = v_external_id
       and pa.location_id is not distinct from p_location_id;

    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id, is_available, reason,
       available_until, set_by, target_kind)
    values
      (v_account_id, v_external_id, null, p_location_id, false, p_reason,
       p_available_until, p_actor, 'modifier_option');
  end if;

  v_action := case when p_is_available then 'open' else 'close' end;
  v_reason_code := case when v_action = 'close' then coalesce(p_reason_code,
    case p_reason when 'stock_out' then 'sin_stock' when 'schedule' then 'fin_servicio'
                  when 'manual' then 'otro' else null end) else null end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_ext, target_label, location_id, action,
       origin, reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'modifier_option', p_option_id, v_external_id, v_name,
       p_location_id, v_action, p_origin, v_reason_code, null, p_actor, p_surface,
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning '_set_modifier_option_availability_core: fallo insertando availability_event: %', sqlerrm;
  end;

  -- `option_refs` (no `matriculas`) para que el dispatch NO los confunda con
  -- skus de producto: son campos distintos en el PATCH de HubRise.
  return jsonb_build_object(
    'option_refs', coalesce(to_jsonb(v_refs), '[]'::jsonb),
    'label', coalesce(v_name, '(opcion)'),
    'available_until', p_available_until);
end;
$core$;

revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from public;
revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from anon;
revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from authenticated;
grant  execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) to service_role;

-- ── 4 · El envoltorio con guarda, que es el que llama la pantalla ──────────
create or replace function public.set_modifier_option_availability(
  p_option_id       uuid,
  p_is_available    boolean,
  p_location_id     uuid    default null,
  p_reason          text    default 'stock_out',
  p_available_until timestamptz default null,
  p_reason_code     text    default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $wrap$
declare
  v_acct   uuid;
  v_res    jsonb;
  v_refs   text[];
  v_secret text;
begin
  select account_id into v_acct from modifier_option where id = p_option_id;
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

  v_res := public._set_modifier_option_availability_core(
    p_option_id, p_is_available, p_location_id, p_reason, p_available_until,
    p_reason_code, v_acct, auth.uid(), 'oficina', 'web');

  select array_agg(x) into v_refs
  from jsonb_array_elements_text(v_res->'option_refs') x;

  -- DISPARA EL DESPACHADOR, igual que set_product_availability. Sin esto la
  -- fila se escribiria en product_availability y NO llegaria a HubRise: un 86
  -- que solo existe en nuestra base de datos es exactamente el fallo silencioso
  -- que se viene arreglando todo el dia. El secreto sale del Vault; si falta,
  -- se avisa en voz alta y no se finge exito.
  if v_refs is not null and array_length(v_refs, 1) > 0 then
    select decrypted_secret into v_secret from vault.decrypted_secrets
     where name = 'availability_dispatch_secret';
    if v_secret is not null then
      -- SOLO option_refs, sin `matriculas`: un ref de opcion no puede viajar
      -- como sku de producto. expires_at lo pone el despachador desde
      -- available_until, igual que en los productos.
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
      v_res := v_res || jsonb_build_object('dispatched', true);
    else
      raise warning 'set_modifier_option_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
      v_res := v_res || jsonb_build_object('dispatched', false, 'warning', 'sin secreto en Vault');
    end if;
  end if;

  return v_res;
end;
$wrap$;

revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from public;
revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from anon;
grant  execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) to authenticated, service_role;

-- ── 5 · Verificacion ───────────────────────────────────────────────────────
do $verif$
declare
  v_n int;
begin
  if to_regprocedure('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)') is null then
    raise exception 'el envoltorio no quedo creado';
  end if;

  -- El nucleo no tiene guarda: si authenticated lo alcanza, cualquiera agota
  -- opciones de cualquier cuenta. Se dejo abierto tres veces en agosto.
  if has_function_privilege('anon', 'public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text)', 'execute') then
    raise exception 'el nucleo sin guarda nacio alcanzable por anon o authenticated';
  end if;
  if has_function_privilege('anon', 'public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)', 'execute') then
    raise exception 'anon alcanza el envoltorio';
  end if;

  -- Lo que ya habia sigue en pie: ninguna fila existente cambia de sentido.
  select count(*) into v_n from product_availability where target_kind <> 'product';
  if v_n <> 0 then
    raise exception 'alguna fila existente nacio marcada como opcion: %', v_n;
  end if;

  -- La milanesa tiene que ser alcanzable: 4 filas, 2 external_id.
  select count(*) into v_n from modifier_option
   where name ilike '%milanesa%ternera%' and external_id is not null;
  if v_n < 4 then
    raise exception 'esperaba al menos 4 filas de milanesa de ternera con external_id y hay %', v_n;
  end if;

  raise notice 'VERIFICACION OK: target_kind en su sitio, nucleo cerrado, % filas de milanesa alcanzables', v_n;
end;
$verif$;

commit;
