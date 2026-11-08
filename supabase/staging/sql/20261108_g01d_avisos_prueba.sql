-- supabase/staging/sql/20261108_g01d_avisos_prueba.sql
--
-- SOLO STAGING. La tanda del G01d (avisos al instante), por sus caminos:
--   1. La 1620, si staging aún no la tiene (y pasarla dos veces no cambia nada).
--   2. COMO USUARIO de A (administrador): pega el código del CRM y enciende
--      «Al instante»; un código corto o con espacios no entra; GoCardless no se
--      enciende sin su secreto. Solo el servidor lee el código (conta_aviso_secreto).
--   3. RLS: A ve sus avisos; B no los ve; nadie de la cuenta escribe en la cola.
--   4. Las personas de UN contacto: se guardan sus empresas, se quitan las que
--      ya no son suyas y las de otro contacto no se tocan.
--   5. «Pendiente de revisar» de unas fichas: las suyas se renuevan, las demás no.
--   6. Una lectura «por aviso» entra; el repaso sin nada pendiente no llama a nadie.
--   7. La vuelta atrás, de verdad, dentro de la transacción.
-- Todo acaba en ROLLBACK. Datos inventados (T11).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1620, si falta.
select to_regclass('public.conta_aviso') is null as falta_1620 \gset
\if :falta_1620
\echo '>>> Staging aún no tiene la 1620 del G01d: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261108T1620_g01d_avisos.sql
\endif
\i supabase/migrations/20261108T1620_g01d_avisos.sql

-- Las conexiones de prueba de A: su CRM (el de pruebas) y GoCardless de su primera empresa.
create temp table _a on commit drop as
select 'c01a0000-0000-4000-8000-00000000000a'::uuid as cuenta,
       (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) as empresa;
grant select on _a to authenticated;
insert into public.conta_crm (account_id, crm, entorno, portal) select cuenta, 'bitrix24', 'pruebas', 'portal-de-prueba.bitrix24.es' from _a
on conflict (account_id, crm) do update set aviso_ref = null, aviso_encendido = false;
insert into public.conta_cobro_gocardless (company_id, account_id, entorno) select empresa, cuenta, 'pruebas' from _a
on conflict (company_id) do update set aviso_ref = null, aviso_encendido = false;

-- 2 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare r jsonb; c uuid := (select cuenta from _a); e uuid := (select empresa from _a);
begin
  r := public.conta_aviso_configurar(c, 'crm', 'bitrix24', null, 'codigodepruebainventado0000000000', true);
  if r->>'frase' not like 'Guardado el código de Bitrix24: no se vuelve a enseñar. «Al instante» encendido para Bitrix24%' then
    raise exception 'PRUEBA G01d · 2a: la frase al pegar y encender no dice lo que ha hecho (%).', r;
  end if;
  begin
    perform public.conta_aviso_configurar(c, 'crm', 'bitrix24', null, 'corto', null);
    raise exception 'PRUEBA G01d · 2b: entró un código corto.';
  exception when invalid_parameter_value then raise notice 'G01d · 2b: un código corto no entra (22023).';
  end;
  begin
    perform public.conta_aviso_configurar(c, 'gocardless', null, e, null, true);
    raise exception 'PRUEBA G01d · 2c: GoCardless se encendió sin su secreto.';
  exception when invalid_parameter_value then raise notice 'G01d · 2c: sin secreto no se enciende (22023).';
  end;
  begin
    perform * from public.conta_aviso_secreto('crm', c, 'bitrix24', null);
    raise exception 'PRUEBA G01d · 2d: una persona ha leído el código.';
  exception when insufficient_privilege then raise notice 'G01d · 2d: el código solo lo lee el servidor (42501).';
  end;
  if not (select aviso_encendido from public.conta_crm where account_id = c and crm = 'bitrix24') then
    raise exception 'PRUEBA G01d · 2e: el CRM no ha quedado encendido.';
  end if;
  raise notice 'G01d · 2: como usuario, pega el código y enciende; lo que no vale no entra. OK';
