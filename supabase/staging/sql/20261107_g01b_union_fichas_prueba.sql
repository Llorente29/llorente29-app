-- supabase/staging/sql/20261107_g01b_union_fichas_prueba.sql
--
-- SOLO STAGING. Prueba del G01b · la unión de las fichas repetidas
-- (20261107T1110): conta_gestoria_diferencia (tipos nuevos), la tabla de
-- fichas, guardar los clientes uno a uno, aplicar la unión y confirmar el
-- mapa sin campos con contraseñas. Todo en una transacción con ROLLBACK, con
-- datos inventados (T11): no cambia staging.
--
--   1. Los tipos nuevos de diferencia entran; uno inventado, no.
--   2. Sin la unión: dos fichas con el mismo NIF, cada una sola. La primera se
--      guarda; la segunda falla con su porqué y la lectura sigue (el resto,
--      también guardado).
--   3. Con la unión: las dos, un solo cliente con sus dos fichas, la
--      situación que se le manda y la otra ficha en «otrasFichas».
--   4. Un NIF que no se usa (en 10 fichas o más) se le quita al cliente si era
--      el que se le puso antes.
--   5. Aplicar la unión: sin sesión, no; sin el mapa confirmado, no; con él,
--      queda quién y cuándo. Confirmar otra vez el mapa la conserva, y no deja
--      un campo con una contraseña.
--   6. La vuelta atrás: todo como antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01b-U: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes on commit drop as
select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_gestoria_diferencia_tipo_check') as chequeo,
       md5(pg_get_functiondef('public.conta_bitrix_confirmar_mapa(uuid,jsonb)'::regprocedure)) as confirmar;

-- Si el ensayo ya la pasó en esta transacción, no se vuelve a pasar (y «antes» es el de la 0915, que guarda su respaldo aquí abajo).
select to_regclass('public.conta_gestoria_ficha') is not null as ya_esta_la_1110 \gset
\if :ya_esta_la_1110
update _antes set confirmar = (select huella from public.funcion_respaldo where firma = 'public.conta_bitrix_confirmar_mapa(uuid,jsonb)' and migracion = '20261107T1110_g01b_union_fichas'),
  chequeo = 'CHECK ((tipo = ANY (ARRAY[''bitrix_sin_cobro''::text, ''gocardless_sin_ficha''::text, ''emisor_distinto''::text, ''nif_repetido_en_bitrix''::text, ''correo_repetido_en_bitrix''::text, ''nif_distinto''::text, ''suscripcion_sin_convertir''::text, ''totales_distintos''::text, ''mandato_por_firmar''::text, ''falla_a_menudo''::text, ''abono_en_otra_cuenta''::text])))';
\else
\i supabase/migrations/20261107T1110_g01b_union_fichas.sql
\endif

savepoint datos;

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub from public.user_profiles p
 where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;

