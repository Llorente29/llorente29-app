-- supabase/staging/sql/20261109_g05_portal_pagos_prueba.sql
--
-- SOLO STAGING. La 1822 (G05 · nº 55: lo que el cliente hace desde el portal y
-- toca el cobro), en la cuenta A de pruebas, con clientes, mandatos y cobros
-- inventados (T11), y ROLLBACK:
--   1. La 1822, dos veces. En una cuenta de demostración, la 57200003 con su
--      apunte en el registro del plan (aquí no hay demo: se crea al usarla).
--   2. Lo de la prueba del G05 T3 (20261109_g05_cobro_prueba.sql), pasos 2 a 7:
--      el Uno, cobrado, facturado (2026/1/141) y retrocedido; el Dos, devuelto
--      antes de cobrarse, sin factura.
--   3. Pagar un devuelto desde el portal (conta_recibo_pagado_portal, con la
--      clave de servicio):
--        · otra cuenta no puede; sin referencia, con otro importe o con otra
--          vía, no; un recibo que no está devuelto, no;
--        · el Dos con tarjeta: su factura (2026/1/142) y su cobro, el asiento
--          57200003 / 430 (la 57200003 «Plataforma Stripe», creada con su
--          apunte en el registro del plan); sale de «Te deben» (portal_tarjeta)
--          y su historial lo dice; otra vez con la misma referencia, nada nuevo;
--          con otra referencia, no;
--        · el Uno desde el banco: el asiento 57200002 / 430, sin otra factura;
--          sale de «Te deben» (portal_banco).
--   4. Cambiar de cuenta (conta_cobro_cuenta_cambiada, solo el servidor): el
--      mandato nuevo, el viejo cancelado, el cliente de GoCardless nuevo con su
--      enlace; un recibo siguiente sale contra el nuevo. Una persona no puede.
--   5. La vuelta atrás de la 1822, y otra vez la 1822. La 57200003 que crea Sumied sin
--      apuntes (la de la demo al aplicar) se va con su registro; con apuntes, se queda.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 PORTAL: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1822, dos veces.
\i supabase/migrations/20261109T1822_g05_portal_pagos.sql
\i supabase/migrations/20261109T1822_g05_portal_pagos.sql
do $$ begin
  if to_regprocedure('public.conta_recibo_pagado_portal(uuid,text,numeric,text)') is null or to_regclass('public.conta_recibo_pago_portal') is null
     or to_regprocedure('public.conta_cobro_cuenta_cambiada(uuid,uuid,text,text,text[],text)') is null then
    raise exception 'G05 PORTAL · 1: falta algo de la 1822.';
  end if;
  raise notice 'G05 PORTAL · 1: la 1822 carga, y dos veces. OK';
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

-- 3 · Pagar un devuelto desde el portal.
-- Otra cuenta (B) no puede.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare v_err text; begin
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, 'pi_PRUEBA_B'); exception when no_data_found then v_err := 'no'; end;
  if v_err is null then raise exception 'G05 PORTAL · 3: otra cuenta ha apuntado un pago.'; end if;
end $$;
reset role;
-- El portal, desde su servidor: las llamadas (lo que comprueban, fuera de ese papel, debajo).
do $$ begin
  insert into _g select 'asientos_antes', count(*)::text from public.journal_entry where company_id = (select v::uuid from _g where clave = 'empresa');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent)
  values ('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'empresa'), (select v::uuid from _g where clave = 'c1'), '2026-12',
          'recibo:' || (select v from _g where clave = 'empresa') || ':' || (select v from _g where clave = 'c1') || ':2026-12', 6050, 6050);
  insert into _g select 'r3', id::text from public.conta_recibo where clave = 'recibo:' || (select v from _g where clave = 'empresa') || ':' || (select v from _g where clave = 'c1') || ':2026-12';
