-- supabase/staging/sql/20261110_gp_portal_facturas_pagada_prueba.sql
--
-- SOLO STAGING. Prueba de la 1010 (GP · nº 24, punto 2: las facturas como la
-- maqueta). Todo en una transacción con ROLLBACK, con datos inventados (T11): no
-- cambia staging.
--
--   1. public.conta_portal_facturas trae lo que lleva cada factura (sus líneas,
--      en orden) y cuándo se pagó: el día del cargo del recibo cobrado, el del
--      cobro apuntado o nada (sin pagar, o devuelta sin pagar).
--   2. public.conta_portal_inicio: la factura de «Lo último» trae «pagada», y lo
--      de la 0945 sigue (lo hecho con lo recibido).
--   3. La vuelta atrás: las dos como estaban (Inicio, como lo dejó la 0945).
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como la persona del portal.
-- Las líneas de una factura emitida no se cambian (trg_customer_invoice_line_inalterable): para sembrarlas se
-- apaga ese disparador solo dentro de esta transacción, que acaba en ROLLBACK.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-1010: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select position('''pagada''' in pg_get_functiondef('public.conta_portal_facturas(uuid)'::regprocedure)) > 0 as ya_esta_la_1010 \gset
\if :ya_esta_la_1010
\i supabase/vuelta-atras/20261110T1010_gp_portal_facturas_pagada.down.sql
\endif
select position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) = 0 as falta_la_0945 \gset
\if :falta_la_0945
\i supabase/migrations/20261110T0945_gp_portal_inicio_hecho.sql
\endif
\i supabase/migrations/20261110T1010_gp_portal_facturas_pagada.sql

-- ── 0 · Un cliente con su acceso y cuatro facturas emitidas ─────────────────────
--   A: recibo cobrado (cargo hace 6 días), con dos líneas.   B: recibo devuelto, sin pagar.
--   C: sin recibo, con un cobro apuntado hace 2 días.          D: sin pagar.
create temp table _g on commit drop as
select c.account_id as cuenta, c.id as empresa, ca.id as c705, '0000a1a1-0000-4000-8000-000000001010'::uuid as todo_u,
       null::uuid as cliente, null::uuid as fa, null::uuid as fb, null::uuid as fc, null::uuid as fd
  from public.company c join public.company_account ca on ca.company_id = c.id and ca.code = '70500000'
 order by c.created_at limit 1;
do $$
declare g _g; v_cli uuid; iva uuid := (select id from public.tax_rate where code = 'iva_general' and company_id is null);
        f uuid[] := '{}'; x uuid; i int;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GP-1010 · 0: staging no tiene una empresa con la cuenta 70500000.'; end if;
  insert into auth.users (id, email) values (g.todo_u, 'todo.1010@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Facturas Prueba, S.L.', 'B00001010') returning id into v_cli;
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'todo.1010@ejemplo.invalid', g.todo_u, 'todo');
  for i in 1..4 loop
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, base, tax, total)
    values (g.cuenta, g.empresa, 'emitida', 'a_mano', 'GP1010', 2026, i, 'GP1010-' || i, current_date - (array[1, 2, 3, 30])[i], current_date + 10,
            v_cli, jsonb_build_object('nombre', 'Cliente Facturas Prueba, S.L.'), 100.00, 21.00, 121.00)
    returning id into x;
    f := f || x;
  end loop;
  alter table public.customer_invoice_line disable trigger trg_customer_invoice_line_inalterable;
  insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, tax_rate_id, tax_pct, revenue_account_id, amount, tax_amount) values
    (g.cuenta, g.empresa, f[1], 2, 'Gestión laboral · 4 trabajadores', 4, 10, iva, 21, g.c705, 40, 8.40),
    (g.cuenta, g.empresa, f[1], 1, 'Gestoría mensual · Estándar', 1, 60, iva, 21, g.c705, 60, 12.60),
    (g.cuenta, g.empresa, f[2], 1, 'Gestoría mensual · Estándar', 1, 100, iva, 21, g.c705, 100, 21);
  alter table public.customer_invoice_line enable trigger trg_customer_invoice_line_inalterable;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado, confirmado_el, invoice_id) values
    (g.cuenta, g.empresa, v_cli, '2026-01', 'recibo:' || g.empresa || ':' || v_cli || ':2026-01', 12100, 'cobrado', current_date - 6, f[1]),
    (g.cuenta, g.empresa, v_cli, '2026-02', 'recibo:' || g.empresa || ':' || v_cli || ':2026-02', 12100, 'devuelto', current_date - 4, f[2]);
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note)
  values (g.cuenta, g.empresa, f[3], current_date - 2, 121.00, 'transferencia', 'prueba GP-1010');
  update _g set cliente = v_cli, fa = f[1], fb = f[2], fc = f[3], fd = f[4];
