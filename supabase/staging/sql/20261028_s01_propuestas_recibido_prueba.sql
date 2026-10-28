-- supabase/staging/sql/20261028_s01_propuestas_recibido_prueba.sql
--
-- SOLO STAGING. Prueba de la 0830 (lo recibido sin factura se propone solo al
-- acabar el mes), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. En la empresa A, con las recepciones de la semilla que siguen sin
-- factura en septiembre (Carnes Prueba del Valle: tres en Norte Centro y una en
-- Norte Mercado), por su camino: como el administrador (lo que llama el
-- navegador y la pasada de noche).
--
--   1. El proveedor no tiene tipo de gasto: no se propone, y queda en «Lo que
--      no he podido proponer», en palabras y con dónde se arregla (Compras).
--   2. Con el tipo de gasto puesto en su ficha: por cada local, el asiento del
--      30/09 (gasto contra 4009, con el proveedor de tercero) y su contrario
--      del 01/10, propuestos y sin validar; el «no he podido» se va. Otra vez,
--      nada nuevo: ya estaban.
--   3. La regla sola: el último día de febrero de un bisiesto, y una recepción
--      sin importe (se dice, y la confianza baja a «duda»).
--   4. Alguien sin cuenta no puede proponer.
--   5. La vuelta atrás: no queda nada de la 0830.
--
-- Nombra lo que toca, para el analizador: conta_propuestas_recibido,
-- conta_proponer_recibidos, _compras_fin_de_mes, purchase_accrual,
-- conta_propuesta_pendiente, _conta_proponer, _conta_no_propuesta,
-- conta_dia_abierto, journal_entry, journal_line.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 RECIBIDO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

select to_regclass('public.conta_propuesta_pendiente') is not null as ya_esta_la_0753,
       to_regprocedure('public.conta_propuestas_recibido(uuid)') is not null as ya_esta_la_0830 \gset
\if :ya_esta_la_0753
\else
\i supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
\endif
\if :ya_esta_la_0830
\else
\i supabase/migrations/20261028T0830_s01_propuestas_recibido.sql
\endif

create or replace function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('carnes', 'c0c00000-0000-4000-8000-000000000003'),
  ('centro', 'c01a0000-0000-4000-8000-0000000000a2'), ('mercado', 'e0200000-0000-4000-8000-0000000000a3'),
  ('materias', '02ee8d0d-1da4-4e30-8598-4e911ac9904d');

-- La siembra que se espera: septiembre abierto, sin nada propuesto aún, y el
-- proveedor sin tipo de gasto.
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if not public.conta_dia_abierto(e, '2026-09-30') then
    raise exception 'PRUEBA S01 RECIBIDO · siembra: el 30/09 de la empresa A no es su primer día abierto; no se prueba encima.';
  end if;
  if exists (select 1 from public.journal_entry where company_id = e and source_type in ('purchase_accrual', 'purchase_accrual_reversal')) then
    raise exception 'PRUEBA S01 RECIBIDO · siembra: la empresa A ya tiene asientos de lo recibido sin factura.';
  end if;
  if (select expense_category_id from public.supplier where id = (select v::uuid from _p where clave = 'carnes')) is not null
     or exists (select 1 from public.company_account_link where company_id = e and entity = 'supplier' and entity_id = (select v from _p where clave = 'carnes') and role = 'gasto') then
    raise exception 'PRUEBA S01 RECIBIDO · siembra: Carnes Prueba del Valle ya tiene tipo de gasto.';
  end if;
end $$;

-- ── 1 · Sin tipo de gasto: no se propone, y se dice ─────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  x := public.conta_proponer_recibidos(e, '2026-09-01', '2026-09-30', 'Prueba');
  if (x->>'propuestas')::int <> 0 or jsonb_array_length(x->'sinPropuesta') <> 2
     or x->'sinPropuesta'->0->>'porque' <> 'A Carnes Prueba del Valle, S.L. le falta el tipo de gasto: ponlo en su ficha y lo recibido sin factura de septiembre se propone.'
     or x->'sinPropuesta'->0->>'que' <> 'Recibido sin factura · Carnes Prueba del Valle, S.L. · 09/2026' then
    raise exception 'PRUEBA S01 RECIBIDO · 1: sin tipo de gasto dio %.', x;
  end if;
  if (select count(*) from public.conta_propuesta_pendiente where company_id = e and origen = 'purchase_accrual' and donde = 'Compras y gastos › Facturas recibidas') <> 2 then
    raise exception 'PRUEBA S01 RECIBIDO · 1: el «no he podido» no quedó apuntado en Compras (o el administrador no lo lee).';
  end if;
  raise notice '1 · sin tipo de gasto: «%», en «Lo que no he podido proponer» (Compras)', x->'sinPropuesta'->0->>'porque';
end $$;
reset role;

-- ── 2 · Con el tipo de gasto: el del 30/09 y su contrario del 01/10, por local ──
-- Como lo pondría el cliente en la ficha del proveedor: materias primas (600).
update public.supplier set expense_category_id = (select v::uuid from _p where clave = 'materias') where id = (select v::uuid from _p where clave = 'carnes');
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; acc uuid; mes public.journal_entry; vuelta public.journal_entry;
        party uuid := (select party_id from public.party_role where role = 'supplier' and supplier_id = (select v::uuid from _p where clave = 'carnes')
                         and account_id = (select v::uuid from _p where clave = 'cuenta') limit 1);
