-- supabase/staging/sql/20261110_gb_bitrix_choques_prueba.sql
--
-- SOLO STAGING. Prueba de la 0050 del GB (nº 13, punto 2: los choques con
-- Bitrix24 a «Pendiente de revisar»). Va después de la 2235: si no está, la
-- pasa antes. Todo en ROLLBACK, con datos inventados (T11).
--
--   1. Un choque: una diferencia «bitrix_cambiado» del cliente, con su porqué,
--      la empresa y la ficha; y la ve la ficha del cliente (sus pendientes).
--   2. Otro choque del mismo campo: la misma diferencia, al día (no dos).
--   3. El campo escrito sin choque: su diferencia deja de estar; la de otro campo, no.
--   4. Sin lectura del CRM no apunta nada y lo dice; una empresa de otra cuenta, tampoco.
--   5. «Ya lo he revisado» la quita (conta_gestoria_revisada, del G01).
--   6. Los tipos de antes siguen valiendo; solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-0050: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regclass('public.conta_bitrix_pestana_cambio') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_choque(uuid,uuid,jsonb,text[])') is not null as ya_esta_la_0050 \gset
\if :ya_esta_la_0050
\i supabase/vuelta-atras/20261110T0050_gb_bitrix_choques.down.sql
\endif

create temp table _u (cuenta uuid, usuario uuid, empresa uuid, cliente uuid, cambio uuid, otra_empresa uuid) on commit drop;
do $$
declare a uuid; u uuid; e uuid; cl uuid; x uuid; e2 uuid;
begin
  select p.account_id, p.user_id into a, u from public.user_profiles p
   where p.active and p.role in ('admin', 'manager') and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
   order by p.created_at limit 1;
  if a is null then raise exception 'PRUEBA GB-0050 · 0: staging no tiene una persona con empresa.'; end if;
  select id into e from public.company where account_id = a and is_active order by created_at limit 1;
  select id into e2 from public.company where account_id <> a order by created_at limit 1;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 0050, S.L.', 'B00000050') returning id into cl;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, frase, hecho_por) values
    (a, cl, 'empresa', '90050', 'alta', 'Alta de prueba', u) returning id into x;
  insert into _u values (a, u, e, cl, x, e2);
end $$;

\i supabase/migrations/20261110T0050_gb_bitrix_choques.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;

-- 4 · Sin lectura del CRM: nada.
set local role service_role;
do $$ declare u record; begin
  select * into u from _u;
  insert into _r values ('sin_lectura', public.conta_bitrix_pestana_choque(u.cambio, u.empresa, '[{"campo":"Cuota mensual","en_bitrix":"300,00","sumied":"250,00"}]', '{}'));
end $$;
reset role;
insert into public.conta_gestoria_lectura (account_id, origen, entorno, por) select cuenta, 'crm', 'pruebas', 'persona' from _u;

set local role service_role;
do $$ declare u record; begin
  select * into u from _u;
  insert into _r values ('otra_empresa', public.conta_bitrix_pestana_choque(u.cambio, u.otra_empresa, '[{"campo":"Cuota mensual","en_bitrix":"300,00","sumied":"250,00"}]', '{}'));
  -- 1 · Dos choques.
  insert into _r values ('uno', public.conta_bitrix_pestana_choque(u.cambio, u.empresa,
    '[{"campo":"Cuota mensual","en_bitrix":"300,00","sumied":"250,00"},{"campo":"Trabajadores","en_bitrix":"25","sumied":"19"}]', '{}'));
  -- 2 · El mismo campo otra vez.
  insert into _r values ('dos', public.conta_bitrix_pestana_choque(u.cambio, u.empresa, '[{"campo":"Cuota mensual","en_bitrix":"310,00","sumied":"250,00"}]', '{}'));
  -- 3 · La cuota se escribe sin choque.
  insert into _r values ('tres', public.conta_bitrix_pestana_choque(u.cambio, u.empresa, '[]', '{"Cuota mensual"}'));
end $$;
reset role;

