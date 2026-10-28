-- supabase/staging/sql/20261028_s01_propuestas_pagado_despues_prueba.sql
--
-- SOLO STAGING. Prueba de la 0849 (el no confirmado que una liquidación paga se
-- propone solo), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. En la empresa A, con dos no confirmados de la semilla del 04/10 en
-- Norte Centro: G153 (Glovo, 22,40 €, con su 430) y D6B55 (Uber Eats, 27,40 €,
-- sin 430 en esta empresa).
--
--   0. La regla de ventas no cambia: la huella de TODAS las propuestas de
--      ventas de staging (cada empresa, local y día con ventas) es la misma
--      antes y después de la 0849, y después de su vuelta atrás (regla 31: la
--      misma vara a los dos lados).
--   1. Llega la liquidación que paga los dos (el disparador, sin nadie): G153
--      se propone sola, propuesta y sin validar, de su día, con el cobro de
--      Glovo, su venta y su IVA, y el porqué de siempre; D6B55 no, y queda en
--      «Lo que no he podido proponer» (Ventas › Cierres del día) con su porqué.
--   2. Otra vez (el navegador o la pasada de noche): nada nuevo.
--   3. Si proponer falla al leer la liquidación, la liquidación entra igual y
--      queda dicho.
--   4. Alguien sin cuenta no puede proponer.
--   5. La vuelta atrás: la regla de ventas, byte a byte, y nada de la 0849.
--
-- Nombra lo que toca, para el analizador: conta_propuesta_ventas_unidad,
-- _conta_propuesta_ventas, conta_propuesta_pagado_despues,
-- conta_proponer_pagados_despues, tg_conta_liquidacion_pedidos_proponer,
-- channel_settlement_order, channel_settlement, conta_no_confirmados_pagados,
-- conta_propuesta_pendiente, journal_entry, journal_line.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 PAGADO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('g153', 'cd5ee000-0000-4000-8000-000000000001'),
  ('d6b55', 'cd5ee000-0000-4000-8000-000000000002'), ('r03k', 'e0300000-0000-4000-8000-0000000000b2'),
  ('glovo', 'e0200000-0000-4000-8000-00000000a0c1'), ('uber', 'e0200000-0000-4000-8000-00000000a0c2');

-- La huella de todas las propuestas de ventas (la vara de los pasos 0 y 5).
create or replace function pg_temp.huella_ventas() returns text language sql as $$
  select md5(coalesce(string_agg(x.empresa::text || '·' || x.location_id::text || '·' || x.dia::text || '·'
                                 || coalesce(public.conta_propuestas_ventas_dia(x.empresa, x.location_id, x.dia)::text, 'null'), '|'
                                 order by x.empresa, x.location_id, x.dia), ''))
    from (select distinct c.id as empresa, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date as dia
            from public.company c join public.sale s on s.account_id = c.account_id
           where c.is_active and s.is_active and s.location_id is not null) x
$$;
create or replace function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
insert into _p select 'huella_antes', pg_temp.huella_ventas();
insert into _p select 'prosrc_antes', md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)');

select to_regclass('public.conta_propuesta_pendiente') is not null as ya_esta_la_0753,
       to_regprocedure('public.conta_propuesta_pagado_despues(uuid,jsonb)') is not null as ya_esta_la_0849 \gset
\if :ya_esta_la_0753
\else
\i supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
\endif
\if :ya_esta_la_0849
\else
\i supabase/migrations/20261028T0849_s01_propuestas_pagado_despues.sql
\endif

-- ── 0 · La regla de ventas no cambia ────────────────────────────────────────
do $$ begin
  if pg_temp.huella_ventas() <> (select v from _p where clave = 'huella_antes') then
    raise exception 'PRUEBA S01 PAGADO · 0: con la 0849, las propuestas de ventas de staging cambian.';
  end if;
  raise notice '0 · la regla de ventas, la misma: huella % antes y después', (select v from _p where clave = 'huella_antes');
end $$;

