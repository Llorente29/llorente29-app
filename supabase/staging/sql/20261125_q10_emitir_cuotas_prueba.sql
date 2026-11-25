-- supabase/staging/sql/20261125_q10_emitir_cuotas_prueba.sql
--
-- SOLO STAGING. La 1610 del Q10 (emitir las facturas de las cuotas ya cobradas por GoCardless), en la cuenta A de
-- pruebas, con ROLLBACK, por sus caminos:
--   0. La siembra inventada (T11): la empresa A con su plan y su ejercicio, cuatro clientes («Cliente Prueba Q10 …»),
--      sus cobros del mes (cobrados, uno fallido), sus suscripciones y sus enlaces atados. Si la base no tiene aún
--      conta_gc_cobro_factura (la trae el #816 de K), se crea aquí igual que en el #816, dentro del ROLLBACK.
--   1. La serie que no cuadra: la última de ERP10 no es la de antes de la primera de Sumied → PARA, sin escribir nada.
--   2. Preparar y emitir un trozo: dos facturas seguidas (la 101 y la 102), con la fecha de hoy, el total igual al
--      cobro, la retención del 15 % en la segunda, la línea de la suscripción, «Cuota de … · cobrada el …» en las
--      notas, su asiento (430/705/477 y la 473), la 430 de ERP10 dada de alta y atada, y cada una atada a su cobro.
--   3. Un cobro, una factura: el mismo cobro otra vez → PARA.
--   4. Un trozo con un cliente sin NIF, o con un cobro fallido → PARA entero: la serie sigue en la 102.
--   5. ERP10 por delante de Sumied → PARA. El trozo siguiente sigue en la 103.
--   6. Otra cuenta (B) no puede.
--   7. La vuelta atrás quita la función, y otra vez la 1610.
-- Nunca se emite nada de verdad: todo acaba en ROLLBACK.
-- sin usuario: la siembra va como postgres; cada emisión, como la persona administradora de A (set local role authenticated).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261125T1610_q10_emitir_cuotas.sql
\i supabase/migrations/20261125T1610_q10_emitir_cuotas.sql

-- La tabla del #816, si aún no está (igual que en su 1320).
create table if not exists public.conta_gc_cobro_factura (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  gc_id text not null,
  invoice_id uuid not null references public.customer_invoice(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (company_id, gc_id),
  unique (invoice_id)
);
grant select on public.conta_gc_cobro_factura to authenticated;

create temp table _q (clave text primary key, v text) on commit drop;
grant select, insert, update on _q to authenticated;

-- 0 · La siembra.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA Q10: la cuenta A no tiene empresa.'; end if;
  insert into _q values ('empresa', v_e::text), ('con_plan', (exists (select 1 from public.company_account where company_id = v_e))::text),
    ('mes', to_char(v_hoy, 'YYYY-MM')), ('dia', to_char(date_trunc('month', v_hoy), 'YYYY-MM-DD')), ('anio', extract(year from v_hoy)::text);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _q where clave = 'empresa'); r jsonb;
begin
  if (select v from _q where clave = 'con_plan') = 'false' then perform public.company_chart_activate(v_e, false, 'Prueba Q10'); end if;
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba Q10 Uno, S.L.', 'B00000010', '{}'::jsonb, 'Prueba Q10'); insert into _q values ('c1', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba Q10 Dos, S.L.', 'B00000020', '{}'::jsonb, 'Prueba Q10'); insert into _q values ('c2', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba Q10 Sin NIF', null, '{}'::jsonb, 'Prueba Q10'); insert into _q values ('c3', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba Q10 Cuatro, S.L.', 'B00000040', '{}'::jsonb, 'Prueba Q10'); insert into _q values ('c4', r->>'party_id');
end $$;
reset role;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _q where clave = 'empresa');
  v_dia date := (select v::date from _q where clave = 'dia'); i int; v_imp numeric[] := array[121, 53, 121, 24.20, 121];