end $$;
grant select on _g to authenticated;
select todo_u as todo_u from _g \gset

-- ── 1 y 2 · Como la persona del portal ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'todo_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare g _g; j jsonb; a jsonb; b jsonb; c jsonb; d jsonb; n jsonb;
begin
  select * into g from _g;
  j := public.conta_portal_facturas(g.cliente) -> 'facturas';
  select x into a from jsonb_array_elements(j) x where x ->> 'id' = g.fa::text;
  select x into b from jsonb_array_elements(j) x where x ->> 'id' = g.fb::text;
  select x into c from jsonb_array_elements(j) x where x ->> 'id' = g.fc::text;
  select x into d from jsonb_array_elements(j) x where x ->> 'id' = g.fd::text;
  if a -> 'lineas' <> '["Gestoría mensual · Estándar", "Gestión laboral · 4 trabajadores"]'::jsonb or (a ->> 'pagada')::date <> current_date - 6 or a ->> 'estado' <> 'Pagada' then
    raise exception 'PRUEBA GP-1010 · 1: la cobrada no trae sus líneas en orden o el día del cargo: %', a;
  end if;
  if b ->> 'pagada' is not null or b ->> 'estado' <> 'Devuelta' then raise exception 'PRUEBA GP-1010 · 1: la devuelta sin pagar sale pagada: %', b; end if;
  if (c ->> 'pagada')::date <> current_date - 2 or c -> 'lineas' <> '[]'::jsonb then raise exception 'PRUEBA GP-1010 · 1: la del cobro apuntado no trae su día: %', c; end if;
  if d ->> 'pagada' is not null then raise exception 'PRUEBA GP-1010 · 1: la que no se ha pagado sale pagada: %', d; end if;
  j := public.conta_portal_inicio(g.cliente);
  select x into n from jsonb_array_elements(j -> 'novedades') x where x ->> 'id' = g.fa::text;
  if n is null or (n ->> 'pagada')::date <> current_date - 6 then raise exception 'PRUEBA GP-1010 · 2: «Lo último» no dice cuándo se pagó: %', j -> 'novedades'; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'novedades') x where x ->> 'id' = g.fb::text and x ->> 'pagada' is null) then
    raise exception 'PRUEBA GP-1010 · 2: la devuelta sale pagada en «Lo último»: %', j -> 'novedades';
  end if;
  raise notice 'GP-1010 · 1 y 2: cada factura con sus líneas y cuándo se pagó (cargo, cobro apuntado; ni la devuelta ni la pendiente); «Lo último», igual. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 3 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261110T1010_gp_portal_facturas_pagada.down.sql
do $$ begin
  if position('''pagada''' in pg_get_functiondef('public.conta_portal_facturas(uuid)'::regprocedure)) > 0
     or position('''pagada''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-1010 · 3: la vuelta atrás no deja las dos funciones como estaban.';
  end if;
  if position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) = 0 then
    raise exception 'PRUEBA GP-1010 · 3: la vuelta atrás se ha llevado también la 0945.';
  end if;
  raise notice 'GP-1010 · 3: la vuelta atrás deja las dos como estaban (Inicio, con la 0945). OK';
end $$;

rollback;
