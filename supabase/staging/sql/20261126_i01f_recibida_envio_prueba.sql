-- supabase/staging/sql/20261126_i01f_recibida_envio_prueba.sql
--
-- SOLO STAGING. Prueba de 20261126T0320_i01f_recibida_envio_tratamiento, con
-- \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- conta_recibida_envio es la LECTURA del envío a Diez de una recibida: no
-- escribe nada, así que su camino es el de quien la llama (conta-diez-enviar,
-- como usuario de la cuenta). Se prueba con una recibida de verdad de la
-- empresa A (la primera de supplier_invoice, propuesta o en borrador —los
-- apuntes de una validada no se tocan—, con una línea de IVA), puesta
-- dentro de la transacción como una intracomunitaria de un proveedor de
-- Francia (su línea de IVA con el tipo «ue_compra» del catálogo):
--   1. Antes: sin «tratamiento» ni «pais».
--   2. Con la 0320, como usuario de A: lo mismo que antes (cada clave de antes,
--      con el mismo valor) y además «tratamiento» = intra_eu en su línea de
--      IVA, null en las demás, y «pais» = FR.
--   3. Con el tipo «isp» y un proveedor de Estados Unidos: reverse_charge y US.
--   4. La cuenta B no la lee (como antes).
--   5. La vuelta atrás, byte a byte (md5 6e5ed258, la de producción), y
--      otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA RECIBIDA ENVÍO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La recibida de la prueba, y lo que devolvía antes (como usuario de A).
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid; v_l uuid; v_s uuid; v_ue uuid; v_isp uuid;
begin
  select je.id, l.id into v_e, v_l
    from public.journal_entry je
    join public.journal_line l on l.entry_id = je.id and l.tax_rate_id is not null
   where je.account_id = a and je.source_type = 'supplier_invoice' and je.status in ('propuesto', 'borrador')
   order by je.created_at, l.position limit 1;
  if v_e is null then raise exception 'PRUEBA RECIBIDA ENVÍO · 0: la empresa A no tiene ninguna recibida propuesta o en borrador con IVA en staging.'; end if;
  select i.supplier_id into v_s from public.journal_entry je join public.supplier_invoice i on i.id = je.source_id and i.account_id = je.account_id where je.id = v_e;
  select id into v_ue from public.tax_rate where is_system and code = 'ue_compra';
  select id into v_isp from public.tax_rate where is_system and code = 'isp';
  if v_s is null or v_ue is null or v_isp is null then raise exception 'PRUEBA RECIBIDA ENVÍO · 0: faltan el proveedor o los tipos ue_compra / isp.'; end if;
  perform set_config('prueba_envio.entry', v_e::text, true);
  perform set_config('prueba_envio.linea', v_l::text, true);
  perform set_config('prueba_envio.proveedor', v_s::text, true);
  perform set_config('prueba_envio.ue', v_ue::text, true);
  perform set_config('prueba_envio.isp', v_isp::text, true);
  -- Una intracomunitaria de Francia (como postgres: es la preparación).
  update public.journal_line set tax_rate_id = v_ue where id = v_l;
  update public.supplier set country_code = 'FR' where id = v_s and account_id = a;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba_envio.antes', public.conta_recibida_envio(current_setting('prueba_envio.entry')::uuid)::text, true);
reset role;

-- 1 · Antes: sin las claves nuevas.
do $$
declare v jsonb := current_setting('prueba_envio.antes')::jsonb;
begin
  if v->'proveedor' ? 'pais' or exists (select 1 from jsonb_array_elements(v->'lineas') x where x ? 'tratamiento') then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 1: la de antes ya trae «pais» o «tratamiento»: ¿está ya la 0320?';
  end if;
end $$;

-- 2 · La 0320, como usuario de A.
\i supabase/migrations/20261126T0320_i01f_recibida_envio_tratamiento.sql

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  antes jsonb := current_setting('prueba_envio.antes')::jsonb;
  v jsonb := public.conta_recibida_envio(current_setting('prueba_envio.entry')::uuid);
  k text; i int;
