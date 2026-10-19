-- supabase/staging/sql/20261122_i01c_justificantes_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0260_i01c_justificantes, con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Nombra lo que cambia en
-- caliente: public.tax_return_box (el CHECK de origin, que amplía); y lo
-- nuevo: conta_impuesto_justificante_mirar, conta_impuesto_justificantes_repasar
-- y conta_impuesto_justificante_apuntar.
--
-- Con la empresa A (Taberna de Prueba Norte, NIF inventado B28000016) y los
-- justificantes INVENTADOS de 2025 (los mismos de la e2e y de las pruebas del
-- lector, tests/conta/fixtures/justificantes/pdfJustificante.mjs):
--   1. El de otro NIF no se guarda, y se dice de quién es.
--   2. El repaso: el 303 del 3T nuevo; el mismo otra vez en la lista, «va dos
--      veces»; un 202 presentado antes de acabar su periodo, no casa; un 111
--      negativo, no casa.
--   3. Apuntar el 303 del 3T: presentada fuera, a compensar 1.761,96, sus 19
--      casillas de origen justificante, y el plazo sin los festivos de 2025,
--      dicho como provisional.
--   4. Otra vez el mismo: «ya estaba»; con otro CSV: no se pisa.
--   5. El 4T de 2025 calculado por Sumied (su [110], la del 3T subido:
--      2.061,96) y después su justificante: las diferencias casilla a casilla,
--      la [110] igual; nunca dos declaraciones del mismo periodo.
--   6. A mano (el PDF no se pudo leer): sin motivo no; con motivo, casillas
--      «manual» con su motivo.
--   7. La vuelta atrás (el CHECK de antes; las funciones fuera) y otra vez
--      hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA JUSTIFICANTES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0260_i01c_justificantes.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;
insert into _p values
  ('3T', '{"modelo":"303","ejercicio":2025,"periodo":"3T","presentada":"2025-10-20T11:02:41","csv":"PRUEBA3T2025AAAA","justificante":"9993030000003","nif":"B28000016","resultado":-1761.96,
           "casillas":{"04":52100.4,"05":10,"06":5210.04,"07":8000,"08":21,"09":1680,"27":6890.04,"28":41200,"29":8652,"45":8652,"46":-1761.96,"64":-1761.96,"65":100,"66":-1761.96,"110":300,"78":0,"87":300,"69":-1761.96,"71":-1761.96}}'),
  ('4T', '{"modelo":"303","ejercicio":2025,"periodo":"4T","presentada":"2026-01-30T09:15:07","csv":"PRUEBA4T2025BBBB","justificante":"9993030000004","nif":"B28000016","resultado":0,
           "casillas":{"04":61000,"05":10,"06":6100,"10":150,"11":31.5,"27":6131.5,"28":27000,"29":5670,"36":150,"37":31.5,"45":5701.5,"46":430,"64":430,"65":100,"66":430,"110":2061.96,"78":430,"87":1631.96,"69":0,"71":0}}');

do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA JUSTIFICANTES: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year = 2025) then
    raise exception 'PRUEBA JUSTIFICANTES: A ya tiene declaraciones de 2025 en staging: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.conta_impuesto_plazo_si_hay('303', 'quarterly', 2025, '3T')) then
    raise exception 'PRUEBA JUSTIFICANTES: ya hay festivos de 2025: el plazo provisional del paso 3 ya no se prueba.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · El de otro NIF no se guarda ─────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb;
begin
  v := public.conta_impuesto_justificantes_repasar(v_a, jsonb_build_array((select val::jsonb from _p where k = '3T') || '{"nif":"B12345674"}'));
  if v->0->>'estado' <> 'error' or v->0->>'motivo' not like 'Es de otro NIF (B12345674), no del de Taberna de Prueba Norte, S.L. (B28000016): no se guarda.' then
    raise exception 'PRUEBA JUSTIFICANTES · 1: el de otro NIF sale %.', v;
  end if;
  begin
    perform public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '3T') || '{"nif":"B12345674"}');
    raise exception 'PRUEBA JUSTIFICANTES · 1: apuntar acepta el de otro NIF.';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PRUEBA JUSTIFICANTES · 1: %', v->0->>'motivo';
end $$;

