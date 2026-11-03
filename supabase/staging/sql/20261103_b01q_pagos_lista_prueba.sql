-- ============================================================================
-- PRUEBA (staging) · B01 · Respuesta 15 (1815, cambia en caliente):
-- conta_pagos_lista y conta_pagos_por_revisar pasan a SECURITY DEFINER con una
-- sola comprobación de la cuenta. Todo en una transacción con ROLLBACK. Datos
-- INVENTADOS (IBAN del banco 9999, T11), en la cuenta D.
--
--   0. La 1815 y su vuelta atrás dejan las dos funciones y sus permisos como
--      estaban, byte a byte; la 1815 otra vez (dos veces) las deja con
--      SECURITY DEFINER.
--   1. Con la sesión del administrador de la cuenta, el MISMO resultado con
--      las de antes y con las nuevas (las mismas filas, campo a campo), y trae
--      lo esperado: la aprobada por pagar, la pagada en parte con su pendiente,
--      la que está en revisión en la otra.
--   2. Con la sesión de otra cuenta, nada: ni filas, ni pagado en el mes, ni
--      las de revisar. Con una empresa que no existe, nada.
--   3. Ni anon ni PUBLIC las llaman.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (clave text primary key, v text) on commit drop;
grant all on _r to authenticated;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa'); s uuid; f uuid;
begin
  insert into public.supplier (account_id, name, iban) values (a, 'Envases Prueba 1815', 'ES0799990000000000001815') returning id into s;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, grand_total, status) values
    (a, e, s, 'P15-APR', '2026-10-20', '2026-10-30', 120.50, 'en_revision'),
    (a, e, s, 'P15-PAR', '2026-10-21', '2026-11-20', 300.00, 'en_revision'),
    (a, e, s, 'P15-REV', '2026-10-22', '2026-11-06', 45.00, 'en_revision');
  update public.supplier_invoice set status = 'aprobada' where account_id = a and invoice_number in ('P15-APR', 'P15-PAR');
  select id into f from public.supplier_invoice where account_id = a and invoice_number = 'P15-PAR';
  insert into public.supplier_invoice_payment (account_id, invoice_id, amount, paid_on) values (a, f, 100.00, '2026-11-02');
end $$;

-- 0 · La 1815 guarda las de antes; su vuelta atrás las restaura del respaldo. Lo que devuelven, como el administrador.
create temp table _acl0 on commit drop as select oid, proacl::text acl, md5(pg_get_functiondef(oid)) h from pg_proc
 where oid in ('public.conta_pagos_lista(uuid,date)'::regprocedure, 'public.conta_pagos_por_revisar(uuid)'::regprocedure);
\i supabase/migrations/20261103T1815_b01q_pagos_lista_rapida.sql
\i supabase/vuelta-atras/20261103T1815_b01q_pagos_lista_rapida.down.sql
do $$ begin
  if exists (select 1 from _acl0 a join pg_proc p on p.oid = a.oid where p.proacl::text is distinct from a.acl or md5(pg_get_functiondef(p.oid)) <> a.h) then
    raise exception 'PRUEBA B01·15 · 0: la vuelta atrás no deja las funciones o sus permisos como estaban (%).',
      (select string_agg(p.oid::regprocedure::text || ' ' || a.acl || ' → ' || p.proacl::text, '; ') from _acl0 a join pg_proc p on p.oid = a.oid);
  end if;
end $$;
do $$ begin
  if (select bool_or(prosecdef) from pg_proc where oid in ('public.conta_pagos_lista(uuid,date)'::regprocedure, 'public.conta_pagos_por_revisar(uuid)'::regprocedure)) then
    raise exception 'PRUEBA B01·15 · 0: la vuelta atrás no las deja como estaban (SECURITY DEFINER).';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select 'antes_lista', public.conta_pagos_lista((select v::uuid from _r where clave = 'empresa'), '2026-11-03')::text;
insert into _r select 'antes_revisar', public.conta_pagos_por_revisar((select v::uuid from _r where clave = 'empresa'))::text;
reset role;

\i supabase/migrations/20261103T1815_b01q_pagos_lista_rapida.sql
\i supabase/migrations/20261103T1815_b01q_pagos_lista_rapida.sql
do $$ begin
  if not (select bool_and(prosecdef) from pg_proc where oid in ('public.conta_pagos_lista(uuid,date)'::regprocedure, 'public.conta_pagos_por_revisar(uuid)'::regprocedure)) then
    raise exception 'PRUEBA B01·15 · 0: la 1815 no las deja SECURITY DEFINER.';
  end if;
