-- supabase/staging/sql/20261108_g04_servicio_crear_prueba.sql
--
-- SOLO STAGING. Prueba de la 1511 (G04, «+ Crear › Servicio»). Todo en una
-- transacción con ROLLBACK, con datos inventados (T11): no cambia staging.
-- cambia: public.conta_tarifa_servicio_crear
--
--   1. Apagado: ensaya y dice lo que hará, pero no escribe hasta que los
--      cambios de tarifa estén encendidos en la empresa.
--   2. Encendido, como la persona: un servicio sin precio; otro con su precio
--      general (fijo al año) desde un mes; uno por trabajador con tramos.
--   3. Lo que no entra: sin nombre, un nombre repetido, una forma que no existe.
--   4. Las acciones de cobro (Asignar, Cobrado por otra vía, Añadirla como
--      línea, No la cuentes) NO dependen del interruptor: con él apagado,
--      «Cobrado por otra vía» sigue guardando.
--   5. La vuelta atrás: fuera la función y lo creado; lo que ya cobra a un
--      cliente se queda.
--
-- sin usuario: sembrar los datos inventados y encender los cambios lo hace el servidor; las acciones se prueban como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G04-1511: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 1511 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás: así parte siempre de lo de antes.
select to_regprocedure('public.conta_tarifa_servicio_crear(uuid,text,text,text,numeric,jsonb,date,boolean)') is not null as ya_esta_la_1511 \gset
\if :ya_esta_la_1511
\i supabase/vuelta-atras/20261108T1511_g04_servicio_crear.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa
  from public.user_profiles p where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
create temp table _id (clave text primary key, id text) on commit drop;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; s uuid;
begin
  if a is null or e is null then raise exception 'PRUEBA G04-1511 · 0: staging no tiene una persona administradora o encargada con una empresa.'; end if;
  -- Apagado, pase lo que pase en staging.
  insert into public.conta_gestoria_ajustes (company_id, account_id, cambios_de_tarifa) values (e, a, false)
    on conflict (company_id) do update set cambios_de_tarifa = false;
  -- Un cliente inventado con un cargo devuelto, para «Cobrado por otra vía».
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 1511, S.L.', 'B00001511') returning id into c1;
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c1, 'gocardless', 'CU1511PRUEBA') on conflict do nothing;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MD1511PRUEBA', 'CU1511PRUEBA', 'active', now());
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe) values (a, e, 'PM1511PRUEBA', 'MD1511PRUEBA', 'SB1511PRUEBA', 'failed', '2026-09-04', 60.50);
  insert into _id values ('c1', c1);
end $$;

\i supabase/migrations/20261108T1511_g04_servicio_crear.sql

-- Como la persona.
grant select on _u to authenticated;
grant select, insert on _id to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Apagado.
do $$
declare e uuid := (select empresa from _u); r jsonb;
begin
  r := public.conta_tarifa_servicio_crear(e, 'Asesoría Prueba 1511', 'fijo', 'mes', 30, null, '2027-01-01');
  if not coalesce((r->>'ensayo')::boolean, false) or r->>'frase' <> 'Se creará el servicio «Asesoría Prueba 1511», que se cobra un precio fijo cada mes, con su precio de tarifa.' then
    raise exception 'PRUEBA G04-1511 · 1: el ensayo no dice lo que hará (%).', r;
  end if;
  if exists (select 1 from public.conta_servicio where company_id = e and nombre = 'Asesoría Prueba 1511') then raise exception 'PRUEBA G04-1511 · 1: el ensayo escribe.'; end if;
  begin
    perform public.conta_tarifa_servicio_crear(e, 'Asesoría Prueba 1511', 'fijo', 'mes', 30, null, '2027-01-01', false);
    raise exception 'PRUEBA G04-1511 · 1: con los cambios apagados, escribe.';
  exception when sqlstate '42501' then
    if sqlerrm not like '%aún no están encendidos%' then raise exception 'PRUEBA G04-1511 · 1: el error no dice por qué (%).', sqlerrm; end if;
  end;
  raise notice 'G04-1511 · 1: apagado: ensaya y no escribe. OK';
end $$;

-- 4 · Lo de los cobros no depende del interruptor (sigue apagado).
do $$
declare e uuid := (select empresa from _u); r jsonb;
begin
  r := public.conta_gc_cobro_otra_via(e, 'PM1511PRUEBA', 'transferencia', '2026-09-10');
  if not exists (select 1 from public.conta_gc_cobro_otra_via where company_id = e and gc_id = 'PM1511PRUEBA') then
    raise exception 'PRUEBA G04-1511 · 4: con los cambios de tarifa apagados, «Cobrado por otra vía» no guarda (%).', r;
  end if;
  raise notice 'G04-1511 · 4: «Cobrado por otra vía» guarda con los cambios de tarifa apagados. OK';
end $$;

-- Encender, como el servidor (en la cuenta real lo decide Julio).
reset role;
update public.conta_gestoria_ajustes set cambios_de_tarifa = true where company_id = (select empresa from _u);
set local role authenticated;

