-- supabase/staging/sql/20261109_gd_tarifa_demo_prueba.sql
--
-- SOLO STAGING. La 1130 del GD (la tarifa de «Gestoría Demo»), por sus caminos,
-- sobre la «Gestoría Demo» de staging (la crea la 0110, sin administrador) con
-- lo que deja la importación de GoCardless puesto a mano dentro de la prueba:
--   1. Sin administrador, no siembra nada y lo dice.
--   2. Con administrador: los 3 niveles con su precio, cada cliente en su nivel,
--      el precio especial, laboral, impuesto de sociedades (con su precio en los
--      dos servicios de la importación, sin juntarlos), nóminas por tramos, el
--      paquete y las líneas de la autónoma.
--   5b. La vuelta atrás deja la demo exactamente como estaba (la huella de sus
--      servicios, líneas y tarifas, igual que antes de sembrar).
--   3. Sembrar otra vez deja exactamente lo mismo (la huella, igual).
--   4. En una cuenta que no es demo, no siembra (42501).
--   5. La vuelta atrás quita la tarifa y la función.
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la siembra la llama la plataforma; dentro actúa como el
-- administrador de la cuenta, y eso es lo que se prueba.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T1130_gd_tarifa_demo.sql

-- 1 · Sin administrador, nada.
do $$ declare v jsonb; begin
  v := public.demo_gestoria_tarifa_sembrar('de000000-0000-4000-8000-0000000000a0');
  if v->>'frase' not like '%no tiene administrador%' then raise exception 'GD · 1: sin administrador tenía que no sembrar: %', v->>'frase'; end if;
  raise notice 'GD · 1: sin administrador, no siembra y lo dice. OK';
end $$;

-- Lo que dejaría la importación: un administrador (un usuario de prueba de staging), los servicios, clientes, tarifas y líneas.
do $$
declare
  c constant uuid := 'de000000-0000-4000-8000-0000000000a0';
  s constant uuid := 'de000000-0000-4000-8000-0000000000a9';
  a constant uuid := 'de000000-0000-4000-8000-0000000000b9';
  v_admin uuid := (select id from auth.users where email = 'p01.laura@p01-prueba.test');
  gm uuid; lab uuid; i1 uuid; i2 uuid; p uuid; r record;
begin
  if v_admin is null then raise exception 'PRUEBA GD: falta el usuario de prueba p01.laura en staging.'; end if;
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (v_admin, c, 'admin', true, 'Administración GD (prueba)', now(), now());
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (c, s, 'gestoria_mensual', 'Gestoría mensual', 'fijo_mes') returning id into gm;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (c, s, 'gestion_laboral', 'Gestión laboral', 'por_empleado') returning id into lab;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma, por_confirmar) values (c, s, 'impuesto de sociedades uno', 'IMPUESTO DE SOCIEDADES UNO', 'fijo_anio', true) returning id into i1;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma, por_confirmar) values (c, s, 'impuesto de sociedades dos', 'IMPUESTO DE SOCIEDADES DOS', 'fijo_anio', true) returning id into i2;
  for r in select * from (values ('Frutas Hermanos Ortega, S.L.', 120, 'soc'), ('Cliente Básica de Prueba, S.L.', 90, 'soc'), ('Cliente Premium de Prueba, S.L.', 150, 'soc'),
                                 ('Autónoma Activa de Prueba', 0, 'activo'), ('Autónomo Renta de Prueba', 0, 'solo_renta'), ('Autónomo de Baja de Prueba', 0, 'baja')) x(nombre, importe, que) loop
    insert into public.party (account_id, name) values (c, r.nombre) returning id into p;
    if r.que = 'soc' then
      insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, origen) values (c, s, gm, p, r.importe, 'mes', date '2026-12-01', 'gocardless');
      insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, periodo, desde) values (c, s, p, gm, 'gocardless', 'mes', date '2026-12-01');
      insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, periodo, desde, empleado_nombre) values (c, s, p, lab, 'gocardless', 'mes', date '2026-12-01', 'Trabajador de Prueba');
    else
      insert into public.conta_gestoria_cliente (account_id, party_id, situacion, emisor_segun_crm, crm, tipo_ficha, id_externo) values (c, p, r.que, a, 'bitrix24', 'empresa', 'gd-prueba-' || r.nombre);
    end if;
  end loop;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, periodo, desde)
  select c, s, (select id from public.party where account_id = c and name = 'Cliente Premium de Prueba, S.L.'), i2, 'gocardless', 'anio', date '2027-06-01';
