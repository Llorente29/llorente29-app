-- supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
--
-- SOLO STAGING. Prueba de la S1b del TPV de sala
-- (20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql), corregida el 01/11
-- para que se pueda pasar dos veces. Con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. Nombra lo que cambia: public.sale,
-- public.sale_line, public.sale_fire, public.sale_line_void,
-- public.tg_auto_print_on_accept, public.upsert_pos_sale, public.pos_open_sales,
-- public.order_for_print y las funciones nuevas (public.pos_floor,
-- public.pos_table_open, public.pos_table_detail, public.pos_table_add_lines,
-- public.pos_table_set_pending_qty, public.pos_table_remove_pending_line,
-- public.pos_table_fire, public.pos_void_reasons, public.pos_table_void_line,
-- public.pos_table_request_bill, public.pos_table_charge, public.pos_table_clear,
-- public._pos_table_state, public._pos_table_assert_open,
-- public._pos_enqueue_print, public._pos_table_recalc_totals,
-- public._pos_insert_order_line, public._pos_device_for, public._pos_actor_name,
-- public._pos_table_sale, public._pos_sala_channel_id).
--
-- Staging ya tiene la S1b (aplicada sin registrar). La prueba:
--   0 · la foto de lo que hay (definiciones, columnas, CHECK, índices y
--       políticas de lo que toca la S1b). Y ROJO A PROPÓSITO: el trozo que la
--       S1b de antes buscaba en tg_auto_print_on_accept sigue apareciendo una
--       vez con ella aplicada, así que la de antes lo habría añadido dos veces.
--   1 · la S1b, primera pasada aquí. Cambian order_for_print, que ahora va
--       escrita con el texto de producción del 01/11, y las funciones de sala
--       que staging tenía en su versión de la S2 (mover y juntar, solo en una
--       rama sin fusionar); se dice.
--   2 · la S1b, segunda pasada: no cambia ninguna definición, columna, CHECK,
--       índice ni política.
--   3 · su vuelta atrás, después de dos pasadas: sin S1b (order_for_print con
--       dos parámetros, sin sale_fire ni sale_line_void ni las columnas nuevas).
-- Va fuera de la banda (00:30–12:15, reloj de Madrid), como la S1b y su vuelta
-- atrás: dentro, las dos paran solas.

-- sin usuario: es estructura (columnas, CHECK y funciones); lo que hacen las
-- funciones de sala con un usuario lo prueba la e2e del TPV.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S1b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- La foto: una fila por cosa, con su texto. Lo que toca la S1b y nada más.
create temp table _foto (paso int, cosa text, valor text) on commit drop;
create function pg_temp.foto(p int) returns void language sql as $f$
  insert into _foto
  select p, 'funcion ' || x.oid::regprocedure::text, md5(pg_get_functiondef(x.oid))
    from pg_proc x
   where x.pronamespace = 'public'::regnamespace
     and (x.proname in ('tg_auto_print_on_accept','upsert_pos_sale','pos_open_sales','order_for_print','pos_floor','pos_void_reasons')
          or x.proname like 'pos\_table\_%' or x.proname like '\_pos\_%')
  union all
  select p, 'permisos ' || x.oid::regprocedure::text, coalesce(x.proacl::text, '')
    from pg_proc x where x.pronamespace = 'public'::regnamespace and x.proname = 'order_for_print'
  union all
  select p, 'columna ' || c.table_name || '.' || c.column_name,
         c.data_type || ' ' || c.is_nullable || ' ' || coalesce(c.column_default, '')
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('sale','sale_line','sale_fire','sale_line_void')
  union all
  select p, 'restriccion ' || k.conrelid::regclass::text || '.' || k.conname, pg_get_constraintdef(k.oid)
    from pg_constraint k
   where k.conrelid in (select to_regclass(t) from unnest(array['public.sale','public.sale_line','public.sale_fire','public.sale_line_void']) t)
  union all
  select p, 'indice ' || i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid)
    from pg_index i
   where i.indrelid in (select to_regclass(t) from unnest(array['public.sale','public.sale_line','public.sale_fire','public.sale_line_void']) t)
  union all
  select p, 'politica ' || pol.tablename || '.' || pol.policyname, coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')
    from pg_policies pol where pol.schemaname = 'public' and pol.tablename in ('sale_fire','sale_line_void');
