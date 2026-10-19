-- supabase/staging/sql/20261122_i01c_csv_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0270_i01c_csv, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Nombra lo que cambia en caliente:
-- public.conta_impuesto_justificante_apuntar y public.conta_impuesto_presentados
-- (las dos con la misma firma); y lo nuevo: las columnas aeat_expediente,
-- presenter_tax_id, presenter_name y receipt_source de tax_return.
--
-- Con la empresa A (Taberna de Prueba Norte, NIF inventado B28000016) y los
-- justificantes INVENTADOS de 2025 (los de la e2e y de las pruebas del lector):
--   1. El 303 del 3T traído de Hacienda por su CSV: se guardan el expediente,
--      el presentador y de dónde salió el PDF; el evento lo dice; en
--      Presentados sale traído y comprobado con Hacienda.
--   2. El 4T subido (no traído): sin comprobar; y, como aplicó 430,00 de
--      trimestres anteriores ([78]), Presentados da «compensado» 430. El 3T,
--      con la [78] a cero, no da compensado.
--   3. Lo de antes sigue igual: el de otro NIF no se guarda.
--   4. La vuelta atrás (las funciones de la 0260 y la 0210, sin las columnas)
--      y otra vez hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA CSV: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0270_i01c_csv.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;
insert into _p values
  ('3T', '{"modelo":"303","ejercicio":2025,"periodo":"3T","presentada":"2025-10-20T11:02:41","csv":"PRUEBA3T2025AAAA","justificante":"9993030000003","nif":"B28000016","resultado":-1761.96,
           "expediente":"2026PRUEBA3033T","presentador":{"nif":"00000000T","nombre":"GESTORIA INVENTADA DE PRUEBA"},"origen_pdf":"aeat_csv",
           "casillas":{"04":52100.4,"05":10,"06":5210.04,"07":8000,"08":21,"09":1680,"27":6890.04,"28":41200,"29":8652,"45":8652,"46":-1761.96,"64":-1761.96,"65":100,"66":-1761.96,"110":300,"78":0,"87":300,"69":-1761.96,"71":-1761.96}}'),
  ('4T', '{"modelo":"303","ejercicio":2025,"periodo":"4T","presentada":"2026-01-30T09:15:07","csv":"PRUEBA4T2025BBBB","justificante":"9993030000004","nif":"B28000016","resultado":0,
           "casillas":{"04":61000,"05":10,"06":6100,"10":150,"11":31.5,"27":6131.5,"28":27000,"29":5670,"36":150,"37":31.5,"45":5701.5,"46":430,"64":430,"65":100,"66":430,"110":2061.96,"78":430,"87":1631.96,"69":0,"71":0}}');

do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA CSV: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year = 2025) then
    raise exception 'PRUEBA CSV: A ya tiene declaraciones de 2025 en staging: esta prueba ya no mide lo que cree.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · El 3T, traído de Hacienda por su CSV ───────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; r public.tax_return; e public.tax_return_event; p jsonb;
begin
  v := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '3T'));
  select * into r from public.tax_return where id = (v->>'declaracion')::uuid;
  if r.aeat_expediente is distinct from '2026PRUEBA3033T' or r.presenter_tax_id is distinct from '00000000T'
     or r.presenter_name is distinct from 'GESTORIA INVENTADA DE PRUEBA' or r.receipt_source is distinct from 'aeat_csv' or r.status <> 'filed' then
    raise exception 'PRUEBA CSV · 1: el 3T traído se guarda como % / % / % / % / %.', r.aeat_expediente, r.presenter_tax_id, r.presenter_name, r.receipt_source, r.status;
  end if;
  select * into e from public.tax_return_event where tax_return_id = r.id and kind = 'note' order by at desc limit 1;
  if e.message not like 'Presentado fuera de Sumied: justificante traído de Hacienda por su CSV nº 9993030000003.' or e.detail->>'origen' <> 'justificante_aeat_csv' then
    raise exception 'PRUEBA CSV · 1: el evento dice «%» (%).', e.message, e.detail->>'origen';
  end if;
  select x into p from jsonb_array_elements(public.conta_impuesto_presentados(v_a)->'presentados') x where x->>'id' = r.id::text;
  if (p->>'traido')::boolean is not true or (p->>'comprobada')::boolean is not true or p->>'expediente' <> '2026PRUEBA3033T'
     or p->'presentador'->>'nif' <> '00000000T' or p->'compensado' <> 'null'::jsonb then
    raise exception 'PRUEBA CSV · 1: Presentados da %.', p;
  end if;
  raise notice 'PRUEBA CSV · 1: traído de Hacienda, comprobado, con expediente y presentador; sin compensado (su [78] es cero).';
