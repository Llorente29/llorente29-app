-- supabase/staging/sql/20261101_dm1_disparadores_restaurar_prueba.sql
--
-- SOLO STAGING. Prueba de la 0024 (DM1 · 2b-1: los disparadores se apartan
-- mientras se restaura una demo), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. Nombra lo que cambia: public._restaurando_demo y las 62
-- funciones de disparador que lista la migración (la prueba las recorre todas
-- desde public.funcion_respaldo), entre ellas public.tg_ensure_public_token,
-- public.tg_sale_consumption_on_complete, public.tg_sale_line_consumption,
-- public.trg_sale_push_status y public.tg_auto_dispatch.
--
-- Las 62, una por línea (las recorre el paso 3 desde public.funcion_respaldo):
--   public._clock_entry_audit_alta()
--   public._clock_entry_quien_y_hora()
--   public._employee_pin_guardar()
--   public._f01c_receta_puesta()
--   public._fill_acc_from_assignment()
--   public._fill_acc_from_employee()
--   public._fill_acc_from_location()
--   public._menu_item_price_snapshot()
--   public._pc01e2_proveedor_iban_cambiado()
--   public._registro_firma_invalidar()
--   public._ticket_tras_venta()
--   public._trg_recipe_item_purchase_format_immutable()
--   public.company_account_link_sin_dueno()
--   public.party_al_borrar_proveedor()
--   public.party_desde_proveedor()
--   public.party_misma_cuenta()
--   public.recipe_line_prevent_cycle()
--   public.set_folvy_code()
--   public.set_goods_receipt_code()
--   public.set_inventory_count_code()
--   public.set_updated_at()
--   public.supplier_tax_rates_ok()
--   public.tg_auto_dispatch()
--   public.tg_auto_print_bag_on_ready()
--   public.tg_auto_print_on_accept()
--   public.tg_clock_entry_audit()
--   public.tg_clock_entry_debounce()
--   public.tg_clock_entry_orden()
--   public.tg_count_line_sella_el_motivo()
--   public.tg_count_line_solo_por_la_puerta()
--   public.tg_dining_table_same_location()
--   public.tg_ensure_public_token()
--   public.tg_goods_receipt_compras_camino()
--   public.tg_goods_receipt_line_trust()
--   public.tg_goods_receipt_recompute_average()
--   public.tg_inventory_count_line_sanity()
--   public.tg_menu_item_inherit_stock_group()
--   public.tg_menu_item_override_history()
--   public.tg_menu_item_override_touch()
--   public.tg_modifier_option_retiro()
--   public.tg_notify_on_way_sale()
--   public.tg_ripf_invalida_revision()
--   public.tg_sale_close_on_complete()
--   public.tg_sale_consumption_on_complete()
--   public.tg_sale_delivery_alarm()
--   public.tg_sale_entrega_desde_raw()
--   public.tg_sale_line_consumption()
--   public.tg_sale_seal_delivered()
--   public.tg_sale_seal_handed_to_courier()
--   public.tg_sale_seal_kpi_hitos()
--   public.tg_sale_service_type_por_interruptor()
--   public.tg_sale_uber_quien_reparte()
--   public.tg_sales_hourly_agg_sync()
--   public.tg_schedule_reject_vacation_conflicts()
--   public.tg_training_notice_on_assign()
--   public.trg_article_supplier_recompute_cost()
--   public.trg_assign_onboarding_training_on_employee_insert()
--   public.trg_assign_onboarding_training_on_employee_update()
--   public.trg_propose_vat_on_family()
--   public.trg_sale_push_status()
--   public.trg_seal_recipe_version_item()
--   public.trg_seal_recipe_version_line()
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás. Y ROJO A PROPÓSITO:
--       con los disparadores de antes, aunque el ajuste folvy.restaurando_demo
--       esté puesto, una venta de reparto propio sale con su token público
--       (tg_ensure_public_token). Si no, la prueba no mediría nada.
--   1 · recién aplicada.
--   2 · con el ajuste apagado, la venta sale con su token (igual que antes);
--       con el ajuste puesto, sale sin él: el disparador no ha hecho nada.
--   3 · las 62, byte a byte: quitando la línea de la guarda, cada una es la de
--       antes (la del respaldo). Con el ajuste apagado no cambia nada.
--   4 · un usuario de la app (authenticated) puede llamar a _restaurando_demo,
--       que es lo que hace cada disparador cuando escribe: si no pudiera, toda
--       escritura de la app fallaría. Con el ajuste apagado, falso.
--   5 · la vuelta atrás: las 62 byte a byte como estaban y sin _restaurando_demo.

-- sin usuario: los disparadores saltan con quien escribe la fila (la app, las
-- tareas programadas, las funciones del servidor). El paso 4 prueba el del
-- usuario de la app; el resto, como la base.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 2b-1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _s (clave text primary key, v text) on commit drop;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'),
  ('migracion', '20261101T0024_dm1_disparadores_restaurar'),
  ('guarda', E'  -- DM1 · 2b-1: mientras se restaura una demo, nada (la foto ya lo trae hecho).\n  if public._restaurando_demo() then return coalesce(new, old); end if;\n');

