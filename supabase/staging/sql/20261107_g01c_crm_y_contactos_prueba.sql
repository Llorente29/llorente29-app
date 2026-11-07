-- supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
--
-- SOLO STAGING. Prueba del G01c · la clave neutra y los contactos del CRM
-- (20261107T1925). Todo en una transacción con ROLLBACK, con datos inventados
-- (T11): no cambia staging.
--
--   0. Sin perder nada: conta_crm tiene las filas de conta_crm_bitrix, y lo
--      que se escribe en una se copia a la otra (el espejo, en los dos
--      sentidos); cada ficha, cliente y diferencia tiene
--      su id externo igual a su bitrix_id. Lo publicado sigue funcionando: la
--      función de antes, con lo que manda la lectura de antes (bitrixId),
--      guarda y escribe bitrix_id.
--   1. Una empresa y un contacto con el mismo id externo son dos clientes.
--   2. Un contacto con el NIF de una empresa se une a ese cliente.
--   3. Un RIF: el cliente con su número, tipo «foreign» y país VE.
--   4. Las personas de contacto cuelgan del cliente de su empresa (de las dos,
--      si tiene dos); una empresa que no está en Sumied no guarda nada; las que
--      ya no lo son se quitan, y guardar los clientes no se las lleva.
--   5. «Pendiente de revisar» admite los dos porqués de los contactos.
--   6. Confirmar el mapa: sin sesión no; como la persona, el de los contactos
--      (un código que el portal no tiene, no) y el de las empresas por la
--      función de antes.
--   7. La vuelta atrás, con contactos ya guardados: todo como antes, sin
--      borrar ningún cliente.
--
-- sin usuario: guardar los clientes y las personas de contacto solo lo hace el servidor (conta-bitrix-leer, con service_role); confirmar el mapa se prueba como la persona en el paso 6.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes (firma text primary key, huella text) on commit drop;
create temp table _cuentas on commit drop as select 0::bigint as crm, 0::bigint as fichas, 0::bigint as clientes, 0::bigint as diferencias;

-- Si el ensayo ya la pasó en esta transacción, no se vuelve a pasar («antes» es entonces el respaldo).
select to_regclass('public.conta_crm') is not null as ya_esta_la_1925 \gset
\if :ya_esta_la_1925
insert into _antes select firma, huella from public.funcion_respaldo where migracion = '20261107T1925_g01c_crm_y_contactos';
update _cuentas set crm = (select count(*) from public.conta_crm), fichas = (select count(*) from public.conta_gestoria_ficha),
  clientes = (select count(*) from public.conta_gestoria_cliente where id_externo is not null), diferencias = (select count(*) from public.conta_gestoria_diferencia where id_externo is not null);
\else
insert into _antes select f, md5(pg_get_functiondef(f::regprocedure)) from unnest(array['public.conta_bitrix_guardar_clientes(uuid,jsonb)', 'public.conta_bitrix_confirmar_mapa(uuid,jsonb)',
  'public.conta_bitrix_aplicar_union(uuid)', 'public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', 'public.conta_bitrix_secreto(uuid)', 'public.conta_gestoria_despertar()']) f;
update _cuentas set crm = (select count(*) from public.conta_crm_bitrix), fichas = (select count(*) from public.conta_gestoria_ficha),
  clientes = (select count(*) from public.conta_gestoria_cliente where bitrix_id is not null), diferencias = (select count(*) from public.conta_gestoria_diferencia where bitrix_id is not null);
\i supabase/migrations/20261107T1925_g01c_crm_y_contactos.sql
\endif

