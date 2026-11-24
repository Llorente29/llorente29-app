-- supabase/staging/sql/20261124_x31_antes_de_enviar_prueba.sql
--
-- SOLO STAGING. Prueba del X31 · 2 (20261124T0835_x31_antes_de_enviar_mirar), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_erp10_envio (el estado
-- «duda» y sus columnas) y public.conta_erp10_cola (no coge lo que está en duda).
--
-- En la gestoría de ejemplo del núcleo (semilla K02), con un asiento suyo sin envío. Datos inventados. Los caminos (regla 10),
-- por las funciones que usan el servidor y la pantalla:
--   1. Coger el envío (conta_erp10_envio_tomar, como el servidor) y dejarlo en duda, como hace la salida al encontrar en
--      ERP10 un asiento que encaja. Otra salida no lo vuelve a coger.
--   2. «Es otro, mándalo» (conta_erp10_envio_es_otro): vuelve a poder salir, con la decisión apuntada; la salida lo coge.
--   3. Una factura en duda con otro total: «Es otro» no vale (ERP10 no admite otra con el mismo número); «Es la misma» sin
--      mirar la diferencia, tampoco; mirándola, queda enlazada con el asiento de ERP10, sin escribir nada.
--   4. Quien no administra la cuenta no decide.
--   5. La cola deja fuera lo que está en duda.
--   6. La vuelta atrás: la cola como antes, el CHECK de antes y sin lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X31: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_erp10_envio_es_la_misma(uuid,boolean,text)') is null then raise exception 'PRUEBA X31 · 0: falta la 0835 delante.'; end if;
end $$;
set local statement_timeout = '60s';
create temp table _x31 (k text primary key, v text) on commit drop;
grant all on _x31 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x31 where _x31.k = $1 $$;

-- 1 · Coger el envío y dejarlo en duda (lo que hace el servidor con service_role) --------------------------------------------
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; v_entry uuid; r jsonb;
begin
  select e.id into v_entry from public.journal_entry e
   where e.company_id = emp and not exists (select 1 from public.conta_erp10_envio x where x.entry_id = e.id) order by e.created_at limit 1;
  if v_entry is null then raise exception 'PRUEBA X31 · 1: la gestoría no tiene ningún asiento sin envío.'; end if;
  r := public.conta_erp10_envio_tomar(emp, v_entry, 'asiento', 'Prueba X31');
  if not (r->>'tomado')::boolean then raise exception 'PRUEBA X31 · 1: no se ha cogido: %', r; end if;
  insert into _x31 values ('envio', r->'envio'->>'id'), ('entry', v_entry);
  update public.conta_erp10_envio set estado = 'duda', motivo = 'Ya está en ERP10 (asiento 61).',
         duda = '{"que":"asiento","ejercicio":"2026","serie":"1","documento":61,"cuantos":1,"fecha":"2026-11-05"}'
   where id = (r->'envio'->>'id')::uuid;
  r := public.conta_erp10_envio_tomar(emp, v_entry, 'asiento', 'Prueba X31');
  if (r->>'tomado')::boolean or r->'envio'->>'estado' <> 'duda' then raise exception 'PRUEBA X31 · 1: en duda, otra salida lo ha vuelto a coger: %', r; end if;
  raise notice 'PRUEBA X31 · 1: en duda («%»); otra salida no lo vuelve a coger.', r->'envio'->>'motivo';
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 2 · «Es otro, mándalo» ---------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v public.conta_erp10_envio;
begin
  r := public.conta_erp10_envio_es_otro(pg_temp.p('envio')::uuid, 'Prueba X31');
  select * into v from public.conta_erp10_envio where id = pg_temp.p('envio')::uuid;
  if v.estado <> 'no_pudo' or v.decision <> 'otro' or v.decision_por <> 'Prueba X31' then raise exception 'PRUEBA X31 · 2: %', to_jsonb(v); end if;
  raise notice 'PRUEBA X31 · 2: «%»', r->>'texto';
