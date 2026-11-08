-- supabase/staging/sql/20261108_g04_pantalla_rapida_prueba.sql
--
-- SOLO STAGING. Prueba de la 2308 (G04, la pantalla de Clientes en una sola
-- llamada). Todo en una transacción con ROLLBACK, con datos inventados (T11):
-- no cambia staging.
--
--   1. Quien es de la cuenta, con un cliente inventado con su ficha, su
--      mandato, una suscripción activa, una cancelada este mes y un cobro:
--      · conta_pantalla_clientes: las mismas filas que conta_lista_clientes,
--        el cliente con los nombres de su suscripción activa y su último
--        cargo; las cuotas, las altas, las bajas y el próximo cobro, iguales a
--        sumar las suscripciones con la RLS; los devueltos, «Lo que tienes que
--        hacer», las asignaciones y los precios, los de sus vistas;
--      · conta_pantalla_ficha: su ficha, su mandato, su cobro y sus dos
--        suscripciones;
--      · conta_pantalla_asignar: las suscripciones activas, como la tabla.
--   2. Quien NO es de la cuenta: las tres, vacías (se saltan la RLS, así que
--      la comprobación de la cuenta es lo único que protege).
--   3. La vuelta atrás: fuera las tres funciones.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G04-2308: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 2308 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás: así parte siempre de lo de antes.
select to_regprocedure('public.conta_pantalla_clientes(uuid)') is not null as ya_esta_la_2308 \gset
\if :ya_esta_la_2308
\i supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa,
       (select a.id from public.accounts a where a.id <> p.account_id order by a.created_at limit 1) as otra
  from public.user_profiles p where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid;
begin
  if a is null or e is null or (select otra from _u) is null then raise exception 'PRUEBA G04-2308 · 0: staging no tiene una persona con empresa y otra cuenta.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 2308, S.L.', 'B00002308') returning id into c1;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha) values (a, c1, 'activo', '{"telefonos":["600 000 000"],"correos":[]}');
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c1, 'gocardless', 'CU2308PRUEBA') on conflict do nothing;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MD2308PRUEBA', 'CU2308PRUEBA', 'active', now());
  insert into public.conta_gc_suscripcion (account_id, company_id, gc_id, gc_cliente_id, mandato_gc_id, nombre, importe, al_mes, estado)
  values (a, e, 'SB2308PRUEBA', 'CU2308PRUEBA', 'MD2308PRUEBA', 'GESTORIA PRUEBA', 60.50, 60.50, 'active'),
         (a, e, 'SB2308BAJA', 'CU2308PRUEBA', 'MD2308PRUEBA', 'GESTORIA BAJA', 30.00, 30.00, 'cancelled');
  update public.conta_gc_suscripcion set inicio = (now() at time zone 'Europe/Madrid')::date, proximo_cobro_fecha = (now() at time zone 'Europe/Madrid')::date + 5, proximo_cobro_importe = 60.50
   where account_id = a and gc_id = 'SB2308PRUEBA';
  update public.conta_gc_suscripcion set fin = (now() at time zone 'Europe/Madrid')::date where account_id = a and gc_id = 'SB2308BAJA';
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe)
  values (a, e, 'PM2308PRUEBA', 'MD2308PRUEBA', 'SB2308PRUEBA', 'paid_out', current_date - 3, 60.50);
end $$;

\i supabase/migrations/20261108T2308_g04_pantalla_rapida.sql

