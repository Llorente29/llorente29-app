-- supabase/staging/sql/20261109_g05_apuntar_pendiente_prueba.sql
--
-- SOLO STAGING. La 2027 (G05 · nº 60: apuntar un pago con tarjeta que quedó
-- pendiente, y poner la cuenta de Stripe en Ajustes del cobro), en la cuenta A de
-- pruebas, con clientes, mandatos y cobros inventados (T11), y ROLLBACK:
--   1. La 2027, dos veces.
--   2. Lo de la prueba del G05 T3 (20261109_g05_cobro_prueba.sql), pasos 2 a 7:
--      el Dos, devuelto antes de cobrarse, sin factura.
--   3. El Dos pagado con tarjeta desde el portal sin cuenta de Stripe: pendiente.
--      · Otra cuenta (B) no lee, no pone la cuenta y no apunta.
--      · Leer: sin cuenta, no vale, 1 pago esperando con su importe.
--      · «Apuntar el pago» sin cuenta: no se apunta y lo dice (sigue pendiente).
--      · Poner la cuenta: una que no es 572 o sin las cifras del plan, error; la
--        de un banco o una con otro nombre, no se guardan y lo dicen; la 57200003 sí (se crea
--        «Plataforma Stripe» con su registro) y dice que hay 1 pago esperando.
--      · «Apuntar los N pagos» (el camino de «Apuntar el pago»): asiento
--        57200003 / 430, su factura nueva (no tenía), fuera de «Te deben» y de
--        «Pendiente de revisar»; con lo del bloque verde (quién, cuándo, los dos
--        asientos con sus apuntes) y en «apuntados hoy»; otra vez, nada.
--      · Quitar la cuenta.
--   4. La vuelta atrás de la 2027, y otra vez la 2027.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 PENDIENTE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 2027, dos veces.
\i supabase/migrations/20261109T2027_g05_apuntar_pendiente.sql
\i supabase/migrations/20261109T2027_g05_apuntar_pendiente.sql
do $$ begin
  if to_regprocedure('public.conta_cobro_cuenta_stripe_poner(uuid,text)') is null or to_regprocedure('public.conta_recibo_apuntar_pendiente(uuid)') is null
     or to_regprocedure('public.conta_cobro_cuenta_stripe_leer(uuid)') is null or to_regprocedure('public.conta_cobro_apuntar_pendientes(uuid)') is null then
    raise exception 'G05 PENDIENTE · 1: falta algo de la 2027.';
  end if;
  raise notice 'G05 PENDIENTE · 1: la 2027 carga, y dos veces. OK';
end $$;

create temp table _g (clave text primary key, v text) on commit drop;
grant select, insert, update on _g to authenticated, service_role;

-- 2 · Lo de la prueba del G05 T3, pasos 2 a 7 (el Uno retrocedido con su factura; el Dos devuelto sin ella).
-- 2 · La empresa A con su plan, dos clientes con su mandato y la serie «1» que empieza en el 141.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA G05: la cuenta A no tiene empresa.'; end if;
  insert into _g values ('empresa', v_e::text), ('con_plan', (exists (select 1 from public.company_account where company_id = v_e))::text);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb;