-- 0 · Sin perder nada.
do $$ begin
  if (select count(*) from public.conta_crm where crm = 'bitrix24') <> (select crm from _cuentas) or (select count(*) from public.conta_crm_bitrix) <> (select crm from _cuentas) then
    raise exception 'PRUEBA G01c · 0: conta_crm no tiene las filas de conta_crm_bitrix.';
  end if;
  if (select count(*) from public.conta_gestoria_ficha) <> (select fichas from _cuentas)
     or exists (select 1 from public.conta_gestoria_ficha where bitrix_id is not null and (id_externo <> bitrix_id or crm <> 'bitrix24' or tipo_ficha <> 'empresa'))
     or (select count(*) from public.conta_gestoria_cliente where id_externo is not null) <> (select clientes from _cuentas)
     or exists (select 1 from public.conta_gestoria_cliente where bitrix_id is not null and (id_externo is distinct from bitrix_id or forma_pago_crm is distinct from forma_pago_bitrix))
     or (select count(*) from public.conta_gestoria_diferencia where id_externo is not null) <> (select diferencias from _cuentas)
     or exists (select 1 from public.conta_gestoria_diferencia where bitrix_id is not null and id_externo is distinct from bitrix_id) then
    raise exception 'PRUEBA G01c · 0: alguna ficha, cliente o diferencia no tiene su id externo igual a su bitrix_id.';
  end if;
  raise notice 'G01c · 0: % conexiones, % fichas, % clientes y % diferencias, con su clave neutra. OK',
    (select crm from _cuentas), (select fichas from _cuentas), (select clientes from _cuentas), (select diferencias from _cuentas);
end $$;

-- Una cuenta de staging con una persona administradora o encargada activa.
create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub from public.user_profiles p
 where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;