end $$;

create temp table _huella (vuelta int, huella text) on commit drop;
create temp table _antes_de_sembrar on commit drop as
select md5(coalesce(string_agg(x, '|' order by x), '')) huella from (
  select concat_ws(';', 'servicio', nombre, forma, por_confirmar, clave) x from public.conta_servicio where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'linea', servicio_id, party_id, nivel_id, origen) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'tarifa', servicio_id, party_id, importe) from public.conta_tarifa where account_id = 'de000000-0000-4000-8000-0000000000a0') q;
-- 2 · Sembrar.
do $$
declare c constant uuid := 'de000000-0000-4000-8000-0000000000a0'; v jsonb; n int;
begin
  v := public.demo_gestoria_tarifa_sembrar(c);
  raise notice 'GD · 2: %', v->>'frase';
  select count(*) into n from public.conta_servicio_nivel where account_id = c;
  if n <> 3 then raise exception 'GD · 2: tenía que haber 3 niveles y hay %.', n; end if;
  select count(*) into n from public.conta_linea l join public.conta_servicio_nivel nv on nv.id = l.nivel_id where l.account_id = c;
  if n <> 3 then raise exception 'GD · 2: los 3 clientes de la gestoría mensual tenían que tener su nivel y hay %.', n; end if;
  if (select nv.nombre from public.conta_linea l join public.conta_servicio_nivel nv on nv.id = l.nivel_id join public.party p on p.id = l.party_id where p.name = 'Frutas Hermanos Ortega, S.L.') <> 'Premium' then
    raise exception 'GD · 2: Frutas Hermanos Ortega tenía que ir en Premium (con su precio especial).';
  end if;
  select count(*) into n from public.conta_precio where account_id = c and party_id is not null and importe = 120;
  if n <> 1 then raise exception 'GD · 2: tenía que haber 1 precio especial y hay %.', n; end if;
  select count(*) into n from public.conta_precio p join public.conta_servicio s on s.id = p.servicio_id
   where s.account_id = c and upper(s.nombre) like 'IMPUESTO DE SOCIEDADES%' and p.importe = 300 and p.periodo = 'anio' and p.party_id is null;
  if n <> 2 then raise exception 'GD · 2: los 2 servicios del impuesto de la importación tenían que tener su precio de 300 € al año y hay %.', n; end if;
  select count(*) into n from public.conta_precio_tramo t join public.conta_precio p on p.id = t.precio_id join public.conta_servicio s on s.id = p.servicio_id where s.account_id = c and s.nombre = 'Nóminas';
  if n <> 3 then raise exception 'GD · 2: Nóminas tenía que tener 3 tramos y tiene %.', n; end if;
  select count(*) into n from public.conta_precio p join public.conta_paquete k on k.id = p.paquete_id where k.account_id = c and k.nombre = 'Pack Empresa' and p.importe = 180;
  if n <> 1 then raise exception 'GD · 2: el Pack Empresa tenía que costar 180 €.'; end if;
  select count(*) into n from public.conta_linea where account_id = c and company_id = 'de000000-0000-4000-8000-0000000000b9' and origen = 'manual';
  if n <> 2 then raise exception 'GD · 2: la autónoma tenía que tener 2 líneas (cuota y renta) y tiene %.', n; end if;
  raise notice 'GD · 2: niveles, clientes en su nivel, precio especial, impuesto con su precio, tramos, paquete y la autónoma. OK';
