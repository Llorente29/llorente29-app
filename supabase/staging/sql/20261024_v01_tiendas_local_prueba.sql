-- supabase/staging/sql/20261024_v01_tiendas_local_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T2031_v01_tiendas_local (cambia
-- public.platform_store: un disparador nuevo; y pone el local a las tiendas que
-- no lo tienen), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la cuenta A (carril 0), con sus locales de prueba: Norte Centro y Norte
-- Puerto, a los que se les pone una dirección dentro de la transacción.
--
--   0. Direcciones: Norte Centro «Florencio Llorente, 29» y Norte Puerto
--      «Camichi, 4»; y cuatro tiendas de Uber SIN local que ya existían antes
--      de la migración: dos de Florencio Llorente, una de Camichi y una de una
--      calle que no es de nadie.
--   1. La migración: las tres que casan, con su local y con su copia previa;
--      la que no casa, sin local y sin copia.
--   2. Una tienda nueva que llega sin local: se lo pone sola. Una que no casa:
--      entra igual, sin local, y se avisa (tienda_sin_local). Una que llega con
--      su local puesto: se respeta. Quitarle el local a mano: se queda sin él.
--   3. Dos locales con la misma dirección: no se adivina (sin local).
--   4. La vuelta atrás: cada tienda vuelve al local que tenía (ninguno), y ni
--      disparador, ni funciones, ni copia.

-- sin usuario: platform_store la escriben las liquidaciones (conta_liquidacion_registrar, con la
-- clave de servicio desde el correo) y el disparador corre con los permisos de la función; no
-- hay ninguna pantalla ni función de usuario nueva que probar como usuario.
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01 TIENDAS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Lo de antes es producción: sin el disparador ni las funciones.
\i supabase/vuelta-atras/20261024T2031_v01_tiendas_local.down.sql

create temp table _t (clave text primary key, v uuid) on commit drop;
insert into _t values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('centro', 'c01a0000-0000-4000-8000-0000000000a2');
insert into _t select 'puerto', l.id from public.locations l
 where l.account_id = 'c01a0000-0000-4000-8000-00000000000a' and l.id <> 'c01a0000-0000-4000-8000-0000000000a2' order by l.name limit 1;

-- 0 · Direcciones y tiendas de antes.
do $$
declare v_cu uuid := (select v from _t where clave = 'cuenta'); v_em uuid := (select v from _t where clave = 'empresa');
        v_ce uuid := (select v from _t where clave = 'centro'); v_pu uuid := (select v from _t where clave = 'puerto');
begin
  if v_pu is null then raise exception 'PRUEBA V01 TIENDAS · 0: la cuenta A no tiene un segundo local.'; end if;
  update public.locations set address = 'Florencio Llorente, 29' where id = v_ce;
  update public.locations set address = 'Camichi, 4' where id = v_pu;
  update public.locations set address = 'Otra Calle De Prueba, 7' where account_id = v_cu and id not in (v_ce, v_pu);
  insert into public.platform_store (account_id, company_id, provider, external_text) values
    (v_cu, v_em, 'uber', 'Prueba Burrito (Calle de Florencio Llorente 29, Madrid, ES, 28027)'),
    (v_cu, v_em, 'uber', 'Prueba Pita (Calle de Florencio Llorente 29, Madrid, ES, 28027)'),
    (v_cu, v_em, 'uber', 'Prueba Pita (Calle de Camichi 4) (Calle de Camichi 4, Madrid, ES, 28025)'),
    (v_cu, v_em, 'uber', 'Prueba Kebab (Calle Que No Existe 99, Madrid, ES, 28001)');
  raise notice '0 · Norte Centro en Florencio Llorente 29, el otro local en Camichi 4, y cuatro tiendas de Uber sin local';
end $$;

\i supabase/migrations/20261024T2031_v01_tiendas_local.sql

-- 1 · Lo que hace la migración con las que ya estaban.
do $$
declare v_ce uuid := (select v from _t where clave = 'centro'); v_pu uuid := (select v from _t where clave = 'puerto'); v_n int;
begin
  if public.conta_clave_direccion('Florencio Llorente, 29') <> public.conta_clave_direccion('Calle de Florencio Llorente 29') then
    raise exception 'PRUEBA V01 TIENDAS · 1: «Florencio Llorente, 29» y «Calle de Florencio Llorente 29» no dan la misma clave.';
  end if;
  if (select location_id from public.platform_store where external_text like 'Prueba Burrito (%') is distinct from v_ce
     or (select location_id from public.platform_store where external_text like 'Prueba Pita (Calle de Florencio%') is distinct from v_ce then
    raise exception 'PRUEBA V01 TIENDAS · 1: las de Florencio Llorente no van a Norte Centro.';
  end if;
  if (select location_id from public.platform_store where external_text like 'Prueba Pita (Calle de Camichi 4)%') is distinct from v_pu then
    raise exception 'PRUEBA V01 TIENDAS · 1: la de Camichi no va a su local («los últimos paréntesis»).';
  end if;
  if (select location_id from public.platform_store where external_text like 'Prueba Kebab (%') is not null then
    raise exception 'PRUEBA V01 TIENDAS · 1: la de una calle que no es de nadie tiene local.';
  end if;
  select count(*) into v_n from public.conta_tienda_local_antes c join public.platform_store ps on ps.id = c.store_id
   where ps.external_text like 'Prueba %' and c.location_antes is null and c.location_puesto = ps.location_id;
  if v_n <> 3 then raise exception 'PRUEBA V01 TIENDAS · 1: la copia previa tiene % de las 3 que casan.', v_n; end if;
  if exists (select 1 from public.conta_tienda_local_antes c join public.platform_store ps on ps.id = c.store_id where ps.external_text like 'Prueba Kebab (%') then
    raise exception 'PRUEBA V01 TIENDAS · 1: la que no casa está en la copia.';
  end if;
  raise notice '1 · la migración: 3 con su local y su copia previa; la que no casa, sin local';