end $$;

-- 1 · El mismo resultado, y el esperado.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa');
  l jsonb := public.conta_pagos_lista(e, '2026-11-03'); rv jsonb := public.conta_pagos_por_revisar(e); x jsonb;
begin
  -- Las mismas filas (por su id) y lo mismo de todo lo demás; el orden de dos que empatan podía variar antes.
  if (select jsonb_agg(f order by f->>'id') from jsonb_array_elements(l->'filas') f) is distinct from
     (select jsonb_agg(f order by f->>'id') from jsonb_array_elements((select v::jsonb from _r where clave = 'antes_lista')->'filas') f)
     or (l - 'filas') <> ((select v::jsonb from _r where clave = 'antes_lista') - 'filas') then
    raise exception 'PRUEBA B01·15 · 1: conta_pagos_lista no devuelve lo mismo que antes (antes % · ahora %).', (select v from _r where clave = 'antes_lista'), l;
  end if;
  if (select jsonb_agg(f order by f->>'id') from jsonb_array_elements(rv) f) is distinct from
     (select jsonb_agg(f order by f->>'id') from jsonb_array_elements((select v::jsonb from _r where clave = 'antes_revisar')) f) then
    raise exception 'PRUEBA B01·15 · 1: conta_pagos_por_revisar no devuelve lo mismo que antes (antes % · ahora %).', (select v from _r where clave = 'antes_revisar'), rv;
  end if;
  select f into x from jsonb_array_elements(l->'filas') f where f->>'numero' = 'P15-APR';
  if x is null or (x->>'pendiente')::numeric <> 120.50 or x->>'estado' <> 'vencida' then raise exception 'PRUEBA B01·15 · 1: la aprobada no sale como se espera (%).', x; end if;
  select f into x from jsonb_array_elements(l->'filas') f where f->>'numero' = 'P15-PAR';
  if x is null or (x->>'pagado')::numeric <> 100 or (x->>'pendiente')::numeric <> 200 then raise exception 'PRUEBA B01·15 · 1: la pagada en parte no sale como se espera (%).', x; end if;
  if not exists (select 1 from jsonb_array_elements(rv) f where f->>'numero' = 'P15-REV') then raise exception 'PRUEBA B01·15 · 1: falta la que está en revisión (%).', rv; end if;
  if exists (select 1 from jsonb_array_elements(l->'filas') f where f->>'numero' = 'P15-REV') then raise exception 'PRUEBA B01·15 · 1: la de revisión sale en la lista de pagar.'; end if;
end $$;
reset role;

-- 2 · Otra cuenta, nada; una empresa que no existe, nada.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'otra'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _r where clave = 'empresa'); l jsonb := public.conta_pagos_lista(e, '2026-11-03');
begin
  if jsonb_array_length(l->'filas') <> 0 or (l->>'pagado_mes')::numeric <> 0 or (l->>'pagadas_mes')::int <> 0 or jsonb_array_length(l->'sin_plazo') <> 0 then
    raise exception 'PRUEBA B01·15 · 2: otra cuenta ve los pagos de la empresa (%).', l;
  end if;
  if jsonb_array_length(public.conta_pagos_por_revisar(e)) <> 0 then raise exception 'PRUEBA B01·15 · 2: otra cuenta ve las de revisar.'; end if;
  if jsonb_array_length(public.conta_pagos_lista(gen_random_uuid(), '2026-11-03')->'filas') <> 0 then raise exception 'PRUEBA B01·15 · 2: una empresa que no existe da filas.'; end if;
end $$;
reset role;

-- 3 · Ni anon ni PUBLIC.
do $$
declare f text;
begin
  foreach f in array array['public.conta_pagos_lista(uuid,date)', 'public.conta_pagos_por_revisar(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA B01·15 · 3: anon puede llamar a %.', f; end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then raise exception 'PRUEBA B01·15 · 3: PUBLIC puede llamar a %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA B01·15 · 3: authenticated no puede llamar a %.', f; end if;
  end loop;
end $$;

select 'PRUEBA B01·15 · Pagos rápido y solo para su cuenta: todo en verde' as resultado;
rollback;
