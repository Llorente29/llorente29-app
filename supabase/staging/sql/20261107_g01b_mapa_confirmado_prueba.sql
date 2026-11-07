-- supabase/staging/sql/20261107_g01b_mapa_confirmado_prueba.sql
--
-- SOLO STAGING. Prueba del G01b · el mapa confirmado (20261107T0915):
-- conta_gestoria_cliente (su CHECK de la situación admite «sin_clasificar») y
-- conta_bitrix_confirmar_mapa. Todo en una transacción con ROLLBACK, con
-- datos inventados (T11): no cambia staging.
--
--   1. Una ficha «sin_clasificar» entra; una situación inventada, no; las de
--      antes siguen entrando.
--   2. Sin sesión de una persona de la cuenta, confirmar no se puede (42501).
--   3. Como persona administradora o encargada: un código que el portal no
--      tiene, no; una opción de la situación sin decir qué es, no; el mapa
--      bueno se guarda con quién y cuándo, sin dudas, y devuelve su frase.
--   4. La vuelta atrás: todo como antes (el CHECK de antes, sin la función,
--      el mapa sin confirmar y la ficha sin clasificar, sin situación).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes on commit drop as
select 'CHECK (((situacion IS NULL) OR (situacion = ANY (ARRAY[''activo''::text, ''baja''::text, ''moroso''::text, ''solo_renta''::text]))))'::text as chequeo;

-- Si el ensayo ya la pasó en esta transacción, no se vuelve a pasar.
select to_regprocedure('public.conta_bitrix_confirmar_mapa(uuid,jsonb)') is not null as ya_esta_la_0915 \gset
\if :ya_esta_la_0915
\else
\i supabase/migrations/20261107T0915_g01b_mapa_confirmado.sql
\endif

savepoint datos;

-- Una cuenta de staging con una persona administradora o encargada activa.
create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub from public.user_profiles p
 where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); v_party uuid;
begin
  if a is null then raise exception 'PRUEBA G01b · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;
  -- Un Bitrix24 inventado, con lo medido de un portal inventado.
  insert into public.conta_crm_bitrix (account_id, entorno, portal, mapa, campos_medidos)
  values (a, 'pruebas', 'portal-de-prueba.bitrix24.es', '{"nombre":"Prueba","campos":[],"formaPagoAEmisor":{},"dudas":[{"campo":"nif","porque":"varios","candidatos":[]}]}'::jsonb,
    '{"TITLE":{"title":"Nombre"},"ADDRESS":{"title":"Dirección"},"ADDRESS_POSTAL_CODE":{"title":"CP"},"UF_CRM_G01B_NIF":{"formLabel":"CIF/NIF"},
      "UF_CRM_G01B_FISCAL":{"formLabel":"Dirección Fiscal"},
      "UF_CRM_G01B_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"},{"ID":"2","VALUE":"BAJA"},{"ID":"3","VALUE":"GRAVE DESAPARECIDO"}]}}'::jsonb)
  on conflict (account_id) do update set mapa = excluded.mapa, campos_medidos = excluded.campos_medidos;

  -- 1
  insert into public.party (account_id, name, source, created_by_name) values (a, 'CLIENTE PRUEBA G01B', 'crm', 'Bitrix24') returning id into v_party;
  insert into public.conta_gestoria_cliente (party_id, account_id, bitrix_id, situacion) values (v_party, a, 'G01B-1', 'sin_clasificar');
  update public.conta_gestoria_cliente set situacion = 'moroso' where party_id = v_party;
  update public.conta_gestoria_cliente set situacion = 'sin_clasificar' where party_id = v_party;
  begin
    update public.conta_gestoria_cliente set situacion = 'inventada' where party_id = v_party;
    raise exception 'PRUEBA G01b · 1: una situación inventada entra.';
  exception when check_violation then null;
  end;
  raise notice 'G01b · 1: «sin_clasificar» entra y una inventada no. OK';

  -- 2
  begin
    perform public.conta_bitrix_confirmar_mapa(a, '{"campos":[]}'::jsonb);
    raise exception 'PRUEBA G01b · 2: sin sesión se confirma el mapa.';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'G01b · 2: sin sesión no se confirma. OK';
