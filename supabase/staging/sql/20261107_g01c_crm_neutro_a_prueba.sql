-- supabase/staging/sql/20261107_g01c_crm_neutro_a_prueba.sql
--
-- SOLO STAGING. Prueba del G01c · PR A de la clave neutra (20261107T2310).
-- Todo en una transacción con ROLLBACK, con datos inventados (T11): no cambia
-- staging.
--
--   1. Los campos que no se leen nunca: contraseñas, certificados, el IBAN,
--      «Detalles del pago» (y su código BANKING_DETAILS); los demás, sí.
--   2. Confirmar el mapa los para, en las empresas y en los contactos (la de
--      la 1110 lo hacía; la neutra lo había perdido). Un mapa bueno se
--      confirma y conserva la unión aplicada.
--   3. La conexión con el CRM: guardar y leer la dirección con el CRM (en
--      Vault: solo donde lo hay); una dirección mal escrita o otro CRM, no.
--   4. Los tipos neutros de «Pendiente de revisar» y el origen «crm» entran.
--   5. La vuelta atrás, con filas de los tipos y del origen nuevos: todo como
--      antes.
--
-- sin usuario: los campos sensibles, la conexión y los CHECK no los llama una persona (el servidor); confirmar el mapa se prueba como la persona en el paso 2.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01c-A: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes (firma text primary key, huella text) on commit drop;
select to_regprocedure('public.conta_crm_secreto(uuid,text)') is not null as ya_esta_la_2310 \gset
\if :ya_esta_la_2310
insert into _antes select firma, huella from public.funcion_respaldo where migracion = '20261107T2310_g01c_crm_neutro_a';
\else
insert into _antes select f, md5(pg_get_functiondef(f::regprocedure)) from unnest(array['public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)']) f;
\i supabase/migrations/20261107T2310_g01c_crm_neutro_a.sql
\endif

-- 1 · Los campos que no se leen nunca.
do $$ begin
  if not (public._conta_crm_campo_sensible('UF_X', '{"formLabel":"IBAN"}') and public._conta_crm_campo_sensible('UF_X', '{"formLabel":"Detalles del pago"}')
          and public._conta_crm_campo_sensible('BANKING_DETAILS', '{"title":"Banking details"}') and public._conta_crm_campo_sensible('UF_X', '{"formLabel":"Clave Cl@ve"}')
          and public._conta_crm_campo_sensible('UF_X', '{"type":"file","title":"Certificado"}') and public._conta_crm_campo_sensible('UF_X', '{"formLabel":"Contraseña de la sede"}')) then
    raise exception 'PRUEBA G01c-A · 1: algún campo sensible se dejaría leer.';
  end if;
  if public._conta_crm_campo_sensible('ADDRESS', '{"title":"Dirección"}') or public._conta_crm_campo_sensible('UF_X', '{"formLabel":"NIF/NIE"}')
     or public._conta_crm_campo_sensible('UF_X', '{"formLabel":"Clasificación"}') then
    raise exception 'PRUEBA G01c-A · 1: un campo normal sale como sensible.';
  end if;
  raise notice 'G01c-A · 1: contraseñas, certificados, IBAN y «Detalles del pago», fuera; los demás, dentro. OK';
end $$;

-- Una cuenta de staging con una persona administradora o encargada activa, y su CRM inventado.
create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub from public.user_profiles p
 where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
do $$ begin
  if (select cuenta from _u) is null then raise exception 'PRUEBA G01c-A · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, campos_medidos, campos_medidos_contactos, mapa, union_aplicada)
  select cuenta, 'bitrix24', 'pruebas', 'portal-de-prueba.bitrix24.es',
    '{"TITLE":{"title":"Nombre"},"UF_A_SIT":{"listLabel":"Situación del Cliente","items":[{"ID":"1","VALUE":"ACTIVO"}]},"BANKING_DETAILS":{"title":"Detalles del pago"}}'::jsonb,
    '{"NAME":{"title":"Nombre"},"UF_A_NIF":{"formLabel":"NIF/NIE"},"UF_A_IBAN":{"formLabel":"IBAN"}}'::jsonb,
    '{"campos":[],"union":{"quien":"PERSONA PRUEBA","cuando":"2026-11-07T13:00:00Z"}}'::jsonb, '{"quien":"PERSONA PRUEBA","cuando":"2026-11-07T13:00:00Z"}'::jsonb from _u
  on conflict (account_id, crm) do update set campos_medidos = excluded.campos_medidos, campos_medidos_contactos = excluded.campos_medidos_contactos,
    mapa = excluded.mapa, union_aplicada = excluded.union_aplicada;
end $$;

-- 2 · Confirmar el mapa, como la persona.
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _u); r jsonb; m jsonb;
        empresas jsonb := '{"campos":[{"codigo":"TITLE","campo":"nombre"},{"codigo":"UF_A_SIT","campo":"situacion","opciones":{"1":"activo"}}],"direcciones":[]}';
