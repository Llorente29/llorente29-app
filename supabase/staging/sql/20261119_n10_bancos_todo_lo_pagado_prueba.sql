-- supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
--
-- SOLO STAGING. Prueba del N10 · parte 2 (20261119T1930_n10_bancos_todo_lo_pagado), que el ensayo de
-- staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Datos
-- INVENTADOS (T11). Nombra lo que cambia: public.bank_facturas_para_casar y
-- public.bank_facturas_recibidas_pendientes.
--
-- En la empresa de la siembra de la cuenta A (3b34403a…, con su banco b0100000…b3, como el PC01 y el E2),
-- un proveedor nuevo con su 400 y tres recibidas aprobadas:
--   · N10-SIN (121,00), sin ningún pago: REGLA 31, sale igual con las dos versiones;
--   · N10-MANO (242,00), con 42,00 pagados a mano, sin banco (una compensación en parte, con su asiento);
--   · N10-YA (242,00), con «Ya la he pagado» de 42,00 (conta_pago_a_mano: una remesa que espera su cargo).
--   1. Lo que propone Bancos (casar y pendientes) y Pagos (la vista), con la versión nueva, con la de antes
--      (la vuelta atrás) y otra vez con la nueva. Se pegan las cifras.
--   2. LA REGLA 10, POR SUS CAMINOS (con la versión nueva): se trae un extracto con tres cargos (42,00 y dos
--      de 200,00); el de 42,00 se casa con la remesa de N10-YA; el resto de N10-MANO se casa desde Bancos,
--      se deshace y se vuelve a casar; y el resto de N10-YA, también. En cada paso, lo que propone Bancos.
--      Nada se cuenta dos veces: lo casado en el banco apunta su pago (el disparador del PC01) y la regla
--      nueva solo suma lo casado sin su pago.
--
-- con usuario: el 1 y el 2 se hacen con «set local role authenticated», como el administrador a1 de la
-- cuenta A. La siembra, como el dueño. En la base local del W09 no está la empresa de la siembra: con
-- «-c n10.sin_banco=si» (PGOPTIONS) se prueba el 1 en la primera empresa de la cuenta A y se salta el 2.
-- Sin eso, si falta la empresa o su banco, PARA.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────────────────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  b uuid := 'b0100000-0000-4000-8000-0000000000b3'; s uuid; sin_banco boolean := current_setting('n10.sin_banco', true) = 'si';
begin
  if not exists (select 1 from public.company where id = e and account_id = a)
     or not exists (select 1 from public.treasury_account where id = b and company_id = e and is_active) then
    if not sin_banco then raise exception 'PRUEBA N10: no está la empresa de la siembra de A con su banco: el camino del banco no se puede probar.'; end if;
    select id into e from public.company where account_id = a order by created_at, id limit 1;
    b := null;
    raise notice 'PRUEBA N10: base sin la empresa de la siembra (n10.sin_banco): se prueba el 1 en otra empresa y se salta el 2.';
  end if;
  insert into _p values ('empresa', e), ('banco', coalesce(b::text, ''));
  insert into public.supplier (account_id, name, legal_name, iban, payment_terms_days)
  values (a, 'Proveedor N10 Prueba', 'Proveedor N10 Prueba SL', 'ES9121000418450200051332', 30) returning id into s;
  insert into _p values ('proveedor', s);
  -- Su 400 propia, nueva, con el molde de la 40000001 (como el E2). Sin molde (la base local), sin cuenta.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, e, ca.plan, '40009951', ca.template_code, 'Proveedores · N10', ca.kind, ca.source from public.company_account ca where ca.company_id = e and ca.code = '40000001';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '40009951';
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, grand_total, status) values
    (a, e, s, 'N10-SIN', public.conta_hoy(), public.conta_hoy() + 30, 121.00, 'en_revision'),
    (a, e, s, 'N10-MANO', public.conta_hoy(), public.conta_hoy() + 30, 242.00, 'en_revision'),
    (a, e, s, 'N10-YA', public.conta_hoy(), public.conta_hoy() + 30, 242.00, 'en_revision');
  insert into _p select lower(replace(invoice_number, 'N10-', 'f_')), id from public.supplier_invoice where supplier_id = s;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _p where clave in ('f_sin', 'f_mano', 'f_ya'));