end $$;

-- 2 · Las que llegan después.
do $$
declare v_cu uuid := (select v from _t where clave = 'cuenta'); v_em uuid := (select v from _t where clave = 'empresa');
        v_ce uuid := (select v from _t where clave = 'centro'); v_pu uuid := (select v from _t where clave = 'puerto');
        v_id uuid; v_loc uuid; v_avisos int := 0; v_hay_cola boolean := to_regclass('public.system_alert_queue') is not null;
begin
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_cu, v_em, 'uber', 'Prueba Nueva (Calle de Camichi 4, Madrid, ES, 28025)') returning id, location_id into v_id, v_loc;
  if v_loc is distinct from v_pu then raise exception 'PRUEBA V01 TIENDAS · 2: la nueva de Camichi no se pone su local.'; end if;

  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_cu, v_em, 'uber', 'Prueba Perdida (Avenida Inventada 1, Madrid, ES, 28001)') returning location_id into v_loc;
  if v_loc is not null then raise exception 'PRUEBA V01 TIENDAS · 2: la que no casa tiene local.'; end if;
  if v_hay_cola then
    execute 'select count(*) from public.system_alert_queue where kind = ''tienda_sin_local'' and message like ''%Prueba Perdida%''' into v_avisos;
    if v_avisos <> 1 then raise exception 'PRUEBA V01 TIENDAS · 2: la que no casa no avisa (% avisos).', v_avisos; end if;
  end if;

  insert into public.platform_store (account_id, company_id, provider, external_text, location_id)
  values (v_cu, v_em, 'uber', 'Prueba Puesta (Calle de Camichi 4, Madrid, ES, 28025)', v_ce) returning location_id into v_loc;
  if v_loc is distinct from v_ce then raise exception 'PRUEBA V01 TIENDAS · 2: la que llega con su local no se respeta.'; end if;

  update public.platform_store set location_id = null where id = v_id returning location_id into v_loc;
  if v_loc is not null then raise exception 'PRUEBA V01 TIENDAS · 2: quitarle el local a mano no vale (se lo vuelve a poner).'; end if;
  raise notice '2 · la nueva se pone su local; la que no casa entra sin local y avisa (% aviso; cola %); la que trae local se respeta; quitarlo a mano vale', v_avisos, case when v_hay_cola then 'sí' else 'no hay' end;
end $$;

-- 3 · Dos locales con la misma dirección: no se adivina.
do $$
declare v_cu uuid := (select v from _t where clave = 'cuenta'); v_em uuid := (select v from _t where clave = 'empresa'); v_loc uuid;
begin
  update public.locations set address = 'Calle de Florencio Llorente 29' where id = (select v from _t where clave = 'puerto');
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_cu, v_em, 'uber', 'Prueba Doble (Calle de Florencio Llorente 29, Madrid, ES, 28027)') returning location_id into v_loc;
  if v_loc is not null then raise exception 'PRUEBA V01 TIENDAS · 3: con dos locales en la misma calle se adivina uno.'; end if;
  update public.locations set address = 'Camichi, 4' where id = (select v from _t where clave = 'puerto');
  raise notice '3 · dos locales con la misma dirección: sin local';
end $$;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261024T2031_v01_tiendas_local.down.sql
do $$ begin
  if exists (select 1 from public.platform_store where external_text in (
      'Prueba Burrito (Calle de Florencio Llorente 29, Madrid, ES, 28027)', 'Prueba Pita (Calle de Florencio Llorente 29, Madrid, ES, 28027)',
      'Prueba Pita (Calle de Camichi 4) (Calle de Camichi 4, Madrid, ES, 28025)') and location_id is not null) then
    raise exception 'PRUEBA V01 TIENDAS · 4: la vuelta atrás no les devuelve el local que tenían (ninguno).';
  end if;
  if to_regclass('public.conta_tienda_local_antes') is not null or to_regprocedure('public.conta_local_de_tienda(uuid,text)') is not null
     or to_regprocedure('public.conta_clave_direccion(text)') is not null
     or exists (select 1 from pg_trigger where tgname = 'conta_tienda_local_por_direccion') then
    raise exception 'PRUEBA V01 TIENDAS · 4: la vuelta atrás se deja la copia, las funciones o el disparador.';
  end if;
  raise notice '4 · la vuelta atrás: sin local otra vez, y ni copia, ni funciones, ni disparador';
  raise notice 'PRUEBA V01 TIENDAS en verde: las de antes con su local y su copia, las nuevas solas, la que no casa avisa, la vuelta atrás.';
end $$;

rollback;