create or replace function pg_temp.ficha(p_tipo text, p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('tipoFicha', p_tipo, 'idExterno', p_id, 'nombre', 'CLIENTE PRUEBA G01C ' || p_tipo || ' ' || p_id, 'nif', p_nif, 'situacion', p_sit,
    'situacionTexto', null, 'calle', 'Calle Inventada ' || p_id, 'cp', '28000', 'poblacion', null, 'provincia', null, 'servicios', '[]'::jsonb, 'formaPago', null,
    'emisorSegunCrm', null)
$$;
create or replace function pg_temp.sola(p_tipo text, p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('clave', 'ficha:' || p_tipo || ':' || p_id, 'nif', p_nif, 'situacion', p_sit, 'motivo', null,
    'principal', pg_temp.ficha(p_tipo, p_id, p_nif, p_sit), 'fichas', jsonb_build_array(pg_temp.ficha(p_tipo, p_id, p_nif, p_sit)))
$$;
create or replace function pg_temp.persona(p_empresa text, p_id text) returns jsonb language sql as $$
  select jsonb_build_object('empresa', p_empresa, 'contacto', jsonb_build_object('idExterno', p_id, 'nombre', 'PERSONA PRUEBA G01C ' || p_id,
    'correos', jsonb_build_array('persona' || p_id || '@prueba.test'), 'telefonos', '[]'::jsonb))
$$;

savepoint datos;

do $$
declare a uuid := (select cuenta from _u); r jsonb; pe uuid; pc uuid; pr uuid; pv uuid; n int; l uuid;
begin
  if a is null then raise exception 'PRUEBA G01c · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;

  -- 0 · Lo publicado sigue funcionando: la función de antes, con lo que manda la lectura de antes.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(jsonb_build_object('clave', 'ficha:9900', 'nif', null, 'situacion', 'activo', 'motivo', null,
    'principal', jsonb_build_object('bitrixId', '9900', 'nombre', 'CLIENTE PRUEBA G01C DE ANTES', 'situacion', 'activo', 'servicios', '[]'::jsonb),
    'fichas', jsonb_build_array(jsonb_build_object('bitrixId', '9900', 'nombre', 'CLIENTE PRUEBA G01C DE ANTES', 'situacion', 'activo')))));
  select party_id into pv from public.conta_gestoria_cliente where account_id = a and bitrix_id = '9900';
  if (r->>'nuevos')::int <> 1 or pv is null
     or not exists (select 1 from public.conta_gestoria_ficha where account_id = a and bitrix_id = '9900' and id_externo = '9900' and crm = 'bitrix24' and tipo_ficha = 'empresa')
     or not exists (select 1 from public.conta_gestoria_cliente where party_id = pv and id_externo = '9900' and crm = 'bitrix24') then
    raise exception 'PRUEBA G01c · 0: la función de antes no guarda con bitrix_id y la clave neutra (%).', r;
  end if;
  raise notice 'G01c · 0: la función de antes, con lo de antes, guarda igual. OK';

  -- 0 · El espejo: lo que escribe lo publicado (conta_crm_bitrix) llega a conta_crm, y al revés.
  insert into public.conta_crm_bitrix (account_id, entorno, portal) values (a, 'pruebas', 'portal-de-antes.bitrix24.es')
  on conflict (account_id) do update set portal = excluded.portal;
  if (select portal from public.conta_crm where account_id = a and crm = 'bitrix24') is distinct from 'portal-de-antes.bitrix24.es' then
    raise exception 'PRUEBA G01c · 0: lo escrito en conta_crm_bitrix no llega a conta_crm.';
  end if;
  update public.conta_crm set portal = 'portal-nuevo.bitrix24.es', mapa_contactos = '{"nif":null}' where account_id = a and crm = 'bitrix24';
  if (select portal from public.conta_crm_bitrix where account_id = a) is distinct from 'portal-nuevo.bitrix24.es' then
    raise exception 'PRUEBA G01c · 0: lo escrito en conta_crm no llega a conta_crm_bitrix.';
  end if;
  raise notice 'G01c · 0: el espejo copia en los dos sentidos. OK';

  -- 1 · Una empresa y un contacto con el mismo id externo: dos clientes.
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(pg_temp.sola('empresa', '9901', null, 'activo'), pg_temp.sola('contacto', '9901', null, null)));
  if (r->>'nuevos')::int <> 2 or jsonb_array_length(r->'errores') <> 0 then raise exception 'PRUEBA G01c · 1: no salen dos clientes (%).', r; end if;
  select party_id into pe from public.conta_gestoria_cliente where account_id = a and crm = 'bitrix24' and tipo_ficha = 'empresa' and id_externo = '9901';
  select party_id into pc from public.conta_gestoria_cliente where account_id = a and crm = 'bitrix24' and tipo_ficha = 'contacto' and id_externo = '9901';
  if pe is null or pc is null or pe = pc then raise exception 'PRUEBA G01c · 1: la empresa y el contacto se confunden.'; end if;
  if (select bitrix_id from public.conta_gestoria_cliente where party_id = pc) is not null then raise exception 'PRUEBA G01c · 1: el contacto escribe bitrix_id.'; end if;
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(pg_temp.sola('empresa', '9901', null, 'activo'), pg_temp.sola('contacto', '9901', null, null)));
  if (r->>'iguales')::int <> 2 then raise exception 'PRUEBA G01c · 1: leídos otra vez no salen iguales (%).', r; end if;
  raise notice 'G01c · 1: una empresa y un contacto con el mismo id externo, dos clientes. OK';

  -- 2 · Un contacto con el NIF de una empresa: un solo cliente, la empresa como principal.
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(jsonb_build_object('clave', 'nif:B00000001', 'nif', 'B00000001', 'situacion', 'activo', 'motivo', 'repetidas',
    'principal', pg_temp.ficha('empresa', '9902', 'B00000001', 'activo'),
    'fichas', jsonb_build_array(pg_temp.ficha('empresa', '9902', 'B00000001', 'activo'), pg_temp.ficha('contacto', '9903', 'B00000001', null)))));
  if (r->>'nuevos')::int <> 1 or jsonb_array_length(r->'errores') <> 0 then raise exception 'PRUEBA G01c · 2: no sale un cliente (%).', r; end if;
  select party_id into pe from public.conta_gestoria_cliente where account_id = a and tipo_ficha = 'empresa' and id_externo = '9902';
  select count(*) into n from public.conta_gestoria_ficha where party_id = pe and de_empresa = '' and (tipo_ficha, id_externo) in (('empresa', '9902'), ('contacto', '9903'));
  if n <> 2 or (select ficha->'otrasFichas'->0->>'tipoFicha' from public.conta_gestoria_cliente where party_id = pe) <> 'contacto' then
    raise exception 'PRUEBA G01c · 2: el cliente no tiene sus dos fichas (%).', n;
  end if;
  raise notice 'G01c · 2: el contacto con el NIF de la empresa se une a su cliente. OK';

  -- 3 · Un RIF: identificador fiscal extranjero de Venezuela.
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(jsonb_build_object('clave', 'nif:J000000000', 'nif', 'J000000000', 'situacion', 'activo', 'motivo', null,
    'idExtranjero', jsonb_build_object('tipo', 'foreign', 'pais', 'VE'),
    'principal', pg_temp.ficha('empresa', '9904', 'J000000000', 'activo'), 'fichas', jsonb_build_array(pg_temp.ficha('empresa', '9904', 'J000000000', 'activo')))));
  select party_id into pr from public.conta_gestoria_cliente where account_id = a and tipo_ficha = 'empresa' and id_externo = '9904';
  if (select tax_id from public.party where id = pr) is distinct from 'J000000000'
     or (select tax_id_type from public.customer_fiscal where party_id = pr) is distinct from 'foreign'
     or (select country_code from public.customer_fiscal where party_id = pr) is distinct from 'VE' then
    raise exception 'PRUEBA G01c · 3: el RIF no queda como identificador extranjero de VE (%).', r;
  end if;
  if (select country_code from public.customer_fiscal where party_id = pe) <> 'ES' then raise exception 'PRUEBA G01c · 3: una española cambia de país.'; end if;
  raise notice 'G01c · 3: el RIF, con su número, tipo foreign y país VE. OK';

  -- 4 · Las personas de contacto.
  r := public.conta_crm_guardar_personas(a, 'bitrix24', jsonb_build_array(pg_temp.persona('9902', '9905'), pg_temp.persona('9904', '9905'), pg_temp.persona('9999', '9906')));
  if (r->>'guardadas')::int <> 2 or (r->>'sinCliente')::int <> 1 then raise exception 'PRUEBA G01c · 4: no se guardan las dos de sus empresas (%).', r; end if;
  if (select party_id from public.conta_gestoria_ficha where account_id = a and tipo_ficha = 'contacto' and id_externo = '9905' and de_empresa = '9902') is distinct from pe
     or (select party_id from public.conta_gestoria_ficha where account_id = a and tipo_ficha = 'contacto' and id_externo = '9905' and de_empresa = '9904') is distinct from pr then
    raise exception 'PRUEBA G01c · 4: la persona de contacto no cuelga del cliente de cada empresa.';
  end if;
  r := public.conta_crm_guardar_personas(a, 'bitrix24', jsonb_build_array(pg_temp.persona('9902', '9905')));
  if (r->>'quitadas')::int <> 1 or exists (select 1 from public.conta_gestoria_ficha where account_id = a and de_empresa = '9904') then
    raise exception 'PRUEBA G01c · 4: la que ya no lo es no se quita (%).', r;
  end if;
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(pg_temp.sola('empresa', '9901', null, 'baja')));
  select count(*) into n from public.conta_gestoria_ficha where account_id = a and party_id in (pe, pr) and (tipo_ficha = 'empresa' or de_empresa = '9902');
  if n <> 3 then raise exception 'PRUEBA G01c · 4: guardar los clientes se lleva fichas o personas (%).', n; end if;
  raise notice 'G01c · 4: las personas de contacto cuelgan de su cliente, y se quitan las que ya no lo son. OK';

  -- 5 · Los dos porqués nuevos de «Pendiente de revisar».
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, quien_name) values (a, 'bitrix', 'pruebas', 'persona', 'PRUEBA G01C') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, crm, tipo_ficha, id_externo, party_id, datos)
  values (a, l, 'contacto_solo_negociacion', 'solo_negociacion', 'Contacto con solo una negociación: ¿es cliente?', 'bitrix24', 'contacto', '9901', pc, '{}'),
         (a, l, 'contacto_empresa_con_datos', 'empresa_con_datos', 'Contacto con empresa y con datos de cliente', 'bitrix24', 'contacto', '9905', pe, '{}');
  begin
    insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, datos) values (a, l, 'inventada', 'x', 'x', '{}');
    raise exception 'PRUEBA G01c · 5: entra un tipo inventado.';
  exception when check_violation then null;
  end;
  if (select count(*) from public.conta_consulta_diferencias where cuenta_id = a and tipo_ficha = 'contacto') <> 2 then
    raise exception 'PRUEBA G01c · 5: la vista de consulta no enseña la ficha del CRM.';
  end if;
  raise notice 'G01c · 5: los dos porqués de los contactos entran, y uno inventado no. OK';

  -- 6 · Sin sesión, no se confirma el mapa.
  update public.conta_crm set campos_medidos_contactos = '{"NAME":{"title":"Nombre"},"ADDRESS":{"title":"Dirección"},"UF_CRM_G01C_NIF":{"formLabel":"NIF/NIE"},
    "UF_CRM_G01C_TARIFA":{"formLabel":"Tarifa Recurrente"},"UF_CRM_G01C_TIPO":{"formLabel":"Tipo de cliente","items":[{"ID":"1","VALUE":"Solo renta"}]}}'::jsonb,
    campos_medidos = '{"TITLE":{"title":"Nombre"},"UF_CRM_G01C_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"}]}}'::jsonb
   where account_id = a and crm = 'bitrix24';
  if not found then
    insert into public.conta_crm (account_id, crm, entorno, portal, campos_medidos, campos_medidos_contactos)
    values (a, 'bitrix24', 'pruebas', 'portal-de-prueba.bitrix24.es',
      '{"TITLE":{"title":"Nombre"},"UF_CRM_G01C_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"}]}}'::jsonb,
      '{"NAME":{"title":"Nombre"},"ADDRESS":{"title":"Dirección"},"UF_CRM_G01C_NIF":{"formLabel":"NIF/NIE"},
        "UF_CRM_G01C_TARIFA":{"formLabel":"Tarifa Recurrente"},"UF_CRM_G01C_TIPO":{"formLabel":"Tipo de cliente","items":[{"ID":"1","VALUE":"Solo renta"}]}}'::jsonb);
  end if;
  begin
    perform public.conta_crm_confirmar_mapa(a, 'bitrix24', 'contacto', '{}'::jsonb);
    raise exception 'PRUEBA G01c · 6: sin sesión se confirma el mapa de contactos.';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'G01c · 6: sin sesión no se confirma. OK';