end $$;

-- 3 · Como la persona (authenticated, con su sub).
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _u); r jsonb; m jsonb;
        bueno jsonb := '{"nombre":"Prueba","formaPagoAEmisor":{},
          "campos":[{"codigo":"TITLE","campo":"nombre"},{"codigo":"UF_CRM_G01B_NIF","campo":"nif"},
                    {"codigo":"UF_CRM_G01B_SIT","campo":"situacion","opciones":{"1":"activo","2":"baja","3":"sin_clasificar"},"textos":{"1":"ACTIVO","2":"BAJA","3":"GRAVE DESAPARECIDO"}}],
          "direcciones":[{"etiqueta":"Dirección Fiscal","calle":"UF_CRM_G01B_FISCAL"},{"etiqueta":"Dirección","calle":"ADDRESS","cp":"ADDRESS_POSTAL_CODE"}],
          "dudas":[{"campo":"nif","porque":"varios","candidatos":[]}]}';
begin
  begin
    perform public.conta_bitrix_confirmar_mapa(a, jsonb_set(bueno, '{direcciones,0,calle}', '"UF_CRM_QUE_NO_EXISTE"'));
    raise exception 'PRUEBA G01b · 3: entra un código que el portal no tiene.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%UF_CRM_QUE_NO_EXISTE%' then raise exception 'PRUEBA G01b · 3: el error no dice qué código falta (%).', sqlerrm; end if;
  end;
  begin
    perform public.conta_bitrix_confirmar_mapa(a, jsonb_set(bueno, '{campos,2,opciones}', '{"1":"activo","2":"baja"}'));
    raise exception 'PRUEBA G01b · 3: entra una opción de la situación sin decir qué es.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%GRAVE DESAPARECIDO%' then raise exception 'PRUEBA G01b · 3: el error no dice qué opción falta (%).', sqlerrm; end if;
  end;
  r := public.conta_bitrix_confirmar_mapa(a, bueno);
  if r->>'frase' not like 'Mapa de Bitrix24 confirmado por %: 3 campos y 2 fuentes de la dirección.%' then
    raise exception 'PRUEBA G01b · 3: la frase no dice lo confirmado (%).', r->>'frase';
  end if;
  select mapa into m from public.conta_crm_bitrix where account_id = a;
  if m->'confirmado'->>'cuando' is null or jsonb_array_length(m->'dudas') <> 0 or m->'campos'->2->'opciones'->>'3' <> 'sin_clasificar' then
    raise exception 'PRUEBA G01b · 3: el mapa no queda confirmado, sin dudas y como se mandó (%).', m;
  end if;
  raise notice 'G01b · 3: %', r->>'frase';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4 · La vuelta atrás: con la ficha sin clasificar y el mapa confirmado, todo como antes.
\i supabase/vuelta-atras/20261107T0915_g01b_mapa_confirmado.down.sql
do $$
declare a uuid := (select cuenta from _u);
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_gestoria_cliente_situacion_check') is distinct from (select chequeo from _antes) then
    raise exception 'PRUEBA G01b · 4: el CHECK no vuelve a ser el de antes.';
  end if;
  if to_regprocedure('public.conta_bitrix_confirmar_mapa(uuid,jsonb)') is not null then raise exception 'PRUEBA G01b · 4: queda la función.'; end if;
  if (select mapa ? 'confirmado' from public.conta_crm_bitrix where account_id = a) then raise exception 'PRUEBA G01b · 4: el mapa sigue confirmado.'; end if;
  if exists (select 1 from public.conta_gestoria_cliente where bitrix_id = 'G01B-1' and situacion is not null) then
    raise exception 'PRUEBA G01b · 4: la ficha sin clasificar sigue con situación.';
  end if;
  raise notice 'G01b · 4: la vuelta atrás deja todo como antes. OK';
end $$;

rollback;