begin
  if (select v from _g where clave = 'con_plan') = 'false' then perform public.company_chart_activate(v_e, false, 'Prueba G05'); end if;
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba G05 Uno', '12345678Z', '{}'::jsonb, 'Prueba G05');
  insert into _g values ('c1', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba G05 Dos', '00000000T', '{}'::jsonb, 'Prueba G05');
  insert into _g values ('c2', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba G05 Otro', null, '{}'::jsonb, 'Prueba G05');
  insert into _g values ('c3', r->>'party_id');
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba G05 Cuatro', null, '{}'::jsonb, 'Prueba G05');
  insert into _g values ('c4', r->>'party_id');
end $$;
reset role;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _g where clave = 'empresa');
begin
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, forma_cobro, gc_cliente_id, updated_by_name)
  values (v_e, (select v::uuid from _g where clave = 'c1'), v_acc, 'gocardless', 'CU0000G05UNO', 'Prueba G05'),
         (v_e, (select v::uuid from _g where clave = 'c2'), v_acc, 'gocardless', 'CU0000G05DOS', 'Prueba G05')
  on conflict (company_id, party_id) do update set gc_cliente_id = excluded.gc_cliente_id, forma_cobro = excluded.forma_cobro;
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado, creado)
  values (v_e, 'MD0000G05UNO', v_acc, 'CU0000G05UNO', 'active', now() - interval '1 year'),
         (v_e, 'MD0000G05VIEJO', v_acc, 'CU0000G05UNO', 'cancelled', now() - interval '2 years'),
         (v_e, 'MD0000G05DOS', v_acc, 'CU0000G05DOS', 'active', now() - interval '1 year');
  -- El ejercicio de 2026, si la empresa no lo tiene abierto (sin él no hay asientos).
  if not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-11-06' between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, v_e, '2026', '2026-01-01', '2026-12-31');
  end if;
  -- Los ajustes del cobro: la retención solo 0, 15 o 7; los días, del 1 al 28; sin poner, los de QBO.
  begin
    insert into public.conta_gestoria_ajustes (company_id, account_id, retencion_pct) values (v_e, v_acc, 10)
    on conflict (company_id) do update set retencion_pct = excluded.retencion_pct;
    raise exception 'G05 · 2: una retención del 10 %% ha entrado.';
  exception when check_violation then null; end;
  begin
    insert into public.conta_gestoria_ajustes (company_id, account_id, dia_cargo) values (v_e, v_acc, 31)
    on conflict (company_id) do update set dia_cargo = excluded.dia_cargo;
    raise exception 'G05 · 2: el día de cargo 31 ha entrado.';
  exception when check_violation then null; end;
  if public._conta_cobro_ajustes(v_e)->>'cuenta_plataforma' <> '57200002' or (public._conta_cobro_ajustes(v_e)->>'retencion_pct')::numeric <> 0 then
    raise exception 'G05 · 2: sin ajustes no salen los de QBO: %.', public._conta_cobro_ajustes(v_e);
  end if;
  -- Como en staging: la 43000001 (la del primer código libre) ya es de otro cliente.
  if not exists (select 1 from public.company_account where company_id = v_e and code = '43000001') then
    perform public._conta_cobro_cuenta(v_e, '43000001', 'Cliente Prueba G05 Otro', 'Prueba G05');
  end if;
  if not exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.company_id = v_e and a.code = '43000001' and k.entity = 'customer') then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_acc, v_e, (select id from public.company_account where company_id = v_e and code = '43000001'), 'customer', (select v from _g where clave = 'c3'), 'principal', 'manual');
  end if;
  delete from public.invoice_series where company_id = v_e and code = '1';
  insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active, formato)
  values (v_acc, v_e, '1', 'Recibos (Prueba G05)', 'invoice', 1, true, 141, false, true, '{año}/{serie}/{número}');
end $$;

-- 2 · Preparar, como conta-cobro (dos veces: no duplica).
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); c1 text := (select v from _g where clave = 'c1'); c2 text := (select v from _g where clave = 'c2');
  v_recibos jsonb; r jsonb; v_n int;
begin
  v_recibos := jsonb_build_array(
    jsonb_build_object('clave', 'recibo:' || v_e || ':' || c1 || ':2026-11', 'party_id', c1, 'total_cent', 6050, 'anterior_cent', null,
      'lineas', jsonb_build_array(jsonb_build_object('texto', 'Asesoría laboral · Plan Básico', 'importeCent', 6050)),
      'cambios', jsonb_build_array(jsonb_build_object('tipo', 'cliente_nuevo', 'texto', 'Cliente nuevo: es su primer recibo.')), 'pide_clic', null, 'parado', '[]'::jsonb,
      'factura', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('concepto', 'Asesoría laboral · Plan Básico', 'cantidad', 1, 'precioCent', 5000)), 'totalCent', 6050),
      'cobrar_cent', 6050),
    jsonb_build_object('clave', 'recibo:' || v_e || ':' || c2 || ':2026-11', 'party_id', c2, 'total_cent', 3025, 'anterior_cent', 3025,
      'lineas', jsonb_build_array(jsonb_build_object('texto', 'Asesoría fiscal', 'importeCent', 3025)),
      'cambios', '[]'::jsonb, 'pide_clic', null, 'parado', '[]'::jsonb,
      'factura', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('concepto', 'Asesoría fiscal', 'cantidad', 1, 'precioCent', 2500)), 'totalCent', 3025),
      'cobrar_cent', 3025));
  r := public.conta_cobro_guardar(v_e, '2026-11', v_recibos, '[]'::jsonb, 'Prueba G05');
  r := public.conta_cobro_guardar(v_e, '2026-11', v_recibos, jsonb_build_array(jsonb_build_object('cliente', 'Uno de baja', 'porque', 'De baja.')), 'Prueba G05');
  select count(*) into v_n from public.conta_recibo where company_id = v_e and mes = '2026-11';
  if v_n <> 2 then raise exception 'G05 · 2: tenía que haber 2 recibos y hay %.', v_n; end if;
  if (select cargo_el from public.conta_cobro_mes where company_id = v_e and mes = '2026-11') <> date '2026-11-04' then raise exception 'G05 · 2: el cargo no es el día 4.'; end if;
  insert into _g select 'r1', id::text from public.conta_recibo where clave = 'recibo:' || v_e || ':' || c1 || ':2026-11';
  insert into _g select 'r2', id::text from public.conta_recibo where clave = 'recibo:' || v_e || ':' || c2 || ':2026-11';
  raise notice 'G05 · 2: preparados 2 recibos; guardar otra vez no duplica. OK';
