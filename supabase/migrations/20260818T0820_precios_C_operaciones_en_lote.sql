-- ============================================================================
-- ENCARGO CODE "Gestor de precios: operaciones en lote y deshacer" (18/08/2026)
-- ============================================================================
-- ADITIVO Y DE SERVIDOR. Sin interfaz. NO publica nada en HubRise ni en Last.
-- NO toca ninguna funcion de economia: menu_item_channel_economics,
-- menu_item_economics y preview_platform_promo_impact quedan intactas, md5
-- incluido. NO se divide entre 1,21 ninguna comision.
--
-- LA PIEZA QUE FALTABA: una operacion = una transaccion = una fila = reversible
-- entera. Hoy "+10% a Entrantes en Glovo" serian decenas de set_menu_item_override
-- sueltos: si falla el numero 80 quedan 79 precios cambiados y nadie sabe cuales.

-- (apply_migration envuelve en transaccion; sin BEGIN/COMMIT explicito)

-- ── A · price_operation ───
create table if not exists public.price_operation (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id),
  kind                   text not null check (kind in ('bulk_price','revert')),
  actor                  uuid,
  created_at             timestamptz not null default now(),
  scope                  jsonb not null,
  entries_count          int not null,
  writes_count           int not null,
  reverted_operation_id  uuid references public.price_operation(id),
  note                   text,
  constraint price_operation_revert_chk check (
    (kind = 'revert' and reverted_operation_id is not null) or
    (kind <> 'revert' and reverted_operation_id is null))
);

comment on table public.price_operation is
  'Una operacion de precios en lote (o su reverso). El id ES el operation_id que estampa menu_item_override_history.';
comment on column public.price_operation.scope is
  'Lo que el usuario eligio, tal cual, para que un humano entienda la fila seis meses despues. NO se usa para recalcular nada.';
comment on column public.price_operation.writes_count is
  'Filas que cambiaron DE VERDAD (las que registro el trigger). Reguardar el mismo precio cuenta como entrada, no como escritura.';

create index if not exists idx_price_operation_account_created
  on public.price_operation (account_id, created_at desc);
create index if not exists idx_price_operation_reverted
  on public.price_operation (reverted_operation_id);

alter table public.price_operation enable row level security;

drop policy if exists price_operation_read on public.price_operation;
create policy price_operation_read
  on public.price_operation
  for select
  using (account_id = any (current_user_account_ids()));

-- Escritura SOLO desde los RPC (SECURITY DEFINER). Sin politica ni grant de escritura.
revoke all on public.price_operation from anon, authenticated;
grant select on public.price_operation to authenticated;
grant select on public.price_operation to service_role;