-- Una ficha inventada, como la manda la lectura.
create or replace function pg_temp.ficha(p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('bitrixId', p_id, 'nombre', 'CLIENTE PRUEBA G01BU ' || p_id, 'nif', p_nif, 'situacion', p_sit, 'situacionTexto', upper(coalesce(p_sit, '')),
    'calle', 'Calle Inventada ' || p_id, 'cp', '28000', 'poblacion', null, 'provincia', null, 'servicios', '[]'::jsonb, 'formaPago', null, 'emisorSegunBitrix', null)
$$;
create or replace function pg_temp.sola(p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('clave', 'ficha:' || p_id, 'nif', p_nif, 'situacion', p_sit, 'motivo', null, 'principal', pg_temp.ficha(p_id, p_nif, p_sit),
    'fichas', jsonb_build_array(pg_temp.ficha(p_id, p_nif, p_sit)))
$$;

do $$
declare a uuid := (select cuenta from _u); r jsonb; v_party uuid; n int; l uuid;
begin
  if a is null then raise exception 'PRUEBA G01b-U · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;
  -- 1
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por) values (a, 'bitrix', 'pruebas', 'persona') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque) values
    (a, l, 'fichas_repetidas', 'prueba', 'prueba'), (a, l, 'nif_no_valido', 'prueba', 'prueba'), (a, l, 'ficha_no_guardada', 'prueba', 'prueba');
  begin
    insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque) values (a, l, 'inventada', 'x', 'x');
    raise exception 'PRUEBA G01b-U · 1: un tipo de diferencia inventado entra.';
  exception when check_violation then null;
  end;
  raise notice 'G01b-U · 1: los tipos nuevos entran y uno inventado no. OK';

  -- 2 · Sin la unión: cada ficha sola; la segunda con el mismo NIF falla y la tercera se guarda igual.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(
    pg_temp.sola('G01BU-1', '00000000T', 'baja'), pg_temp.sola('G01BU-2', '00000000T', 'activo'), pg_temp.sola('G01BU-3', null, 'activo')));
  if (r->>'nuevos')::int <> 2 or jsonb_array_length(r->'errores') <> 1 or r->'errores'->0->>'porque' <> 'su NIF ya es de otro cliente de Sumied'
     or r->'errores'->0->'bitrixIds'->>0 <> 'G01BU-2' then
    raise exception 'PRUEBA G01b-U · 2: sin la unión, no sale una guardada, una que falla con su porqué y otra guardada (%).', r;
  end if;
  if not exists (select 1 from public.conta_gestoria_ficha where account_id = a and bitrix_id = 'G01BU-3') then
    raise exception 'PRUEBA G01b-U · 2: la ficha de después de la que falla no se ha guardado.';
  end if;
  raise notice 'G01b-U · 2: sin la unión, la que choca falla con su porqué y las demás se guardan. OK';

  -- 3 · Con la unión: las dos fichas, un cliente; situación la que se manda (la más viva) y la otra en «otrasFichas».
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(jsonb_build_object('clave', 'nif:00000000T', 'nif', '00000000T', 'situacion', 'activo',
    'motivo', 'repetidas', 'principal', pg_temp.ficha('G01BU-2', '00000000T', 'activo'),
    'fichas', jsonb_build_array(pg_temp.ficha('G01BU-1', '00000000T', 'baja'), pg_temp.ficha('G01BU-2', '00000000T', 'activo')))));
  if jsonb_array_length(r->'errores') <> 0 then raise exception 'PRUEBA G01b-U · 3: la unión falla (%).', r; end if;
  select party_id into v_party from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01BU-2';
  select count(*) into n from public.conta_gestoria_ficha where party_id = v_party;
  if v_party is null or n <> 2 or (select situacion from public.conta_gestoria_cliente where party_id = v_party) <> 'activo'
     or (select ficha->'otrasFichas'->0->>'bitrixId' from public.conta_gestoria_cliente where party_id = v_party) <> 'G01BU-1'
     or (select count(*) from public.party where account_id = a and tax_id = '00000000T') <> 1 then
    raise exception 'PRUEBA G01b-U · 3: no queda un cliente con sus dos fichas, activo y con la otra ficha (fichas %).', n;
  end if;
  raise notice 'G01b-U · 3: con la unión, un cliente con sus dos fichas, activo. OK';

  -- 4 · Su NIF sale en 10 fichas o más: no se usa, y se le quita.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(jsonb_build_object('clave', 'ficha:G01BU-2', 'nif', null, 'situacion', 'activo',
    'motivo', 'nif_en_muchas', 'principal', pg_temp.ficha('G01BU-2', '00000000T', 'activo'), 'fichas', jsonb_build_array(pg_temp.ficha('G01BU-2', '00000000T', 'activo')))));
  if (select tax_id from public.party where id = v_party) is not null or jsonb_array_length(r->'errores') <> 0 then
    raise exception 'PRUEBA G01b-U · 4: el NIF que no se usa sigue en el cliente (%).', r;
  end if;
  raise notice 'G01b-U · 4: el NIF que no se usa se le quita. OK';

  -- 5 · Sin sesión, no se aplica.
  begin
    perform public.conta_bitrix_aplicar_union(a);
    raise exception 'PRUEBA G01b-U · 5: sin sesión se aplica la unión.';
  exception when sqlstate '42501' then null;
  end;
  insert into public.conta_crm_bitrix (account_id, entorno, portal, mapa, campos_medidos)
  values (a, 'pruebas', 'portal-de-prueba.bitrix24.es', '{"nombre":"Prueba","campos":[],"formaPagoAEmisor":{}}'::jsonb,
    '{"TITLE":{"title":"Nombre"},"UF_CRM_G01BU_NIF":{"formLabel":"CIF/NIF","type":"string"},"UF_CRM_G01BU_CLAVE":{"formLabel":" Clave Certificado Digital Administrador 1","type":"string"},
      "UF_CRM_G01BU_CERT":{"formLabel":"Certificado Electrónico Sociedad","type":"file"},
      "UF_CRM_G01BU_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"}]}}'::jsonb)
  on conflict (account_id) do update set mapa = excluded.mapa, campos_medidos = excluded.campos_medidos;
