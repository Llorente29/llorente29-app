-- supabase/staging/sql/20261018_cierre_proponer_prueba.sql
--
-- SOLO STAGING. Prueba de «Cierre del día · 2 — el cierre también propone»
-- (20261018T0100): conta_propuesta_ventas_dia, _journal_entry_proponer,
-- journal_entry_proponer, conta_proponer_dias, sales_day_proposal_log y
-- conta_cierre_del_dia_todas.
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
-- La paridad con el núcleo del botón (ventasDelDia) se midió aparte, en
-- producción y en solo lectura, sobre los 20 días×local de octubre de Foodint:
-- 20 de 20 iguales al céntimo (docs/conta/cierre-del-dia/CIERRE_PROPONE.md).
-- Aquí se prueban las RAMAS con números hechos a mano, cada uno con su cuenta:
--
--   1. Siembra en la empresa A, local Norte Centro, cinco días de septiembre:
--      21 · Glovo: 22,00 con base 20,00 y cuota 2,00 (la trae); 11,00 sin base
--           (se calcula: 10,00 + 1,00); una cedida cerrada de 18,00; un
--           cancelado de 9,90.  → asiento: cobra Glovo 33,00 · ventas Casa
--           Lola 30,00 · IVA 3,00 sobre 30,00, 2 facturas; «probable».
--      22 · Uber Eats (sin 430 en staging): 15,00 → sin propuesta, y dice por qué.
--      23 · Glovo 10,00 cerrado y 5,00 abierto (de tu marca) → sin propuesta:
--           «sigue abierto».
--      24 · un resumen A MEDIAS de antes (1 ticket, sin asiento, como el
--           09/10 de Carabanchel) y el día entero de 3 tickets → UN resumen,
--           el entero, con su asiento.
--      25 · descartado antes (journal_dismissal) → no se propone.
--   2. conta_proponer_dias(A) → 2 propuestos, 2 sin propuesta, 0 fallos (el
--      25 no es de los días por asentar: ya está descartado). Las líneas, las
--      razones y el resumen del 21, una a una; el asiento cuadra, sin usuario
--      y a nombre de «Folvy (cierre del día)»; el registro dice cada porqué.
--   3. Otra pasada: no propone nada dos veces; los sin propuesta suben a 2
--      intentos.
--   4. El botón sigue siendo del administrador: B (otra cuenta) no propone en
--      A; A proponiendo el 21 recibe «ya estaba».
--   5. Las puertas: sin usuario nadie llama a _journal_entry_proponer,
--      conta_proponer_dias ni conta_propuesta_ventas_dia, y B no lee el
--      registro de A.
--   7. Una empresa sin el IVA de sus ventas (la de la cuenta B en staging): la
--      propuesta dice «Falta el IVA…», no sale vacía. (Run 134: salía NULL y
--      la pasada fallaba con «No hay ejercicio para el <NULL>».)
--   6. El procedimiento horario propone después de cerrar (en su cuerpo: un
--      procedimiento con COMMIT no se puede llamar dentro de esta transacción;
--      su pasada de verdad se mira en staging a los :07 después de aplicar).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA proponer: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('prueba.empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1), true);

-- ── 1 · La siembra ──────────────────────────────────────────────────────────
do $$
declare
  v_e      uuid := current_setting('prueba.empresa')::uuid;
  v_acc    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc    constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca  constant uuid := '7e000000-0000-4000-8000-000000000b01';   -- Casa Lola, propia
  v_cedida constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';   -- Brasa Prestada, cedida
  v_glovo  constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';   -- con su 430
  v_uber   constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';   -- sin 430 en staging
  h        constant interval := interval '13 hours';
begin
  if exists (select 1 from public.sale where account_id = v_acc and sold_at >= '2026-09-20' and sold_at < '2026-09-27') then
    raise exception 'PRUEBA proponer · 1: A ya tiene ventas del 20 al 26 de septiembre; la prueba no mediría lo que dice.';
  end if;
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-21'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 22.00, 20.00, 2.00, 'hubrise', 'S2101', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-21'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 11.00, null, null, 'hubrise', 'S2102', true),
    (v_acc, v_loc, v_cedida, v_glovo, ('2026-09-21'::timestamp + h + interval '2 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 18.00, null, null, 'hubrise', 'S2103', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-21'::timestamp + h + interval '3 hours') at time zone 'Europe/Madrid', 'cancelled', 'cancelled', 9.90, null, null, 'hubrise', 'S2104', true),
    (v_acc, v_loc, v_marca,  v_uber,  ('2026-09-22'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 15.00, null, null, 'hubrise', 'S2201', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-23'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 10.00, null, null, 'hubrise', 'S2301', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-23'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 5.00, null, null, 'hubrise', 'S2302', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-24'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 11.00, null, null, 'hubrise', 'S2401', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-24'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 22.00, null, null, 'hubrise', 'S2402', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-24'::timestamp + h + interval '2 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 33.00, null, null, 'hubrise', 'S2403', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-25'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 12.00, null, null, 'hubrise', 'S2501', true);
  -- El 24, un resumen a medias de antes, sin asiento (la forma del 09/10 de Carabanchel).
  insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, tickets_count, total, detail_hash, created_by)
  values (v_acc, v_e, v_loc, '2026-09-24', 1, 11.00, 'a-medias', 'c01a0000-0000-4000-8000-0000000000a1');
  -- El 25, descartado antes.
  insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by_name)
  values (v_acc, v_e, 'sales_day', v_loc || ':2026-09-25', 'prueba: lo llevaba otro', 'Prueba');
  raise notice 'PRUEBA proponer · 1: sembrados 11 pedidos del 21 al 25 de septiembre, un resumen a medias (24) y un descarte (25).';