-- Una venta de reparto propio de A, cancelada (que no la recoja ningún proceso), y su token.
create function pg_temp.token_de_una_venta() returns text language plpgsql as $f$
declare v_id uuid; v_t text;
begin
  insert into public.sale (account_id, sold_at, source, status, service_type)
  values ((select v::uuid from _s where clave = 'a'), now(), 'import', 'cancelled', 'own_delivery')
  returning id, public_token into v_id, v_t;
  delete from public.sale where id = v_id;
  return v_t;
end $f$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261101T0024_dm1_disparadores_restaurar') as dm1_2b1_aplicada \gset
\if :dm1_2b1_aplicada
\i supabase/vuelta-atras/20261101T0024_dm1_disparadores_restaurar.down.sql
\endif
select set_config('folvy.restaurando_demo', 'on', true);
do $$ begin
  if pg_temp.token_de_una_venta() is null then
    raise exception 'PRUEBA DM1 2b-1 · 0: con los disparadores de antes la venta sale sin token: la prueba no mediría nada.';
  end if;
  raise notice 'DM1 2b-1 · 0 (rojo a propósito): con los disparadores de antes, aunque se esté restaurando, la venta sale con su token.';
end $$;
select set_config('folvy.restaurando_demo', '', true);

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261101T0024_dm1_disparadores_restaurar.sql

-- ── 2 · Apagado, como antes; puesto, no hace nada ───────────────────────────
do $$ begin
  if public._restaurando_demo() then raise exception 'PRUEBA DM1 2b-1 · 2: _restaurando_demo dice que sí sin el ajuste puesto.'; end if;
  if pg_temp.token_de_una_venta() is null then
    raise exception 'PRUEBA DM1 2b-1 · 2: con el ajuste apagado, la venta sale sin token: el disparador ya no hace lo de antes.';
  end if;
  perform set_config('folvy.restaurando_demo', 'on', true);
  if pg_temp.token_de_una_venta() is not null then
    raise exception 'PRUEBA DM1 2b-1 · 2: restaurando, la venta sale con token: el disparador no se ha apartado.';
  end if;
  perform set_config('folvy.restaurando_demo', '', true);
  raise notice 'DM1 2b-1 · 2: apagado, la venta sale con su token como antes; restaurando, sin él.';
end $$;

-- ── 3 · Las 62, byte a byte con la de antes, quitando la guarda ─────────────
do $$
declare r record; n int := 0;
begin
  for r in select firma, definicion from public.funcion_respaldo where migracion = (select v from _s where clave = 'migracion') loop
    n := n + 1;
    if replace(pg_get_functiondef(r.firma::regprocedure), (select v from _s where clave = 'guarda'), '') <> r.definicion then
      raise exception 'PRUEBA DM1 2b-1 · 3: % no es la de antes más la guarda.', r.firma;
    end if;
    if pg_get_functiondef(r.firma::regprocedure) not like '%' || (select v from _s where clave = 'guarda') || '%' then
      raise exception 'PRUEBA DM1 2b-1 · 3: % no lleva la guarda.', r.firma;
    end if;
  end loop;
  if n <> 62 then raise exception 'PRUEBA DM1 2b-1 · 3: se esperaban 62 funciones respaldadas y hay %.', n; end if;
  raise notice 'DM1 2b-1 · 3: las 62 son la de antes, byte a byte, más la línea de la guarda.';
end $$;

-- ── 4 · Un usuario de la app puede llamarla ─────────────────────────────────
set local role authenticated;
select public._restaurando_demo() as restaurando_como_usuario \gset
reset role;
\if :restaurando_como_usuario
do $$ begin raise exception 'PRUEBA DM1 2b-1 · 4: como usuario de la app, _restaurando_demo dice «sí» con el ajuste apagado.'; end $$;
\endif
do $$ begin raise notice 'DM1 2b-1 · 4: un usuario de la app la puede llamar, y con el ajuste apagado dice que no.'; end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
create temp table _nuevas on commit drop as
  select firma, definicion from public.funcion_respaldo where migracion = (select v from _s where clave = 'migracion');
\i supabase/vuelta-atras/20261101T0024_dm1_disparadores_restaurar.down.sql
do $$
declare r record;
begin
  for r in select firma, definicion from _nuevas loop
    if pg_get_functiondef(r.firma::regprocedure) <> r.definicion then
      raise exception 'PRUEBA DM1 2b-1 · 5: la vuelta atrás no deja % como estaba.', r.firma;
    end if;
  end loop;
  if to_regprocedure('public._restaurando_demo()') is not null then raise exception 'PRUEBA DM1 2b-1 · 5: _restaurando_demo sigue.'; end if;
  raise notice 'DM1 2b-1 · 5: la vuelta atrás deja las 62 byte a byte como estaban y quita _restaurando_demo.';
end $$;

rollback;