begin
  x := public.conta_proponer_recibidos(e, '2026-09-01', '2026-09-30', 'Prueba');
  if (x->>'propuestas')::int <> 4 or jsonb_array_length(x->'sinPropuesta') <> 0 then raise exception 'PRUEBA S01 RECIBIDO · 2: con el tipo dio %.', x; end if;
  select id into acc from public.purchase_accrual where company_id = e and month = '2026-09-01'
     and supplier_id = (select v::uuid from _p where clave = 'carnes') and location_id = (select v::uuid from _p where clave = 'centro');
  select * into mes from public.journal_entry where company_id = e and source_type = 'purchase_accrual' and source_id = acc;
  select * into vuelta from public.journal_entry where company_id = e and source_type = 'purchase_accrual_reversal' and source_id = acc;
  if mes.status <> 'propuesto' or mes.entry_date <> '2026-09-30' or mes.series <> 2 or mes.confidence <> 'seguro'
     or mes.concept <> 'Recibido sin factura · Carnes Prueba del Valle, S.L. · Norte Centro · septiembre' then
    raise exception 'PRUEBA S01 RECIBIDO · 2: el del mes es % del % (serie %, «%», %).', mes.status, mes.entry_date, mes.series, mes.concept, mes.confidence;
  end if;
  if vuelta.status <> 'propuesto' or vuelta.entry_date <> '2026-10-01'
     or vuelta.concept <> 'Contrario del recibido sin factura · Carnes Prueba del Valle, S.L. · Norte Centro · septiembre' then
    raise exception 'PRUEBA S01 RECIBIDO · 2: el contrario es % del % («%»).', vuelta.status, vuelta.entry_date, vuelta.concept;
  end if;
  if pg_temp.lineas(mes.id) <> '60000000 911.38/0.00 · 40090000 0.00/911.38' or pg_temp.lineas(vuelta.id) <> '60000000 0.00/911.38 · 40090000 911.38/0.00' then
    raise exception 'PRUEBA S01 RECIBIDO · 2: las líneas fueron «%» y «%».', pg_temp.lineas(mes.id), pg_temp.lineas(vuelta.id);
  end if;
  if (select jl.party_id from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = mes.id and ca.code = '40090000') is distinct from party then
    raise exception 'PRUEBA S01 RECIBIDO · 2: la 4009 no lleva al proveedor de tercero.';
  end if;
  if exists (select 1 from public.conta_propuesta_pendiente where company_id = e and origen = 'purchase_accrual') then
    raise exception 'PRUEBA S01 RECIBIDO · 2: el «no he podido» sigue ahí después de proponerlo.';
  end if;
  x := public.conta_proponer_recibidos(e, '2026-09-01', '2026-09-30', 'Prueba');
  if (x->>'propuestas')::int <> 0 or (x->>'yaEstaban')::int <> 4 then raise exception 'PRUEBA S01 RECIBIDO · 2: otra vez dio %.', x; end if;
  raise notice '2 · con el tipo de gasto: Norte Centro %, y su contrario el 01/10 (sin validar); otra vez, ya estaban', pg_temp.lineas(mes.id);
end $$;
reset role;

-- ── 3 · La regla sola: febrero de un bisiesto, y una recepción sin importe ──
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); acc uuid; x jsonb;
begin
  insert into public.purchase_accrual (account_id, company_id, supplier_id, location_id, month, base, receipts, without_base, computed_at)
  values ((select v::uuid from _p where clave = 'cuenta'), e, (select v::uuid from _p where clave = 'carnes'), (select v::uuid from _p where clave = 'centro'), '2028-02-01', 120.50,
          jsonb_build_array(jsonb_build_object('code', 'ALB-1', 'fecha', '2028-02-10', 'base', 120.50), jsonb_build_object('code', 'ALB-2', 'fecha', '2028-02-28', 'base', null)), 1, now())
  returning id into acc;
  x := public.conta_propuestas_recibido(acc);
  if x->'propuestas'->0->'entrada'->>'fecha' <> '2028-02-29' or x->'propuestas'->1->'entrada'->>'fecha' <> '2028-03-01' then
    raise exception 'PRUEBA S01 RECIBIDO · 3: en un bisiesto, las fechas son % y %.', x->'propuestas'->0->'entrada'->>'fecha', x->'propuestas'->1->'entrada'->>'fecha';
  end if;
  if x->'propuestas'->0->'entrada'->>'confianza' <> 'duda'
     or x->'propuestas'->0->'entrada'->'razones'->2 <> jsonb_build_object('decision', 'Mira esto', 'porque', '1 recepción(es) sin importe no están en la cifra.')
     or x->'propuestas'->0->'entrada'->'razones'->0->>'porque' <> 'ALB-1 (10/02, 120,50 €), ALB-2 (28/02, sin importe)' then
    raise exception 'PRUEBA S01 RECIBIDO · 3: con una recepción sin importe dio %.', x->'propuestas'->0->'entrada';
  end if;
  raise notice '3 · febrero de 2028: % y %; sin importe: «duda» y dicho', x->'propuestas'->0->'entrada'->>'fecha', x->'propuestas'->1->'entrada'->>'fecha';
end $$;

-- ── 4 · Sin cuenta, no ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_proponer_recibidos((select v::uuid from _p where clave = 'empresa'), '2026-09-01', '2026-09-30', 'Nadie');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01 RECIBIDO · 4: alguien sin cuenta propone lo recibido sin factura.'; end if;
  raise notice '4 · sin cuenta, no se propone («%»)', v_err;
end $$;
reset role;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0830_s01_propuestas_recibido.down.sql
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('conta_propuestas_recibido', 'conta_proponer_recibidos')) then
    raise exception 'PRUEBA S01 RECIBIDO · 5: la vuelta atrás deja algo.';
  end if;
  raise notice '5 · la vuelta atrás: no queda nada de la 0830';
end $$;
rollback;