end $$;

-- 3 · Revisar, como la persona administradora de A.
set local role authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb;
begin
  r := public.conta_cobro_aprobar_iguales(v_e, '2026-11');
  if (r->>'n')::int <> 1 then raise exception 'G05 · 3: «aprobar los iguales» tenía que aprobar 1 y aprueba % (%).', r->>'n', r->>'frase'; end if;
  if (select decision from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1')) <> 'pendiente' then
    raise exception 'G05 · 3: el recibo nuevo se ha aprobado sin mirarlo.';
  end if;
  r := public.conta_cobro_decidir((select v::uuid from _g where clave = 'r1'), 'aprobado');
  if r->>'frase' not like 'Aprobado el recibo de Cliente Prueba G05 Uno: 60,50 €.' then raise exception 'G05 · 3: la frase de aprobar es «%».', r->>'frase'; end if;
  r := public.conta_pantalla_cobro(v_acc, v_e, '2026-11');
  if jsonb_array_length(r->'recibos') <> 2 or r->'ajustes'->>'cuenta_plataforma' <> '57200002' then raise exception 'G05 · 3: la pantalla no enseña los 2 recibos con sus ajustes: %.', r; end if;
  raise notice 'G05 · 3: los iguales se aprueban de una vez y el nuevo uno a uno; la pantalla los enseña. OK';
end $$;
reset role;

-- 4 · Otra cuenta (B) no ve ni toca nada; y una persona no guarda recibos.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb;
begin
  if exists (select 1 from public.conta_recibo where company_id = v_e) or exists (select 1 from public.conta_cobro_mes where company_id = v_e) then
    raise exception 'G05 · 4: la cuenta B ve los recibos de A.';
  end if;
  r := public.conta_pantalla_cobro('c01a0000-0000-4000-8000-00000000000a', v_e, '2026-11');
  if jsonb_array_length(r->'recibos') <> 0 or r->'ajustes' <> 'null'::jsonb and r->'ajustes' is not null then raise exception 'G05 · 4: la pantalla enseña a B lo de A: %.', r; end if;
  r := public.conta_pantalla_cobro('c01b0000-0000-4000-8000-00000000000b', v_e, '2026-11');
  if jsonb_array_length(r->'recibos') <> 0 or r->'ajustes' is not null and r->'ajustes' <> 'null'::jsonb then raise exception 'G05 · 4: con su cuenta, B ve lo de la empresa de A: %.', r; end if;
  begin
    perform public.conta_cobro_decidir((select v::uuid from _g where clave = 'r1'), 'este_mes_no');
    raise exception 'G05 · 4: B ha decidido un recibo de A.';
  exception when no_data_found then null; end;
  begin
    perform public.conta_cobro_guardar(v_e, '2026-11', '[]'::jsonb, '[]'::jsonb, 'Intruso');
    raise exception 'G05 · 4: una persona ha podido guardar recibos.';
  exception when insufficient_privilege then null; end;
  begin
    perform public._conta_cobro_facturar((select v::uuid from _g where clave = 'r1'));
    raise exception 'G05 · 4: una persona ha podido facturar un recibo a mano.';
  exception when insufficient_privilege then null; end;
  raise notice 'G05 · 4: otra cuenta no ve ni toca nada, y una persona no guarda ni factura recibos. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

-- 5 · Enviar, como conta-cobro: los dos aprobados, con su mandato que cobra (no el cancelado).
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); v_l jsonb; v_x jsonb; r jsonb;
begin
  v_l := public.conta_cobro_para_enviar(v_e, '2026-11');
  if jsonb_array_length(v_l) <> 2 then raise exception 'G05 · 5: tenían que salir 2 y salen %.', jsonb_array_length(v_l); end if;
  if exists (select 1 from jsonb_array_elements(v_l) x where x->>'mandato_gc_id' not in ('MD0000G05UNO', 'MD0000G05DOS')) then raise exception 'G05 · 5: algún recibo sale con otro mandato: %.', v_l; end if;
  for v_x in select * from jsonb_array_elements(v_l) loop
    perform public.conta_cobro_enviado((v_x->>'id')::uuid, 'PM0000G05' || case when v_x->>'mandato_gc_id' = 'MD0000G05UNO' then 'UNO' else 'DOS' end,
      'pending_submission', null, v_x->>'mandato_gc_id', 'pruebas', 'c01a0000-0000-4000-8000-0000000000a1', 'Persona Prueba A');
  end loop;
  begin
    perform public.conta_cobro_enviado((select v::uuid from _g where clave = 'r1'), 'PM0000G05OTRO', 'pending_submission', null, 'MD0000G05UNO', 'pruebas', null, 'Prueba G05');
    raise exception 'G05 · 5: un recibo ha cogido un segundo cobro.';
  exception when unique_violation then null; end;
  r := public.conta_cobro_guardar(v_e, '2026-11', jsonb_build_array(jsonb_build_object('clave', (select clave from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1')),
         'party_id', (select v from _g where clave = 'c1'), 'total_cent', 9999, 'cobrar_cent', 9999)), '[]'::jsonb, 'Prueba G05');
  if (r->>'ya_enviados')::int <> 1 or (select total_cent from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1')) <> 6050 then
    raise exception 'G05 · 5: preparar otra vez ha tocado un recibo enviado (%).', r;
  end if;
  if exists (select 1 from public.conta_recibo where id = (select v::uuid from _g where clave = 'r2')) is false then raise exception 'G05 · 5: preparar sin un recibo enviado lo ha borrado.'; end if;
  if (select count(*) from public.conta_gc_cobro where company_id = v_e and gc_id like 'PM0000G05%') <> 2 then raise exception 'G05 · 5: los cobros no están en la lectura de GoCardless.'; end if;
  if exists (select 1 from public.conta_recibo where company_id = v_e and mes = '2026-11' and (estado <> 'enviado' or invoice_id is not null)) then
    raise exception 'G05 · 5: un recibo enviado no está «enviado» o ya tiene factura.';
  end if;
  raise notice 'G05 · 5: enviados los 2 con su mandato; ni un segundo cobro ni tocar lo enviado; sin factura hasta el cobro. OK';
end $$;

-- 6 · Seguir: el Uno se confirma; el Dos, devuelto antes de cobrarse.
update public.conta_gc_cobro set estado = 'confirmed', fecha = date '2026-11-06'
 where company_id = (select v::uuid from _g where clave = 'empresa') and gc_id = 'PM0000G05UNO';
update public.conta_gc_cobro set estado = 'failed', fecha = date '2026-11-06', motivo = 'insufficient_funds'
 where company_id = (select v::uuid from _g where clave = 'empresa') and gc_id = 'PM0000G05DOS';
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_r public.conta_recibo; v_f public.customer_invoice;
  v_430 text; v_mal text; v_cobro record;
begin
  r := public.conta_cobro_seguir(v_e);
  if (r->>'facturadas')::int <> 1 or (r->>'fallos')::int <> 0 then
    raise exception 'G05 · 6: seguir tenía que facturar 1 sin fallos: % (%).', r,
      (select string_agg(texto, ' | ') from public.conta_recibo_evento where company_id = v_e and tipo = 'fallo');
  end if;
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1');
  select * into v_f from public.customer_invoice where id = v_r.invoice_id;
  if v_r.estado <> 'facturado' or v_f.number_text is distinct from '2026/1/141' or v_f.total <> 60.50 or v_f.tax <> 10.50 then
    raise exception 'G05 · 6: la factura del Uno no es la 2026/1/141 de 60,50 (estado %, número %, total %, IVA %).', v_r.estado, v_f.number_text, v_f.total, v_f.tax;
  end if;
  if v_f.issue_date <> date '2026-11-06' then raise exception 'G05 · 6: la factura no lleva la fecha del cobro confirmado (%).', v_f.issue_date; end if;
  -- El asiento de la factura: 430 + código del cliente al debe por el total; 70500000 y la 477 al haber.
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit, ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_f.entry_id;
  if not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_f.entry_id and a.code = '70500000' and l.credit = 50)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_f.entry_id and a.code like '477%' and l.credit = 10.50)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_f.entry_id and a.code ~ '^430[0-9]{5}$' and l.debit = 60.50) then
    raise exception 'G05 · 6: el asiento de la factura no es 430 / 705 + 477: %.', v_mal;
  end if;
  select a.code into v_430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_r.party_id::text and k.role = 'principal';
  if v_430 is null or v_430 = '43000001' then raise exception 'G05 · 6: el Uno ha cogido la 430 de otro cliente (%).', v_430; end if;
  -- El del cobro: 57200002 al debe y la 430 del cliente al haber, con la fecha del cobro y «nº de factura-nombre».
  select e.entry_date, e.concept, e.status into v_cobro from public.journal_entry e where e.id = v_r.asiento_cobro;
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit || ' «' || coalesce(l.concept, '') || '»', ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_r.asiento_cobro;
  if v_mal is distinct from format('%s 0.00/60.50 «2026/1/141-Cliente Prueba G05 Uno», 57200002 60.50/0.00 «2026/1/141-Cliente Prueba G05 Uno»', v_430) then
    raise exception 'G05 · 6: el asiento del cobro no es 57200002 / % con su concepto: %.', v_430, v_mal;
  end if;
  if v_cobro.entry_date <> date '2026-11-06' then raise exception 'G05 · 6: el asiento del cobro no lleva la fecha del cobro (%).', v_cobro.entry_date; end if;
  if not exists (select 1 from public.customer_invoice_payment where invoice_id = v_f.id and amount = 60.50 and entry_id = v_r.asiento_cobro) then
    raise exception 'G05 · 6: la factura no queda cobrada con su asiento.';
  end if;
  -- El Dos: devuelto, sin factura y sin asientos.
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r2');
  if v_r.estado <> 'devuelto' or v_r.invoice_id is not null or v_r.asiento_cobro is not null then
    raise exception 'G05 · 6: el devuelto sin cobrar tiene factura o asiento (estado %).', v_r.estado;
  end if;
  -- Seguir otra vez: nada nuevo.
  r := public.conta_cobro_seguir(v_e);
  if (r->>'facturadas')::int <> 0 or (select count(*) from public.customer_invoice where company_id = v_e and series_code = '1') <> 1 then
    raise exception 'G05 · 6: seguir otra vez ha hecho otra factura (%).', r;
  end if;
  raise notice 'G05 · 6: confirmado → la 2026/1/141 (60,50 €) con 430 / 705 + 477 y el cobro 57200002 / %; el devuelto, sin factura; sin repetir. OK', v_430;