reset role;
-- N10-MANO: 42,00 pagados a mano, sin banco: una compensación con su asiento, como la que apunta conta_abono_compensar (los
-- pagos sin banco de verdad llevan asiento: con uno sin asiento, Bancos no la da por pagada al casar el resto, e2e 1426).
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa'); fy uuid; ent uuid;
begin
  select id into fy from public.fiscal_year where company_id = e and public.conta_hoy() between starts_on and ends_on limit 1;
  if fy is not null then
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
    values (a, e, fy, 1, public.conta_hoy(), 'Prueba N10 · compensación de N10-MANO', 'supplier_payment', 'borrador') returning id into ent;
  elsif (select v from _p where clave = 'banco') <> '' then
    raise exception 'PRUEBA N10 · siembra: la empresa de la siembra no tiene ejercicio para hoy.';
  end if;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, created_by_name)
  values (a, e, (select v::uuid from _p where clave = 'f_mano'), public.conta_hoy(), 42.00, 'compensation', 'Prueba N10 · compensada en parte', ent, 'Prueba N10');
end $$;
-- N10-YA: «Ya la he pagado» de 42,00, como la pantalla (con banco; sin él, se salta).
set local role authenticated;
do $$
declare x jsonb;
begin
  if (select v from _p where clave = 'banco') = '' then return; end if;
  x := public.conta_pago_a_mano((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'f_ya'), (select v::uuid from _p where clave = 'banco'), public.conta_hoy(), 42.00);
  insert into _p values ('remesa_ya', x->>'remesa');
  raise notice 'PRUEBA N10 · siembra: %', x->>'frase';
end $$;
reset role;

-- ── 1 · Lo que proponen Bancos y Pagos, con la versión nueva y con la de antes ──────────────────────
create or replace function pg_temp.medir() returns jsonb language sql as $f$
  with c as (select (select v::uuid from _p where clave = 'empresa') as id), suyas as (select v::uuid as id from _p where clave like 'f\_%')
  select jsonb_build_object(
    'casar', (select jsonb_object_agg(b.numero, (b.total - b.pagado)::numeric(14,2)) from c, public.bank_facturas_para_casar(c.id) b where b.id in (select id from suyas)),
    'pendientes', (select jsonb_object_agg(b.numero, (b.total - b.pagado)::numeric(14,2)) from c, public.bank_facturas_recibidas_pendientes(c.id) b where b.id in (select id from suyas)),
    'pagos', (select jsonb_object_agg(si.invoice_number, r.pendiente) from public.conta_recibida_pago r join public.supplier_invoice si on si.id = r.invoice_id where si.id in (select id from suyas)))
$f$;
grant execute on function pg_temp.medir() to authenticated;
-- Lo que propone Bancos de TODAS las recibidas sin pagos a mano de todas las cuentas (a propósito, regla 9: la huella de
-- «esto no se ha movido», de tabla entera), con las dos funciones como las ve el dueño. Sin pagos a mano: sin ningún pago
-- que no venga de un casado del banco, y no traídas. Las cifras, a dos decimales: la de antes escribía «0» y la nueva
-- «0.00» (las mismas cifras; lo que resta la pantalla es igual).
create or replace function pg_temp.huella_sin_mano() returns text language sql as $f$
  select count(*) || ' recibidas · ' || md5(coalesce(string_agg(x, ',' order by x), '')) from (
    select 'casar|' || b.id || '|' || b.total::numeric(14,2) || '|' || b.pagado::numeric(14,2) as x from public.company co, public.bank_facturas_para_casar(co.id) b
     where not exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = b.id and p.bank_match_id is null)
       and (select source from public.supplier_invoice where id = b.id) is distinct from 'traida'
    union all
    select 'pend|' || b.id || '|' || b.total::numeric(14,2) || '|' || b.pagado::numeric(14,2) from public.company co, public.bank_facturas_recibidas_pendientes(co.id) b
     where not exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = b.id and p.bank_match_id is null)
       and (select source from public.supplier_invoice where id = b.id) is distinct from 'traida') t
$f$;

set local role authenticated;
select set_config('n10.nueva', pg_temp.medir()::text, true) is not null as con_lo_nuevo;
reset role;
select set_config('n10.huella_nueva', pg_temp.huella_sin_mano(), true) is not null as huella_con_lo_nuevo;
\i supabase/vuelta-atras/20261119T1930_n10_bancos_todo_lo_pagado.down.sql
do $$ begin
  if exists (select 1 from pg_proc where prosrc like '%N10 · todo lo pagado, como Pagos%') then raise exception 'PRUEBA N10 · 1: la vuelta atrás no ha dejado las dos funciones como antes.'; end if;
end $$;
set local role authenticated;
select set_config('n10.vieja', pg_temp.medir()::text, true) is not null as con_lo_de_antes;
reset role;
select set_config('n10.huella_vieja', pg_temp.huella_sin_mano(), true) is not null as huella_con_lo_de_antes;
\i supabase/migrations/20261119T1930_n10_bancos_todo_lo_pagado.sql
set local role authenticated;
select set_config('n10.otra_vez', pg_temp.medir()::text, true) is not null as con_lo_nuevo_otra_vez;
reset role;