end $$;

-- ── 2 · La pasada ──────────────────────────────────────────────────────────
select set_config('prueba.pasada', public.conta_proponer_dias(current_setting('prueba.empresa')::uuid, now())::text, true);

do $$
declare
  v_e    uuid := current_setting('prueba.empresa')::uuid;
  v_loc  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v      jsonb := current_setting('prueba.pasada')::jsonb;
  v_ent  record; v_l jsonb; v_raz jsonb; v_res record; v_n int; v_d numeric; v_h numeric;
  v_log  text;
begin
  if (v->>'propuestos')::int <> 2 or (v->>'sin_propuesta')::int <> 2 or (v->>'fallos')::int <> 0 then
    raise exception 'PRUEBA proponer · 2: esperaba 2 propuestos, 2 sin propuesta y 0 fallos: %', v;
  end if;

  -- El 21, línea a línea.
  select e.* into v_ent from public.journal_entry e join public.sales_day_summary s on s.entry_id = e.id
   where s.company_id = v_e and s.location_id = v_loc and s.sales_day = '2026-09-21';
  if v_ent.id is null or v_ent.status <> 'propuesto' or v_ent.created_by is not null or v_ent.created_by_name <> 'Folvy (cierre del día)'
     or v_ent.confidence <> 'probable' or v_ent.concept <> 'Ventas del día · Norte Centro' then
    raise exception 'PRUEBA proponer · 2: el asiento del 21 no es el esperado: % % % % %', v_ent.status, v_ent.created_by, v_ent.created_by_name, v_ent.confidence, v_ent.concept;
  end if;
  select jsonb_agg(jsonb_build_object('c', a.code, 'd', l.debit, 'h', l.credit, 'con', l.concept, 'b', l.tax_base, 'f', case when l.tax_rate_id is null then null else l.tax_documents end) order by l.position)
    into v_l from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_ent.id;
  if v_l <> jsonb_build_array(
       jsonb_build_object('c', '43000001', 'd', 33.00, 'h', 0, 'con', 'Cobra Glovo', 'b', null, 'f', null),
       jsonb_build_object('c', '70000000', 'd', 0, 'h', 30.00, 'con', 'Ventas de tus marcas', 'b', null, 'f', null),
       jsonb_build_object('c', '47700010', 'd', 0, 'h', 3.00, 'con', 'IVA repercutido 10 %', 'b', 30.00, 'f', 2)) then
    raise exception 'PRUEBA proponer · 2: las líneas del 21 no son las esperadas: %', v_l;
  end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = v_ent.id;
  if v_d <> v_h then raise exception 'PRUEBA proponer · 2: el 21 no cuadra (% / %).', v_d, v_h; end if;
  v_raz := v_ent.reasons;
  if (select jsonb_agg(x->>'decision') from jsonb_array_elements(v_raz) x) <> jsonb_build_array(
       '2 tickets de tus marcas, 33,00 €', 'IVA al 10 %', 'Base calculada', 'Fuera: 1 pedidos de marcas cedidas (18,00 €)', 'Fuera: 1 cancelado') then
    raise exception 'PRUEBA proponer · 2: las razones del 21 no son las esperadas: %', v_raz;
  end if;
  if v_ent.reason <> '2 tickets de tus marcas cuadran con lo que cobran las plataformas, al céntimo; base calculada al 10 %.' then
    raise exception 'PRUEBA proponer · 2: el porqué del 21 no es el esperado: %', v_ent.reason;
  end if;
  select * into v_res from public.sales_day_summary where company_id = v_e and location_id = v_loc and sales_day = '2026-09-21';
  if v_res.tickets_count <> 2 or v_res.total <> 33.00 or not v_res.base_calculated or cardinality(v_res.sale_ids) <> 2 or v_res.created_by is not null
     or (v_res.by_rate->0->>'base')::numeric <> 30.00 or (v_res.by_rate->0->>'cuota')::numeric <> 3.00 then
    raise exception 'PRUEBA proponer · 2: el resumen del 21 no es el esperado: %', to_jsonb(v_res);
  end if;

  -- El 24: UN resumen, el entero, con asiento.
  select count(*) into v_n from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id
   where s.company_id = v_e and s.location_id = v_loc and s.sales_day = '2026-09-24' and s.tickets_count = 3 and s.total = 66.00 and s.detail_hash <> 'a-medias';
  if v_n <> 1 or (select count(*) from public.sales_day_summary where company_id = v_e and location_id = v_loc and sales_day = '2026-09-24') <> 1 then
    raise exception 'PRUEBA proponer · 2: el 24 no ha quedado con un solo resumen entero y su asiento.';
  end if;

  -- El registro, con cada porqué.
  select string_agg(sales_day || '=' || result || coalesce(': ' || reason, ''), ' | ' order by sales_day) into v_log
    from public.sales_day_proposal_log where company_id = v_e and location_id = v_loc and sales_day between '2026-09-21' and '2026-09-25';
  if v_log is distinct from
       '2026-09-21=propuesto | 2026-09-22=sin_propuesta: No sé a qué cuenta va lo que cobra Uber Eats: enlaza su 430 en su ficha (Clientes y proveedores › Plataformas).'
    || ' | 2026-09-23=sin_propuesta: El cierre del día aún no ha pasado por este día: 1 pedido de tus marcas sigue abierto. Pasa cada hora a los 7 minutos; vuelve a proponer después.'
    || ' | 2026-09-24=propuesto' then
    raise exception 'PRUEBA proponer · 2: el registro no dice lo esperado: %', v_log;
  end if;
  if exists (select 1 from public.journal_entry e join public.sales_day_summary s on s.entry_id = e.id
              where s.company_id = v_e and s.location_id = v_loc and s.sales_day = '2026-09-25') then
    raise exception 'PRUEBA proponer · 2: ha propuesto el 25, que estaba descartado.';
  end if;
  raise notice 'PRUEBA proponer · 2: % · el 21 y el 24 propuestos (líneas, razones y resumen como se esperaban); 22 y 23 dicen por qué no; el 25 descartado no sale.', v;
