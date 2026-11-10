-- supabase/staging/sql/20261110_g05_motivo_devuelto_prueba.sql
--
-- SOLO STAGING. La 1138 (G05 · nº 77, punto 2: el motivo del devuelto, guardado
-- en el recibo), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1138, dos veces.
--   2. Dos recibos enviados: uno se devuelve sin saldo y otro se cobra.
--   3. conta_cobro_seguir: el devuelto queda con su motivo en palabras de oficina;
--      el cobrado, sin motivo; si la lectura trae después otro motivo, se cambia;
--      sin motivo en español, no se pone nada (nunca el inglés).
--   4. La vuelta atrás de la 1138 (seguir de su respaldo), y otra vez la 1138.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 MOTIVO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1138, dos veces.
\i supabase/migrations/20261110T1138_g05_motivo_devuelto.sql
\i supabase/migrations/20261110T1138_g05_motivo_devuelto.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_recibo' and column_name = 'motivo_devolucion')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_cobro' and column_name = 'motivo_es') then
    raise exception 'G05 MOTIVO · 1: falta una columna de la 1138.';
  end if;
  raise notice 'G05 MOTIVO · 1: la 1138 carga, y dos veces. OK';
end $$;

-- 2 · Dos recibos enviados, inventados.
create temp table _g (clave text primary key, v text) on commit drop;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c1 uuid; c2 uuid; r1 uuid; r2 uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 MOTIVO · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Motivo Uno, S.L.', 'B00000955') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Motivo Dos, S.L.', 'B00000956') returning id into c2;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, decision, estado, entorno, gc_cobro_id, gc_estado, enviado_at)
  values (a, e, c1, '2026-12', 'recibo:' || e || ':' || c1 || ':2026-12', 14520, 14520, 'aprobado', 'enviado', 'pruebas', 'PM000PRUEBA955', 'pending_submission', now()) returning id into r1;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, decision, estado, entorno, gc_cobro_id, gc_estado, enviado_at)
  values (a, e, c2, '2026-12', 'recibo:' || e || ':' || c2 || ':2026-12', 9680, 9680, 'aprobado', 'enviado', 'pruebas', 'PM000PRUEBA956', 'pending_submission', now()) returning id into r2;
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, estado, fecha, importe, moneda, motivo, causa, motivo_es)
  values (e, 'PM000PRUEBA955', a, 'failed', current_date, 145.20, 'EUR', 'The customer''s account had insufficient funds to make this payment.', 'insufficient_funds', 'Sin saldo en la cuenta'),
         (e, 'PM000PRUEBA956', a, 'submitted', current_date, 96.80, 'EUR', null, null, null);
  insert into _g values ('e', e), ('r1', r1), ('r2', r2);
end $$;

-- 3 · Seguir.
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); r1 uuid := (select v::uuid from _g where clave = 'r1'); r2 uuid := (select v::uuid from _g where clave = 'r2');
        x public.conta_recibo;
begin
  perform public.conta_cobro_seguir(e);
  select * into x from public.conta_recibo where id = r1;
  if x.estado <> 'devuelto' or x.motivo_devolucion is distinct from 'Sin saldo en la cuenta' then raise exception 'G05 MOTIVO · 3: el devuelto: % · %', x.estado, x.motivo_devolucion; end if;
  select * into x from public.conta_recibo where id = r2;
  if x.estado <> 'en_el_banco' or x.motivo_devolucion is not null then raise exception 'G05 MOTIVO · 3: el que se cobra: % · %', x.estado, x.motivo_devolucion; end if;
  -- La lectura trae otro motivo después: se cambia.
  update public.conta_gc_cobro set causa = 'refer_to_payer', motivo_es = 'El banco lo ha devuelto: el cliente tiene que hablar con su banco' where company_id = e and gc_id = 'PM000PRUEBA955';
  perform public.conta_cobro_seguir(e);
  if (select motivo_devolucion from public.conta_recibo where id = r1) <> 'El banco lo ha devuelto: el cliente tiene que hablar con su banco' then
    raise exception 'G05 MOTIVO · 3: el motivo nuevo no se ha guardado.';
  end if;
  -- Sin motivo en español (una lectura de antes), nada: nunca el inglés.
  update public.conta_gc_cobro set estado = 'failed', motivo = 'The customer cancelled their mandate at their bank.', motivo_es = null where company_id = e and gc_id = 'PM000PRUEBA956';
  perform public.conta_cobro_seguir(e);
  select * into x from public.conta_recibo where id = r2;
  if x.estado <> 'devuelto' or x.motivo_devolucion is not null then raise exception 'G05 MOTIVO · 3: sin motivo en español: % · %', x.estado, x.motivo_devolucion; end if;
  raise notice 'G05 MOTIVO · 3: el devuelto con su motivo; el cobrado, sin; el nuevo se cambia; nunca el inglés. OK';
end $$;

-- 4 · La vuelta atrás, y otra vez la 1138.
\i supabase/vuelta-atras/20261110T1138_g05_motivo_devuelto.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_recibo' and column_name = 'motivo_devolucion')
     or position('motivo_devolucion' in pg_get_functiondef('public.conta_cobro_seguir(uuid)'::regprocedure)) > 0 then
    raise exception 'G05 MOTIVO · 4: la vuelta atrás ha dejado algo.';
  end if;
end $$;
\i supabase/migrations/20261110T1138_g05_motivo_devuelto.sql
do $$ begin raise notice 'G05 MOTIVO · 4: vuelta atrás (seguir de su respaldo) y otra vez la 1138. OK'; end $$;

rollback;