do $$
declare n jsonb := current_setting('n10.nueva')::jsonb; vi jsonb := current_setting('n10.vieja')::jsonb; k text; f text;
        con_banco boolean := (select v from _p where clave = 'banco') <> '';
begin
  if n is distinct from current_setting('n10.otra_vez')::jsonb then raise exception 'PRUEBA N10 · 1: la versión nueva no enseña lo mismo la segunda vez.'; end if;
  foreach k in array array['casar', 'pendientes', 'pagos'] loop
    foreach f in array array['N10-SIN', 'N10-MANO', 'N10-YA'] loop
      raise notice 'PRUEBA N10 · 1: «%» · %: antes % · después %', k, f, coalesce(vi->k->>f, '—'), coalesce(n->k->>f, '—');
    end loop;
  end loop;
  -- Regla 31: la que no tiene pagos, igual; y todas las de todas las cuentas sin pagos a mano, la misma huella.
  foreach k in array array['casar', 'pendientes', 'pagos'] loop
    if n->k->'N10-SIN' is distinct from vi->k->'N10-SIN' or (n->k->>'N10-SIN')::numeric <> 121 then raise exception 'PRUEBA N10 · 1: N10-SIN cambia en «%».', k; end if;
  end loop;
  if current_setting('n10.huella_nueva') <> current_setting('n10.huella_vieja') then
    raise exception 'PRUEBA N10 · 1: las recibidas sin pagos a mano cambian en Bancos: antes %, después %.', current_setting('n10.huella_vieja'), current_setting('n10.huella_nueva');
  end if;
  raise notice 'PRUEBA N10 · 1: todas las cuentas · las recibidas sin pagos a mano en Bancos (casar y pendientes): antes % · después %', current_setting('n10.huella_vieja'), current_setting('n10.huella_nueva');
  -- El pago a mano: Bancos le restaba solo lo casado (242,00); ahora, como Pagos, 200,00.
  if (vi->'casar'->>'N10-MANO')::numeric <> 242 or (n->'casar'->>'N10-MANO')::numeric <> 200 or (n->'pendientes'->>'N10-MANO')::numeric <> 200
     or (n->'pagos'->>'N10-MANO')::numeric <> 200 then
    raise exception 'PRUEBA N10 · 1: N10-MANO: antes %, después %.', vi, n;
  end if;
  -- «Ya la he pagado», esperando su cargo: ni Pagos ni Bancos lo cuentan como pagado (Pagos lo enseña en su remesa): igual con las dos.
  if con_banco and ((n->'casar'->>'N10-YA')::numeric <> 242 or n->'casar'->'N10-YA' is distinct from vi->'casar'->'N10-YA' or (n->'pagos'->>'N10-YA')::numeric <> 242) then
    raise exception 'PRUEBA N10 · 1: N10-YA (esperando su cargo): antes %, después %.', vi, n;
  end if;
end $$;

-- ── 2 · La regla 10, por sus caminos (con la versión nueva) ────────────────────────────────────────
set local role authenticated;
do $$
declare
  e uuid := (select v::uuid from _p where clave = 'empresa'); bco text := (select v from _p where clave = 'banco');
  mv jsonb := '[]'::jsonb; r jsonb; x jsonb; i int; m record; c400 text := '40009951';
  f_mano uuid := (select v::uuid from _p where clave = 'f_mano'); f_ya uuid := (select v::uuid from _p where clave = 'f_ya');
  ver jsonb;
