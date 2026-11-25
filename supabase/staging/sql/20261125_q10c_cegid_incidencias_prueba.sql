-- supabase/staging/sql/20261126_q10c_cegid_incidencias_prueba.sql
--
-- SOLO STAGING. La 2336 del Q10 (lo mandado a Cegid), en las cuentas A y B de pruebas, con ROLLBACK:
--   1. La 2336, dos veces: la tabla conta_cegid_incidencia.
--   2. Nada dos veces: un cobro no puede tener dos incidencias vivas (mandando, mandada o facturada); deshecha la
--      primera, sí se puede volver a mandar.
--   3. Lo mandado (sembrado como lo escribe conta-cegid-mandar: aquí, como postgres) lo lee la persona de la cuenta A
--      y NO la de la cuenta B; y nadie lo escribe desde la pantalla.
--   4. La vuelta atrás: con algo vivo, la tabla se queda; sin nada vivo, se quita. Y otra vez la 2336.
-- Datos inventados (T11). Nada sale a Cegid: esto es solo la base.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 MANDAR: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261125T2336_q10c_cegid_incidencias.sql
\i supabase/migrations/20261125T2336_q10c_cegid_incidencias.sql
do $$ begin
  if to_regclass('public.conta_cegid_incidencia') is null then raise exception 'Q10 MANDAR · 1: falta la tabla de la 2336.'; end if;
  raise notice 'Q10 MANDAR · 1: la 2336 carga, y dos veces. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into _c values ('empresa', v_e::text);
  insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, incidencia, concepto, serie, texto, base, total, estado)
  values (v_e, v_acc, 'PM000PRUEBA1', '2026-11', 167, 1, '0008', '1', 'GESTION LABORAL', 25, 30.25, 'mandada');
  -- 2 · El mismo cobro, otra vez vivo: no.
  begin
    insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, concepto, serie, texto, base, total, estado)
    values (v_e, v_acc, 'PM000PRUEBA1', '2026-11', 167, '0008', '1', 'GESTION LABORAL', 25, 30.25, 'mandando');
    raise exception 'Q10 MANDAR · 2: un cobro ha quedado con dos incidencias vivas.';
  exception when unique_violation then null; end;
  -- Deshecha, sí se vuelve a mandar.
  update public.conta_cegid_incidencia set estado = 'deshecha', deshecha_at = now() where company_id = v_e and gc_cobro_id = 'PM000PRUEBA1';
  insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, incidencia, concepto, serie, texto, base, total, estado)
  values (v_e, v_acc, 'PM000PRUEBA1', '2026-11', 167, 2, '0008', '1', 'GESTION LABORAL', 25, 30.25, 'mandada');
  begin
    insert into public.conta_cegid_incidencia (company_id, account_id, gc_cobro_id, mes, cliente, concepto, serie, texto, base, total, estado)
    values (v_e, v_acc, 'PM000PRUEBA2', '2026-11', 167, '0008', '1', 'GESTION LABORAL', 25, 30.25, 'mandadísima');
    raise exception 'Q10 MANDAR · 2: se ha guardado un estado que no existe.';
  exception when check_violation then null; end;
  raise notice 'Q10 MANDAR · 2: un cobro, como mucho una incidencia viva; deshecha, se puede volver a mandar. OK';
end $$;

-- 3 · La persona de A lo lee; no lo escribe. La de B no lo ve.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa');
begin
  if (select count(*) from public.conta_cegid_incidencia where company_id = v_e) <> 2 then
    raise exception 'Q10 MANDAR · 3: la persona de A no ve lo mandado de su empresa.';
  end if;
  begin
    update public.conta_cegid_incidencia set estado = 'deshecha' where company_id = v_e;
    if found then raise exception 'Q10 MANDAR · 3: desde la pantalla se ha cambiado lo mandado.'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_cegid_incidencia) then raise exception 'Q10 MANDAR · 3: la cuenta B ve lo mandado de la A.'; end if;
  raise notice 'Q10 MANDAR · 3: A lo lee, B no, y desde la pantalla no se escribe. OK';
end $$;
reset role;

-- 4 · La vuelta atrás: con una viva, la tabla se queda; sin ninguna, se quita. Y otra vez la 2336.
\i supabase/vuelta-atras/20261125T2336_q10c_cegid_incidencias.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_incidencia') is null then raise exception 'Q10 MANDAR · 4: con algo mandado, la vuelta atrás ha quitado la tabla.'; end if;
end $$;
update public.conta_cegid_incidencia set estado = 'deshecha';
\i supabase/vuelta-atras/20261125T2336_q10c_cegid_incidencias.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_incidencia') is not null then raise exception 'Q10 MANDAR · 4: sin nada vivo, la vuelta atrás no quita la tabla.'; end if;
  raise notice 'Q10 MANDAR · 4: la vuelta atrás respeta lo mandado y, sin nada, lo deja como estaba. OK';
end $$;
\i supabase/migrations/20261125T2336_q10c_cegid_incidencias.sql
\echo 'Q10 MANDAR · 4: y otra vez la 2336. OK'

rollback;