-- La siembra que se espera.
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if exists (select 1 from public.sale s where s.id in ((select v::uuid from _p where clave = 'g153'), (select v::uuid from _p where clave = 'd6b55'))
              and not (s.unconfirmed_at is not null and s.status = 'cancelled'))
     or (select count(*) from public.sale where id in ((select v::uuid from _p where clave = 'g153'), (select v::uuid from _p where clave = 'd6b55'))) <> 2 then
    raise exception 'PRUEBA S01 PAGADO · siembra: G153 y D6B55 no son dos no confirmados.';
  end if;
  if not public.conta_dia_abierto(e, '2026-10-04') then raise exception 'PRUEBA S01 PAGADO · siembra: el 04/10 no está abierto.'; end if;
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'sales_adjustment')
     or exists (select 1 from public.channel_settlement_order where sale_id in ((select v::uuid from _p where clave = 'g153'), (select v::uuid from _p where clave = 'd6b55'))) then
    raise exception 'PRUEBA S01 PAGADO · siembra: ya hay asientos de ajuste o líneas de liquidación de estos pedidos.';
  end if;
end $$;

-- ── 1 · Llega la liquidación que los paga (el disparador, sin nadie) ───────
insert into public.channel_settlement (id, account_id, channel_id, settlement_ref, settlement_date, period_from, period_to, flow_type, import_key, gross_sales)
values ('cd5ee000-0000-4000-8000-000000000701', (select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'glovo'),
        'G-PRUEBA-S01', '2026-10-20', '2026-10-04', '2026-10-10', 'own', 'prueba-s01-pagado', 49.8);
insert into public.channel_settlement_order (account_id, channel_id, settlement_id, settlement_ref, platform_order_code, sale_id, order_date, products, matched, match_status, import_key)
values ((select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'glovo'), 'cd5ee000-0000-4000-8000-000000000701', 'G-PRUEBA-S01', 'G153',
        (select v::uuid from _p where clave = 'g153'), '2026-10-04', 22.4, true, 'casada', 'prueba-s01-pagado-g153'),
       ((select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'uber'), 'cd5ee000-0000-4000-8000-000000000701', 'G-PRUEBA-S01', 'D6B55',
        (select v::uuid from _p where clave = 'd6b55'), '2026-10-04', 27.4, true, 'casada', 'prueba-s01-pagado-d6b55');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); je public.journal_entry; v_l text;
begin
  select * into je from public.journal_entry where company_id = e and source_type = 'sales_adjustment' and source_id = (select v::uuid from _p where clave = 'g153');
  if je.id is null then
    raise exception 'PRUEBA S01 PAGADO · 1: la liquidación llegó y G153 no se propuso (%).',
      (select porque from public.conta_propuesta_pendiente where company_id = e and origen_id = (select v from _p where clave = 'g153'));
  end if;
  if je.status <> 'propuesto' or je.entry_date <> '2026-10-04' or je.series <> 1
     or je.concept <> 'Venta del 4 de octubre pagada después · Glovo · pedido G153' then
    raise exception 'PRUEBA S01 PAGADO · 1: el asiento es % del % (serie %, «%»).', je.status, je.entry_date, je.series, je.concept;
  end if;
  v_l := pg_temp.lineas(je.id);
  if v_l not like '43000001 22.40/0.00 · %' or v_l not like '%477%' then
    raise exception 'PRUEBA S01 PAGADO · 1: las líneas fueron «%».', v_l;
  end if;
  if (select sum(coalesce(debit, 0)) - sum(coalesce(credit, 0)) from public.journal_line where entry_id = je.id) <> 0 then
    raise exception 'PRUEBA S01 PAGADO · 1: el asiento no cuadra («%»).', v_l;
  end if;
  if je.reason is distinct from 'Glovo ha pagado el pedido G153, que se cerró sin confirmar el 4 de octubre'
     or je.reasons->0->>'porque' not like '%G-PRUEBA-S01 del 20 de octubre lo paga%' or je.document_ref is distinct from 'G153' then
    raise exception 'PRUEBA S01 PAGADO · 1: el porqué es «%» y la primera razón «%».', je.reason, je.reasons->0->>'porque';
  end if;
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'sales_adjustment' and source_id = (select v::uuid from _p where clave = 'd6b55')) then
    raise exception 'PRUEBA S01 PAGADO · 1: D6B55, sin 430, se propuso.';
  end if;
  if (select porque || ' · ' || donde from public.conta_propuesta_pendiente where company_id = e and origen = 'sales_adjustment' and origen_id = (select v from _p where clave = 'd6b55'))
     not like 'No sé a qué cuenta va lo que cobra Uber Eats: enlaza su 430 en su ficha (Clientes y proveedores › Plataformas). · Ventas › Cierres del día' then
    raise exception 'PRUEBA S01 PAGADO · 1: el «no he podido» de D6B55 es «%».',
      (select porque || ' · ' || donde from public.conta_propuesta_pendiente where company_id = e and origen_id = (select v from _p where clave = 'd6b55'));
  end if;
  raise notice '1 · al llegar la liquidación: G153 propuesta (%), D6B55 dicho («No sé a qué cuenta va lo que cobra Uber Eats…», en Ventas › Cierres del día)', v_l;