begin
  begin
    perform public.conta_crm_confirmar_mapa(a, 'bitrix24', 'empresa', jsonb_set(empresas, '{campos}', (empresas->'campos') || '[{"codigo":"BANKING_DETAILS","campo":"forma_pago"}]'));
    raise exception 'PRUEBA G01c-A · 2: se confirma un mapa de empresas con «Detalles del pago».';
  exception when sqlstate '22023' then
    if sqlerrm not like '%no se leen nunca%' then raise exception 'PRUEBA G01c-A · 2: el error no dice por qué (%).', sqlerrm; end if;
  end;
  begin
    perform public.conta_crm_confirmar_mapa(a, 'bitrix24', 'contacto', '{"nif":"UF_A_IBAN","direccion":null,"cuota":null,"tipoCliente":null}');
    raise exception 'PRUEBA G01c-A · 2: se confirma un mapa de contactos con el IBAN.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%IBAN%' then raise exception 'PRUEBA G01c-A · 2: el error no dice qué campo (%).', sqlerrm; end if;
  end;
  r := public.conta_crm_confirmar_mapa(a, 'bitrix24', 'empresa', empresas);
  r := public.conta_crm_confirmar_mapa(a, 'bitrix24', 'contacto', '{"nif":"UF_A_NIF","direccion":null,"cuota":null,"tipoCliente":null}');
  select mapa into m from public.conta_crm where account_id = a and crm = 'bitrix24';
  if m->'confirmado' is null or m->'union'->>'cuando' is null then raise exception 'PRUEBA G01c-A · 2: el mapa bueno no se confirma o pierde la unión (%).', m; end if;
  raise notice 'G01c-A · 2: confirmar el mapa para los campos que no se leen nunca, en empresas y contactos; el bueno se confirma con su unión. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La conexión con el CRM (Vault, solo donde lo hay: staging sí).
do $$
declare a uuid := (select cuenta from _u); s record;
begin
  begin
    perform public.conta_crm_guardar_conexion(a, 'bitrix24', 'pruebas', 'https://mal-escrita', 'x', 'PERSONA PRUEBA');
    raise exception 'PRUEBA G01c-A · 3: entra una dirección mal escrita.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_crm_guardar_conexion(a, 'otro_crm', 'pruebas', 'https://otro.test/', 'x', 'PERSONA PRUEBA');
    raise exception 'PRUEBA G01c-A · 3: entra un CRM que Sumied no sabe conectar.';
  exception when sqlstate '22023' then null;
  end;
  if to_regclass('vault.secrets') is null then
    raise notice 'G01c-A · 3: esta base no tiene Vault: la dirección se prueba en staging.';
    return;
  end if;
  perform public.conta_crm_guardar_conexion(a, 'bitrix24', 'pruebas', 'https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/', 'portal-de-prueba.bitrix24.es', 'PERSONA PRUEBA');
  select * into s from public.conta_crm_secreto(a, 'bitrix24');
  if s.url is distinct from 'https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/' or s.entorno <> 'pruebas' then
    raise exception 'PRUEBA G01c-A · 3: la dirección guardada no es la que se lee.';
  end if;
  raise notice 'G01c-A · 3: la conexión se guarda y se lee con el CRM; mal escrita u otro CRM, no. OK';
end $$;

-- 4 · Los tipos neutros y el origen «crm».
do $$
declare a uuid := (select cuenta from _u); l uuid;
begin
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, quien_name) values (a, 'crm', 'pruebas', 'persona', 'PRUEBA G01C-A') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, datos)
  select a, l, t, t, 'PRUEBA G01C-A', '{}' from unnest(array['crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm']) t;
  raise notice 'G01c-A · 4: los tres tipos neutros y el origen «crm» entran. OK';
end $$;

-- 5 · La vuelta atrás, con filas de los tipos y del origen nuevos.
\i supabase/vuelta-atras/20261107T2310_g01c_crm_neutro_a.down.sql
do $$
declare f record;
begin
  for f in select * from _antes loop
    if md5(pg_get_functiondef(f.firma::regprocedure)) is distinct from f.huella then raise exception 'PRUEBA G01c-A · 5: % no vuelve a ser la de antes.', f.firma; end if;
  end loop;
  if (select count(*) from _antes) <> 1 then raise exception 'PRUEBA G01c-A · 5: falta la función por comparar.'; end if;
  if to_regprocedure('public.conta_crm_secreto(uuid,text)') is not null or to_regprocedure('public.conta_crm_guardar_conexion(uuid,text,text,text,text,text)') is not null
     or to_regprocedure('public._conta_crm_campo_sensible(text,jsonb)') is not null then
    raise exception 'PRUEBA G01c-A · 5: quedan funciones nuevas.';
  end if;
  if exists (select 1 from public.conta_gestoria_diferencia where tipo in ('crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm'))
     or exists (select 1 from public.conta_gestoria_lectura where origen = 'crm')
     or (select count(*) from public.conta_gestoria_diferencia where porque = 'PRUEBA G01C-A' and tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix')) <> 3 then
    raise exception 'PRUEBA G01c-A · 5: las filas de lo nuevo no vuelven a lo de antes.';
  end if;
  raise notice 'G01c-A · 5: la vuelta atrás deja todo como antes. OK';
end $$;

rollback;
