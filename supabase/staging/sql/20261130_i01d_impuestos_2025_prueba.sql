-- supabase/staging/sql/20261130_i01d_impuestos_2025_prueba.sql
--
-- SOLO STAGING. Prueba de 20261130T0420_i01d_impuestos_2025, con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Nombra lo que cambia:
-- public.conta_impuesto_trimestre.
--
-- Con la empresa A (Taberna de Prueba Norte, NIF inventado B28000016) y cifras
-- INVENTADAS: el 303 del 4T de 2025 sale a compensar 631,96 € con la [87] en
-- 1.000,00 €, así que deja 1.631,96 € para 2026; el 1T de 2026 empieza con esa
-- [110], aplica 300,00 y queda 1.331,96.
--   1. Sin nada cargado: lo pendiente al empezar 2026 no se sabe, «desde» es la
--      primera obligación vigente de A, y el 303 del 4T de 2025 sale en la
--      tira sin declaración (la pantalla dirá «Sin cargar · Pegar CSV»).
--   2. Solo con el 1T de 2026 cargado: lo pendiente sale de su [110], y lo dice
--      («1T/2026»), sin «c110_1t».
--   3. Con el 4T de 2025 cargado por su justificante: lo pendiente sale del 4T
--      ([87] 1.000,00 + 631,96 a compensar = 1.631,96, «4T/2025»), con la [110]
--      del 1T al lado para ver si casan; la [110] que le toca al 1T, la misma.
--      En 2025, el 4T sale presentado en la tira y en la cartera.
--   4. Un 4T de 2025 que no casa con el 1T: lo pendiente sigue saliendo del 4T,
--      y «c110_1t» trae la del 1T, distinta (la pantalla dice que no casa).
--   5. Otra cuenta no lo ve.
--   6. La vuelta atrás de verdad (\i del .down.sql): otra vez la de la 0280,
--      sin «desde» y con lo pendiente del 1T; y hacia delante otra vez.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA I01d 2025: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261130T0420_i01d_impuestos_2025.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;
insert into _p values
  ('4T', '{"modelo":"303","ejercicio":2025,"periodo":"4T","presentada":"2026-01-28T10:12:40","csv":"PRUEBAI01D4T2025","justificante":"9993030002504","nif":"B28000016","resultado":-631.96,
           "casillas":{"27":4000,"45":4631.96,"46":-631.96,"64":-631.96,"65":100,"66":-631.96,"110":1000.00,"78":0,"87":1000.00,"69":-631.96,"71":-631.96}}'),
  ('1T', '{"modelo":"303","ejercicio":2026,"periodo":"1T","presentada":"2026-04-20T09:40:02","csv":"PRUEBAI01D1T2026","justificante":"9993030002601","nif":"B28000016","resultado":0,
           "casillas":{"27":5000,"45":4700,"46":300,"64":300,"65":100,"66":300,"110":1631.96,"78":300,"87":1331.96,"69":0,"71":0}}');

do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA I01d 2025: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year in (2025, 2026)) then
    raise exception 'PRUEBA I01d 2025: A ya tiene declaraciones de 2025 o 2026 en staging: esta prueba ya no mide lo que cree.';
  end if;
  if not exists (select 1 from public.tax_obligation where company_id = v_a and form_code = '303' and active and valid_to is null) then
    raise exception 'PRUEBA I01d 2025: A no presenta el 303: esta prueba ya no mide lo que cree.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · Sin nada cargado ────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t jsonb; m jsonb; v_desde date;
begin
  t := public.conta_impuesto_trimestre(v_a, 2026, 1);
  v_desde := (select min(valid_from) from public.tax_obligation where company_id = v_a and valid_to is null and active);
  if t->'cartera'->'pendiente_al_empezar' <> 'null'::jsonb or (t->>'desde')::date is distinct from v_desde or v_desde is null then
    raise exception 'PRUEBA I01d 2025 · 1: sin nada, lo pendiente no se sabe y «desde» es %; da % y %.', v_desde, t->'cartera'->'pendiente_al_empezar', t->'desde';
  end if;
  t := public.conta_impuesto_trimestre(v_a, 2025, 4);
  select x into m from jsonb_array_elements(t->'modelos') x where x->>'modelo' = '303';
  if m is null or m->'declaracion' <> 'null'::jsonb or m->>'periodo' <> '4T' or (t->>'desde')::date is distinct from v_desde then
    raise exception 'PRUEBA I01d 2025 · 1: el 303 del 4T de 2025, sin cargar, da %.', m;
  end if;
  raise notice 'PRUEBA I01d 2025 · 1: sin nada cargado, lo pendiente de 2025 no se sabe; «desde» %; el 303 del 4T de 2025, sin declaración.', v_desde;
end $$;

-- ── 2 · Solo el 1T de 2026 ──────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; p jsonb; r jsonb;
begin
  r := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '1T'));
  if not (r->>'ok')::boolean then raise exception 'PRUEBA I01d 2025 · 2: el 1T no se apunta: %.', r; end if;
  p := public.conta_impuesto_trimestre(v_a, 2026, 1)->'cartera'->'pendiente_al_empezar';
  if p->>'de' <> '1T/2026' or (p->>'importe')::numeric <> 1631.96 or p->'c110_1t' <> 'null'::jsonb then
    raise exception 'PRUEBA I01d 2025 · 2: sin el 4T, lo pendiente sale de la [110] del 1T; da %.', p;
  end if;
  raise notice 'PRUEBA I01d 2025 · 2: sin el 4T, lo pendiente sale de la [110] del 1T (1.631,96, «1T/2026»).';