do $$
declare u record; n int; d public.conta_gestoria_diferencia; f jsonb;
begin
  select * into u from _u;
  if (select x.r->>'apuntadas' from _r x where x.paso = 'sin_lectura') <> '0' or (select x.r->>'porque' from _r x where x.paso = 'sin_lectura') not like 'La cuenta no ha leído nunca su CRM%'
     or (select x.r->>'apuntadas' from _r x where x.paso = 'otra_empresa') <> '0' then
    raise exception 'PRUEBA GB-0050 · 4: sin lectura u otra empresa tenían que no apuntar nada (%).', (select jsonb_agg(x.r) from _r x);
  end if;
  if (select x.r from _r x where x.paso = 'uno') <> '{"apuntadas":2,"quitadas":0}'::jsonb or (select x.r from _r x where x.paso = 'dos') <> '{"apuntadas":1,"quitadas":0}'::jsonb
     or (select x.r from _r x where x.paso = 'tres') <> '{"apuntadas":0,"quitadas":1}'::jsonb then
    raise exception 'PRUEBA GB-0050 · 1-3: lo devuelto no es lo esperado (%).', (select jsonb_agg(x.r) from _r x);
  end if;
  select count(*) into n from public.conta_gestoria_diferencia where party_id = u.cliente and tipo = 'bitrix_cambiado';
  if n <> 2 then raise exception 'PRUEBA GB-0050 · 2: tenía que haber una por campo (hay %).', n; end if;
  select * into d from public.conta_gestoria_diferencia where party_id = u.cliente and tipo = 'bitrix_cambiado' and datos->>'campo' = 'Cuota mensual';
  if d.vigente or d.porque <> 'En Bitrix24 alguien ha cambiado «Cuota mensual» a «310,00»; Sumied dice «250,00». No se ha pisado: mira cuál vale.'
     or d.company_id <> u.empresa or d.id_externo <> '90050' or d.tipo_ficha <> 'empresa' or d.crm <> 'bitrix24' then
    raise exception 'PRUEBA GB-0050 · 2-3: la de la cuota no es la esperada (%).', to_jsonb(d);
  end if;
  select * into d from public.conta_gestoria_diferencia where party_id = u.cliente and tipo = 'bitrix_cambiado' and datos->>'campo' = 'Trabajadores';
  if not d.vigente then raise exception 'PRUEBA GB-0050 · 3: la de Trabajadores tenía que seguir.'; end if;
  -- 1 · La ve la ficha del cliente, como la persona.
  perform set_config('request.jwt.claims', json_build_object('sub', u.usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', u.usuario::text || ':' || u.cuenta::text, true);
  f := public.conta_pantalla_ficha(u.cuenta, u.cliente);
  if not exists (select 1 from jsonb_array_elements(f->'pendientes') p where p->>'tipo' = 'bitrix_cambiado' and p->>'id' = d.id::text) then
    raise exception 'PRUEBA GB-0050 · 1: la ficha no la enseña (%).', f->'pendientes';
  end if;
  -- 5 · «Ya lo he revisado».
  perform public.conta_gestoria_revisada(d.id, 'Vale lo de Bitrix24, de prueba');
  if (select vigente from public.conta_gestoria_diferencia where id = d.id) then raise exception 'PRUEBA GB-0050 · 5: «Ya lo he revisado» no la quita.'; end if;
  -- 6 · Los tipos de antes siguen valiendo; solo el servidor.
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, tipo, porque_codigo, porque)
  select u.cuenta, (select id from public.conta_gestoria_lectura where account_id = u.cuenta order by empezada_at desc limit 1), u.empresa, u.cliente,
         'falta_cuenta_stripe', 'prueba', 'De prueba';
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_choque(uuid,uuid,jsonb,text[])', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_choque(uuid,uuid,jsonb,text[])', 'execute') then
    raise exception 'PRUEBA GB-0050 · 6: no es solo del servidor.';
  end if;
  raise notice 'GB-0050 · 1 a 6: el choque a «Pendiente de revisar» (uno por campo), lo escrito lo quita, sin lectura nada, la ficha lo ve, «Ya lo he revisado», los tipos de antes y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T0050_gb_bitrix_choques.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_choque(uuid,uuid,jsonb,text[])') is not null
     or exists (select 1 from public.conta_gestoria_diferencia where tipo = 'bitrix_cambiado') then
    raise exception 'PRUEBA GB-0050 · 6: la vuelta atrás no lo quita.';
  end if;
  raise notice 'GB-0050 · 6: la vuelta atrás lo quita. OK';
end $$;

rollback;
