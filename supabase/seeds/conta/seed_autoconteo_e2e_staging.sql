-- ============================================================================
-- AUTOCONTEO · La e2e de la tablet y de la pantalla de conteos. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/inventario/autoconteo.spec.ts (encargo de Julio del 21/10):
--
--   a.trabajador@prueba.folvy.test · cuenta A · rol `worker` · «Trabajador de
--   Prueba», con su ficha de empleado en Taberna de Prueba Norte · Centro (a2).
--   Es quien entra en la tablet y ve «Conteo». La contraseña no vive aquí: el
--   carril le pone la de un solo uso de cada ejecución, como a los demás
--   (scripts/e2e/carril/comun.sql lo lleva en la lista de la plantilla).
--
--   Tres artículos de la cuenta A con stock de partida (10, 20 y 30 ud), solo
--   para esta e2e: así sus cifras no dependen de ninguna otra prueba.
--
--   e2e_autoconteo_preparar(p_caso): la prueba no tiene la clave de servicio,
--   y el autoconteo de cada ejecución tiene que ser «de hoy». Esta función —que
--   SOLO existe en staging, por esta semilla, y no está en ninguna migración—
--   se la deja preparar al administrador de A (el de la plantilla o el de su
--   carril), y solo en SU cuenta:
--     · 'hoy'     anula los autoconteos abiertos del local y crea el de hoy,
--                 con los tres artículos asignados al trabajador;
--     · 'fallido' crea uno de ayer con un artículo contado y el fallo de la
--                 noche apuntado (lo que avisa la pantalla de inventario).
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta la
-- cuenta A o su local. Se puede volver a aplicar.
-- ============================================================================

do $$
declare
  a_cuenta    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_local     constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  a_trab      constant uuid := 'c01a0000-0000-4000-8000-0000000000a7';
  a_empleado  constant uuid := 'c01a0000-0000-4000-8000-0000000000e7';
  u_ud        constant uuid := 'c1b0a000-0000-4000-8000-000000000104';
  correo      constant text := 'a.trabajador@prueba.folvy.test';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla del autoconteo ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.locations where id = a_local and account_id = a_cuenta) then
    raise exception 'Semilla del autoconteo: falta el local Norte · Centro de la cuenta A.';
  end if;

  insert into public.employees (id, account_id, name, active, location_id)
  values (a_empleado, a_cuenta, 'Trabajador de Prueba', true, a_local)
  on conflict (id) do nothing;

  if not exists (select 1 from auth.users where id = a_trab) then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', a_trab, 'authenticated', 'authenticated', correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (a_trab::text, a_trab, jsonb_build_object('sub', a_trab::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());
  end if;
  if not exists (select 1 from public.user_profiles where user_id = a_trab) then
    insert into public.user_profiles (user_id, account_id, role, active, display_name, employee_id, terms_accepted_at, welcome_completed_at)
    values (a_trab, a_cuenta, 'worker', true, 'Trabajador de Prueba', a_empleado, now(), now());
  end if;

  insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_stockable, cost_strategy, fixed_cost) values
    ('a7c10000-0000-4000-8000-000000000001', a_cuenta, 'raw', 'Latas de cola (prueba de autoconteo)',       u_ud, true, 'fixed', 0.45),
    ('a7c10000-0000-4000-8000-000000000002', a_cuenta, 'raw', 'Pan de hamburguesa (prueba de autoconteo)', u_ud, true, 'fixed', 0.30),
    ('a7c10000-0000-4000-8000-000000000003', a_cuenta, 'raw', 'Bolsas de papel (prueba de autoconteo)',    u_ud, true, 'fixed', 0.08)
  on conflict (id) do nothing;

  -- El stock de partida, una vez (10, 20 y 30 ud), hace una semana.
  insert into public.stock_movement (account_id, location_id, recipe_item_id, movement_type, qty_base, unit_cost, cost_provisional, source_type, occurred_at, created_by_name, notes)
  select a_cuenta, a_local, x.id, 'ajuste', x.n, x.c, false, 'adjustment', now() - interval '7 days', 'semilla autoconteo e2e', 'stock de partida de la e2e del autoconteo'
    from (values ('a7c10000-0000-4000-8000-000000000001'::uuid, 10, 0.45),
                 ('a7c10000-0000-4000-8000-000000000002'::uuid, 20, 0.30),
                 ('a7c10000-0000-4000-8000-000000000003'::uuid, 30, 0.08)) x(id, n, c)
   where not exists (select 1 from public.stock_movement m where m.recipe_item_id = x.id and m.location_id = a_local and m.created_by_name = 'semilla autoconteo e2e');
  perform public.recompute_location_stock_core(x, a_local)
     from unnest(array['a7c10000-0000-4000-8000-000000000001', 'a7c10000-0000-4000-8000-000000000002', 'a7c10000-0000-4000-8000-000000000003']::uuid[]) x;

  raise notice 'Semilla del autoconteo OK: % (worker con ficha en Norte · Centro) y tres artículos con 10, 20 y 30 ud.', correo;
end $$;