end $$;
reset role;
do $$
declare r jsonb;
begin
  r := public.conta_erp10_envio_tomar('c0e20000-0000-4000-8000-0000000000e3', pg_temp.p('entry')::uuid, 'asiento', 'Prueba X31');
  if not (r->>'tomado')::boolean or r->'envio'->>'decision' <> 'otro' then raise exception 'PRUEBA X31 · 2: la salida no lo coge, o sin su decisión: %', r; end if;
  raise notice 'PRUEBA X31 · 2: la siguiente salida lo coge, con «Es otro» apuntado (sale sin volver a mirar).';
  -- Ahora, una factura en duda con otro total.
  update public.conta_erp10_envio set estado = 'duda', decision = null, clase = 'recibida', motivo = 'Ya está en ERP10 (asiento 51).',
         duda = '{"que":"factura","ejercicio":"2026","serie":"2","documento":51,"cuantos":1,"numero":"X31-1","totalErp10Cent":12000,"totalSumiedCent":12100}'
   where id = pg_temp.p('envio')::uuid;
end $$;
set local role authenticated;

-- 3 · Una factura en duda con otro total ----------------------------------------------------------------------------------
do $$
declare r jsonb; v public.conta_erp10_envio; ok boolean;
begin
  ok := false; begin perform public.conta_erp10_envio_es_otro(pg_temp.p('envio')::uuid, 'Prueba X31'); exception when others then ok := sqlerrm like 'Una factura no puede ser otra%'; end;
  if not ok then raise exception 'PRUEBA X31 · 3: «Es otro» ha valido para una factura'; end if;
  ok := false; begin perform public.conta_erp10_envio_es_la_misma(pg_temp.p('envio')::uuid, false, 'Prueba X31'); exception when others then ok := sqlerrm like 'Los totales no son iguales%'; end;
  if not ok then raise exception 'PRUEBA X31 · 3: «Es la misma» sin mirar la diferencia ha valido'; end if;
  r := public.conta_erp10_envio_es_la_misma(pg_temp.p('envio')::uuid, true, 'Prueba X31');
  select * into v from public.conta_erp10_envio where id = pg_temp.p('envio')::uuid;
  if v.estado <> 'en_erp10' or v.erp10_documento <> 51 or v.erp10_serie <> '2' or not v.enlazada or v.decision <> 'la_misma' or v.pdf is not null then
    raise exception 'PRUEBA X31 · 3: %', to_jsonb(v);
  end if;
  raise notice 'PRUEBA X31 · 3: «Es otro» no vale para una factura; «Es la misma», solo mirando la diferencia: «%»', r->>'texto';
end $$;
reset role;

-- 4 · Quien no administra la cuenta no decide -----------------------------------------------------------------------------
do $$ begin
  update public.conta_erp10_envio set estado = 'duda', erp10_documento = null, enlazada = false, decision = null where id = pg_temp.p('envio')::uuid;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000abcd","role":"authenticated"}', true);
set local role authenticated;
do $$
declare ok boolean := false;
begin
  begin perform public.conta_erp10_envio_es_la_misma(pg_temp.p('envio')::uuid, true, 'Alguien de fuera'); exception when others then ok := sqlerrm like 'Solo quien administra%' or sqlerrm like 'Ese envío no está%'; end;
  if not ok then raise exception 'PRUEBA X31 · 4: alguien de fuera ha decidido'; end if;
  raise notice 'PRUEBA X31 · 4: quien no administra la cuenta no decide.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La cola deja fuera lo que está en duda ------------------------------------------------------------------------------
do $$ begin
  if strpos(pg_get_functiondef('public.conta_erp10_cola(integer)'::regprocedure), 'or v.estado = ''duda''') = 0 then
    raise exception 'PRUEBA X31 · 5: la cola no deja fuera lo que está en duda.';
  end if;
  perform count(*) from public.conta_erp10_cola(50);
  raise notice 'PRUEBA X31 · 5: la cola deja fuera lo que está en duda, y contesta.';
end $$;

-- 6 · La vuelta atrás -------------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261124T0835_x31_antes_de_enviar_mirar.down.sql
do $$ begin
  if to_regprocedure('public.conta_erp10_envio_es_la_misma(uuid,boolean,text)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'conta_erp10_envio' and column_name in ('duda', 'decision', 'alta_pedida_en'))
     or strpos(pg_get_functiondef('public.conta_erp10_cola(integer)'::regprocedure), 'X31') > 0
     or (select estado from public.conta_erp10_envio where id = pg_temp.p('envio')::uuid) <> 'no_pudo' then
    raise exception 'PRUEBA X31 · 6: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X31 · 6: la vuelta atrás deja la cola y el CHECK como antes, sin lo nuevo (lo que estaba en duda, «no pudo»).';
  raise notice 'PRUEBA X31: 6 de 6 bien.';
end $$;

rollback;