end $$;

-- 7 · El Uno se retrocede después de cobrarse.
update public.conta_gc_cobro set estado = 'charged_back' where company_id = (select v::uuid from _g where clave = 'empresa') and gc_id = 'PM0000G05UNO';
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_r public.conta_recibo; v_mal text;
begin
  r := public.conta_cobro_seguir(v_e);
  if (r->>'deshechos')::int <> 1 then raise exception 'G05 · 7: seguir tenía que deshacer 1 cobro: %.', r; end if;
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1');
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit, ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_r.asiento_devolucion;
  if v_r.estado <> 'retrocedido' or v_mal !~ '^430[0-9]{5} 60\.50/0\.00, 57200002 0\.00/60\.50$' then
    raise exception 'G05 · 7: el retrocedido no deshace el cobro con 430 / 57200002 (estado %, asiento %).', v_r.estado, v_mal;
  end if;
  if (select status from public.customer_invoice where id = v_r.invoice_id) in ('borrador', 'anulada') then raise exception 'G05 · 7: la factura no se queda.'; end if;
  r := public.conta_cobro_seguir(v_e);
  if (r->>'deshechos')::int <> 0 then raise exception 'G05 · 7: seguir otra vez lo deshace dos veces.'; end if;
  raise notice 'G05 · 7: retrocedido → 430 / 57200002 una sola vez, y la factura se queda. OK';
