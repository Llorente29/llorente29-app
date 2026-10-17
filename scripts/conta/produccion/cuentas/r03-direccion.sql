-- scripts/conta/produccion/cuentas/r03-direccion.sql
--
-- R03 · LO QUE CUENTA LA TANDA DE LA DIRECCIÓN QUE NO LLEGA (20261118T0300,
-- T0310 y T0320), antes y después. Lo declara el manifiesto («cuenta: <este
-- fichero>») y lo comparan deshacer.sh y el ensayo de la vuelta atrás: tras
-- deshacer, todo tiene que salir como antes. SOLO LEE.
--
-- Solo estructura (huellas, columnas, funciones y disparadores): los pedidos
-- entran mientras corre la tanda, así que un recuento de pedidos no sale igual
-- antes y después aunque nada se haya roto. Ningún dato de cliente.
select clave, valor from (
  select 1 o, 'huella de resolve_dispatch (la vuelta atrás la deja en 9d645a51…)' clave, (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.resolve_dispatch(uuid)')) valor union all
  select 2, 'huella de orders_feed', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.orders_feed(uuid)')) union all
  select 3, 'huella de orders_feed_by_token', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.orders_feed_by_token(text)')) union all
  select 4, 'huella de order_for_print', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.order_for_print(text,uuid)')) union all
  select 5, 'firmas de las cuatro (sin sobrecargas)', (select count(*) from pg_proc where proname in ('resolve_dispatch', 'orders_feed', 'orders_feed_by_token', 'order_for_print') and pronamespace = 'public'::regnamespace)::text union all
  select 6, 'columnas nuevas de sale', (select coalesce(string_agg(column_name, ' · ' order by column_name), 'ninguna') from information_schema.columns
      where table_schema = 'public' and table_name = 'sale'
        and column_name in ('delivery_address_fixed', 'delivery_address_fixed_at', 'delivery_address_fixed_by', 'delivery_address_origin',
                            'delivery_by_reason', 'customer_phone_code', 'delivery_instructions', 'order_customer_note')) union all
  select 7, 'funciones nuevas', concat_ws(' · ',
      'fijar_direccion_entrega ' || (to_regprocedure('public.fijar_direccion_entrega(uuid,text,text)') is not null)::text,
      'pedidos_sin_direccion ' || (to_regprocedure('public.pedidos_sin_direccion(uuid,text)') is not null)::text,
      'sale_coordenadas_de_entrega_by_token ' || (to_regprocedure('public.sale_coordenadas_de_entrega_by_token(text,uuid)') is not null)::text,
      'decidir_quien_reparte ' || exists (select 1 from pg_proc where proname = 'decidir_quien_reparte' and pronamespace = 'public'::regnamespace)::text,
      'sale_entrega_desde_raw ' || exists (select 1 from pg_proc where proname = 'sale_entrega_desde_raw' and pronamespace = 'public'::regnamespace)::text,
      'uber_senales_de_reparto ' || exists (select 1 from pg_proc where proname = 'uber_senales_de_reparto' and pronamespace = 'public'::regnamespace)::text) union all
  select 8, 'disparadores nuevos en sale', (select coalesce(string_agg(tgname, ' · ' order by tgname), 'ninguno') from pg_trigger
      where tgrelid = 'public.sale'::regclass and not tgisinternal and tgname in ('trg_sale_entrega_desde_raw', 'trg_sale_tipo_uber_quien_reparte')) union all
  select 9, 'tabla del relleno de la 0320', (to_regclass('public.r03_entrega_relleno') is not null)::text union all
  select 10, 'anon sobre sale_coordenadas_de_entrega (tiene que ser false)', coalesce((select has_function_privilege('anon', 'public.sale_coordenadas_de_entrega(uuid)', 'execute'))::text, 'sin la función')
) t order by o;