end $$;
reset role;
do $$
declare v record;
begin
  select * into v from public.conta_aviso_secreto('crm', (select cuenta from _a), 'bitrix24', null);
  if v.codigo is distinct from 'codigodepruebainventado0000000000' or not v.encendido or v.entorno <> 'pruebas' then
    raise exception 'PRUEBA G01d · 2f: el servidor no lee el código guardado (% · %).', v.encendido, v.entorno;
  end if;
  raise notice 'G01d · 2f: el servidor lee el código, encendido. OK';
end $$;

-- 3 · RLS de la cola: lo escribe el servidor; lo lee la cuenta.
insert into public.conta_aviso (account_id, origen, crm, clave, estado, tipo_ficha, id_externo, accion, frase)
select cuenta, 'crm', 'bitrix24', 'bitrix24:ONCRMCOMPANYUPDATE:901:1', 'hecho', 'empresa', '901', 'cambio', 'Empresa 901, al día.' from _a;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$ begin
  if (select count(*) from public.conta_aviso where clave = 'bitrix24:ONCRMCOMPANYUPDATE:901:1') <> 1 then raise exception 'PRUEBA G01d · 3a: A no ve su aviso.'; end if;
  begin
    insert into public.conta_aviso (account_id, origen, estado) values ((select cuenta from _a), 'crm', 'pendiente');
    raise exception 'PRUEBA G01d · 3b: una persona ha escrito en la cola.';
  exception when insufficient_privilege then raise notice 'G01d · 3b: nadie de la cuenta escribe en la cola (42501).';
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from public.conta_aviso where clave = 'bitrix24:ONCRMCOMPANYUPDATE:901:1') then raise exception 'PRUEBA G01d · 3c: B ve un aviso de A.'; end if;
  raise notice 'G01d · 3: A ve su aviso, B no, y nadie escribe en la cola. OK';
end $$;
reset role;
-- El mismo aviso dos veces no entra (una clave por cuenta).
do $$ begin
  begin
    insert into public.conta_aviso (account_id, origen, crm, clave, estado) select cuenta, 'crm', 'bitrix24', 'bitrix24:ONCRMCOMPANYUPDATE:901:1', 'pendiente' from _a;
    raise exception 'PRUEBA G01d · 3d: el mismo aviso ha entrado dos veces.';
  exception when unique_violation then raise notice 'G01d · 3d: el mismo aviso no entra dos veces (23505). OK';
  end;
end $$;

-- 4 · Las personas de UN contacto.
create temp table _p on commit drop as
select (select cuenta from _a) as cuenta, gen_random_uuid() as party1, gen_random_uuid() as party2;
insert into public.party (id, account_id, name, source) select party1, cuenta, 'PRUEBA G01D EMPRESA 901', 'crm' from _p;
insert into public.party (id, account_id, name, source) select party2, cuenta, 'PRUEBA G01D EMPRESA 902', 'crm' from _p;
insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, ficha)
select cuenta, 'bitrix24', 'empresa', '901', '', party1, '{}'::jsonb from _p union all
select cuenta, 'bitrix24', 'empresa', '902', '', party2, '{}'::jsonb from _p union all
select cuenta, 'bitrix24', 'contacto', '78', '901', party1, '{"idExterno":"78"}'::jsonb from _p;
do $$
declare r jsonb; c uuid := (select cuenta from _p);
begin
  r := public.conta_crm_guardar_personas_de_contacto(c, 'bitrix24', '77', '["901", "902", "999"]', '{"idExterno":"77","nombre":"Contacto de Prueba"}');
  if r <> '{"guardadas": 2, "sinCliente": 1, "quitadas": 0}'::jsonb then raise exception 'PRUEBA G01d · 4a: %', r; end if;
  r := public.conta_crm_guardar_personas_de_contacto(c, 'bitrix24', '77', '["902"]', '{"idExterno":"77","nombre":"Contacto de Prueba"}');
  if r <> '{"guardadas": 1, "sinCliente": 0, "quitadas": 1}'::jsonb then raise exception 'PRUEBA G01d · 4b: %', r; end if;
  if not exists (select 1 from public.conta_gestoria_ficha where account_id = c and tipo_ficha = 'contacto' and id_externo = '78' and de_empresa = '901') then
    raise exception 'PRUEBA G01d · 4c: se ha tocado la persona de contacto de otro contacto.';
  end if;
  raise notice 'G01d · 4: las personas de un contacto, sin tocar las de los demás. OK';