end $$;

-- 6 · Como la persona (authenticated, con su sub).
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _u); r jsonb; m jsonb;
        bueno jsonb := '{"nif":"UF_CRM_G01C_NIF","direccion":{"calle":"ADDRESS"},"cuota":"UF_CRM_G01C_TARIFA","tipoCliente":"UF_CRM_G01C_TIPO","textosTipo":{"1":"Solo renta"}}';
begin
  begin
    perform public.conta_crm_confirmar_mapa(a, 'bitrix24', 'contacto', jsonb_set(bueno, '{nif}', '"UF_CRM_QUE_NO_EXISTE"'));
    raise exception 'PRUEBA G01c · 6: entra un código que el portal no tiene.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%UF_CRM_QUE_NO_EXISTE%' then raise exception 'PRUEBA G01c · 6: el error no dice qué código falta (%).', sqlerrm; end if;
  end;
  r := public.conta_crm_confirmar_mapa(a, 'bitrix24', 'contacto', bueno);
  if r->>'frase' not like 'Mapa de los contactos de Bitrix24 confirmado por %' then raise exception 'PRUEBA G01c · 6: la frase no dice lo confirmado (%).', r->>'frase'; end if;
  select mapa_contactos into m from public.conta_crm where account_id = a and crm = 'bitrix24';
  if m->'confirmado'->>'cuando' is null or m->>'nif' <> 'UF_CRM_G01C_NIF' or m->'textosTipo'->>'1' <> 'Solo renta' then
    raise exception 'PRUEBA G01c · 6: el mapa de contactos no queda confirmado y como se mandó (%).', m;
  end if;
  -- El de las empresas, por la función de antes (lo que llama el front publicado).
  r := public.conta_bitrix_confirmar_mapa(a, '{"campos":[{"codigo":"TITLE","campo":"nombre"},{"codigo":"UF_CRM_G01C_SIT","campo":"situacion","opciones":{"1":"activo"}}]}'::jsonb);
  if r->>'frase' not like 'Mapa de Bitrix24 confirmado por %: 2 campos y 0 fuentes de la dirección.%' then raise exception 'PRUEBA G01c · 6: el de las empresas no se confirma (%).', r->>'frase'; end if;
  raise notice 'G01c · 6: %', r->>'frase';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · La vuelta atrás, con contactos, personas de contacto y diferencias ya guardados.