end $$;

-- ── 3 · Con el 4T de 2025 ───────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; r jsonb; m jsonb; f4 jsonb;
begin
  r := public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '4T'));
  if not (r->>'ok')::boolean then raise exception 'PRUEBA I01d 2025 · 3: el 4T de 2025 no se apunta: %.', r; end if;
  c := public.conta_impuesto_trimestre(v_a, 2026, 1)->'cartera';
  if c->'pendiente_al_empezar'->>'de' <> '4T/2025' or (c->'pendiente_al_empezar'->>'importe')::numeric <> 1631.96
     or (c->'pendiente_al_empezar'->>'c110_1t')::numeric <> 1631.96
     or c->'esperada_110'->>'de' <> '4T/2025' or (c->'esperada_110'->>'importe')::numeric <> 1631.96 then
    raise exception 'PRUEBA I01d 2025 · 3: con el 4T, lo pendiente sale de él (1.000,00 + 631,96); da % y %.', c->'pendiente_al_empezar', c->'esperada_110';
  end if;
  r := public.conta_impuesto_trimestre(v_a, 2025, 4);
  select x into m from jsonb_array_elements(r->'modelos') x where x->>'modelo' = '303';
  select x into f4 from jsonb_array_elements(r->'cartera'->'filas') x where x->>'periodo' = '4T';
  if m->'declaracion'->>'estado' <> 'filed' or m->'declaracion'->>'csv' <> 'PRUEBAI01D4T2025'
     or (f4->>'presentada')::boolean is not true or (f4->>'c87')::numeric <> 1000.00 or f4->>'resultado' <> 'to_offset' then
    raise exception 'PRUEBA I01d 2025 · 3: en 2025, el 4T tendría que salir presentado; da % y %.', m->'declaracion', f4;
  end if;
  raise notice 'PRUEBA I01d 2025 · 3: lo pendiente al empezar 2026 sale del 4T de 2025: 1.000,00 + 631,96 = 1.631,96, y la [110] del 1T casa.';
end $$;

-- ── 4 · Un 4T que no casa con el 1T ─────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; p jsonb;
begin
  reset role;
  update public.tax_return_box b set value = 1200.00
    from public.tax_return r where b.tax_return_id = r.id and r.company_id = v_a and r.form_code = '303' and r.fiscal_year = 2025 and r.period = '4T' and b.box = '87';
  set local role authenticated;
  p := public.conta_impuesto_trimestre(v_a, 2026, 1)->'cartera'->'pendiente_al_empezar';
  if p->>'de' <> '4T/2025' or (p->>'importe')::numeric <> 1831.96 or (p->>'c110_1t')::numeric <> 1631.96 then
    raise exception 'PRUEBA I01d 2025 · 4: lo pendiente sigue saliendo del 4T y la [110] del 1T va al lado; da %.', p;
  end if;
  raise notice 'PRUEBA I01d 2025 · 4: si no casan, lo pendiente sigue saliendo del 4T (1.831,96) y la [110] del 1T va al lado (1.631,96).';
end $$;

-- ── 5 · Otra cuenta no lo ve ────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.conta_impuesto_trimestre('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, 1);
    raise exception 'PRUEBA I01d 2025 · 5: la cuenta B ha visto el trimestre de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA I01d 2025 · 5: la cuenta B no ve el trimestre de A.';
end $$;

-- ── 6 · La vuelta atrás de verdad ───────────────────────────────────────────
reset role;
\i supabase/vuelta-atras/20261130T0420_i01d_impuestos_2025.down.sql
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare t jsonb;
begin
  t := public.conta_impuesto_trimestre('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, 1);
  if t ? 'desde' or t->'cartera'->'pendiente_al_empezar'->>'de' <> '1T/2026' then
    raise exception 'PRUEBA I01d 2025 · 6: con la vuelta atrás tendría que ser la de la 0280 (sin «desde», lo pendiente del 1T); da % y %.', t->'desde', t->'cartera'->'pendiente_al_empezar';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.conta_impuesto_trimestre(uuid,integer,integer)'::regprocedure)) <> '9522728be846f7d8acc8d03a09cabfa5' then
    raise exception 'PRUEBA I01d 2025 · 6: la vuelta atrás no deja el cuerpo de la 0280 byte a byte.';
  end if;
  raise notice 'PRUEBA I01d 2025 · 6: la vuelta atrás deja la de la 0280, byte a byte (md5 9522728b…).';
end $$;
reset role;
\i supabase/migrations/20261130T0420_i01d_impuestos_2025.sql
do $$ begin
  if not (public.conta_impuesto_trimestre('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, 1) ? 'desde') then
    raise exception 'PRUEBA I01d 2025 · 6: hacia delante otra vez, no está.';
  end if;
end $$;

\echo '>>> PRUEBA I01d 2025 (0420): en verde. ROLLBACK: staging no cambia.'
rollback;