create or replace function public.e2e_autoconteo_preparar(p_caso text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Los ids de la plantilla con el segundo grupo a 0000: el del carril lo lleva
  -- con su número (scripts/e2e/carril/comun.sql, en_carril), así que se compara así.
  v_acc uuid;
  v_loc uuid;
  v_emp uuid;
  v_count uuid;
  v_linea uuid;
  r record;
  i int := 0;
  plantilla constant text := '0000';
begin
  if auth.uid() is null
     or overlay(auth.uid()::text placing plantilla from 10 for 4) <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'Solo el administrador de la cuenta A de prueba.' using errcode = '42501';
  end if;
  select up.account_id into v_acc from public.user_profiles up where up.user_id = auth.uid() and up.active limit 1;
  if v_acc is null or overlay(v_acc::text placing plantilla from 10 for 4) <> 'c01a0000-0000-4000-8000-00000000000a' then
    raise exception 'El administrador de prueba no está en la cuenta A.' using errcode = '42501';
  end if;
  select id into v_loc from public.locations
   where account_id = v_acc and overlay(id::text placing plantilla from 10 for 4) = 'c01a0000-0000-4000-8000-0000000000a2';
  select id into v_emp from public.employees
   where account_id = v_acc and overlay(id::text placing plantilla from 10 for 4) = 'c01a0000-0000-4000-8000-0000000000e7';
  if v_loc is null or v_emp is null then
    raise exception 'Falta el local o el trabajador de prueba en esta cuenta (seed_autoconteo_e2e_staging.sql).';
  end if;

  if p_caso = 'hoy' then
    -- Que la tablet coja ESTE: los autoconteos abiertos del local, anulados.
    update public.inventory_count set status = 'anulado', updated_at = now(),
           notes = concat_ws(E'\n', notes, 'Anulado por la e2e del autoconteo (otro de hoy).')
     where account_id = v_acc and location_id = v_loc and kind = 'cycle' and status in ('abierto', 'contando', 'en_revision');
    -- El stock de partida otra vez (10, 20 y 30 ud): la pasada de móvil corre
    -- después de la de ordenador en el mismo carril, con su ajuste ya hecho.
    for r in
      select ri.id, (array[10, 20, 30])[right(overlay(ri.id::text placing plantilla from 10 for 4), 1)::int] as objetivo,
             (select coalesce(sum(qty_base), 0) from public.stock_movement m where m.recipe_item_id = ri.id and m.location_id = v_loc) as hay
        from public.recipe_item ri
       where ri.account_id = v_acc and overlay(ri.id::text placing plantilla from 10 for 4) like 'a7c10000-0000-4000-8000-00000000000_'
    loop
      if r.objetivo <> r.hay then
        insert into public.stock_movement (account_id, location_id, recipe_item_id, movement_type, qty_base, cost_provisional, source_type, occurred_at, created_by_name, notes)
        values (v_acc, v_loc, r.id, 'ajuste', r.objetivo - r.hay, false, 'adjustment', now() - interval '1 minute', 'e2e autoconteo', 'vuelve al stock de partida de la e2e');
        perform public.recompute_location_stock(r.id, v_loc);
      end if;
    end loop;
    insert into public.inventory_count (account_id, location_id, kind, status, started_at, created_by_name)
    values (v_acc, v_loc, 'cycle', 'contando', now(), 'e2e autoconteo')
    returning id into v_count;
    for r in
      select ri.id from public.recipe_item ri
       where ri.account_id = v_acc and overlay(ri.id::text placing plantilla from 10 for 4) like 'a7c10000-0000-4000-8000-00000000000_'
       order by ri.id
    loop
      i := i + 1;
      insert into public.inventory_count_line (account_id, inventory_count_id, recipe_item_id, system_qty, position, assigned_to)
      values (v_acc, v_count, r.id,
              (select coalesce(sum(qty_base), 0) from public.stock_movement m where m.recipe_item_id = r.id and m.location_id = v_loc),
              i, v_emp);
    end loop;
  elsif p_caso = 'fallido' then
    insert into public.inventory_count (account_id, location_id, kind, status, started_at, created_at, created_by_name)
    values (v_acc, v_loc, 'cycle', 'contando', now() - interval '30 hours', now() - interval '30 hours', 'e2e autoconteo')
    returning id into v_count;
    select ri.id into r from public.recipe_item ri
     where ri.account_id = v_acc and overlay(ri.id::text placing plantilla from 10 for 4) = 'a7c10000-0000-4000-8000-000000000002';
    insert into public.inventory_count_line (account_id, inventory_count_id, recipe_item_id, system_qty, position, assigned_to)
    values (v_acc, v_count, r.id,
            (select coalesce(sum(qty_base), 0) from public.stock_movement m where m.recipe_item_id = r.id and m.location_id = v_loc), 1, v_emp)
    returning id into v_linea;
    -- Contado por la puerta, como lo cuenta la tablet (el disparador no deja otra).
    perform public.save_count_line(v_linea, jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', 18)), null, null, null);
    update public.inventory_count
       set auto_apply_error = 'canceling statement due to lock timeout (fallo de prueba de la e2e)',
           auto_apply_failed_at = now() - interval '1 hour'
     where id = v_count;
  else
    raise exception 'Caso desconocido: % (hoy | fallido)', p_caso;
  end if;

  return jsonb_build_object('count_id', v_count, 'code', (select code from public.inventory_count where id = v_count));
end;
$$;

revoke execute on function public.e2e_autoconteo_preparar(text) from public, anon;
grant execute on function public.e2e_autoconteo_preparar(text) to authenticated;