end $$;

-- ── 2 · Otra vez: nada nuevo ────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  x := public.conta_proponer_pagados_despues(e, 'Prueba');
  if (x->>'propuestas')::int <> 0 or (select count(*) from public.journal_entry where company_id = e and source_type = 'sales_adjustment') <> 1 then
    raise exception 'PRUEBA S01 PAGADO · 2: otra vez dio % (y % asientos).', x, (select count(*) from public.journal_entry where company_id = e and source_type = 'sales_adjustment');
  end if;
  raise notice '2 · otra vez: nada nuevo (%)', x;
end $$;
reset role;

-- ── 3 · Si proponer falla al leer la liquidación, entra igual y se dice ────
savepoint falla;
create or replace function public.conta_proponer_pagados_despues(p_company uuid, p_quien text default null)
returns jsonb language plpgsql as $$ begin raise exception 'fallo simulado de la prueba'; end $$;
insert into public.channel_settlement_order (account_id, channel_id, settlement_id, settlement_ref, platform_order_code, sale_id, order_date, products, matched, match_status, import_key)
values ((select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'glovo'), 'cd5ee000-0000-4000-8000-000000000701', 'G-PRUEBA-S01', 'R03K',
        (select v::uuid from _p where clave = 'r03k'), '2026-10-17', 19, true, 'casada', 'prueba-s01-pagado-r03k');
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if not exists (select 1 from public.channel_settlement_order where import_key = 'prueba-s01-pagado-r03k') then
    raise exception 'PRUEBA S01 PAGADO · 3: con el fallo, la línea de la liquidación no entró.';
  end if;
  if (select porque from public.conta_propuesta_pendiente where company_id = e and origen = 'sales_adjustment' and origen_id = (select v from _p where clave = 'r03k'))
     is distinct from 'No he podido proponerlo al leer la liquidación: fallo simulado de la prueba' then
    raise exception 'PRUEBA S01 PAGADO · 3: el fallo no quedó dicho.';
  end if;
  raise notice '3 · si proponer falla, la liquidación entra igual y queda dicho';
end $$;
rollback to savepoint falla;

-- ── 4 · Sin cuenta, no ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_proponer_pagados_despues((select v::uuid from _p where clave = 'empresa'), 'Nadie');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01 PAGADO · 4: alguien sin cuenta propone.'; end if;
  raise notice '4 · sin cuenta, no se propone («%»)', v_err;
end $$;
reset role;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0849_s01_propuestas_pagado_despues.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)'))
     <> (select v from _p where clave = 'prosrc_antes') then
    raise exception 'PRUEBA S01 PAGADO · 5: la regla de ventas no vuelve byte a byte.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('_conta_propuesta_ventas', 'conta_propuesta_pagado_despues', 'conta_proponer_pagados_despues', 'tg_conta_liquidacion_pedidos_proponer'))
     or exists (select 1 from pg_trigger where tgname like 'conta_liquidacion_pedidos_proponer%') then
    raise exception 'PRUEBA S01 PAGADO · 5: la vuelta atrás deja algo.';
  end if;
  raise notice '5 · la vuelta atrás: la regla de ventas byte a byte (%), y nada de la 0849', (select v from _p where clave = 'prosrc_antes');
end $$;
rollback;
