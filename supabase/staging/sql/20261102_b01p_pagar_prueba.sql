-- ============================================================================
-- PRUEBA (staging) · B01 · Cola 1e (2115, solo añade): Pagos enseña también lo
-- que está por revisar. Todo en una transacción con ROLLBACK. Datos INVENTADOS
-- (IBAN del banco 9999, T11), en la cuenta D.
--
--   0. La vuelta atrás quita la función, y la 2115 la vuelve a poner (dos veces).
--   1. Trae las facturas en revisión y sin pagar de la empresa, con su
--      vencimiento y «por_revisar»; no las aprobadas, ni las descartadas, ni las
--      que se compensan.
--   2. Con la sesión de otra cuenta, nada (lee con su RLS); y anon no la llama.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

\i supabase/vuelta-atras/20261102T2115_b01p_pagos_por_revisar.down.sql
do $$ begin
  if to_regprocedure('public.conta_pagos_por_revisar(uuid)') is not null then raise exception 'PRUEBA B01 cola 1e · 0: la vuelta atrás no quita la función.'; end if;
end $$;
\i supabase/migrations/20261102T2115_b01p_pagos_por_revisar.sql
\i supabase/migrations/20261102T2115_b01p_pagos_por_revisar.sql

create temp table _r (clave text primary key, v text) on commit drop;
grant all on _r to authenticated;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa'); s uuid;
begin
  insert into public.supplier (account_id, name, iban) values (a, 'Limpiezas Prueba 1e', 'ES0799990000000000002115') returning id into s;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, grand_total, status) values
    (a, e, s, 'P1E-REV', '2026-10-22', '2026-11-06', 180.15, 'en_revision'),
    (a, e, s, 'P1E-APR', '2026-10-22', '2026-11-06', 50.00, 'en_revision'),
    (a, e, s, 'P1E-DES', '2026-10-22', '2026-11-06', 10.00, 'en_revision'),
    (a, e, s, 'P1E-COM', '2026-10-22', '2026-11-06', 5.00, 'en_revision');
  update public.supplier_invoice set status = 'aprobada' where account_id = a and invoice_number = 'P1E-APR';
  update public.supplier_invoice set discarded_at = now() where account_id = a and invoice_number = 'P1E-DES';
  update public.supplier_invoice set payment_method = 'compensation' where account_id = a and invoice_number = 'P1E-COM';
end $$;

-- 1 · Las de la empresa, con la sesión de su administrador.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb := public.conta_pagos_por_revisar((select v::uuid from _r where clave = 'empresa')); x jsonb;
begin
  select f into x from jsonb_array_elements(r) f where f->>'numero' = 'P1E-REV';
  if x is null then raise exception 'PRUEBA B01 cola 1e · 1: no trae la factura en revisión (%).', r; end if;
  if (x->>'por_revisar')::boolean is distinct from true or x->>'vence' <> '2026-11-06' or (x->>'pendiente')::numeric <> 180.15 then
    raise exception 'PRUEBA B01 cola 1e · 1: la fila no es la esperada (%).', x;
  end if;
  if exists (select 1 from jsonb_array_elements(r) f where f->>'numero' in ('P1E-APR', 'P1E-DES', 'P1E-COM')) then
    raise exception 'PRUEBA B01 cola 1e · 1: trae una aprobada, una descartada o una que se compensa (%).', r;
  end if;
end $$;
reset role;

-- 2 · Otra cuenta no ve nada; anon no la llama.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'otra'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.conta_pagos_por_revisar((select v::uuid from _r where clave = 'empresa'))) <> 0 then
    raise exception 'PRUEBA B01 cola 1e · 2: otra cuenta ve las facturas en revisión de la empresa.';
  end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.conta_pagos_por_revisar(uuid)', 'execute') then raise exception 'PRUEBA B01 cola 1e · 2: anon puede llamarla.'; end if;
end $$;

select 'PRUEBA B01 cola 1e · lo que está por revisar en Pagos: todo en verde' as resultado;
rollback;
