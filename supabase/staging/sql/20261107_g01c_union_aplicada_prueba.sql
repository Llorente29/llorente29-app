-- supabase/staging/sql/20261107_g01c_union_aplicada_prueba.sql
--
-- SOLO STAGING. Prueba del G01c · la unión aplicada no se pierde al confirmar
-- el mapa (20261107T2115). Reproduce lo de producción del 07/11: unión
-- aplicada a las 13:02 UTC, mapa confirmado a las 20:05 UTC y, desde entonces,
-- la lectura sin unir («31 clientes no se han guardado … Se unirá a su cliente
-- cuando se aplique la unión»). Todo en una transacción con ROLLBACK, con
-- datos inventados (T11): no cambia staging.
--
--   1. Aplicar la unión la deja en conta_crm.union_aplicada y en el mapa.
--   2. Confirmar el mapa (con el que manda la pantalla, que no la lleva) la
--      conserva en los dos sitios. Con la función de antes, se perdía.
--   3. La vuelta atrás: las dos funciones como antes, sin la columna, y la
--      unión en el mapa.
--
-- sin usuario: lo que no hace una persona (rellenar la columna) lo hace la migración; aplicar la unión y confirmar el mapa se prueban como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01c-U: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes (firma text primary key, huella text) on commit drop;
select to_regprocedure('public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)') is not null
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_crm' and column_name = 'union_aplicada') as ya_esta_la_2115 \gset
\if :ya_esta_la_2115
insert into _antes select firma, huella from public.funcion_respaldo where migracion = '20261107T2115_g01c_union_aplicada';
\else
insert into _antes select f, md5(pg_get_functiondef(f::regprocedure)) from unnest(array['public.conta_crm_aplicar_union(uuid,text)', 'public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)']) f;
\i supabase/migrations/20261107T2115_g01c_union_aplicada.sql
\endif

-- Una cuenta de staging con una persona administradora o encargada activa, y su CRM inventado con el mapa confirmado.
create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub from public.user_profiles p
 where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
do $$
declare a uuid := (select cuenta from _u);
begin
  if a is null then raise exception 'PRUEBA G01c-U · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, campos_medidos, mapa)
  values (a, 'bitrix24', 'pruebas', 'portal-de-prueba.bitrix24.es',
    '{"TITLE":{"title":"Nombre"},"UF_CRM_G01CU_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"}]}}'::jsonb,
    '{"nombre":"Prueba","campos":[],"formaPagoAEmisor":{},"confirmado":{"quien":"PERSONA PRUEBA","cuando":"2026-11-07T09:00:00Z"}}'::jsonb)
  on conflict (account_id, crm) do update set campos_medidos = excluded.campos_medidos, mapa = excluded.mapa, union_aplicada = null;
end $$;

grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _u); r jsonb; c record;
        pantalla jsonb := '{"nombre":"Prueba","formaPagoAEmisor":{},"campos":[{"codigo":"TITLE","campo":"nombre"},{"codigo":"UF_CRM_G01CU_SIT","campo":"situacion","opciones":{"1":"activo"}}],"direcciones":[],"dudas":[]}';
begin
  -- 1 · Aplicar la unión.
  r := public.conta_crm_aplicar_union(a, 'bitrix24');
  select union_aplicada, mapa into c from public.conta_crm where account_id = a and crm = 'bitrix24';
  if c.union_aplicada->>'cuando' is null or c.mapa->'union' is distinct from c.union_aplicada then
    raise exception 'PRUEBA G01c-U · 1: la unión no queda en la columna y en el mapa (%).', c.union_aplicada;
  end if;
  raise notice 'G01c-U · 1: %', r->>'frase';

  -- 2 · Confirmar el mapa con lo que manda la pantalla (sin «union»): lo de producción del 07/11 a las 20:05 UTC.
  r := public.conta_crm_confirmar_mapa(a, 'bitrix24', 'empresa', pantalla);
  select union_aplicada, mapa into c from public.conta_crm where account_id = a and crm = 'bitrix24';
  if c.union_aplicada->>'cuando' is null or c.mapa->'union' is distinct from c.union_aplicada or c.mapa->'confirmado'->>'cuando' is null then
    raise exception 'PRUEBA G01c-U · 2: confirmar el mapa se lleva la unión (%).', c.mapa;
  end if;
  raise notice 'G01c-U · 2: confirmado el mapa, la unión sigue aplicada. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261107T2115_g01c_union_aplicada.down.sql
do $$
declare f record; a uuid := (select cuenta from _u);
begin
  for f in select * from _antes loop
    if md5(pg_get_functiondef(f.firma::regprocedure)) is distinct from f.huella then raise exception 'PRUEBA G01c-U · 3: % no vuelve a ser la de antes.', f.firma; end if;
  end loop;
  if (select count(*) from _antes) <> 2 then raise exception 'PRUEBA G01c-U · 3: faltan funciones por comparar.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_crm' and column_name = 'union_aplicada') then
    raise exception 'PRUEBA G01c-U · 3: queda la columna.';
  end if;
  if (select mapa->'union'->>'cuando' from public.conta_crm where account_id = a and crm = 'bitrix24') is null then
    raise exception 'PRUEBA G01c-U · 3: la vuelta atrás se lleva la unión del mapa.';
  end if;
  raise notice 'G01c-U · 3: la vuelta atrás deja las funciones como antes y la unión en el mapa. OK';
end $$;

rollback;