$f$;
-- Lo que cambia entre dos fotos, para el mensaje.
create function pg_temp.diferencias(a int, b int) returns text language sql as $f$
  select coalesce(string_agg(cosa, ', ' order by cosa), '') from (
    (select cosa, valor from _foto where paso = a except select cosa, valor from _foto where paso = b)
    union
    (select cosa, valor from _foto where paso = b except select cosa, valor from _foto where paso = a)) d;
$f$;

-- ── 0 · Lo que hay, y el rojo a propósito ───────────────────────────────────
do $$ begin
  if to_regprocedure('public.order_for_print(text,uuid,uuid)') is null then
    raise exception 'PRUEBA S1b · 0: staging no tiene la S1b aplicada: la prueba de «dos veces» no mediría nada.';
  end if;
end $$;
select pg_temp.foto(0);
do $$
declare c int;
begin
  select count(*) into c from regexp_matches(pg_get_functiondef('public.tg_auto_print_on_accept()'::regprocedure), '\n  if v_fire then\n', 'g');
  if c <> 1 then raise exception 'PRUEBA S1b · 0: el trozo que buscaba la S1b de antes aparece % veces: la prueba no mediría nada.', c; end if;
  raise notice 'S1b · 0 (rojo a propósito): con la S1b aplicada, su trozo de tg_auto_print_on_accept sigue apareciendo una vez: la de antes lo habría añadido dos veces (y habría parado en order_for_print, que ya no tiene la firma de dos).';
end $$;

-- ── 1 · Primera pasada ──────────────────────────────────────────────────────
\i supabase/migrations/20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql
select pg_temp.foto(1);
do $$ begin
  raise notice 'S1b · 1: primera pasada. Distinto de lo que había (order_for_print, ahora con el texto de producción del 01/11, y las funciones de sala que staging tenía en su versión de la S2, que solo está en una rama sin fusionar): %', coalesce(nullif(pg_temp.diferencias(0, 1), ''), 'nada');
end $$;

-- ── 2 · Segunda pasada: nada cambia ─────────────────────────────────────────
\i supabase/migrations/20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql
select pg_temp.foto(2);
do $$
declare d text := pg_temp.diferencias(1, 2);
begin
  if d <> '' then raise exception 'PRUEBA S1b · 2: la segunda pasada cambia: %', d; end if;
  raise notice 'S1b · 2: la segunda pasada no cambia ninguna definición, columna, CHECK, índice ni política (% cosas medidas).', (select count(*) from _foto where paso = 2);
end $$;

-- ── 3 · La vuelta atrás, después de dos pasadas ─────────────────────────────
\i supabase/vuelta-atras/20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.down.sql
do $$ begin
  if to_regprocedure('public.order_for_print(text,uuid)') is null or to_regprocedure('public.order_for_print(text,uuid,uuid)') is not null then
    raise exception 'PRUEBA S1b · 3: después de la vuelta atrás, order_for_print no tiene la firma de dos.';
  end if;
  if to_regclass('public.sale_fire') is not null or to_regclass('public.sale_line_void') is not null then
    raise exception 'PRUEBA S1b · 3: después de la vuelta atrás quedan sale_fire o sale_line_void.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'sale' and column_name in ('table_id','covers','served_by','served_by_name','bill_requested_at','table_cleared_at'))
                or (table_name = 'sale_line' and column_name in ('fire_id','voided_at')))) then
    raise exception 'PRUEBA S1b · 3: después de la vuelta atrás quedan columnas de la S1b.';
  end if;
  if pg_get_functiondef('public.tg_auto_print_on_accept()'::regprocedure) like '%TPV sala (S1)%' then
    raise exception 'PRUEBA S1b · 3: después de la vuelta atrás tg_auto_print_on_accept sigue con la regla de la mesa.';
  end if;
  raise notice 'S1b · 3: la vuelta atrás, después de dos pasadas, deja la base sin S1b.';
end $$;

rollback;