-- 2 · Encendido.
do $$
declare e uuid := (select empresa from _u); r jsonb; s1 uuid; s2 uuid; s3 uuid;
begin
  r := public.conta_tarifa_servicio_crear(e, 'Asesoría Prueba 1511', 'fijo', 'mes', null, null, null, false);
  s1 := (r->>'id')::uuid;
  if r->>'frase' <> 'Creado el servicio «Asesoría Prueba 1511», que se cobra un precio fijo cada mes, sin precio de tarifa: cada cliente con el suyo.' then
    raise exception 'PRUEBA G04-1511 · 2: la frase sin precio (%).', r->>'frase';
  end if;
  if (select clave || '|' || forma from public.conta_servicio where id = s1) <> 'g04:asesoria_prueba_1511|fijo_mes' then raise exception 'PRUEBA G04-1511 · 2: la clave o la forma.'; end if;
  if exists (select 1 from public.conta_precio where servicio_id = s1) then raise exception 'PRUEBA G04-1511 · 2: sin precio, guarda un precio.'; end if;

  r := public.conta_tarifa_servicio_crear(e, 'Vigilancia Prueba 1511', 'fijo', 'anio', 605, null, '2027-01-15', false);
  s2 := (r->>'id')::uuid;
  if r->>'frase' <> 'Creado el servicio «Vigilancia Prueba 1511», que se cobra un precio fijo cada año. Guardado Vigilancia Prueba 1511 (precio de tarifa): 605,00 € al año desde enero de 2027.' then
    raise exception 'PRUEBA G04-1511 · 2: la frase con precio (%).', r->>'frase';
  end if;
  if (select forma from public.conta_servicio where id = s2) <> 'fijo_anio'
     or (select count(*) from public.conta_precio where servicio_id = s2 and party_id is null and importe = 605 and periodo = 'anio' and desde = '2027-01-01' and hasta is null) <> 1 then
    raise exception 'PRUEBA G04-1511 · 2: el precio general no se guarda como se dijo.';
  end if;

  r := public.conta_tarifa_servicio_crear(e, 'Nóminas Prueba 1511', 'tramo_y_por_trabajador', null, null,
    '[{"desde":1,"hasta":5,"importe":100,"porUnidad":false},{"desde":6,"hasta":null,"importe":18,"porUnidad":true}]', '2027-01-01', false);
  s3 := (r->>'id')::uuid;
  if (select clave || '|' || forma from public.conta_servicio where id = s3) <> 'g04:nominas_prueba_1511|por_empleado' then raise exception 'PRUEBA G04-1511 · 2: el de tramos (%).', r; end if;
  insert into _id values ('s1', s1), ('s2', s2), ('s3', s3);
  raise notice 'G04-1511 · 2: crea sin precio, con precio general y por tramos. OK';
end $$;

-- 3 · Lo que no entra.
do $$
declare e uuid := (select empresa from _u);
begin
  begin perform public.conta_tarifa_servicio_crear(e, '  ', 'fijo', 'mes', null, null, null, false); raise exception 'PRUEBA G04-1511 · 3: entra sin nombre.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_tarifa_servicio_crear(e, 'asesoría prueba 1511', 'fijo', 'mes', null, null, null, false); raise exception 'PRUEBA G04-1511 · 3: entra un nombre repetido.';
  exception when sqlstate '23505' then null; end;
  begin perform public.conta_tarifa_servicio_crear(e, 'Otra Prueba 1511', 'por_uso', null, null, null, null, false); raise exception 'PRUEBA G04-1511 · 3: entra una forma que no existe.';
  exception when sqlstate '22023' then null; end;
  raise notice 'G04-1511 · 3: sin nombre, repetido o con una forma que no existe, no entra. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La vuelta atrás: lo que ya cobra a un cliente se queda.
insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, origen, periodo, desde)
select cuenta, empresa, (select id::uuid from _id where clave = 'c1'), (select id::uuid from _id where clave = 's2'), 'cuota', 'manual', 'anio', '2027-01-01' from _u;
\i supabase/vuelta-atras/20261108T1511_g04_servicio_crear.down.sql
do $$
begin
  if to_regprocedure('public.conta_tarifa_servicio_crear(uuid,text,text,text,numeric,jsonb,date,boolean)') is not null then raise exception 'PRUEBA G04-1511 · 5: la función sigue.'; end if;
  if exists (select 1 from public.conta_servicio where id in (select id::uuid from _id where clave in ('s1', 's3'))) then raise exception 'PRUEBA G04-1511 · 5: queda un servicio creado sin uso.'; end if;
  if not exists (select 1 from public.conta_servicio where id = (select id::uuid from _id where clave = 's2')) then raise exception 'PRUEBA G04-1511 · 5: borra un servicio que ya cobra a un cliente.'; end if;
  raise notice 'G04-1511 · 5: la vuelta atrás quita lo creado y deja lo que está en uso. OK';
end $$;

rollback;