end $$;

-- ── 2 · El 4T, subido: sin comprobar, y con lo compensado ──────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; r public.tax_return; p jsonb;
begin
  v := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '4T'));
  select * into r from public.tax_return where id = (v->>'declaracion')::uuid;
  if r.receipt_source is distinct from 'upload' or r.aeat_expediente is not null or r.presenter_tax_id is not null then
    raise exception 'PRUEBA CSV · 2: el 4T subido se guarda como % / % / %.', r.receipt_source, r.aeat_expediente, r.presenter_tax_id;
  end if;
  select x into p from jsonb_array_elements(public.conta_impuesto_presentados(v_a)->'presentados') x where x->>'id' = r.id::text;
  if (p->>'traido')::boolean or (p->>'comprobada')::boolean or (p->>'compensado')::numeric is distinct from 430 or (p->>'importe')::numeric <> 0 then
    raise exception 'PRUEBA CSV · 2: Presentados da %.', p;
  end if;
  raise notice 'PRUEBA CSV · 2: el 4T sale 0,00 y «430,00 compensado»; subido, sin comprobar con Hacienda.';
end $$;

-- ── 3 · El de otro NIF sigue sin guardarse ─────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; n int;
begin
  select count(*) into n from public.tax_return where company_id = v_a and fiscal_year = 2025;
  begin
    perform public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '3T')
      || '{"nif":"B12345674","csv":"PRUEBAOTRAEMPRES","periodo":"2T","presentada":"2025-07-20T10:00:00"}');
    raise exception 'PRUEBA CSV · 3: apuntar acepta el de otro NIF.';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.tax_return where company_id = v_a and fiscal_year = 2025) <> n then
    raise exception 'PRUEBA CSV · 3: el de otro NIF ha dejado algo.';
  end if;
  raise notice 'PRUEBA CSV · 3: el de otro NIF no se guarda.';
end $$;

-- ── 4 · Vuelta atrás y otra vez hacia delante ──────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0270_i01c_csv.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tax_return'
              and column_name in ('aeat_expediente', 'presenter_tax_id', 'presenter_name', 'receipt_source')) then
    raise exception 'PRUEBA CSV · 4: la vuelta atrás deja columnas de la 0270.';
  end if;
  if (select prosrc from pg_proc where proname = 'conta_impuesto_presentados') like '%compensado%'
     or (select prosrc from pg_proc where proname = 'conta_impuesto_justificante_apuntar') like '%receipt_source%' then
    raise exception 'PRUEBA CSV · 4: la vuelta atrás no devuelve las funciones de antes.';
  end if;
  raise notice 'PRUEBA CSV · 4: la vuelta atrás deja las funciones de la 0260 y la 0210, sin columnas.';
end $$;
\i supabase/migrations/20261122T0270_i01c_csv.sql
do $$ begin
  if (select prosrc from pg_proc where proname = 'conta_impuesto_presentados') not like '%compensado%' then
    raise exception 'PRUEBA CSV · 4: hacia delante otra vez no vuelve a dar lo compensado.';
  end if;
end $$;

\echo '>>> PRUEBA CSV (0270): en verde. ROLLBACK: staging no cambia.'
rollback;