-- Como la persona.
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Lo mismo que leer las tablas y las vistas con la RLS.
do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); j jsonb; f jsonb; g jsonb; c1 uuid; n int; x numeric; y numeric;
begin
  j := public.conta_pantalla_clientes(a);
  select id into c1 from public.party where account_id = a and name = 'Cliente Prueba G04 2308, S.L.';
  -- La lista: las mismas filas (cliente y empresa) que conta_lista_clientes.
  select count(*) into n from (
    (select cliente_id, empresa_id from public.conta_lista_clientes(a)
      except all select (r ->> 'cliente_id')::uuid, (r ->> 'empresa_id')::uuid from jsonb_array_elements(j -> 'clientes') r)
    union all
    (select (r ->> 'cliente_id')::uuid, (r ->> 'empresa_id')::uuid from jsonb_array_elements(j -> 'clientes') r
      except all select cliente_id, empresa_id from public.conta_lista_clientes(a))) d;
  if n <> 0 or jsonb_array_length(j -> 'clientes') = 0 then raise exception 'PRUEBA G04-2308 · 1: la lista no es la de conta_lista_clientes (% de diferencia).', n; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'clientes') r where (r ->> 'cliente_id')::uuid = c1 and (r ->> 'empresa_id')::uuid = e
                   and r ->> 'servicios_gc' = 'GESTORIA PRUEBA' and r ->> 'ultimo_cargo_estado' = 'paid_out' and (r ->> 'ultimo_cargo_fecha')::date = current_date - 3
                   and (r ->> 'ultimo_cargo_importe')::numeric = 60.50 and r -> 'telefonos' ->> 0 = '600 000 000') then
    raise exception 'PRUEBA G04-2308 · 1: el cliente inventado no sale con su suscripción activa (sin la cancelada), su último cargo y su teléfono.';
  end if;
  -- Las cuotas de GoCardless, por empresa: lo mismo que sumar las suscripciones con la RLS.
  select coalesce(sum(al_mes), 0) into x from public.conta_gc_suscripcion where account_id = a and company_id = e and estado = 'active';
  select (c ->> 'al_mes')::numeric into y from jsonb_array_elements(j -> 'cuotas_gc') c where (c ->> 'empresa_id')::uuid = e;
  if x is distinct from y then raise exception 'PRUEBA G04-2308 · 1: las cuotas de GoCardless no suman lo de las suscripciones (% / %).', x, y; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'cuotas_gc') c where (c ->> 'empresa_id')::uuid = e and (c ->> 'altas_n')::int >= 1 and (c ->> 'bajas_n')::int >= 1
                   and (c ->> 'bajas_euros')::numeric >= 30) then
    raise exception 'PRUEBA G04-2308 · 1: no cuenta el alta y la baja inventadas de este mes.';
  end if;
  select count(*) into n from public.conta_gc_suscripcion where account_id = a and estado = 'active';
  select coalesce(sum((p ->> 'n')::int), 0) into x from jsonb_array_elements(j -> 'proximos') p;
  if n <> x then raise exception 'PRUEBA G04-2308 · 1: el próximo cobro no cuenta todas las suscripciones activas (% / %).', n, x; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'proximos') p where (p ->> 'empresa_id')::uuid = e and (p ->> 'fecha')::date = (now() at time zone 'Europe/Madrid')::date + 5
                   and (p ->> 'euros')::numeric >= 60.50) then
    raise exception 'PRUEBA G04-2308 · 1: el próximo cobro inventado no sale en su día.';
  end if;
  -- Lo de antes, de sus vistas.
  if jsonb_array_length(j -> 'cargos') <> (select count(*) from public.conta_consulta_cargo_devuelto where cuenta_id = a)
     or jsonb_array_length(j -> 'que_hacer') <> (select count(*) from public.conta_lista_que_hacer(a))
     or jsonb_array_length(j -> 'asignaciones') <> (select count(*) from public.conta_consulta_asignacion where cuenta_id = a)
     or jsonb_array_length(j -> 'precios') <> (select count(*) from public.conta_consulta_tarifa_precio where cuenta_id = a)
     or jsonb_array_length(j -> 'servicios') <> (select count(*) from public.conta_servicio where account_id = a) then
    raise exception 'PRUEBA G04-2308 · 1: los devueltos, «Lo que tienes que hacer», las asignaciones, los precios o los servicios no son los de sus vistas.';
  end if;
  -- La ficha del cliente inventado.
  f := public.conta_pantalla_ficha(a, c1);
  if f -> 'ficha' -> 'telefonos' ->> 0 is distinct from '600 000 000' or jsonb_array_length(f -> 'mandatos') <> 1 or jsonb_array_length(f -> 'cobros') <> 1
     or jsonb_array_length(f -> 'suscripciones') <> 2 or f -> 'cobros' -> 0 ->> 'gc_id' is distinct from 'PM2308PRUEBA' then
    raise exception 'PRUEBA G04-2308 · 1: la ficha no trae su ficha, su mandato, su cobro y sus dos suscripciones: %', f;
  end if;
  -- Asignar: las suscripciones activas, como la tabla con la RLS.
  g := public.conta_pantalla_asignar(a);
  if jsonb_array_length(g -> 'suscripciones') <> (select count(*) from public.conta_gc_suscripcion where account_id = a and estado = 'active')
     or not exists (select 1 from jsonb_array_elements(g -> 'suscripciones') s where s ->> 'gc_id' = 'SB2308PRUEBA')
     or exists (select 1 from jsonb_array_elements(g -> 'suscripciones') s where s ->> 'gc_id' = 'SB2308BAJA') then
    raise exception 'PRUEBA G04-2308 · 1: «Asignar» no trae las suscripciones activas.';
  end if;
  raise notice 'G04-2308 · 1: las tres funciones dan lo mismo que las tablas y las vistas con la RLS (% filas en la lista). OK', jsonb_array_length(j -> 'clientes');
end $$;

-- 2 · Otra cuenta: nada.
do $$
declare o uuid := (select otra from _u); c1 uuid := (select id from public.party where account_id = (select cuenta from _u) and name = 'Cliente Prueba G04 2308, S.L.'); j jsonb; f jsonb; g jsonb;
begin
  j := public.conta_pantalla_clientes(o);
  f := public.conta_pantalla_ficha(o, c1);
  g := public.conta_pantalla_asignar(o);
  -- Todo lo que es una lista, vacío; y la ficha, sin ficha.
  if exists (select 1 from jsonb_each(j || f || g) e where jsonb_array_length(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) > 0)
     or jsonb_typeof(f -> 'ficha') <> 'null' then
    raise exception 'PRUEBA G04-2308 · 2: quien no es de la cuenta ve algo.';
  end if;
  raise notice 'G04-2308 · 2: con otra cuenta, todo vacío. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql
do $$
begin
  if to_regprocedure('public.conta_pantalla_clientes(uuid)') is not null or to_regprocedure('public.conta_pantalla_ficha(uuid,uuid)') is not null
     or to_regprocedure('public.conta_pantalla_asignar(uuid)') is not null then
    raise exception 'PRUEBA G04-2308 · 3: la vuelta atrás deja alguna función.';
  end if;
  raise notice 'G04-2308 · 3: la vuelta atrás quita las tres funciones. OK';
end $$;

rollback;