-- ── 2 · El repaso ───────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; t jsonb := (select val::jsonb from _p where k = '3T');
begin
  v := public.conta_impuesto_justificantes_repasar(v_a, jsonb_build_array(
         t, t,
         '{"modelo":"202","ejercicio":2025,"periodo":"3P","presentada":"2025-11-10T10:00:00","csv":"PRUEBA2023PEEEEE","nif":"B28000016","resultado":960,"casillas":{"05":960}}'::jsonb,
         '{"modelo":"111","ejercicio":2025,"periodo":"3T","presentada":"2025-10-20T11:05:12","csv":"PRUEBA111T3CCCCC","nif":"B28000016","resultado":-5,"casillas":{"30":-5}}'::jsonb));
  if v->0->>'estado' <> 'nuevo' or (v->0->>'importe')::numeric <> 1761.96 or v->0->>'resultado' <> 'to_offset'
     or v->1->>'motivo' <> 'Va dos veces en esta subida: se apunta el primero.'
     or v->2->>'motivo' <> 'Está presentado antes de acabar el periodo: no casa.'
     or v->3->>'motivo' <> 'Un 111 no sale negativo: el resultado leído no casa.' then
    raise exception 'PRUEBA JUSTIFICANTES · 2: el repaso sale %.', v;
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year = 2025) then
    raise exception 'PRUEBA JUSTIFICANTES · 2: repasar ha escrito.';
  end if;
  raise notice 'PRUEBA JUSTIFICANTES · 2: nuevo · dos veces · antes de acabar · negativo.';
end $$;

-- ── 3 · Apuntar el 303 del 3T ───────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; r public.tax_return;
begin
  v := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '3T'));
  select * into r from public.tax_return where id = (v->>'declaracion')::uuid;
  if r.status <> 'filed' or r.filed_via <> 'outside' or r.result_kind <> 'to_offset' or r.amount <> 1761.96 or r.aeat_csv <> 'PRUEBA3T2025AAAA'
     or r.aeat_receipt_number <> '9993030000003' or (r.filed_at at time zone 'Europe/Madrid') <> '2025-10-20 11:02:41'
     or r.due_date <> '2025-10-20' or r.due_provisional not like 'Sin los festivos de 2025:%' then
    raise exception 'PRUEBA JUSTIFICANTES · 3: la declaración queda %.', to_jsonb(r);
  end if;
  if (select count(*) from public.tax_return_box where tax_return_id = r.id and origin = 'justificante') <> 19
     or (select value from public.tax_return_box where tax_return_id = r.id and box = '87') <> 300 then
    raise exception 'PRUEBA JUSTIFICANTES · 3: las casillas quedan %.', (select jsonb_object_agg(box, value || ' ' || origin) from public.tax_return_box where tax_return_id = r.id);
  end if;
  if not exists (select 1 from public.tax_return_event where tax_return_id = r.id and kind = 'status' and to_status = 'filed')
     or not exists (select 1 from public.tax_return_event where tax_return_id = r.id and kind = 'note' and detail->>'origen' = 'justificante') then
    raise exception 'PRUEBA JUSTIFICANTES · 3: falta el registro.';
  end if;
  insert into _p values ('id3T', r.id::text);
  raise notice 'PRUEBA JUSTIFICANTES · 3: %', v->>'mensaje';
end $$;

-- ── 4 · El mismo otra vez; otro CSV ─────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; w jsonb;
begin
  v := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '3T'));
  w := public.conta_impuesto_justificantes_repasar(v_a, jsonb_build_array((select val::jsonb from _p where k = '3T') || '{"csv":"PRUEBA3T2025ZZZZ"}'));
  if v->>'estado' <> 'ya_estaba' or v->>'declaracion' <> (select val from _p where k = 'id3T') or v->>'motivo' <> 'Ya estaba apuntado; se guarda el PDF.'
     or w->0->>'motivo' not like 'Ya hay un 303 del 3T/2025 presentado con otro CSV.%'
     or (select count(*) from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2025 and period = '3T') <> 1 then
    raise exception 'PRUEBA JUSTIFICANTES · 4: % · %', v, w;
  end if;
  raise notice 'PRUEBA JUSTIFICANTES · 4: ya estaba; con otro CSV no se pisa.';
end $$;

