-- supabase/staging/sql/20261108_g04_pantalla_rapida_prueba.sql
--
-- SOLO STAGING. Prueba de la 2308 (G04, la pantalla de Clientes entera
-- rápida). Todo en una transacción con ROLLBACK, con datos inventados (T11):
-- no cambia staging.
--
--   1. Quien es de la cuenta: las cuatro funciones devuelven exactamente las
--      filas que da la tabla con la RLS (fila a fila, en los dos sentidos),
--      con un cliente inventado con su ficha, su mandato, una suscripción
--      activa, una cancelada (no sale) y un cobro.
--   2. Quien NO es de la cuenta: las cuatro, cero filas (se saltan la RLS, así
--      que la comprobación de la cuenta es lo único que protege).
--   3. La vuelta atrás: fuera las cuatro funciones.
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
select to_regprocedure('public.conta_lista_gc_cobros(uuid)') is not null as ya_esta_la_2308 \gset
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
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MD2308PRUEBA', 'CU2308PRUEBA', 'active', now());
  insert into public.conta_gc_suscripcion (account_id, company_id, gc_id, gc_cliente_id, mandato_gc_id, nombre, importe, al_mes, estado)
  values (a, e, 'SB2308PRUEBA', 'CU2308PRUEBA', 'MD2308PRUEBA', 'GESTORIA PRUEBA', 60.50, 60.50, 'active'),
         (a, e, 'SB2308BAJA', 'CU2308PRUEBA', 'MD2308PRUEBA', 'GESTORIA BAJA', 30.00, 30.00, 'cancelled');
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe)
  values (a, e, 'PM2308PRUEBA', 'MD2308PRUEBA', 'SB2308PRUEBA', 'paid_out', current_date - 3, 60.50);
end $$;

\i supabase/migrations/20261108T2308_g04_pantalla_rapida.sql

-- Como la persona.
grant select on _u to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Lo mismo que las tablas con la RLS.
do $$
declare a uuid := (select cuenta from _u); x int; y int;
begin
  select count(*) into x from (select b.company_id, b.gc_id, b.mandato_gc_id, b.suscripcion_gc_id, b.estado, b.fecha, b.importe, b.motivo from public.conta_gc_cobro b where b.account_id = a
                                except all select * from public.conta_lista_gc_cobros(a)) d;
  select count(*) into y from (select * from public.conta_lista_gc_cobros(a) except all
                                select b.company_id, b.gc_id, b.mandato_gc_id, b.suscripcion_gc_id, b.estado, b.fecha, b.importe, b.motivo from public.conta_gc_cobro b where b.account_id = a) d;
  if x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2308 · 1: los cobros no son los de la tabla (% / %).', x, y; end if;
  select count(*) into x from (select m.company_id, m.gc_id, m.gc_cliente_id, m.estado, m.creado from public.conta_gc_mandato m where m.account_id = a
                                except all select * from public.conta_lista_gc_mandatos(a)) d;
  select count(*) into y from (select * from public.conta_lista_gc_mandatos(a) except all
                                select m.company_id, m.gc_id, m.gc_cliente_id, m.estado, m.creado from public.conta_gc_mandato m where m.account_id = a) d;
  if x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2308 · 1: los mandatos no son los de la tabla (% / %).', x, y; end if;
  select count(*) into x from (select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.importe, s.al_mes, s.estado, s.inicio, s.fin, s.proximo_cobro_fecha, s.proximo_cobro_importe
                                 from public.conta_gc_suscripcion s where s.account_id = a and s.estado = 'active'
                                except all select * from public.conta_lista_gc_suscripciones(a)) d;
  select count(*) into y from (select * from public.conta_lista_gc_suscripciones(a) except all
                                select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.importe, s.al_mes, s.estado, s.inicio, s.fin, s.proximo_cobro_fecha, s.proximo_cobro_importe
                                  from public.conta_gc_suscripcion s where s.account_id = a and s.estado = 'active') d;
  if x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2308 · 1: las suscripciones no son las de la tabla (% / %).', x, y; end if;
  -- jsonb no tiene igualdad para except: se compara su texto.
  select count(*) into x from (select c.party_id, c.ficha::text, c.leido_at from public.conta_gestoria_cliente c where c.account_id = a
                                except all select f.party_id, f.ficha::text, f.leido_at from public.conta_lista_fichas(a) f) d;
  select count(*) into y from (select f.party_id, f.ficha::text, f.leido_at from public.conta_lista_fichas(a) f except all
                                select c.party_id, c.ficha::text, c.leido_at from public.conta_gestoria_cliente c where c.account_id = a) d;
  if x <> 0 or y <> 0 then raise exception 'PRUEBA G04-2308 · 1: las fichas no son las de la tabla (% / %).', x, y; end if;
  if not exists (select 1 from public.conta_lista_gc_cobros(a) where gc_id = 'PM2308PRUEBA' and estado = 'paid_out')
     or not exists (select 1 from public.conta_lista_gc_mandatos(a) where gc_id = 'MD2308PRUEBA')
     or not exists (select 1 from public.conta_lista_gc_suscripciones(a) where gc_id = 'SB2308PRUEBA')
     or exists (select 1 from public.conta_lista_gc_suscripciones(a) where gc_id = 'SB2308BAJA')
     or not exists (select 1 from public.conta_lista_fichas(a) f join public.party p on p.id = f.party_id
                     where p.name = 'Cliente Prueba G04 2308, S.L.' and f.ficha -> 'telefonos' ->> 0 = '600 000 000') then
    raise exception 'PRUEBA G04-2308 · 1: el cliente inventado no sale con su cobro, su mandato, su suscripción activa (sin la cancelada) y su ficha.';
  end if;
  raise notice 'G04-2308 · 1: las cuatro funciones dan lo mismo que sus tablas con la RLS. OK';
end $$;

-- 2 · Otra cuenta: nada.
do $$
declare o uuid := (select otra from _u);
begin
  if exists (select 1 from public.conta_lista_gc_cobros(o)) or exists (select 1 from public.conta_lista_gc_mandatos(o))
     or exists (select 1 from public.conta_lista_gc_suscripciones(o)) or exists (select 1 from public.conta_lista_fichas(o)) then
    raise exception 'PRUEBA G04-2308 · 2: quien no es de la cuenta ve sus filas.';
  end if;
  raise notice 'G04-2308 · 2: con otra cuenta, cero filas. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql
do $$
begin
  if to_regprocedure('public.conta_lista_gc_cobros(uuid)') is not null or to_regprocedure('public.conta_lista_gc_mandatos(uuid)') is not null
     or to_regprocedure('public.conta_lista_gc_suscripciones(uuid)') is not null or to_regprocedure('public.conta_lista_fichas(uuid)') is not null then
    raise exception 'PRUEBA G04-2308 · 3: la vuelta atrás deja alguna función.';
  end if;
  raise notice 'G04-2308 · 3: la vuelta atrás quita las cuatro funciones. OK';
end $$;

rollback;
