-- supabase/staging/sql/20261126_q10h_cuota_revisada_prueba.sql
--
-- SOLO STAGING. La 2200 del Q10 · respuesta 6 (la guarda de las cuotas fijas de Cegid y lo corregido de cada
-- incidencia), en las cuentas A y B de pruebas, con ROLLBACK:
--   1. Dos veces; la tabla conta_cegid_cuota_revisada y las columnas corregida_at y corregida_por existen; sin la
--      empresa de QBO no mete nada.
--   2. Una cuota revisada de A: la persona de A la ve y no la escribe; la de B no la ve.
--   3. La vuelta atrás: con una incidencia corregida deja las columnas; sin ninguna, las quita; la tabla, siempre
--      (todo como estaba). Y otra vez la 2200.
-- Datos inventados (T11). Nada sale a Cegid.
-- cambia: conta_cegid_cuota_revisada · conta_cegid_incidencia

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 CUOTA: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261126T2200_q10h_cuota_revisada.sql
\i supabase/migrations/20261126T2200_q10h_cuota_revisada.sql
do $$ begin
  if to_regclass('public.conta_cegid_cuota_revisada') is null
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('corregida_at', 'corregida_por')) <> 2 then
    raise exception 'Q10 CUOTA · 1: falta algo de la 2200.';
  end if;
  if exists (select 1 from public.conta_cegid_cuota_revisada) then raise exception 'Q10 CUOTA · 1: la 2200 ha metido cuotas en una base sin QBO.'; end if;
  raise notice 'Q10 CUOTA · 1: la 2200 carga, dos veces, y no mete nada aquí. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into _c values ('empresa', v_e::text);
  insert into public.conta_cegid_cuota_revisada (company_id, account_id, cliente, revisada_el) values (v_e, v_acc, 900001, date '2026-11-26');
end $$;

-- 2 · La persona de A ve y no escribe.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa');
begin
  if (select count(*) from public.conta_cegid_cuota_revisada where company_id = v_e) <> 1 then raise exception 'Q10 CUOTA · 2: A no ve su cuota revisada.'; end if;
  begin
    insert into public.conta_cegid_cuota_revisada (company_id, account_id, cliente, revisada_el) values (v_e, 'c01a0000-0000-4000-8000-00000000000a', 900002, current_date);
    raise exception 'Q10 CUOTA · 2: desde la pantalla se ha escrito una cuota revisada.';
  exception when insufficient_privilege then null; end;
  raise notice 'Q10 CUOTA · 2: A ve lo suyo y no escribe. OK';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_cegid_cuota_revisada) then raise exception 'Q10 CUOTA · 2: la cuenta B ve lo de A.'; end if;
  raise notice 'Q10 CUOTA · 2: B no ve lo de A. OK';
end $$;
reset role;

-- 3 · La vuelta atrás.
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa');
begin
  insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, incidencia, concepto, serie, texto, base, total, estado, corregida_at, corregida_por)
  values (v_e, 'c01a0000-0000-4000-8000-00000000000a', 'PM000PRUEBACUOTA', '2026-11', 900001, 1, '00001', '1', 'GESTORIA MENSUAL', 70, 84.70, 'mandada', now(), 'prueba');
end $$;
\i supabase/vuelta-atras/20261126T2200_q10h_cuota_revisada.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_cuota_revisada') is not null then raise exception 'Q10 CUOTA · 3: la vuelta atrás no quita la tabla.'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('corregida_at', 'corregida_por')) <> 2 then
    raise exception 'Q10 CUOTA · 3: con una corregida, la vuelta atrás ha quitado las columnas.';
  end if;
end $$;
delete from public.conta_cegid_incidencia where gc_cobro_id = 'PM000PRUEBACUOTA';
\i supabase/vuelta-atras/20261126T2200_q10h_cuota_revisada.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('corregida_at', 'corregida_por')) then
    raise exception 'Q10 CUOTA · 3: sin corregidas, la vuelta atrás no quita las columnas.';
  end if;
  raise notice 'Q10 CUOTA · 3: la vuelta atrás respeta lo corregido y lo deja todo como estaba. OK';
end $$;
\i supabase/migrations/20261126T2200_q10h_cuota_revisada.sql
\echo 'Q10 CUOTA · 3: y otra vez la 2200. OK'

rollback;