-- ── 5 · El 4T calculado, y después su justificante ──────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; w jsonb; c jsonb; r public.tax_return;
begin
  c := to_jsonb(public.conta_impuesto_303_calcular(v_a, 2025, '4T'));
  select * into r from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2025 and period = '4T';
  if (select value from public.tax_return_box where tax_return_id = r.id and box = '110') is distinct from 2061.96 then
    raise exception 'PRUEBA JUSTIFICANTES · 5: el 4T calculado no arrastra la [110] del 3T subido (% · %).', c,
      (select jsonb_object_agg(box, value) from public.tax_return_box where tax_return_id = r.id);
  end if;
  w := public.conta_impuesto_justificantes_repasar(v_a, jsonb_build_array((select val::jsonb from _p where k = '4T')));
  if w->0->>'estado' <> 'completa' or w->0->>'declaracion' <> r.id::text
     or exists (select 1 from jsonb_array_elements(w->0->'diferencias') d where d->>'casilla' = '110')
     or not exists (select 1 from jsonb_array_elements(w->0->'diferencias') d where d->>'casilla' = '78' and (d->>'presentado')::numeric = 430) then
    raise exception 'PRUEBA JUSTIFICANTES · 5: el repaso del 4T sale %.', w;
  end if;
  v := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '4T'));
  select * into r from public.tax_return where id = r.id;
  if v->>'declaracion' <> r.id::text or r.status <> 'filed' or r.result_kind <> 'zero' or r.amount <> 0
     or (select count(*) from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2025 and period = '4T') <> 1
     or exists (select 1 from public.tax_return_box where tax_return_id = r.id and origin <> 'justificante')
     or jsonb_array_length((select detail->'diferencias' from public.tax_return_event where tax_return_id = r.id and kind = 'note' and detail ? 'diferencias')) = 0 then
    raise exception 'PRUEBA JUSTIFICANTES · 5: el 4T queda % · %', to_jsonb(r), v;
  end if;
  raise notice 'PRUEBA JUSTIFICANTES · 5: % · diferencias %', v->>'mensaje', w->0->'diferencias';
end $$;

-- ── 6 · A mano ──────────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; r public.tax_return;
  d jsonb := '{"modelo":"115","ejercicio":2025,"periodo":"3T","presentada":"2025-10-20T11:06:30","csv":"PRUEBA115T3DDDDD","nif":"","resultado":855,"a_mano":true,"casillas":{"01":1,"02":4500,"03":855,"05":855}}';
begin
  begin
    perform public.conta_impuesto_justificante_apuntar(v_a, d);
    raise exception 'PRUEBA JUSTIFICANTES · 6: a mano sin motivo, apunta.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_impuesto_justificante_apuntar(v_a, d || '{"motivo":"El PDF es una foto"}');
  select * into r from public.tax_return where id = (v->>'declaracion')::uuid;
  if r.status <> 'filed' or r.result_kind <> 'to_pay' or r.amount <> 855
     or exists (select 1 from public.tax_return_box where tax_return_id = r.id and (origin <> 'manual' or manual_reason <> 'Escrita a mano del justificante: El PDF es una foto')) then
    raise exception 'PRUEBA JUSTIFICANTES · 6: a mano queda %.', to_jsonb(r);
  end if;
  raise notice 'PRUEBA JUSTIFICANTES · 6: %', v->>'mensaje';
end $$;
reset role;

-- ── 7 · Vuelta atrás, y otra vez hacia delante ──────────────────────────────
-- Las casillas «justificante» de esta prueba no caben en el CHECK de antes: la
-- vuelta atrás no se puede dar con ellas puestas, y lo dice.
do $$ begin
  begin
    execute 'alter table public.tax_return_box drop constraint tax_return_box_origin_check, add constraint tax_return_box_origin_check check (origin in (''calculated'', ''manual''))';
    raise exception 'PRUEBA JUSTIFICANTES · 7: el CHECK de antes entra con casillas «justificante».';
  exception when check_violation then null;
  end;
end $$;
-- Todas, también las de una e2e que esté corriendo: dentro de esta transacción, que acaba en rollback.
delete from public.tax_return_box where origin = 'justificante';
\i supabase/vuelta-atras/20261122T0260_i01c_justificantes.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_justificante_apuntar(uuid,jsonb)') is not null
     or to_regprocedure('public.conta_impuesto_justificantes_repasar(uuid,jsonb)') is not null
     or to_regprocedure('public.conta_impuesto_justificante_mirar(uuid,jsonb)') is not null
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tax_return_box_origin_check')
        <> 'CHECK ((origin = ANY (ARRAY[''calculated''::text, ''manual''::text])))' then
    raise exception 'PRUEBA JUSTIFICANTES · 7: la vuelta atrás no deja lo de antes.';
  end if;
  raise notice 'PRUEBA JUSTIFICANTES · 7: vuelta atrás hecha.';
end $$;
\i supabase/migrations/20261122T0260_i01c_justificantes.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_justificante_apuntar(uuid,jsonb)') is null then raise exception 'PRUEBA JUSTIFICANTES · 7: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA JUSTIFICANTES · 7: y se vuelve a aplicar.';
end $$;

rollback;