begin
  -- Lo de antes, igual.
  for k in select jsonb_object_keys(antes) loop
    if k in ('proveedor', 'lineas') then continue; end if;
    if v->k is distinct from antes->k then raise exception 'PRUEBA RECIBIDA ENVÍO · 2: «%» ha cambiado.', k; end if;
  end loop;
  if (v->'proveedor') - 'pais' is distinct from antes->'proveedor' then raise exception 'PRUEBA RECIBIDA ENVÍO · 2: el proveedor ha cambiado.'; end if;
  if jsonb_array_length(v->'lineas') <> jsonb_array_length(antes->'lineas') then raise exception 'PRUEBA RECIBIDA ENVÍO · 2: no salen las mismas líneas.'; end if;
  for i in 0 .. jsonb_array_length(v->'lineas') - 1 loop
    if (v->'lineas'->i) - 'tratamiento' is distinct from antes->'lineas'->i then raise exception 'PRUEBA RECIBIDA ENVÍO · 2: la línea % ha cambiado.', i + 1; end if;
  end loop;
  -- Lo nuevo.
  if v->'proveedor'->>'pais' is distinct from 'FR' then raise exception 'PRUEBA RECIBIDA ENVÍO · 2: el país es «%», no FR.', v->'proveedor'->>'pais'; end if;
  if (select count(*) from jsonb_array_elements(v->'lineas') x where x->>'tratamiento' = 'intra_eu') <> 1 then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 2: la línea de IVA no dice intra_eu.';
  end if;
  if exists (select 1 from jsonb_array_elements(v->'lineas') x where x->>'tipoIva' is null and x->>'tratamiento' is not null) then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 2: una línea sin IVA trae tratamiento.';
  end if;
  raise notice 'PRUEBA RECIBIDA ENVÍO · 2: lo de antes igual; intra_eu y FR.';
end $$;
reset role;

-- 3 · Con el tipo «isp» y un proveedor de Estados Unidos.
update public.journal_line set tax_rate_id = current_setting('prueba_envio.isp')::uuid where id = current_setting('prueba_envio.linea')::uuid;
update public.supplier set country_code = 'US' where id = current_setting('prueba_envio.proveedor')::uuid;
set local role authenticated;
do $$
declare v jsonb := public.conta_recibida_envio(current_setting('prueba_envio.entry')::uuid);
begin
  if (select count(*) from jsonb_array_elements(v->'lineas') x where x->>'tratamiento' = 'reverse_charge') <> 1 then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 3: la línea de IVA no dice reverse_charge.';
  end if;
  if v->'proveedor'->>'pais' is distinct from 'US' then raise exception 'PRUEBA RECIBIDA ENVÍO · 3: el país tendría que ser US.'; end if;
  raise notice 'PRUEBA RECIBIDA ENVÍO · 3: reverse_charge y US.';
end $$;
reset role;

-- 4 · La cuenta B no la lee.
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibida_envio(current_setting('prueba_envio.entry')::uuid);
    raise exception 'PRUEBA RECIBIDA ENVÍO · 4: la cuenta B lee la recibida de A.';
  exception when no_data_found then raise notice 'PRUEBA RECIBIDA ENVÍO · 4: la cuenta B no la lee.';
  end;
end $$;
reset role;

-- 5 · La vuelta atrás, byte a byte, y otra vez delante.
\i supabase/vuelta-atras/20261126T0320_i01f_recibida_envio_tratamiento.down.sql
do $$ begin
  if (select left(md5(prosrc), 8) from pg_proc where oid = 'public.conta_recibida_envio(uuid)'::regprocedure) <> '6e5ed258' then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 5: la vuelta atrás no deja la de producción (6e5ed258).';
  end if;
  if (select count(*) from pg_proc where proname = 'conta_recibida_envio' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 5: hay más de una conta_recibida_envio.';
  end if;
end $$;
\i supabase/migrations/20261126T0320_i01f_recibida_envio_tratamiento.sql
do $$ begin
  if (select left(md5(prosrc), 8) from pg_proc where oid = 'public.conta_recibida_envio(uuid)'::regprocedure) <> 'e3c57e29' then
    raise exception 'PRUEBA RECIBIDA ENVÍO · 5: otra vez delante no es la 0320 (e3c57e29).';
  end if;
  raise notice 'PRUEBA RECIBIDA ENVÍO · 5: la vuelta atrás, byte a byte; y otra vez delante.';
end $$;

rollback;