end $$;
insert into _huella select 1, md5(string_agg(x, '|' order by x)) from (
  select concat_ws(';', s.nombre, s.forma, nv.nombre, p.forma, p.periodo, p.importe, (select string_agg(t.desde || '-' || coalesce(t.hasta, 0) || ':' || t.importe, ',' order by t.desde) from public.conta_precio_tramo t where t.precio_id = p.id),
         (select name from public.party where id = p.party_id), (select nombre from public.conta_paquete where id = p.paquete_id)) x
    from public.conta_precio p left join public.conta_servicio s on s.id = p.servicio_id left join public.conta_servicio_nivel nv on nv.id = p.nivel_id
   where p.account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'linea', s.nombre, nv.nombre, l.origen, (select name from public.party where id = l.party_id)) from public.conta_linea l
    join public.conta_servicio s on s.id = l.servicio_id left join public.conta_servicio_nivel nv on nv.id = l.nivel_id where l.account_id = 'de000000-0000-4000-8000-0000000000a0') q;

-- 3 · Otra vez: lo mismo.
select public.demo_gestoria_tarifa_sembrar('de000000-0000-4000-8000-0000000000a0') is not null as sembrada_otra_vez;
insert into _huella select 2, md5(string_agg(x, '|' order by x)) from (
  select concat_ws(';', s.nombre, s.forma, nv.nombre, p.forma, p.periodo, p.importe, (select string_agg(t.desde || '-' || coalesce(t.hasta, 0) || ':' || t.importe, ',' order by t.desde) from public.conta_precio_tramo t where t.precio_id = p.id),
         (select name from public.party where id = p.party_id), (select nombre from public.conta_paquete where id = p.paquete_id)) x
    from public.conta_precio p left join public.conta_servicio s on s.id = p.servicio_id left join public.conta_servicio_nivel nv on nv.id = p.nivel_id
   where p.account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'linea', s.nombre, nv.nombre, l.origen, (select name from public.party where id = l.party_id)) from public.conta_linea l
    join public.conta_servicio s on s.id = l.servicio_id left join public.conta_servicio_nivel nv on nv.id = l.nivel_id where l.account_id = 'de000000-0000-4000-8000-0000000000a0') q;
do $$ begin
  if (select count(distinct huella) from _huella) <> 1 then raise exception 'GD · 3: sembrar otra vez no ha dejado lo mismo.'; end if;
  raise notice 'GD · 3: sembrar otra vez deja exactamente lo mismo. OK';
end $$;

-- 4 · En una cuenta que no es demo, no.
do $$ begin
  begin
    perform public.demo_gestoria_tarifa_sembrar('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'GD · 4: en una cuenta que no es demo tenía que negarse.';
  exception when insufficient_privilege then raise notice 'GD · 4: en una cuenta que no es demo, no siembra. OK';
  end;
end $$;

-- 5 · La vuelta atrás.
\i supabase/vuelta-atras/20261109T1130_gd_tarifa_demo.down.sql
do $$ begin
  if to_regprocedure('public.demo_gestoria_tarifa_sembrar(uuid)') is not null then raise exception 'GD · 5: la función sigue.'; end if;
  if exists (select 1 from public.conta_precio where account_id = 'de000000-0000-4000-8000-0000000000a0')
     or exists (select 1 from public.conta_servicio_nivel where account_id = 'de000000-0000-4000-8000-0000000000a0')
     or exists (select 1 from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0' and origen = 'manual') then
    raise exception 'GD · 5: la vuelta atrás ha dejado tarifa.';
  end if;
  raise notice 'GD · 5: la vuelta atrás quita la tarifa y la función. OK';
  if (select md5(coalesce(string_agg(x, '|' order by x), '')) from (
        select concat_ws(';', 'servicio', nombre, forma, por_confirmar, clave) x from public.conta_servicio where account_id = 'de000000-0000-4000-8000-0000000000a0'
        union all select concat_ws(';', 'linea', servicio_id, party_id, nivel_id, origen) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'
        union all select concat_ws(';', 'tarifa', servicio_id, party_id, importe) from public.conta_tarifa where account_id = 'de000000-0000-4000-8000-0000000000a0') q)
     <> (select huella from _antes_de_sembrar) then
    raise exception 'GD · 5b: la vuelta atrás no deja la demo como estaba antes de sembrar.';
  end if;
  raise notice 'GD · 5b: la vuelta atrás deja la demo exactamente como estaba. OK';
end $$;

rollback;