end $$;

grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _u); r jsonb;
        bueno jsonb := '{"nombre":"Prueba","formaPagoAEmisor":{},"campos":[{"codigo":"TITLE","campo":"nombre"},{"codigo":"UF_CRM_G01BU_NIF","campo":"nif"},
          {"codigo":"UF_CRM_G01BU_SIT","campo":"situacion","opciones":{"1":"activo"}}]}';
begin
  begin
    perform public.conta_bitrix_aplicar_union(a);
    raise exception 'PRUEBA G01b-U · 5: se aplica la unión sin el mapa confirmado.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_bitrix_confirmar_mapa(a, jsonb_set(bueno, '{campos,1,codigo}', '"UF_CRM_G01BU_CLAVE"'));
    raise exception 'PRUEBA G01b-U · 5: se confirma un campo con una contraseña.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%Clave Certificado Digital Administrador 1%' then raise exception 'PRUEBA G01b-U · 5: el error no dice qué campo (%).', sqlerrm; end if;
  end;
  begin
    perform public.conta_bitrix_confirmar_mapa(a, bueno || '{"direcciones":[{"etiqueta":"x","calle":"UF_CRM_G01BU_CERT"}]}');
    raise exception 'PRUEBA G01b-U · 5: se confirma un certificado como dirección.';
  exception when sqlstate '22023' then null;
  end;
  perform public.conta_bitrix_confirmar_mapa(a, bueno);
  r := public.conta_bitrix_aplicar_union(a);
  if r->>'frase' not like 'Unión aplicada por %' or (select mapa->'union'->>'cuando' from public.conta_crm_bitrix where account_id = a) is null then
    raise exception 'PRUEBA G01b-U · 5: la unión no queda aplicada (%).', r;
  end if;
  perform public.conta_bitrix_confirmar_mapa(a, bueno);
  if (select mapa->'union'->>'cuando' from public.conta_crm_bitrix where account_id = a) is null then
    raise exception 'PRUEBA G01b-U · 5: confirmar otra vez el mapa pierde la unión.';
  end if;
  raise notice 'G01b-U · 5: %', r->>'frase';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás, con datos dentro.
\i supabase/vuelta-atras/20261107T1110_g01b_union_fichas.down.sql
do $$
declare x record;
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_gestoria_diferencia_tipo_check') is distinct from (select chequeo from _antes) then
    raise exception 'PRUEBA G01b-U · 6: el CHECK de las diferencias no vuelve a ser el de antes.';
  end if;
  if (select confirmar from _antes) is not null
     and md5(pg_get_functiondef('public.conta_bitrix_confirmar_mapa(uuid,jsonb)'::regprocedure)) is distinct from (select confirmar from _antes) then
    raise exception 'PRUEBA G01b-U · 6: confirmar el mapa no vuelve a ser la de antes.';
  end if;
  if to_regclass('public.conta_gestoria_ficha') is not null or to_regprocedure('public.conta_bitrix_guardar_clientes(uuid,jsonb)') is not null
     or to_regprocedure('public.conta_bitrix_aplicar_union(uuid)') is not null or to_regprocedure('public._conta_bitrix_campo_sensible(jsonb)') is not null then
    raise exception 'PRUEBA G01b-U · 6: quedan la tabla o las funciones nuevas.';
  end if;
  if exists (select 1 from public.conta_crm_bitrix where mapa ? 'union') then raise exception 'PRUEBA G01b-U · 6: queda la unión aplicada.'; end if;
  raise notice 'G01b-U · 6: la vuelta atrás deja todo como antes. OK';
end $$;

rollback;