end $$;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$
declare r jsonb; v_err text; v_n text;
begin
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, '  '); exception when invalid_parameter_value then v_err := 'sin referencia'; end;
  if v_err is null then raise exception 'G05 PORTAL · 3: ha entrado sin referencia.'; end if;
  v_err := null;
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'cheque', 30.25, 'x'); exception when invalid_parameter_value then v_err := 'via'; end;
  if v_err is null then raise exception 'G05 PORTAL · 3: ha entrado otra vía.'; end if;
  v_err := null;
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.26, 'pi_PRUEBA1'); exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'El recibo es de 30,25 € y el pago, de 30,26 €: no se apunta.' then raise exception 'G05 PORTAL · 3: otro importe dijo «%».', v_err; end if;
  -- El Dos, devuelto antes de cobrarse, con tarjeta.
  r := public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, 'pi_PRUEBA1');
  insert into _g values ('pago_dos', r::text);
  -- Otra vez con la misma referencia; con otra, no.
  r := public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, 'pi_PRUEBA1');
  insert into _g values ('pago_dos_otra_vez', r::text);
  v_err := null;
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r2'), 'tarjeta', 30.25, 'pi_OTRA'); exception when unique_violation then v_err := 'otra'; end;
  if v_err is null then raise exception 'G05 PORTAL · 3: ha entrado otro pago del mismo recibo.'; end if;
  -- El Uno, retrocedido después de cobrarse, desde el banco.
  r := public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r1'), 'banco', 60.50, 'PM_PRUEBA_PORTAL');
  insert into _g values ('pago_uno', r::text);
  -- Uno que no está devuelto, no.
  v_err := null;
  begin perform public.conta_recibo_pagado_portal((select v::uuid from _g where clave = 'r3'), 'banco', 60.50, 'x'); exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Este recibo no está devuelto: no hay nada que pagar desde el portal.' then raise exception 'G05 PORTAL · 3: uno sin devolver dijo «%».', v_err; end if;
end $$;
reset role;
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); r jsonb; v_r public.conta_recibo; v_mal text; v_430 text;
begin
  r := (select v::jsonb from _g where clave = 'pago_dos');
  if r->>'frase' <> 'Apuntado: el recibo de 2026-11 (30,25 €) pagado desde el portal con tarjeta o Bizum. Ya no sale en «Te deben».' or r->>'cuenta' <> '57200003' then
    raise exception 'G05 PORTAL · 3: pagar el Dos dijo %.', r;
  end if;
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r2');
  if v_r.invoice_id is null or (select number_text from public.customer_invoice where id = v_r.invoice_id) <> '2026/1/142'
     or (select total from public.customer_invoice where id = v_r.invoice_id) <> 30.25 then
    raise exception 'G05 PORTAL · 3: el Dos no tiene su factura 2026/1/142 de 30,25 € (%, %).', (select number_text from public.customer_invoice where id = v_r.invoice_id), (select total from public.customer_invoice where id = v_r.invoice_id);
  end if;
  select a.code into v_430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_r.party_id::text and k.role = 'principal';
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit, ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = (r->>'asiento')::uuid;
  if v_mal is distinct from format('%s 0.00/30.25, 57200003 30.25/0.00', v_430) then raise exception 'G05 PORTAL · 3: el asiento del Dos es «%».', v_mal; end if;
  if not exists (select 1 from public.company_account_log where company_id = v_e and que = 'subcuenta_creada' and code = '57200003')
     or (select name from public.company_account where company_id = v_e and code = '57200003') <> 'Plataforma Stripe' then
    raise exception 'G05 PORTAL · 3: la 57200003 no se ha creado con su apunte en el registro del plan.';
  end if;
  if (select via from public.conta_gc_cobro_otra_via where company_id = v_e and gc_id = 'PM0000G05DOS') is distinct from 'portal_tarjeta' then
    raise exception 'G05 PORTAL · 3: el Dos sigue en «Te deben».';
  end if;
  if not exists (select 1 from public.conta_recibo_evento where recibo_id = v_r.id and tipo = 'pagado_portal') then raise exception 'G05 PORTAL · 3: el historial del Dos no lo dice.'; end if;
  if ((select v::jsonb from _g where clave = 'pago_dos_otra_vez')->>'ya')::boolean is not true
     or (select count(*) from public.conta_recibo_pago_portal where recibo_id = v_r.id) <> 1 then
    raise exception 'G05 PORTAL · 3: repetir con la misma referencia ha duplicado algo.';
  end if;
  -- El Uno: el asiento 57200002 / 430, sin otra factura.
  r := (select v::jsonb from _g where clave = 'pago_uno');
  select * into v_r from public.conta_recibo where id = (select v::uuid from _g where clave = 'r1');
  select a.code into v_430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_r.party_id::text and k.role = 'principal';
  select string_agg(a.code || ' ' || l.debit || '/' || l.credit, ', ' order by a.code) into v_mal
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = (r->>'asiento')::uuid;
  if v_mal is distinct from format('%s 0.00/60.50, 57200002 60.50/0.00', v_430) or (r->>'factura')::uuid is distinct from v_r.invoice_id
     or (select count(*) from public.customer_invoice where company_id = v_e and series_code = '1') <> 2 then
    raise exception 'G05 PORTAL · 3: el Uno: asiento «%», %.', v_mal, r;
  end if;
  if (select via from public.conta_gc_cobro_otra_via where company_id = v_e and gc_id = 'PM0000G05UNO') is distinct from 'portal_banco' then
    raise exception 'G05 PORTAL · 3: el Uno sigue en «Te deben».';
  end if;
  -- Dos pagos, dos asientos nuevos (y la factura del Dos con el suyo): nada más.
  if (select count(*) from public.journal_entry where company_id = v_e) - (select v::int from _g where clave = 'asientos_antes') <> 3 then
    raise exception 'G05 PORTAL · 3: hay % asientos nuevos, y tenían que ser 3 (la factura y el cobro del Dos, y el cobro del Uno).',
      (select count(*) from public.journal_entry where company_id = v_e) - (select v::int from _g where clave = 'asientos_antes');
  end if;
  raise notice 'G05 PORTAL · 3: el Dos con tarjeta (factura 2026/1/142, 57200003 / 430, la 57200003 con su registro) y el Uno desde el banco (57200002 / 430, sin otra factura); salen de «Te deben»; repetir no duplica; lo que no vale, no entra. OK';