begin
  if not exists (select 1 from public.fiscal_year where company_id = v_e and v_dia between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, v_e, to_char(v_dia, 'YYYY'), date_trunc('year', v_dia)::date, (date_trunc('year', v_dia) + interval '1 year - 1 day')::date);
  end if;
  -- La serie «1», sin empezar: la crea la primera emisión.
  delete from public.customer_invoice_counter where company_id = v_e and series_code = '1';
  delete from public.invoice_series where company_id = v_e and code = '1';
  -- El cliente Uno ya tiene su 430 en Sumied (43000101); el Dos no (la de ERP10 será la 43000202).
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, public._conta_cobro_cuenta(v_e, '43000101', 'Cliente Prueba Q10 Uno, S.L.', 'Prueba Q10'), 'customer', (select v from _q where clave = 'c1'), 'principal', 'manual')
  on conflict (company_id, entity, entity_id, role) do update set company_account_id = excluded.company_account_id;
  delete from public.company_account_link where company_id = v_e and entity = 'customer' and entity_id = (select v from _q where clave = 'c2');
  -- Cinco cobros: 1 (121, c1), 2 (53, c2), 3 (121, c3 sin NIF), 4 (24,20, c4), 5 (121, c4, FALLIDO).
  for i in 1..5 loop
    insert into public.conta_gc_suscripcion (company_id, gc_id, account_id, gc_cliente_id, nombre, estado)
    values (v_e, 'SBQ10' || i, v_acc, 'CUQ10' || least(i, 4), case i when 4 then 'GESTION LABORAL  PERSONA INVENTADA' else 'GESTORIA MENSUAL' end, 'active');
    insert into public.conta_gc_cobro (company_id, gc_id, account_id, suscripcion_gc_id, estado, fecha, importe, moneda)
    values (v_e, 'PMQ10' || i, v_acc, 'SBQ10' || i, case i when 5 then 'failed' else 'paid_out' end, v_dia, v_imp[i], 'EUR');
  end loop;
  for i in 1..4 loop
    insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado)
    values (v_e, 'CUQ10' || i, v_acc, (select v::uuid from _q where clave = 'c' || i), 'persona', 'atado')
    on conflict (company_id, gc_cliente_id) do update set party_id = excluded.party_id, por = 'persona', estado = 'atado';
  end loop;
  raise notice 'Q10 · 0: la siembra, en la empresa A. OK';
end $$;

-- Como la persona administradora de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;

-- 1 · La serie que no cuadra: ERP10 va por la 100 y la primera de Sumied sería la 102.
do $$
declare v_e uuid := (select v::uuid from _q where clave = 'empresa'); v_mes text := (select v from _q where clave = 'mes'); v_a text := (select v from _q where clave = 'anio');
begin
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 102, v_a || '/1/100', '[{"gc_id": "PMQ10" }]'::jsonb || '[]'::jsonb);
    raise exception 'Q10 · 1: con la serie sin cuadrar, ha emitido.';
  exception when check_violation then
    if sqlerrm not like '%tienen que ir seguidas%' then raise; end if;
  end;
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 101, null, '[{"gc_id": "PMQ101"}]');
    raise exception 'Q10 · 1: sin la última de ERP10, ha emitido.';
  exception when check_violation then null; end;
  if exists (select 1 from public.customer_invoice where company_id = v_e and series_code = '1')
     or exists (select 1 from public.invoice_series where company_id = v_e and code = '1') then
    raise exception 'Q10 · 1: ha escrito algo sin emitir.';
  end if;
  raise notice 'Q10 · 1: la serie que no cuadra PARA sin escribir nada. OK';
end $$;

-- 2 · Emitir un trozo: la 101 (121 €, sin retención) y la 102 (53 €, con el 15 % y la 430 de ERP10).
do $$
declare v_e uuid := (select v::uuid from _q where clave = 'empresa'); v_mes text := (select v from _q where clave = 'mes'); v_a text := (select v from _q where clave = 'anio');
  r jsonb; f1 public.customer_invoice; f2 public.customer_invoice; v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_dia text := (select v from _q where clave = 'dia');