begin
  if bco = '' then raise notice 'PRUEBA N10 · 2: sin banco en esta base (n10.sin_banco): no se prueba el camino del banco.'; return; end if;
  for i in 1..3 loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', public.conta_hoy(), 'importe', (array[-42.00, -200.00, -200.00])[i],
      'concepto_banco', 'TRANSFERENCIA N10 ' || i, 'concepto_limpio', 'Transferencia n10 ' || i, 'contraparte', 'PROVEEDOR N10 PRUEBA', 'tipo', 'TRANSFERENCIAS',
      'huella', 'n10-bancos-' || i, 'huella_suave', 'n10-bancos-s' || i));
  end loop;
  r := public.bank_importar(bco::uuid, 'fichero', 'csv:bbva', 'prueba-n10.xlsx', repeat('d', 64), public.conta_hoy(), public.conta_hoy(), null, null, 'prueba', null, mv);
  for m in select distinct on (bm.bank_concept) bm.* from public.bank_movement bm
            where bm.statement_id = (r->>'extracto')::uuid and bm.bank_concept like 'TRANSFERENCIA N10 _'
            order by bm.bank_concept, bm.created_at desc loop
    insert into _p values ('mov' || right(m.bank_concept, 1), m.id);
  end loop;
  if (select count(*) from _p where clave in ('mov1', 'mov2', 'mov3')) <> 3 then raise exception 'PRUEBA N10 · 2: el extracto no trae los 3 cargos.'; end if;

  -- a · El cargo de 42,00 con la remesa de «Ya la he pagado»: N10-YA queda con 200,00 (no 158,00: su pago no cuenta dos veces).
  x := public.conta_remesa_casar((select v::uuid from _p where clave = 'mov1'), (select v::uuid from _p where clave = 'remesa_ya'), null);
  ver := pg_temp.medir();
  raise notice 'PRUEBA N10 · 2a: casado el cargo de 42,00 con la remesa de N10-YA → Bancos propone N10-YA %, N10-MANO %', ver->'casar'->>'N10-YA', ver->'casar'->>'N10-MANO';
  if (ver->'casar'->>'N10-YA')::numeric <> 200 or (ver->'pagos'->>'N10-YA')::numeric <> 200 then raise exception 'PRUEBA N10 · 2a: N10-YA, %.', ver; end if;

  -- b · El resto de N10-MANO (200,00), casado desde Bancos: pagada, y Bancos ya no la propone.
  x := public.bank_casar((select v::uuid from _p where clave = 'mov2'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', f_mano, 'importe', 200.00)), 'cuenta_tercero', c400, 'tercero_id', null, 'concepto', 'Pago N10-MANO'),
    'probable', 'prueba', '[]'::jsonb, 'persona', null);
  insert into _p values ('casado_mano', x->>'match');
  ver := pg_temp.medir();
  raise notice 'PRUEBA N10 · 2b: casado el resto de N10-MANO → estado %, Bancos la propone por %', (select status from public.supplier_invoice where id = f_mano), coalesce(ver->'casar'->>'N10-MANO', '(ya no la propone)');
  if (select status from public.supplier_invoice where id = f_mano) <> 'pagada' or ver->'casar' ? 'N10-MANO' then raise exception 'PRUEBA N10 · 2b: N10-MANO, %.', ver; end if;

  -- c · Deshacerlo: vuelve a por pagar, y Bancos la propone otra vez por 200,00 (el pago a mano sigue).
  perform public.bank_deshacer((select v::uuid from _p where clave = 'casado_mano'), 'Prueba N10: no era este cargo');
  ver := pg_temp.medir();
  raise notice 'PRUEBA N10 · 2c: deshecho → estado %, Bancos la propone por %', (select status from public.supplier_invoice where id = f_mano), ver->'casar'->>'N10-MANO';
  if (select status from public.supplier_invoice where id = f_mano) <> 'aprobada' or (ver->'casar'->>'N10-MANO')::numeric <> 200 then raise exception 'PRUEBA N10 · 2c: N10-MANO, %.', ver; end if;

  -- d · Volver a casarlo: pagada otra vez.
  x := public.bank_casar((select v::uuid from _p where clave = 'mov2'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', f_mano, 'importe', 200.00)), 'cuenta_tercero', c400, 'tercero_id', null, 'concepto', 'Pago N10-MANO'),
    'probable', 'prueba', '[]'::jsonb, 'persona', null);
  ver := pg_temp.medir();
  raise notice 'PRUEBA N10 · 2d: vuelto a casar → estado %', (select status from public.supplier_invoice where id = f_mano);
  if (select status from public.supplier_invoice where id = f_mano) <> 'pagada' or ver->'casar' ? 'N10-MANO' then raise exception 'PRUEBA N10 · 2d: N10-MANO, %.', ver; end if;

  -- e · El resto de N10-YA (200,00): pagada; lo pagado, 242,00 en dos pagos (el de la remesa y el del casado).
  x := public.bank_casar((select v::uuid from _p where clave = 'mov3'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', f_ya, 'importe', 200.00)), 'cuenta_tercero', c400, 'tercero_id', null, 'concepto', 'Pago N10-YA'),
    'probable', 'prueba', '[]'::jsonb, 'persona', null);
  ver := pg_temp.medir();
  raise notice 'PRUEBA N10 · 2e: casado el resto de N10-YA → estado %, pagado % en % pagos', (select status from public.supplier_invoice where id = f_ya),
    (select sum(amount) from public.supplier_invoice_payment where invoice_id = f_ya), (select count(*) from public.supplier_invoice_payment where invoice_id = f_ya);
  if (select status from public.supplier_invoice where id = f_ya) <> 'pagada' or (select sum(amount) from public.supplier_invoice_payment where invoice_id = f_ya) <> 242 then
    raise exception 'PRUEBA N10 · 2e: N10-YA, %.', ver;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
rollback;
