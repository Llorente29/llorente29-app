-- supabase/staging/sql/20261108_g04_lista_rapida_prueba.sql
--
-- SOLO STAGING. Prueba de la 2209 (G04, la lista de Clientes rápida). Todo en
-- una transacción con ROLLBACK, con datos inventados (T11): no cambia staging.
--
--   1. Quien es de la cuenta: conta_lista_clientes y conta_lista_que_hacer
--      devuelven exactamente lo mismo que conta_consulta_cliente_empresa y
--      conta_consulta_que_hacer (fila a fila, en los dos sentidos), con un
--      cliente inventado con su cobro de GoCardless, su mandato, su suscripción
--      y una diferencia vigente.
--   2. Quien NO es de la cuenta: las dos funciones, cero filas (se saltan la
--      RLS, así que la comprobación de la cuenta es lo único que protege).
--   3. La vuelta atrás: fuera las dos funciones.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G04-2209: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 2209 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás: así parte siempre de lo de antes.
select to_regprocedure('public.conta_lista_clientes(uuid)') is not null as ya_esta_la_2209 \gset
\if :ya_esta_la_2209
\i supabase/vuelta-atras/20261108T2209_g04_lista_rapida.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa,
       (select a.id from public.accounts a where a.id <> p.account_id order by a.created_at limit 1) as otra
  from public.user_profiles p where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid;
begin
  if a is null or e is null or (select otra from _u) is null then raise exception 'PRUEBA G04-2209 · 0: staging no tiene una persona con empresa y otra cuenta.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 2209, S.L.', 'B00002209') returning id into c1;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha) values (a, c1, 'activo', '{"telefonos":[],"correos":[]}');
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c1, 'gocardless', 'CU2209PRUEBA') on conflict do nothing;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MD2209PRUEBA', 'CU2209PRUEBA', 'active', now());
  insert into public.conta_gc_suscripcion (account_id, company_id, gc_id, gc_cliente_id, mandato_gc_id, nombre, importe, al_mes, estado)
  values (a, e, 'SB2209PRUEBA', 'CU2209PRUEBA', 'MD2209PRUEBA', 'GESTORIA PRUEBA', 60.50, 60.50, 'active');
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe)
  values (a, e, 'PM2209PRUEBA', 'MD2209PRUEBA', 'SB2209PRUEBA', 'paid_out', current_date - 3, 60.50);
end $$;

\i supabase/migrations/20261108T2209_g04_lista_rapida.sql

-- Como la persona.
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Lo mismo que las vistas.
do $$
declare a uuid := (select cuenta from _u); n int; x int; y int;
begin
  select count(*) into n from public.conta_lista_clientes(a);
  select count(*) into x from (select * from public.conta_consulta_cliente_empresa where cuenta_id = a
                                except all select * from public.conta_lista_clientes(a)) d;
  select count(*) into y from (select * from public.conta_lista_clientes(a)
                                except all select * from public.conta_consulta_cliente_empresa where cuenta_id = a) d;
  if n = 0 or x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2209 · 1: la lista no es la de la vista (% filas; % solo en la vista, % solo en la función).', n, x, y; end if;
  if not exists (select 1 from public.conta_lista_clientes(a) where cliente = 'Cliente Prueba G04 2209, S.L.' and mandato = 'active'
                   and gocardless_al_mes = 60.50 and suscripciones_activas = 1 and ultimo_cobro_fecha = current_date - 3 and ultimo_cargo_estado = 'paid_out') then
    raise exception 'PRUEBA G04-2209 · 1: el cliente inventado no sale con su cobro, su mandato y su suscripción.';
  end if;
  select count(*) into x from (select * from public.conta_consulta_que_hacer where cuenta_id = a except all select * from public.conta_lista_que_hacer(a)) d;
  select count(*) into y from (select * from public.conta_lista_que_hacer(a) except all select * from public.conta_consulta_que_hacer where cuenta_id = a) d;
  if x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2209 · 1: «Lo que tienes que hacer» no es el de la vista (% / %).', x, y; end if;
  raise notice 'G04-2209 · 1: las dos funciones dan lo mismo que sus vistas (% filas en la lista). OK', n;
end $$;

-- 2 · Otra cuenta: nada.
do $$
declare o uuid := (select otra from _u);
begin
  if exists (select 1 from public.conta_lista_clientes(o)) or exists (select 1 from public.conta_lista_que_hacer(o)) then
    raise exception 'PRUEBA G04-2209 · 2: quien no es de la cuenta ve sus filas.';
  end if;
  raise notice 'G04-2209 · 2: con otra cuenta, cero filas. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261108T2209_g04_lista_rapida.down.sql
do $$
begin
  if to_regprocedure('public.conta_lista_clientes(uuid)') is not null or to_regprocedure('public.conta_lista_que_hacer(uuid)') is not null then
    raise exception 'PRUEBA G04-2209 · 3: la vuelta atrás deja alguna función.';
  end if;
  raise notice 'G04-2209 · 3: la vuelta atrás quita las dos funciones. OK';
end $$;

rollback;