\i supabase/vuelta-atras/20261107T1925_g01c_crm_y_contactos.down.sql
do $$
declare f record;
begin
  for f in select * from _antes loop
    if md5(pg_get_functiondef(f.firma::regprocedure)) is distinct from f.huella then raise exception 'PRUEBA G01c · 7: % no vuelve a ser la de antes.', f.firma; end if;
  end loop;
  if (select count(*) from _antes) <> 6 then raise exception 'PRUEBA G01c · 7: faltan funciones por comparar.'; end if;
  if to_regclass('public.conta_crm') is not null or to_regprocedure('public._conta_crm_desde_bitrix()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.conta_crm_bitrix'::regclass and not tgisinternal and tgname = 'conta_crm_bitrix_a_crm') then
    raise exception 'PRUEBA G01c · 7: quedan conta_crm o sus espejos.';
  end if;
  if (select portal from public.conta_crm_bitrix where account_id = (select cuenta from _u)) is distinct from 'portal-nuevo.bitrix24.es' then
    raise exception 'PRUEBA G01c · 7: conta_crm_bitrix no tiene al día la fila de Bitrix24.';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_gestoria_ficha_pkey') <> 'PRIMARY KEY (account_id, bitrix_id)'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_crm_bitrix_pkey') <> 'PRIMARY KEY (account_id)' then
    raise exception 'PRUEBA G01c · 7: las claves no vuelven a ser las de antes.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('conta_gestoria_ficha', 'conta_gestoria_cliente', 'conta_gestoria_diferencia')
               and column_name in ('crm', 'tipo_ficha', 'id_externo', 'de_empresa', 'forma_pago_crm', 'emisor_segun_crm')) then
    raise exception 'PRUEBA G01c · 7: quedan columnas neutras.';
  end if;
  if to_regprocedure('public.conta_crm_guardar_clientes(uuid,text,jsonb)') is not null or to_regprocedure('public._conta_crm_nombre(text)') is not null then
    raise exception 'PRUEBA G01c · 7: quedan funciones neutras.';
  end if;
  if not exists (select 1 from public.party where name = 'CLIENTE PRUEBA G01C contacto 9901') then raise exception 'PRUEBA G01c · 7: se ha borrado un cliente.'; end if;
  if not exists (select 1 from public.conta_gestoria_ficha where bitrix_id = '9902') or exists (select 1 from public.conta_gestoria_ficha where bitrix_id = '9905') then
    raise exception 'PRUEBA G01c · 7: las fichas de las empresas no vuelven con su bitrix_id, o quedan las de los contactos.';
  end if;
  if (select count(*) from public.conta_consulta_clientes) is null or (select count(*) from public.conta_consulta_diferencias) is null then raise exception 'PRUEBA G01c · 7: las vistas no vuelven.'; end if;
  raise notice 'G01c · 7: la vuelta atrás deja todo como antes, sin borrar clientes. OK';
end $$;

rollback;
