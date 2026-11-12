-- supabase/staging/sql/20261109_g01d_cola_clave_prueba.sql
--
-- SOLO STAGING. La 0050 del G01d (la clave única de la cola, sin «where»), por
-- el mismo camino que las funciones que reciben avisos:
--   1. La 0050, dos veces (pasarla otra vez no cambia nada).
--   2. «on conflict (account_id, clave) do nothing», el del upsert de las
--      funciones: el primer aviso entra y el repetido no, sin error. Con la
--      clave parcial de la 1620 esto daba 42P10.
--   3. Lo que no tiene clave (rechazados, ignorados) entra todas las veces.
--   4. La vuelta atrás: con la clave de antes vuelve el 42P10 (así se ve que
--      la prueba mira lo que hay que mirar); y otra vez la 0050.
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la cola solo la escriben las dos funciones con la clave del
-- servidor (las personas solo la leen, y eso lo prueba la de la 1620).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 0050, dos veces.
\i supabase/migrations/20261109T0050_g01d_cola_clave.sql
\i supabase/migrations/20261109T0050_g01d_cola_clave.sql

do $$
declare v_pred text; v_n int;
  v_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
begin
  select pg_get_expr(i.indpred, i.indrelid) into v_pred from pg_index i where i.indexrelid = 'public.conta_aviso_clave_idx'::regclass;
  if v_pred is not null then raise exception 'G01d · 1: la clave de la cola sigue siendo parcial (%).', v_pred; end if;

  -- 2 · El upsert de las funciones: el primero entra, el repetido no, y sin error.
  insert into public.conta_aviso (account_id, origen, crm, clave, estado, tipo_ficha, id_externo, accion)
  values (v_cuenta, 'crm', 'bitrix24', 'bitrix24:ONCRMCOMPANYUPDATE:1:1700000000', 'pendiente', 'empresa', '1', 'cambio')
  on conflict (account_id, clave) do nothing;
  insert into public.conta_aviso (account_id, origen, crm, clave, estado, tipo_ficha, id_externo, accion)
  values (v_cuenta, 'crm', 'bitrix24', 'bitrix24:ONCRMCOMPANYUPDATE:1:1700000000', 'pendiente', 'empresa', '1', 'cambio')
  on conflict (account_id, clave) do nothing;
  select count(*) into v_n from public.conta_aviso where account_id = v_cuenta and clave = 'bitrix24:ONCRMCOMPANYUPDATE:1:1700000000';
  if v_n <> 1 then raise exception 'G01d · 2: el aviso repetido tenía que quedar una vez y hay %.', v_n; end if;
  -- El mismo aviso en otra cuenta es otro aviso.
  insert into public.conta_aviso (account_id, origen, crm, clave, estado)
  values ('c01b0000-0000-4000-8000-00000000000b', 'crm', 'bitrix24', 'bitrix24:ONCRMCOMPANYUPDATE:1:1700000000', 'pendiente')
  on conflict (account_id, clave) do nothing;
  if not exists (select 1 from public.conta_aviso where account_id = 'c01b0000-0000-4000-8000-00000000000b' and clave = 'bitrix24:ONCRMCOMPANYUPDATE:1:1700000000') then
    raise exception 'G01d · 2: el mismo aviso de otra cuenta no ha entrado.';
  end if;
  raise notice 'G01d · 2: el upsert de las funciones guarda el aviso una vez y el repetido no da error. OK';

  -- 3 · Sin clave, entra todas las veces.
  insert into public.conta_aviso (account_id, origen, crm, estado, porque) values (v_cuenta, 'crm', 'bitrix24', 'rechazado', 'Prueba G01d: sin clave.');
  insert into public.conta_aviso (account_id, origen, crm, estado, porque) values (v_cuenta, 'crm', 'bitrix24', 'rechazado', 'Prueba G01d: sin clave.');
  select count(*) into v_n from public.conta_aviso where account_id = v_cuenta and clave is null and porque = 'Prueba G01d: sin clave.';
  if v_n <> 2 then raise exception 'G01d · 3: los avisos sin clave tenían que entrar los dos y hay %.', v_n; end if;
  raise notice 'G01d · 3: lo que no tiene clave entra todas las veces. OK';
end $$;

-- 4 · La vuelta atrás: vuelve el 42P10 de antes; y la 0050 lo arregla otra vez.
\i supabase/vuelta-atras/20261109T0050_g01d_cola_clave.down.sql
do $$ begin
  begin
    insert into public.conta_aviso (account_id, origen, clave, estado) values ('c01a0000-0000-4000-8000-00000000000a', 'crm', 'g01d:vuelta', 'pendiente')
    on conflict (account_id, clave) do nothing;
    raise exception 'G01d · 4: con la clave parcial de antes, el on conflict tenía que fallar (42P10).';
  exception when invalid_column_reference then
    raise notice 'G01d · 4: con la clave de antes, el on conflict da 42P10 (el fallo que arregla la 0050). OK';
  end;
end $$;
\i supabase/migrations/20261109T0050_g01d_cola_clave.sql
insert into public.conta_aviso (account_id, origen, clave, estado) values ('c01a0000-0000-4000-8000-00000000000a', 'crm', 'g01d:vuelta', 'pendiente')
on conflict (account_id, clave) do nothing;
\echo 'G01d · 4: la vuelta atrás y otra vez la 0050. OK'

rollback;