-- ── B · El operation_id viaja por GUC hasta el trigger ───
-- Unico cambio del trigger de esta manana: leer folvy.operation_id y estamparlo.
-- current_setting(..., true) devuelve NULL si la variable no existe, asi que las
-- escrituras SUELTAS desde el modal siguen funcionando igual, con operation_id null.
create or replace function public.tg_menu_item_override_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();   -- null si escribe un proceso sin JWT
  v_op    uuid := nullif(current_setting('folvy.operation_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into menu_item_override_history (
      account_id, menu_item_id, location_id, channel_id, op,
      price_before, price_after, is_available_before, is_available_after, changed_by, operation_id)
    values (
      new.account_id, new.menu_item_id, new.location_id, new.channel_id, 'insert',
      null, new.price, null, new.is_available, v_actor, v_op);

  elsif tg_op = 'UPDATE' then
    if (new.price IS DISTINCT FROM old.price)
       or (new.is_available IS DISTINCT FROM old.is_available) then
      insert into menu_item_override_history (
        account_id, menu_item_id, location_id, channel_id, op,
        price_before, price_after, is_available_before, is_available_after, changed_by, operation_id)
      values (
        new.account_id, new.menu_item_id, new.location_id, new.channel_id, 'update',
        old.price, new.price, old.is_available, new.is_available, v_actor, v_op);
    end if;

  else -- DELETE
    insert into menu_item_override_history (
      account_id, menu_item_id, location_id, channel_id, op,
      price_before, price_after, is_available_before, is_available_after, changed_by, operation_id)
    values (
      old.account_id, old.menu_item_id, old.location_id, old.channel_id, 'delete',
      old.price, null, old.is_available, null, v_actor, v_op);
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora
end;
$$;

-- ── C · apply_price_operation ───
-- Recibe PRECIOS FINALES, no formulas: el "+10%" lo calcula el cliente y manda el
-- resultado de cada celda. Lo que el usuario vio en la previsualizacion es
-- literalmente lo que se escribe. Si el servidor recalculara la formula,
-- previsualizacion y guardado podrian separarse por redondeos.
create or replace function public.apply_price_operation(
  p_account_id uuid,
  p_scope      jsonb,
  p_entries    jsonb,
  p_note       text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_op_id  uuid := gen_random_uuid();
  v_n      int;
  v_bad    text;
  v_writes int;
  r        record;
begin
  -- ── forma del array ───
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries debe ser un array JSON';
  end if;
  v_n := jsonb_array_length(p_entries);
  if v_n = 0 then
    raise exception 'p_entries no puede estar vacio';
  end if;
  if v_n > 2000 then
    raise exception 'Maximo 2000 entradas por operacion (recibidas %). Es un tope de seguridad.', v_n;
  end if;

  -- ── permiso: el mismo que set_menu_item_override ───
  if not (current_user_is_admin() or current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'Sin permiso para operar precios de esta cuenta';
  end if;

  -- ── C.3 validaciones, TODAS antes de escribir nada ───
  -- producto de otra cuenta / inexistente
  select string_agg(format('%s (producto)', e.menu_item_id), ', ')
    into v_bad
  from jsonb_to_recordset(p_entries)
       as e(menu_item_id uuid, channel_id uuid, location_id uuid,
            action text, price numeric, expected_price_before numeric)
  where not exists (select 1 from menu_item mi
                     where mi.id = e.menu_item_id and mi.account_id = p_account_id);
  if v_bad is not null then
    raise exception 'Productos que no pertenecen a la cuenta: %', v_bad;
  end if;

  -- local de otra cuenta
  select string_agg(distinct e.location_id::text, ', ') into v_bad
  from jsonb_to_recordset(p_entries)
       as e(menu_item_id uuid, channel_id uuid, location_id uuid,
            action text, price numeric, expected_price_before numeric)
  where e.location_id is not null
    and not exists (select 1 from locations l
                     where l.id = e.location_id and l.account_id = p_account_id);
  if v_bad is not null then
    raise exception 'Locales que no pertenecen a la cuenta: %', v_bad;
  end if;

  -- accion desconocida
  select string_agg(distinct coalesce(e.action,'(null)'), ', ') into v_bad
  from jsonb_to_recordset(p_entries)
       as e(menu_item_id uuid, channel_id uuid, location_id uuid,
            action text, price numeric, expected_price_before numeric)
  where coalesce(e.action,'set') not in ('set','clear');
  if v_bad is not null then
    raise exception 'Accion no reconocida: % (solo set o clear)', v_bad;
  end if;

  -- set sin precio, o con precio negativo
  select string_agg(format('%s/%s', e.menu_item_id, coalesce(e.price::text,'null')), ', ')
    into v_bad
  from jsonb_to_recordset(p_entries)
       as e(menu_item_id uuid, channel_id uuid, location_id uuid,
            action text, price numeric, expected_price_before numeric)
  where coalesce(e.action,'set') = 'set'
    and (e.price is null or e.price < 0);
  if v_bad is not null then
    raise exception 'Entradas set con precio nulo o negativo: %', v_bad;
  end if;

  -- DEFENSIVO (no estaba en el encargo, ver informe): una misma celda repetida
  -- dentro de la operacion dejaria DOS filas de historial con el mismo
  -- operation_id para la misma clave, y el revert no sabria cual deshacer.
  select string_agg(format('%s|%s|%s', e.menu_item_id, e.channel_id,
                           coalesce(e.location_id::text,'-')), ', ')
    into v_bad
  from (
    select e.menu_item_id, e.channel_id, e.location_id
    from jsonb_to_recordset(p_entries)
         as e(menu_item_id uuid, channel_id uuid, location_id uuid,
              action text, price numeric, expected_price_before numeric)
    group by 1,2,3 having count(*) > 1
  ) e;
  if v_bad is not null then
    raise exception 'Celdas repetidas en la misma operacion: %', v_bad;
  end if;

  -- ── C.2 guarda optimista: nadie ha tocado estas celdas por el camino ───
  -- expected_price_before NO NULO -> comparar con effective_price, tolerancia 0,005.
  -- expected_price_before NULO    -> la previsualizacion vio "sin override";
  --                                  se comprueba que sigue sin haberlo.
  select string_agg(txt, E'\n') into v_bad from (
    select format('  %s / canal %s%s: esperaba %s, hay %s',
             e.menu_item_id, e.channel_id,
             case when e.location_id is null then '' else ' / local '||e.location_id end,
             coalesce(e.expected_price_before::text, 'sin override'),
             case when e.expected_price_before is null
                  then 'un override de ' || coalesce((
                         select mio.price::text from menu_item_override mio
                          where mio.menu_item_id = e.menu_item_id
                            and coalesce(mio.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                                = coalesce(e.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                            and coalesce(mio.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                = coalesce(e.location_id, '00000000-0000-0000-0000-000000000000'::uuid)), '?')
                  else effective_price(e.menu_item_id, e.channel_id, e.location_id)::text
             end) as txt
    from jsonb_to_recordset(p_entries)
         as e(menu_item_id uuid, channel_id uuid, location_id uuid,
              action text, price numeric, expected_price_before numeric)
    where
      case when e.expected_price_before is null then
        exists (select 1 from menu_item_override mio
                 where mio.menu_item_id = e.menu_item_id
                   and coalesce(mio.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                       = coalesce(e.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                   and coalesce(mio.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                       = coalesce(e.location_id, '00000000-0000-0000-0000-000000000000'::uuid))
      else
        abs(coalesce(effective_price(e.menu_item_id, e.channel_id, e.location_id), -999999)
            - e.expected_price_before) > 0.005
      end
  ) c;
  if v_bad is not null then
    raise exception E'La carta cambio por debajo: % celda(s) en conflicto. No se ha escrito NADA.\n%',
      (length(v_bad) - length(replace(v_bad, E'\n', ''))) + 1, v_bad;
  end if;

  -- ── C.4 escritura: una sola transaccion ───
  -- El operation_id viaja por GUC LOCAL a la transaccion: se limpia solo.
  perform set_config('folvy.operation_id', v_op_id::text, true);

  insert into price_operation (id, account_id, kind, actor, scope, entries_count, writes_count, note)
  values (v_op_id, p_account_id, 'bulk_price', auth.uid(), p_scope, v_n, 0, p_note);

  for r in
    select e.menu_item_id, e.channel_id, e.location_id,
           coalesce(e.action,'set') as action, e.price
    from jsonb_to_recordset(p_entries)
         as e(menu_item_id uuid, channel_id uuid, location_id uuid,
              action text, price numeric, expected_price_before numeric)
  loop
    if r.action = 'clear' then
      delete from menu_item_override
       where menu_item_id = r.menu_item_id
         and coalesce(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.location_id, '00000000-0000-0000-0000-000000000000'::uuid);
    else
      -- OJO (desviacion consciente del encargo, ver informe): en el DO UPDATE
      -- NO se toca is_available. Esta operacion es de PRECIO; si copiara el
      -- is_available del INSERT (true) borraria los 86 manuales de golpe.
      insert into menu_item_override (account_id, menu_item_id, channel_id, location_id, price, is_available)
      values (p_account_id, r.menu_item_id, r.channel_id, r.location_id, r.price, true)
      on conflict (menu_item_id,
                   coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   coalesce(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid))
      do update set price = excluded.price, updated_at = now();
    end if;
  end loop;

  select count(*) into v_writes
    from menu_item_override_history where operation_id = v_op_id;
  update price_operation set writes_count = v_writes where id = v_op_id;

  return v_op_id;
end;
$$;

revoke all on function public.apply_price_operation(uuid, jsonb, jsonb, text) from anon;
grant execute on function public.apply_price_operation(uuid, jsonb, jsonb, text) to authenticated;

-- ── D · revert_price_operation ───
-- Deshace escribiendo una operacion NUEVA. No borra historial jamas.
create or replace function public.revert_price_operation(p_operation_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_op      price_operation%rowtype;
  v_new_id  uuid := gen_random_uuid();
  v_bad     text;
  v_n       int;
  v_writes  int;
  r         record;
begin
  select * into v_op from price_operation where id = p_operation_id;
  if not found then
    raise exception 'Operacion % no encontrada', p_operation_id;
  end if;

  if not (current_user_is_admin() or current_user_is_admin_or_manager_of(v_op.account_id)) then
    raise exception 'Sin permiso para deshacer operaciones de esta cuenta';
  end if;

  if v_op.kind = 'revert' then
    raise exception 'No se puede deshacer un deshacer (operacion % es kind=revert)', p_operation_id;
  end if;

  if exists (select 1 from price_operation where reverted_operation_id = p_operation_id) then
    raise exception 'La operacion % ya fue deshecha', p_operation_id;
  end if;

  select count(*) into v_n
    from menu_item_override_history where operation_id = p_operation_id;
  if v_n = 0 then
    raise exception 'La operacion % no tiene cambios que deshacer', p_operation_id;
  end if;

  -- ── conflicto: el estado actual tiene que ser EXACTAMENTE el que dejo la
  -- operacion. Si alguien toco una celda despues, se aborta entera: deshacer a
  -- medias es peor que no deshacer.
  select string_agg(txt, E'\n') into v_bad from (
    select format('  %s / canal %s%s: la operacion dejo %s, ahora hay %s',
             h.menu_item_id, h.channel_id,
             case when h.location_id is null then '' else ' / local '||h.location_id end,
             case when h.op = 'delete' then 'sin override' else coalesce(h.price_after::text,'null') end,
             coalesce((select mio.price::text from menu_item_override mio
                        where mio.menu_item_id = h.menu_item_id
                          and coalesce(mio.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                              = coalesce(h.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                          and coalesce(mio.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                              = coalesce(h.location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                      'sin override')) as txt
    from menu_item_override_history h
    where h.operation_id = p_operation_id
      and case
            when h.op = 'delete' then
              exists (select 1 from menu_item_override mio
                       where mio.menu_item_id = h.menu_item_id
                         and coalesce(mio.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                             = coalesce(h.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                         and coalesce(mio.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                             = coalesce(h.location_id, '00000000-0000-0000-0000-000000000000'::uuid))
            else
              not exists (select 1 from menu_item_override mio
                           where mio.menu_item_id = h.menu_item_id
                             and coalesce(mio.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                                 = coalesce(h.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                             and coalesce(mio.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                 = coalesce(h.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
                             and mio.price IS NOT DISTINCT FROM h.price_after
                             and mio.is_available IS NOT DISTINCT FROM h.is_available_after)
          end
  ) c;
  if v_bad is not null then
    raise exception E'Alguien toco estas celdas despues de la operacion. No se ha deshecho NADA.\n%', v_bad;
  end if;

  -- ── restaurar bajo un operation_id NUEVO ───
  perform set_config('folvy.operation_id', v_new_id::text, true);

  insert into price_operation (id, account_id, kind, actor, scope, entries_count, writes_count,
                               reverted_operation_id, note)
  values (v_new_id, v_op.account_id, 'revert', auth.uid(),
          jsonb_build_object('deshace', p_operation_id, 'scope_original', v_op.scope),
          v_n, 0, p_operation_id,
          format('Deshace la operacion %s', p_operation_id));

  for r in
    select * from menu_item_override_history
     where operation_id = p_operation_id
     order by changed_at desc, id desc
  loop
    if r.op = 'insert' then
      -- antes no existia: se borra
      delete from menu_item_override
       where menu_item_id = r.menu_item_id
         and coalesce(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.location_id, '00000000-0000-0000-0000-000000000000'::uuid);

    elsif r.op = 'update' then
      update menu_item_override
         set price = r.price_before, is_available = r.is_available_before
       where menu_item_id = r.menu_item_id
         and coalesce(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(r.location_id, '00000000-0000-0000-0000-000000000000'::uuid);

    else -- 'delete': se vuelve a crear tal como estaba
      insert into menu_item_override (account_id, menu_item_id, channel_id, location_id, price, is_available)
      values (r.account_id, r.menu_item_id, r.channel_id, r.location_id, r.price_before, r.is_available_before);
    end if;
  end loop;

  select count(*) into v_writes
    from menu_item_override_history where operation_id = v_new_id;
  update price_operation set writes_count = v_writes where id = v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.revert_price_operation(uuid) from anon;
grant execute on function public.revert_price_operation(uuid) to authenticated;