end $$;

-- 3 · El Dos, pagado con tarjeta desde el portal sin cuenta de Stripe: queda pendiente.
reset role;
do $$ begin
  if not exists (select 1 from public.conta_gestoria_lectura where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    insert into public.conta_gestoria_lectura (account_id, company_id, origen, entorno, por)
    values ('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'empresa'), 'gocardless', 'pruebas', 'persona');
  end if;
  -- Sin cuenta de Stripe (por si la empresa de staging tuviera una).
  update public.conta_gestoria_ajustes set cuenta_stripe = null where company_id = (select v::uuid from _g where clave = 'empresa');
  insert into _g select 'asientos_antes', count(*)::text from public.journal_entry where company_id = (select v::uuid from _g where clave = 'empresa');
end $$;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$ begin
  insert into _g values ('pend', public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, 'pi_PRUEBA1')::text);
end $$;
reset role;
do $$ declare v_id uuid; begin
  if ((select v::jsonb from _g where clave = 'pend')->>'pendiente')::boolean is not true then raise exception 'G05 PENDIENTE · 3: el pago no ha quedado pendiente: %.', (select v from _g where clave = 'pend'); end if;
  select id into v_id from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe' and vigente and datos->>'recibo' = (select v from _g where clave = 'r2');
  if v_id is null then raise exception 'G05 PENDIENTE · 3: no está su incidencia.'; end if;
  insert into _g values ('dif1', v_id::text);
  -- Para «la de un banco»: la 57200000 enlazada como banco; y una 572 con otro nombre que no es de banco.
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select x.account_id, x.company_id, x.id, 'bank_account', gen_random_uuid()::text, 'principal', 'manual'
    from public.company_account x where x.company_id = (select v::uuid from _g where clave = 'empresa') and x.code = '57200000'
  on conflict do nothing;
  perform public._conta_cobro_puente((select v::uuid from _g where clave = 'empresa'), '57200009', 'Otra plataforma de prueba', 'Prueba G05', 'Prueba G05');
end $$;

-- Otra cuenta (B) no lee, no pone la cuenta y no apunta.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare v_n int := 0; begin
  begin perform public.conta_cobro_cuenta_stripe_leer((select v::uuid from _g where clave = 'empresa')); exception when no_data_found then v_n := v_n + 1; end;
  begin perform public.conta_cobro_cuenta_stripe_poner((select v::uuid from _g where clave = 'empresa'), '57200003'); exception when no_data_found then v_n := v_n + 1; end;
  begin perform public.conta_recibo_apuntar_pendiente((select v::uuid from _g where clave = 'dif1')); exception when no_data_found then v_n := v_n + 1; end;
  if v_n <> 3 then raise exception 'G05 PENDIENTE · 3: otra cuenta ha podido leer, poner o apuntar (% de 3 paradas).', v_n; end if;
end $$;
reset role;

-- La persona administradora de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_err text; begin
  r := public.conta_cobro_cuenta_stripe_leer(v_e);
  if r->>'cuenta' is not null or r->>'motivo' <> 'sin_cuenta' or jsonb_array_length(r->'pendientes') <> 1
     or (r->'pendientes'->0->>'importe')::numeric <> 30.25 or r->'pendientes'->0->>'referencia' <> 'pi_PRUEBA1'
     or r->'pendientes'->0->>'mes' <> '2026-11' or r->'pendientes'->0->>'pagado_el' is null or jsonb_array_length(r->'apuntados_hoy') <> 0
     or r->'pendientes'->0->>'numero' is not null then
    raise exception 'G05 PENDIENTE · 3: leer sin cuenta dijo %.', r;
  end if;
  -- «Apuntar el pago» sin cuenta: no se apunta.
  insert into _g values ('apuntar_sin', public.conta_recibo_apuntar_pendiente((select v::uuid from _g where clave = 'dif1'))::text);
  -- Poner la cuenta: las que no valen.
  begin perform public.conta_cobro_cuenta_stripe_poner(v_e, '43000001'); exception when invalid_parameter_value then v_err := 'no 572'; end;
  if v_err is null then raise exception 'G05 PENDIENTE · 3: ha valido una cuenta que no es 572.'; end if;
  v_err := null;
  begin perform public.conta_cobro_cuenta_stripe_poner(v_e, '5720003'); exception when invalid_parameter_value then v_err := 'cifras'; end;
  if v_err is null then raise exception 'G05 PENDIENTE · 3: ha valido una cuenta sin las cifras del plan.'; end if;
  -- La de un banco y una con otro nombre: no se guardan, y lo dicen con su nombre.
  r := public.conta_cobro_cuenta_stripe_poner(v_e, '57200000');
  if (r->>'guardada')::boolean or r->>'motivo' <> 'de_banco' or r->>'banco' is null
     or r->>'frase' not like 'No se ha guardado: la 57200000 es tu banco (%). Elige otra 572, por ejemplo la 57200003.' then
    raise exception 'G05 PENDIENTE · 3: con la de un banco dijo %.', r;
  end if;
  r := public.conta_cobro_cuenta_stripe_poner(v_e, '57200009');
  if (r->>'guardada')::boolean or r->>'motivo' <> 'otro_nombre' or r->>'nombre' <> 'Otra plataforma de prueba'
     or r->>'frase' <> 'No se ha guardado: la 57200009 ya existe y se llama «Otra plataforma de prueba». Elige otra 572, por ejemplo la 57200003.' then
    raise exception 'G05 PENDIENTE · 3: con otro nombre dijo %.', r;
  end if;
  if (select cuenta_stripe from public.conta_gestoria_ajustes where company_id = v_e) is not null then raise exception 'G05 PENDIENTE · 3: se ha guardado una cuenta que no vale.'; end if;
  -- La 57200003, que no existe: se crea «Plataforma Stripe».
  insert into _g values ('poner', public.conta_cobro_cuenta_stripe_poner(v_e, '57200003')::text);
end $$;
reset role;
do $$ declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_id uuid; begin
  r := (select v::jsonb from _g where clave = 'apuntar_sin');
  if coalesce((r->>'apuntado')::boolean, false) or r->>'motivo' <> 'sin_cuenta'
     or r->>'frase' <> 'No se ha apuntado el pago del recibo de 2026-11 (30,25 €): falta la cuenta de Stripe en Ajustes. Queda en «Pendiente de revisar».' then
    raise exception 'G05 PENDIENTE · 3: apuntar sin cuenta dijo %.', r;
  end if;
  if exists (select 1 from public.conta_recibo_pago_portal where recibo_id = (select v::uuid from _g where clave = 'r2'))
     or (select count(*) from public.journal_entry where company_id = v_e) <> (select v::int from _g where clave = 'asientos_antes') then
    raise exception 'G05 PENDIENTE · 3: sin cuenta se ha apuntado algo.';
  end if;
  -- La incidencia de antes deja de estar vigente y entra la de ahora: una sola.
  select id into v_id from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe' and vigente and datos->>'recibo' = (select v from _g where clave = 'r2');
  if v_id is null or v_id = (select v::uuid from _g where clave = 'dif1')
     or (select count(*) from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe' and vigente and company_id = v_e) <> 1 then
    raise exception 'G05 PENDIENTE · 3: después de «Apuntar el pago» sin cuenta, la incidencia no es una sola y nueva.';
  end if;
  insert into _g values ('dif2', v_id::text);
  r := (select v::jsonb from _g where clave = 'poner');
  if r->>'frase' <> 'Guardada: la cuenta de Stripe es la 57200003 «Plataforma Stripe». Hay 1 pago con tarjeta esperando: apúntalo desde aquí o desde la ficha del cliente.'
     or (r->>'guardada')::boolean is not true or r->>'nombre' <> 'Plataforma Stripe' then
    raise exception 'G05 PENDIENTE · 3: poner la 57200003 dijo %.', r;
  end if;
  if (select cuenta_stripe from public.conta_gestoria_ajustes where company_id = v_e) is distinct from '57200003'
     or (select name from public.company_account where company_id = v_e and code = '57200003') is distinct from 'Plataforma Stripe'
     or not exists (select 1 from public.company_account_log where company_id = v_e and que = 'subcuenta_creada' and code = '57200003') then
    raise exception 'G05 PENDIENTE · 3: la 57200003 no ha quedado puesta, o no se ha creado con su registro.';
  end if;
end $$;

-- «Apuntar el pago», ya con la cuenta.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare v_err text; begin
  -- La de antes ya no está vigente (y aún no está apuntado): no.
  begin perform public.conta_recibo_apuntar_pendiente((select v::uuid from _g where clave = 'dif1')); exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Esta incidencia ya no está vigente: mira la de ahora en «Pendiente de revisar».' then raise exception 'G05 PENDIENTE · 3: una incidencia vieja dijo «%».', v_err; end if;
  -- «Apuntar los N pagos» (aquí, uno): el mismo camino que «Apuntar el pago».
  insert into _g values ('todos', public.conta_cobro_apuntar_pendientes((select v::uuid from _g where clave = 'empresa'))::text);
  insert into _g values ('apuntar', ((select v::jsonb from _g where clave = 'todos')->'apuntados'->0)::text);
  insert into _g values ('todos_otra_vez', public.conta_cobro_apuntar_pendientes((select v::uuid from _g where clave = 'empresa'))::text);
  insert into _g values ('apuntar_otra_vez', public.conta_recibo_apuntar_pendiente((select v::uuid from _g where clave = 'dif2'))::text);
  insert into _g values ('leer_despues', public.conta_cobro_cuenta_stripe_leer((select v::uuid from _g where clave = 'empresa'))::text);
  insert into _g values ('quitar', public.conta_cobro_cuenta_stripe_poner((select v::uuid from _g where clave = 'empresa'), null)::text);
end $$;
reset role;
do $$ declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_r public.conta_recibo; v_430 text; v_mal text; begin
  r := (select v::jsonb from _g where clave = 'apuntar');
  if (r->>'apuntado')::boolean is not true or r->>'cuenta' <> '57200003'
     or r->>'frase' <> 'Apuntado: el recibo de 2026-11 (30,25 €) pagado desde el portal con tarjeta o Bizum. Ya no sale en «Te deben».' then
    raise exception 'G05 PENDIENTE · 3: apuntar con la cuenta dijo %.', r;
  end if;
  if (select v::jsonb from _g where clave = 'todos')->>'frase' <> 'Apuntados 1 pago con tarjeta, con su factura y su asiento.'
     or (select v::jsonb from _g where clave = 'todos_otra_vez')->>'frase' <> 'Ningún pago con tarjeta esperaba: no había nada que apuntar.' then
    raise exception 'G05 PENDIENTE · 3: «Apuntar los pagos» dijo % y, otra vez, %.', (select v from _g where clave = 'todos'), (select v from _g where clave = 'todos_otra_vez');
  end if;
  -- El bloque verde: la factura nueva (el Dos no tenía), quién y cuándo, y sus dos asientos con sus apuntes.
  if (r->>'factura_nueva')::boolean is not true or r->>'numero' is null or r->>'mes' <> '2026-11' or (r->>'importe')::numeric <> 30.25
     or r->>'quien' is null or r->>'quien' = 'El cliente, desde el portal' or r->>'cuando' is null
     or jsonb_array_length(r->'asientos') <> 2 or r->'asientos'->0->>'tipo' <> 'factura' or r->'asientos'->1->>'tipo' <> 'cobro'
     or (select string_agg(x->>'codigo', ',' order by x->>'codigo') from jsonb_array_elements(r->'asientos'->1->'apuntes') x) not like '430%,57200003' then
    raise exception 'G05 PENDIENTE · 3: lo del bloque verde no está entero: %.', r;
  end if;
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r2');
  select a.code into v_430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_r.party_id::text and k.role = 'principal';
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit, ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = (r->>'asiento')::uuid;
  if v_mal is distinct from format('%s 0.00/30.25, 57200003 30.25/0.00', v_430) or v_r.invoice_id is null then
    raise exception 'G05 PENDIENTE · 3: el asiento del Dos es «%» (factura %).', v_mal, v_r.invoice_id;
  end if;
  if (select via from public.conta_gc_cobro_otra_via where company_id = v_e and gc_id = 'PM0000G05DOS') is distinct from 'portal_tarjeta' then
    raise exception 'G05 PENDIENTE · 3: el Dos sigue en «Te deben».';
  end if;
  if exists (select 1 from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe' and vigente and company_id = v_e) then
    raise exception 'G05 PENDIENTE · 3: apuntado, la incidencia sigue en «Pendiente de revisar».';
  end if;
  if (select (quien_name) from public.conta_recibo_pago_portal where recibo_id = v_r.id) = 'El cliente, desde el portal' then
    raise exception 'G05 PENDIENTE · 3: el pago apuntado a mano sale como si lo hubiera apuntado el portal.';
  end if;
  r := (select v::jsonb from _g where clave = 'apuntar_otra_vez');
  if (r->>'ya')::boolean is not true or (select count(*) from public.conta_recibo_pago_portal where recibo_id = v_r.id) <> 1
     or (select count(*) from public.journal_entry where company_id = v_e) - (select v::int from _g where clave = 'asientos_antes') <> 2 then
    raise exception 'G05 PENDIENTE · 3: apuntar otra vez ha duplicado algo (%).', r;
  end if;
  r := (select v::jsonb from _g where clave = 'leer_despues');
  if r->>'cuenta' <> '57200003' or r->>'nombre' <> 'Plataforma Stripe' or r->>'motivo' is not null or jsonb_array_length(r->'pendientes') <> 0
     or jsonb_array_length(r->'apuntados_hoy') <> 1 or r->'apuntados_hoy'->0->>'numero' is null or (r->'apuntados_hoy'->0->>'importe')::numeric <> 30.25 then
    raise exception 'G05 PENDIENTE · 3: leer después dijo %.', r;
  end if;
  if (select cuenta_stripe from public.conta_gestoria_ajustes where company_id = v_e) is not null
     or (select v::jsonb from _g where clave = 'quitar')->>'frase' <> 'Quitada la cuenta de Stripe: los pagos con tarjeta desde el portal quedarán en «Pendiente de revisar» hasta que pongas una.' then
    raise exception 'G05 PENDIENTE · 3: quitar la cuenta no la ha quitado o no lo dice.';
  end if;
  raise notice 'G05 PENDIENTE · 3: sin cuenta, pendiente y «Apuntar el pago» lo dice; otra cuenta no puede; la cuenta: ni no-572, ni otras cifras, ni de banco, ni otro nombre; la 57200003 sí, creada con su registro; apuntado: 57200003 / 430, su factura, fuera de «Te deben» y de «Pendiente de revisar»; otra vez no duplica; quitar la quita. OK';
end $$;

-- 4 · La vuelta atrás de la 2027, y otra vez la 2027.
\i supabase/vuelta-atras/20261109T2027_g05_apuntar_pendiente.down.sql
do $$ begin
  if to_regprocedure('public.conta_cobro_cuenta_stripe_poner(uuid,text)') is not null or to_regprocedure('public.conta_recibo_apuntar_pendiente(uuid)') is not null
     or to_regprocedure('public.conta_cobro_cuenta_stripe_leer(uuid)') is not null or to_regprocedure('public.conta_cobro_apuntar_pendientes(uuid)') is not null
     or to_regprocedure('public._conta_cobro_stripe_estado(uuid,text)') is not null or to_regprocedure('public._conta_cobro_asientos_pago(uuid,uuid)') is not null then
    raise exception 'G05 PENDIENTE · 4: la vuelta atrás de la 2027 no la quita.';
  end if;
end $$;
\i supabase/migrations/20261109T2027_g05_apuntar_pendiente.sql
\echo 'G05 PENDIENTE · 4: la vuelta atrás de la 2027, y otra vez la 2027. OK'

rollback;