end $$;

-- 4 · Cambiar de cuenta: solo el servidor; el recibo siguiente, contra la nueva.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare v_err text; begin
  begin perform public.conta_cobro_cuenta_cambiada((select v::uuid from _g where clave = 'empresa'), (select v::uuid from _g where clave = 'c1'), 'MD0000G05NUEVO', 'CU0000G05NUEVO', array['MD0000G05UNO']);
  exception when insufficient_privilege then v_err := 'no'; end;
  if v_err is null then raise exception 'G05 PORTAL · 4: una persona ha cambiado la cuenta de cargo sin el servidor.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$ begin
  insert into _g values ('cambio', public.conta_cobro_cuenta_cambiada((select v::uuid from _g where clave = 'empresa'), (select v::uuid from _g where clave = 'c1'),
    'MD0000G05NUEVO', 'CU0000G05NUEVO', array['MD0000G05UNO'], 'Persona Prueba (portal)')::text);
end $$;
reset role;
do $$
declare v_e uuid := (select v::uuid from _g where clave = 'empresa'); c1 uuid := (select v::uuid from _g where clave = 'c1'); r jsonb := (select v::jsonb from _g where clave = 'cambio'); v_l jsonb;
begin
  if r->>'frase' <> 'Cambiada la cuenta de Cliente Prueba G05 Uno: los recibos siguientes se cargan en la domiciliación nueva y la vieja está cancelada en GoCardless (MD0000G05UNO).' then
    raise exception 'G05 PORTAL · 4: cambiar dijo «%».', r->>'frase';
  end if;
  if (select estado from public.conta_gc_mandato where company_id = v_e and gc_id = 'MD0000G05UNO') <> 'cancelled'
     or (select estado from public.conta_gc_mandato where company_id = v_e and gc_id = 'MD0000G05NUEVO') <> 'active'
     or (select gc_cliente_id from public.conta_cobro_cliente where company_id = v_e and party_id = c1) <> 'CU0000G05NUEVO'
     or not exists (select 1 from public.conta_gestoria_decision where company_id = v_e and tipo = 'enlace' and party_id = c1 and gc_cliente_id = 'CU0000G05NUEVO') then
    raise exception 'G05 PORTAL · 4: el cambio no ha quedado guardado entero.';
  end if;
  -- El recibo siguiente, aprobado: sale contra la nueva.
  insert into public.conta_cobro_mes (company_id, mes, account_id, aviso_el, cargo_el) values (v_e, '2026-12', 'c01a0000-0000-4000-8000-00000000000a', '2026-12-02', '2026-12-04')
  on conflict (company_id, mes) do nothing;
  update public.conta_recibo set decision = 'aprobado' where id = (select v::uuid from _g where clave = 'r3');
  v_l := public.conta_cobro_para_enviar(v_e, '2026-12');
  if (select x->>'mandato_gc_id' from jsonb_array_elements(v_l) x where (x->>'id')::uuid = (select v::uuid from _g where clave = 'r3')) is distinct from 'MD0000G05NUEVO' then
    raise exception 'G05 PORTAL · 4: el recibo siguiente no sale contra la domiciliación nueva: %.', v_l;
  end if;
  raise notice 'G05 PORTAL · 4: el servidor cambia la cuenta (nueva activa, vieja cancelada, cliente nuevo con su enlace) y el recibo siguiente sale contra la nueva; una persona no puede. OK';