end $$;

-- 5 · «Pendiente de revisar» de unas fichas.
create temp table _l on commit drop as select gen_random_uuid() as id;
insert into public.conta_gestoria_lectura (id, account_id, origen, entorno, por) select (select id from _l), cuenta, 'crm', 'pruebas', 'aviso' from _p;
insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, crm, tipo_ficha, id_externo)
select cuenta, (select id from _l), 'nif_no_valido', 'formato', 'De antes (901).', 'bitrix24', 'empresa', '901' from _p union all
select cuenta, (select id from _l), 'nif_no_valido', 'formato', 'De antes (902).', 'bitrix24', 'empresa', '902' from _p;
do $$
declare n int; c uuid := (select cuenta from _p);
begin
  n := public.conta_crm_renovar_pendientes(c, 'bitrix24', (select id from _l), '[{"tipoFicha":"empresa","idExterno":"901"}]',
    '[{"tipo":"fichas_repetidas","porque_codigo":"mismo_nif","porque":"Nueva (901).","tipo_ficha":"empresa","id_externo":"901","datos":{"fichas":["empresa:901"]}}]');
  if n <> 1 then raise exception 'PRUEBA G01d · 5a: % diferencias nuevas.', n; end if;
  if exists (select 1 from public.conta_gestoria_diferencia where account_id = c and vigente and porque = 'De antes (901).') then raise exception 'PRUEBA G01d · 5b: la de antes de la 901 sigue vigente.'; end if;
  if not exists (select 1 from public.conta_gestoria_diferencia where account_id = c and vigente and porque = 'De antes (902).') then raise exception 'PRUEBA G01d · 5c: se ha tocado la de la 902.'; end if;
  if not exists (select 1 from public.conta_gestoria_diferencia d join _p on d.party_id = _p.party1 where d.vigente and d.porque = 'Nueva (901).') then
    raise exception 'PRUEBA G01d · 5d: la nueva no lleva el cliente de su ficha.';
  end if;
  raise notice 'G01d · 5: se renueva el «Pendiente de revisar» de esa ficha y no el de las demás. OK';
end $$;

-- 6 · El repaso sin nada que toque no llama a nadie (no hay ningún aviso pendiente).
do $$ begin
  if exists (select 1 from public.conta_aviso where estado in ('pendiente', 'fallo', 'trabajando')) then
    raise notice 'G01d · 6: staging tiene avisos en cola; el repaso no se prueba aquí para no llamar a nadie.';
  else
    perform public.conta_avisos_despertar();
    raise notice 'G01d · 6: el repaso sin nada pendiente no hace nada. OK';
  end if;
end $$;

-- 7 · La vuelta atrás, de verdad.
\i supabase/vuelta-atras/20261108T1620_g01d_avisos.down.sql
do $$ begin
  if to_regclass('public.conta_aviso') is not null then raise exception 'PRUEBA G01d · 7: queda la cola.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_crm' and column_name like 'aviso_%') then raise exception 'PRUEBA G01d · 7: quedan columnas del aviso.'; end if;
  if to_regprocedure('public.conta_aviso_configurar(uuid,text,text,uuid,text,boolean)') is not null then raise exception 'PRUEBA G01d · 7: queda conta_aviso_configurar.'; end if;
  if exists (select 1 from public.conta_gestoria_lectura where por = 'aviso') then raise exception 'PRUEBA G01d · 7: queda una lectura «por aviso».'; end if;
  raise notice 'G01d · 7: la vuelta atrás deja la base como estaba. OK';
end $$;

rollback;
