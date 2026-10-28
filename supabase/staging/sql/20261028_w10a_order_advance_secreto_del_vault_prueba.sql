-- supabase/staging/sql/20261028_w10a_order_advance_secreto_del_vault_prueba.sql
--
-- SOLO STAGING. Prueba de la 1630 del W10a (trg_sale_push_status lee el
-- secreto de order-advance del Vault), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia y nada sale a la red (pg_net solo manda lo que
-- se confirma).
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás; la huella de la
--       función y la dirección a la que llama, para compararlas.
--   1 · aplicar: ningún secreto escrito en la función; lo lee del Vault; la
--       dirección, la misma de antes (eso es el W10b).
--   2 · el camino de verdad: una venta de Last que cambia de estado.
--       a) sin order_advance_secret en el Vault (como está staging): no llama,
--          deja el aviso y la venta se guarda;
--       b) con un secreto de prueba (solo dentro de esta transacción): una
--          llamada, a la misma dirección de antes y con ese secreto.
--   3 · una sola firma.
--   4 · la vuelta atrás: la huella de antes.
--
-- sin usuario: trg_sale_push_status es SECURITY DEFINER y corre como su dueño
-- sea quien sea quien cambie el pedido (la cocina, el repartidor, un webhook);
-- lo único que cambia es de dónde lee el secreto, y eso no depende de quién.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA W10a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T1630_w10a_order_advance_secreto_del_vault') as w10a_aplicada \gset
\if :w10a_aplicada
\i supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql
\endif
select set_config('w10a.huella', md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), true);
select set_config('w10a.url', (regexp_match(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure), 'url\s*:=\s*''([^'']+)'''))[1], true);
do $$ begin
  if current_setting('w10a.url', true) is null or current_setting('w10a.url') !~ '/functions/v1/order-advance$' then
    raise exception 'PRUEBA W10a · 0: no encuentro la dirección de order-advance en la función.';
  end if;
  raise notice '0 · lo de antes: la huella y la dirección de trg_sale_push_status, medidas';
end $$;

-- ── 1 · Aplicar ─────────────────────────────────────────────────────────────
\i supabase/migrations/20261028T1630_w10a_order_advance_secreto_del_vault.sql
do $$
declare v_def text := pg_get_functiondef('public.trg_sale_push_status()'::regprocedure);
begin
  if v_def ~ 'fv_[A-Za-z0-9]+_[A-Za-z0-9]{16,}' then raise exception 'PRUEBA W10a · 1: sigue con el secreto escrito.'; end if;
  if v_def !~ 'from vault\.decrypted_secrets where name = ''order_advance_secret''' then raise exception 'PRUEBA W10a · 1: no lee el secreto del Vault.'; end if;
  if (regexp_match(v_def, 'url\s*:=\s*''([^'']+)'''))[1] is distinct from current_setting('w10a.url') then
    raise exception 'PRUEBA W10a · 1: ha cambiado la dirección (eso es el W10b).';
  end if;
  raise notice '1 · aplicar: sin secreto escrito, lo lee del Vault y llama a la misma dirección';
end $$;

-- ── 2 · El camino de verdad: una venta de Last que cambia de estado ─────────
select set_config('w10a.cola', coalesce(max(id), 0)::text, true) from net.http_request_queue;
select set_config('w10a.venta', id::text, true) from public.sale where source = 'lastapp' order by created_at limit 1;
do $$ begin
  if coalesce(current_setting('w10a.venta', true), '') = '' then raise exception 'PRUEBA W10a · 2: staging no tiene ninguna venta de Last.'; end if;
  if exists (select 1 from vault.decrypted_secrets where name = 'order_advance_secret') then
    raise exception 'PRUEBA W10a · 2: staging tiene order_advance_secret; la prueba a) supone que no.';
  end if;
end $$;
update public.sale set order_status = 'in_preparation' where id = current_setting('w10a.venta')::uuid;
do $$
declare v_n int;
begin
  select count(*) into v_n from net.http_request_queue
   where id > current_setting('w10a.cola')::bigint and url like '%/functions/v1/order-advance';
  if v_n <> 0 then raise exception 'PRUEBA W10a · 2a: sin secreto no tiene que salir ninguna llamada y salen %.', v_n; end if;
  if not exists (select 1 from public.system_alert_queue where subject = 'Sin llamar a order-advance: falta order_advance_secret en el Vault') then
    raise exception 'PRUEBA W10a · 2a: no ha quedado el aviso en system_alert_queue.';
  end if;
  if not exists (select 1 from public.sale where id = current_setting('w10a.venta')::uuid and order_status = 'in_preparation') then
    raise exception 'PRUEBA W10a · 2a: la venta no se ha guardado.';
  end if;
  raise notice '2a · sin secreto en el Vault: ninguna llamada, el aviso y la venta guardada';
end $$;

select vault.create_secret('secreto-de-prueba-w10a', 'order_advance_secret') is not null as w10a_secreto;
update public.sale set order_status = 'awaiting_collection' where id = current_setting('w10a.venta')::uuid;
do $$
declare r record; v_n int;
begin
  select count(*) into v_n from net.http_request_queue
   where id > current_setting('w10a.cola')::bigint and url like '%/functions/v1/order-advance';
  if v_n <> 1 then raise exception 'PRUEBA W10a · 2b: esperaba 1 llamada a order-advance y hay %.', v_n; end if;
  select url, headers into r from net.http_request_queue
   where id > current_setting('w10a.cola')::bigint and url like '%/functions/v1/order-advance';
  if r.url <> current_setting('w10a.url') then raise exception 'PRUEBA W10a · 2b: la llamada no va a la misma dirección de antes.'; end if;
  if r.headers->>'x-order-advance-secret' is distinct from 'secreto-de-prueba-w10a' then
    raise exception 'PRUEBA W10a · 2b: la llamada no lleva el secreto del Vault.';
  end if;
  raise notice '2b · con secreto: una llamada, a la misma dirección y con el secreto del Vault';
end $$;

-- ── 3 · Una sola firma ──────────────────────────────────────────────────────
do $$ begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'trg_sale_push_status') <> 1 then
    raise exception 'PRUEBA W10a · 3: hay más de una trg_sale_push_status.';
  end if;
  raise notice '3 · una sola firma';
end $$;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)) <> current_setting('w10a.huella') then
    raise exception 'PRUEBA W10a · 4: la vuelta atrás no la deja como estaba.';
  end if;
  raise notice '4 · la vuelta atrás: como estaba, byte a byte';
end $$;

rollback;