end $$;

-- 5 · La vuelta atrás de la 1822, y otra vez la 1822. Como en la demo al aplicar (nº 57): una
-- empresa inventada con su plan y la 57200003 que crea Sumied, sin apuntes, se va con su apunte
-- del registro; la de la empresa A, con apuntes, se queda aunque la haya creado Sumied.
reset role;
do $$ declare v_t uuid; begin
  insert into public.company (account_id, legal_name, tax_id) values ('c01a0000-0000-4000-8000-00000000000a', 'Empresa Prueba G05 Stripe, S.L.', 'B00000000') returning id into v_t;
  insert into _g values ('empresa_t', v_t::text);
  -- Su plan: la 57200000 de la empresa A, para que tenga el plan y sus cifras.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name)
  select x.account_id, v_t, x.plan, x.code, x.template_code, x.name, x.plain_name, x.kind, x.source, 'Prueba G05'
    from public.company_account x where x.company_id = (select v::uuid from _g where clave = 'empresa') and x.code = '57200000';
  if not found then raise exception 'G05 PORTAL · 5: la empresa A no tiene la 57200000.'; end if;
end $$;
do $$ declare v_t uuid := (select v::uuid from _g where clave = 'empresa_t'); v_e uuid := (select v::uuid from _g where clave = 'empresa'); begin
  perform public._conta_cobro_puente(v_t, '57200003', 'Plataforma Stripe', 'Lo que Stripe ha cobrado (tarjeta o Bizum) y aún no ha ingresado en el banco', 'Sumied');
  if not exists (select 1 from public.company_account where company_id = v_t and code = '57200003')
     or not exists (select 1 from public.company_account_log where company_id = v_t and que = 'subcuenta_creada' and code = '57200003') then
    raise exception 'G05 PORTAL · 5: la 57200003 de la empresa de prueba no se ha creado con su registro.';
  end if;
  update public.company_account set created_by_name = 'Sumied' where company_id = v_e and code = '57200003';
  update public.company_account_log set done_by_name = 'Sumied' where company_id = v_e and que = 'subcuenta_creada' and code = '57200003';
end $$;
\i supabase/vuelta-atras/20261109T1822_g05_portal_pagos.down.sql
do $$ declare v_t uuid := (select v::uuid from _g where clave = 'empresa_t'); v_e uuid := (select v::uuid from _g where clave = 'empresa'); begin
  if exists (select 1 from public.company_account where company_id = v_t and code = '57200003')
     or exists (select 1 from public.company_account_log where company_id = v_t and code = '57200003') then
    raise exception 'G05 PORTAL · 5: la vuelta atrás deja la 57200003 sin apuntes, o su apunte en el registro del plan.';
  end if;
  if not exists (select 1 from public.company_account where company_id = v_e and code = '57200003')
     or not exists (select 1 from public.company_account_log where company_id = v_e and que = 'subcuenta_creada' and code = '57200003') then
    raise exception 'G05 PORTAL · 5: la vuelta atrás ha quitado una 57200003 con apuntes.';
  end if;
end $$;
do $$ begin
  if to_regprocedure('public.conta_recibo_pagado_portal(uuid,text,numeric,text)') is not null or to_regclass('public.conta_recibo_pago_portal') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gestoria_ajustes' and column_name = 'cuenta_stripe')
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_gc_cobro_otra_via_via_check')) like '%portal%' then
    raise exception 'G05 PORTAL · 5: la vuelta atrás de la 1822 no la quita.';
  end if;
end $$;
\i supabase/migrations/20261109T1822_g05_portal_pagos.sql
\echo 'G05 PORTAL · 5: la vuelta atrás de la 1822 (fuera la 57200003 sin apuntes con su registro; la que tiene apuntes se queda), y otra vez la 1822. OK'

rollback;