begin
  r := public.conta_cuotas_emitir(v_e, v_mes, 101, v_a || '/1/100',
    '[{"gc_id": "PMQ101", "retencion_pct": 0}, {"gc_id": "PMQ102", "retencion_pct": 15, "cuenta_cliente": "43000202"}]');
  if r->>'frase' not like 'Emitidas 2 facturas de % de la ' || v_a || '/1/101 a la ' || v_a || '/1/102, 174,00 €.' then raise exception 'Q10 · 2: la frase es «%».', r->>'frase'; end if;
  if (r->>'siguiente')::int <> 103 then raise exception 'Q10 · 2: la siguiente es %.', r->>'siguiente'; end if;
  select * into f1 from public.customer_invoice where id = (select invoice_id from public.conta_gc_cobro_factura where company_id = v_e and gc_id = 'PMQ101');
  select * into f2 from public.customer_invoice where id = (select invoice_id from public.conta_gc_cobro_factura where company_id = v_e and gc_id = 'PMQ102');
  if f1.number_text <> v_a || '/1/101' or f2.number_text <> v_a || '/1/102' or f1.status <> 'emitida' or f2.status <> 'emitida' then
    raise exception 'Q10 · 2: los números son % y % (%, %).', f1.number_text, f2.number_text, f1.status, f2.status;
  end if;
  if f1.issue_date <> v_hoy or f2.issue_date <> v_hoy then raise exception 'Q10 · 2: la fecha no es la de hoy: %.', f1.issue_date; end if;
  if f1.total <> 121 or f1.base <> 100 or f1.tax <> 21 or coalesce(f1.withholding_amount, 0) <> 0 then raise exception 'Q10 · 2: la 101 sale %/%/%/%.', f1.base, f1.tax, f1.withholding_amount, f1.total; end if;
  if f2.total <> 53 or f2.base <> 50 or f2.tax <> 10.50 or f2.withholding_amount <> 7.50 then raise exception 'Q10 · 2: la 102 sale %/%/%/%.', f2.base, f2.tax, f2.withholding_amount, f2.total; end if;
  if f1.notes <> 'Cuota de ' || (select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_hoy)::int]) || ' de ' || v_a
                || ' · cobrada el ' || to_char(v_dia::date, 'DD/MM/YYYY') then raise exception 'Q10 · 2: las notas son «%».', f1.notes; end if;
  if (select concept from public.customer_invoice_line where invoice_id = f1.id) <> 'GESTORIA MENSUAL' then raise exception 'Q10 · 2: la línea no es la suscripción.'; end if;
  -- El asiento: 430 por el total, 705, 477 y la 473 de la retención; la 430 de la 102 es la de ERP10.
  if not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = f1.entry_id and a.code = '43000101' and l.debit = 121)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = f1.entry_id and a.code = '70500000' and l.credit = 100)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = f1.entry_id and a.code like '477%' and l.credit = 21)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = f2.entry_id and a.code = '43000202' and l.debit = 53)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = f2.entry_id and a.code like '473%' and l.debit = 7.50) then
    raise exception 'Q10 · 2: los asientos no son 430/705/477 (y 473).';
  end if;
  if not exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.company_id = v_e and k.entity = 'customer' and k.entity_id = (select v from _q where clave = 'c2') and a.code = '43000202') then
    raise exception 'Q10 · 2: la 430 de ERP10 no ha quedado atada al cliente Dos.';
  end if;
  if (select count(*) from public.conta_gc_cobro_factura where company_id = v_e) <> 2 then raise exception 'Q10 · 2: no hay dos facturas atadas a su cobro.'; end if;
  raise notice 'Q10 · 2: emitidas la 101 y la 102 de hoy, cuadradas con su cobro, con la retención, su asiento y atadas a su cobro. OK';
end $$;

-- 3 · Un cobro, una factura.
do $$
declare v_e uuid := (select v::uuid from _q where clave = 'empresa'); v_mes text := (select v from _q where clave = 'mes'); v_a text := (select v from _q where clave = 'anio');
begin
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 103, v_a || '/1/100', '[{"gc_id": "PMQ101"}]');
    raise exception 'Q10 · 3: el mismo cobro ha tenido dos facturas.';
  exception when unique_violation then null; end;
  raise notice 'Q10 · 3: un cobro, una factura. OK';
