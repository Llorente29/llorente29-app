-- supabase/staging/sql/20261126_q10d_concepto_elegido_prueba.sql
--
-- SOLO STAGING. La 0653 y la 0654 del Q10 · respuesta 4 (el concepto de Cegid de lo que no está en la tabla), en las
-- cuentas A y B de pruebas, con ROLLBACK:
--   1. Las dos, dos veces; la columna del texto del cobro existe; la 0654 no hace nada sin la empresa de QBO.
--   2. La persona de A confirma el concepto de un cobro suelto suyo, y lo cambia (queda uno); un concepto que no es
--      un código, no; un cobro que no está en lo leído, no.
--   3. La persona de B no elige en la empresa de A ni ve lo de A; nadie escribe lo elegido desde la pantalla.
--   4. Las vueltas atrás: la 0654 solo quita lo suyo; la 0653 deja la tabla si hay elegidos, la quita si no, y quita la
--      columna (todo como estaba).
-- Datos inventados (T11). Nada sale a Cegid ni a GoCardless.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 CONCEPTO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261126T0653_q10d_concepto_elegido.sql
\i supabase/migrations/20261126T0653_q10d_concepto_elegido.sql
\i supabase/migrations/20261126T0654_q10d_conceptos_noviembre.sql
\i supabase/migrations/20261126T0654_q10d_conceptos_noviembre.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_cobro' and column_name = 'descripcion')
     or to_regclass('public.conta_cegid_concepto_elegido') is null then
    raise exception 'Q10 CONCEPTO · 1: falta algo de la 0653.';
  end if;
  if exists (select 1 from public.conta_cegid_concepto_elegido) then raise exception 'Q10 CONCEPTO · 1: la 0654 ha elegido algo en una base sin QBO.'; end if;
  raise notice 'Q10 CONCEPTO · 1: la 0653 y la 0654 cargan, dos veces, y la 0654 no hace nada aquí. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into _c values ('empresa', v_e::text);
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, estado, fecha, importe, descripcion, leido_at)
  values (v_e, 'PM000PRUEBASUELTO', v_acc, 'paid_out', '2026-11-04', 96.80, 'Renta anual de prueba 2023', now());
end $$;

-- 2 · La persona de A confirma y cambia.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa'); r jsonb;
begin
  r := public.conta_cegid_elegir_concepto(v_e, 'cobro', 'PM000PRUEBASUELTO', '0017');
  if r->>'frase' <> 'Confirmado: va al concepto 0017 de Cegid.' then raise exception 'Q10 CONCEPTO · 2: la frase es «%».', r->>'frase'; end if;
  perform public.conta_cegid_elegir_concepto(v_e, 'cobro', 'PM000PRUEBASUELTO', '0039');
  if (select count(*) from public.conta_cegid_concepto_elegido where company_id = v_e) <> 1
     or (select concepto from public.conta_cegid_concepto_elegido where company_id = v_e) <> '0039' then
    raise exception 'Q10 CONCEPTO · 2: cambiar el concepto no deja uno solo, el último.';
  end if;
  begin
    perform public.conta_cegid_elegir_concepto(v_e, 'cobro', 'PM000PRUEBASUELTO', 'no vale');
    raise exception 'Q10 CONCEPTO · 2: se ha guardado un concepto que no es un código.';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.conta_cegid_elegir_concepto(v_e, 'cobro', 'PM000NOEXISTE', '0039');
    raise exception 'Q10 CONCEPTO · 2: se ha elegido para un cobro que no está en lo leído.';
  exception when no_data_found then null; end;
  begin
    insert into public.conta_cegid_concepto_elegido (company_id, account_id, que, gc_id, concepto) values (v_e, 'c01a0000-0000-4000-8000-00000000000a', 'cobro', 'X', '0039');
    raise exception 'Q10 CONCEPTO · 3: desde la pantalla se ha escrito lo elegido.';
  exception when insufficient_privilege then null; end;
  raise notice 'Q10 CONCEPTO · 2: A confirma y cambia; lo que no vale, no. OK';
end $$;
reset role;

-- 3 · La persona de B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_cegid_elegir_concepto((select v::uuid from _c where clave = 'empresa'), 'cobro', 'PM000PRUEBASUELTO', '0008');
    raise exception 'Q10 CONCEPTO · 3: la cuenta B ha elegido en la empresa de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.conta_cegid_concepto_elegido) then raise exception 'Q10 CONCEPTO · 3: la cuenta B ve lo elegido de A.'; end if;
  raise notice 'Q10 CONCEPTO · 3: B ni elige ni ve lo de A. OK';
end $$;
reset role;

-- 4 · Las vueltas atrás.
\i supabase/vuelta-atras/20261126T0654_q10d_conceptos_noviembre.down.sql
\i supabase/vuelta-atras/20261126T0653_q10d_concepto_elegido.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_concepto_elegido') is null then raise exception 'Q10 CONCEPTO · 4: con elegidos, la vuelta atrás ha quitado la tabla.'; end if;
end $$;
delete from public.conta_cegid_concepto_elegido;
\i supabase/vuelta-atras/20261126T0653_q10d_concepto_elegido.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_concepto_elegido') is not null then raise exception 'Q10 CONCEPTO · 4: sin elegidos, la vuelta atrás no quita la tabla.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_cobro' and column_name = 'descripcion') then
    raise exception 'Q10 CONCEPTO · 4: la vuelta atrás no quita la columna del texto del cobro.';
  end if;
  raise notice 'Q10 CONCEPTO · 4: las vueltas atrás respetan lo elegido y lo dejan todo como estaba. OK';
end $$;
\i supabase/migrations/20261126T0653_q10d_concepto_elegido.sql
\echo 'Q10 CONCEPTO · 4: y otra vez la 0653. OK'

rollback;