end $$;

-- ── 3 · Otra pasada ─────────────────────────────────────────────────────────
do $$
declare
  v_e  uuid := current_setting('prueba.empresa')::uuid;
  v    jsonb;
  v_n  int;
begin
  select count(*) into v_n from public.journal_entry where company_id = v_e and source_type = 'sales_day';
  v := public.conta_proponer_dias(v_e, now());
  if (v->>'propuestos')::int <> 0 or (v->>'fallos')::int <> 0 then
    raise exception 'PRUEBA proponer · 3: la segunda pasada ha propuesto o fallado: %', v;
  end if;
  if (select count(*) from public.journal_entry where company_id = v_e and source_type = 'sales_day') <> v_n then
    raise exception 'PRUEBA proponer · 3: la segunda pasada ha creado asientos.';
  end if;
  if (select attempts from public.sales_day_proposal_log where company_id = v_e and sales_day = '2026-09-22') <> 2 then
    raise exception 'PRUEBA proponer · 3: el 22 no lleva 2 intentos.';
  end if;
  raise notice 'PRUEBA proponer · 3: otra pasada no propone nada dos veces (%); los sin propuesta, 2 intentos.', v;
end $$;

-- ── 4 · El botón sigue siendo del administrador ────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_e uuid := current_setting('prueba.empresa')::uuid; v_p jsonb;
begin
  v_p := public.conta_propuesta_ventas_dia(v_e, 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-21');
  begin
    perform public.journal_entry_proponer(v_e, v_p->'entrada', v_p->'lineas', v_p->'resumen', 'B');
    raise exception 'PRUEBA proponer · 4: B ha podido proponer en la empresa de A.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_e uuid := current_setting('prueba.empresa')::uuid; v_p jsonb; v_r jsonb;
begin
  v_p := public.conta_propuesta_ventas_dia(v_e, 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-21');
  v_r := public.journal_entry_proponer(v_e, v_p->'entrada', v_p->'lineas', v_p->'resumen', 'A');
  if not coalesce((v_r->>'existente')::boolean, false) then
    raise exception 'PRUEBA proponer · 4: A proponiendo el 21 no ha recibido «ya estaba»: %', v_r;
  end if;
  raise notice 'PRUEBA proponer · 4: B no propone en A (42501); A, con el botón, recibe «ya estaba».';
end $$;

-- ── 5 · Las puertas ────────────────────────────────────────────────────────
set local role authenticated;
do $$
declare v_e uuid := current_setting('prueba.empresa')::uuid; v_f text; v_mal text[] := '{}';
begin
  foreach v_f in array array[
    format('select public._journal_entry_proponer(%L, %L, %L, null, %L, null)', v_e, '{}', '[]', 'x'),
    format('select public.conta_proponer_dias(%L)', v_e),
    format('select public.conta_propuesta_ventas_dia(%L, %L, %L)', v_e, 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-21')] loop
    begin
      execute v_f;
      v_mal := v_mal || v_f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if cardinality(v_mal) > 0 then
    raise exception 'PRUEBA proponer · 5: un usuario puede llamar a: %', v_mal;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.log_b', (select count(*)::text from public.sales_day_proposal_log where company_id = current_setting('prueba.empresa')::uuid), true);
reset role;
do $$ begin
  if current_setting('prueba.log_b')::int <> 0 then
    raise exception 'PRUEBA proponer · 5: B lee % filas del registro de A.', current_setting('prueba.log_b');
  end if;
  raise notice 'PRUEBA proponer · 5: sin usuario nadie llama a las tres funciones del servidor; B no lee el registro de A.';
end $$;

-- ── 6 · El procedimiento horario propone después de cerrar ─────────────────
do $$
declare v_def text := pg_get_functiondef('public.conta_cierre_del_dia_todas()'::regprocedure);
begin
  if position('conta_cerrar_dias' in v_def) = 0 or position('conta_proponer_dias' in v_def) = 0
     or position('conta_cerrar_dias' in v_def) > position('conta_proponer_dias' in v_def) then
    raise exception 'PRUEBA proponer · 6: el procedimiento horario no cierra y después propone.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'conta-cierre-del-dia' and active and command like '%conta_cierre_del_dia_todas%') then
    raise exception 'PRUEBA proponer · 6: el cron del cierre del día no está.';
  end if;
  raise notice 'PRUEBA proponer · 6: el procedimiento horario cierra y después propone; el cron sigue a los :07.';
end $$;

-- ── 7 · Sin el IVA de sus ventas ───────────────────────────────────────────
do $$
declare v_e uuid; v_p jsonb;
begin
  select c.id into v_e from public.company c left join public.company_tax_profile t on t.company_id = c.id
   where c.account_id = 'c01b0000-0000-4000-8000-00000000000b' and t.sales_tax_rate_code is null order by c.created_at limit 1;
  if v_e is null then
    raise exception 'PRUEBA proponer · 7: no encuentro en staging la empresa de B sin IVA de ventas; la prueba no mediría nada.';
  end if;
  v_p := public.conta_propuesta_ventas_dia(v_e, 'c01b0000-0000-4000-8000-0000000000b2', '2026-10-04');
  if v_p is null or v_p->>'sin_propuesta' is distinct from 'Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.' then
    raise exception 'PRUEBA proponer · 7: sin IVA de ventas, la propuesta tenía que decir por qué (dice %).', v_p;
  end if;
  raise notice 'PRUEBA proponer · 7: sin IVA de ventas, dice «%».', v_p->>'sin_propuesta';
end $$;

rollback;