end $$;

-- 4 · Un trozo con un cliente sin NIF, o con un cobro fallido: PARA entero, la serie sigue en la 102.
do $$
declare v_e uuid := (select v::uuid from _q where clave = 'empresa'); v_mes text := (select v from _q where clave = 'mes'); v_a text := (select v from _q where clave = 'anio');
begin
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 103, v_a || '/1/100', '[{"gc_id": "PMQ104", "cuenta_cliente": "43000404"}, {"gc_id": "PMQ103"}]');
    raise exception 'Q10 · 4: ha emitido a un cliente sin NIF.';
  exception when check_violation then
    if sqlerrm not like '%no tiene NIF%' then raise; end if;
  end;
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 103, v_a || '/1/100', '[{"gc_id": "PMQ105"}]');
    raise exception 'Q10 · 4: ha emitido un cobro fallido.';
  exception when check_violation then null; end;
  if (select max(number) from public.customer_invoice where company_id = v_e and series_code = '1' and status = 'emitida') <> 102
     or exists (select 1 from public.conta_gc_cobro_factura where company_id = v_e and gc_id = 'PMQ104') then
    raise exception 'Q10 · 4: un trozo que para ha dejado algo.';
  end if;
  raise notice 'Q10 · 4: el trozo con un cliente sin NIF o un cobro fallido PARA entero. OK';
end $$;

-- 5 · ERP10 por delante de Sumied: PARA. Y el trozo siguiente sigue en la 103.
do $$
declare v_e uuid := (select v::uuid from _q where clave = 'empresa'); v_mes text := (select v from _q where clave = 'mes'); v_a text := (select v from _q where clave = 'anio'); r jsonb;
begin
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 103, v_a || '/1/105', '[{"gc_id": "PMQ104", "cuenta_cliente": "43000404"}]');
    raise exception 'Q10 · 5: con ERP10 por delante, ha emitido.';
  exception when check_violation then
    if sqlerrm not like '%alguien ha numerado en ERP10%' then raise; end if;
  end;
  begin
    perform public.conta_cuotas_emitir(v_e, v_mes, 104, v_a || '/1/100', '[{"gc_id": "PMQ104", "cuenta_cliente": "43000404"}]');
    raise exception 'Q10 · 5: saltándose la 103, ha emitido.';
  exception when check_violation then null; end;
  r := public.conta_cuotas_emitir(v_e, v_mes, 103, v_a || '/1/100', '[{"gc_id": "PMQ104", "cuenta_cliente": "43000404"}]');
  if r->'emitidas'->0->>'numero' <> v_a || '/1/103' then raise exception 'Q10 · 5: el trozo siguiente no sigue en la 103: %.', r; end if;
  raise notice 'Q10 · 5: ERP10 por delante PARA; el trozo siguiente sigue en la 103. OK';
end $$;
reset role;

-- 6 · Otra cuenta (B) no puede.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_cuotas_emitir((select v::uuid from _q where clave = 'empresa'), (select v from _q where clave = 'mes'), 104,
      (select v from _q where clave = 'anio') || '/1/100', '[{"gc_id": "PMQ103"}]');
    raise exception 'Q10 · 6: otra cuenta ha emitido.';
  exception when insufficient_privilege then null; end;
  raise notice 'Q10 · 6: otra cuenta no puede. OK';
end $$;
reset role;

-- 7 · La vuelta atrás, y otra vez la 1610.
\i supabase/vuelta-atras/20261125T1610_q10_emitir_cuotas.down.sql
do $$ begin
  if to_regprocedure('public.conta_cuotas_emitir(uuid,text,int,text,jsonb)') is not null then raise exception 'Q10 · 7: la vuelta atrás no quita la función.'; end if;
  raise notice 'Q10 · 7: la vuelta atrás quita la función. OK';
end $$;
\i supabase/migrations/20261125T1610_q10_emitir_cuotas.sql
\echo 'Q10 · 7: y otra vez la 1610. OK'

rollback;
