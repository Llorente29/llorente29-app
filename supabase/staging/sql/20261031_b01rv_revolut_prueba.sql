-- ============================================================================
-- PRUEBA (staging) · B01 Revolut · PR 1 (2210, que añade; 2211 y 2212, que
-- cambian): conectar Revolut Business y leer sus movimientos.
-- Todo en una transacción con ROLLBACK. Datos INVENTADOS, en un banco que crea
-- la propia prueba en la empresa de la cuenta A.
--
--   1. revolut_conexion: la escribe solo la clave de servicio; el
--      administrador de A la ve; alguien sin la cuenta, no; el certificado y la
--      vuelta tienen su forma.
--   2. Los secretos en el Vault: solo la clave de servicio los pone y los lee;
--      un administrador, no (42501); un «qué» que no es de Revolut, no; poner
--      otra vez cambia el valor, no crea otro. (Sin Vault, en la base local
--      del W09, se dice y se salta.)
--   3. El proveedor «revolut» en bank_aggregator_link (2211, cambia): se apunta
--      como el de BBVA, con la fecha «sin caducidad». Y SIN DUPLICADOS en la
--      base de verdad: los mismos dos movimientos, leídos dos veces por
--      bank_importar con la fuente agregador:revolut, entran una vez.
--   3b. Lo de hoy entra hoy (2212, bank_importar): dos lecturas de Revolut el
--      mismo día siguen la continuidad; un fichero del mismo día, como antes.
--   4. conta_revolut_desconectar: solo la clave de servicio; desde Sumied
--      queda «desconectada», sin secretos y sin cuentas conectadas, y lo que
--      entró se queda; desde Revolut, «retirada» con su porqué.
--   5. El despertador sin ninguna conexión conectada no hace nada (ni pide
--      el Vault).
--   6. Las tres vueltas atrás (2212, 2211 y 2210): bank_importar como la de
--      la B02 (su huella), sin la tabla ni las funciones, y el proveedor como
--      lo dejó la 0753 del B01c.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (que text primary key, id uuid, texto text) on commit drop;
grant all on _r to authenticated, service_role;

-- ── 0 · La empresa A y un banco inventado, solo para esta prueba ──────────
-- La empresa de la cuenta A: en staging, la 3b34403a…; en la base local del
-- W09 las semillas le dan otro id. El banco lo crea la prueba (no depende de
-- la semilla del B01) y se va con el ROLLBACK.
do $$
declare v_emp uuid; v_banco uuid;
begin
  select id into v_emp from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a'
   order by (id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') desc, created_at limit 1;
  if v_emp is null then raise exception 'PRUEBA B01 Revolut · 0: no está la empresa de la cuenta A.'; end if;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values ('c01a0000-0000-4000-8000-00000000000a', v_emp, 'bank', 'B01 Revolut · Prueba', 'ES0099990000000000005678', '572', true)
  returning id into v_banco;
  insert into _r values ('emp', v_emp, null), ('banco', v_banco, null);
end $$;

-- ── 1 · La conexión ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$
declare v uuid;
begin
  insert into public.revolut_conexion (account_id, company_id, entorno, certificado, certificado_huella, vuelta, desde_historico, created_by_name)
  select c.account_id, c.id, 'sandbox', '-----BEGIN CERTIFICATE-----' || chr(10) || 'INVENTADO' || chr(10) || '-----END CERTIFICATE-----',
         repeat('a', 64), 'https://app.sumied.com/bancos/revolut/vuelta', date '2030-01-01', 'Prueba B01 Revolut'
    from public.company c where c.id = (select id from _r where que = 'emp')
  returning id into v;
  if v is null then raise exception 'PRUEBA B01 Revolut · 1: no se creó la conexión de A.'; end if;
  insert into _r values ('conexion', v, null);
  -- Una vuelta que no es /bancos/revolut/vuelta, o sin https, no cabe.
  begin
    update public.revolut_conexion set vuelta = 'http://app.sumied.com/bancos/revolut/vuelta' where id = v;
    raise exception 'PRUEBA B01 Revolut · 1: cupo una vuelta sin https.';
  exception when check_violation then null; end;
  -- Una por empresa.
  begin
    insert into public.revolut_conexion (account_id, company_id, entorno, certificado, certificado_huella, vuelta)
    select account_id, company_id, 'sandbox', certificado, certificado_huella, vuelta from public.revolut_conexion where id = v;
    raise exception 'PRUEBA B01 Revolut · 1: cupieron dos conexiones para la misma empresa.';
  exception when unique_violation then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.revolut_conexion where company_id = (select id from _r where que = 'emp')) then
    raise exception 'PRUEBA B01 Revolut · 1: el administrador de A no ve su conexión.';
  end if;
  begin
    update public.revolut_conexion set estado = 'conectada' where company_id = (select id from _r where que = 'emp');
    if found then raise exception 'PRUEBA B01 Revolut · 1: el administrador cambió la conexión a mano.'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.revolut_conexion) then raise exception 'PRUEBA B01 Revolut · 1: alguien sin la cuenta ve una conexión.'; end if;
end $$;
reset role;

-- ── 2 · Los secretos ───────────────────────────────────────────────────────
do $$
declare v text; emp constant uuid := (select id from _r where que = 'emp');
begin
  if to_regclass('vault.secrets') is null then
    raise notice 'PRUEBA B01 Revolut · 2: esta base no tiene Vault (la local del W09): se salta. En staging corre.';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.conta_revolut_secreto_poner(emp, 'client_id', 'client-id-inventado-1');
  perform public.conta_revolut_secreto_poner(emp, 'client_id', 'client-id-inventado-2');
  perform public.conta_revolut_secreto_poner(emp, 'renovacion', 'renovacion-inventada');
  if public.conta_revolut_secreto(emp, 'client_id') is distinct from 'client-id-inventado-2' then
    raise exception 'PRUEBA B01 Revolut · 2: poner otra vez no cambió el valor.';
  end if;
  if (select count(*) from vault.secrets where name = 'revolut:' || emp || ':client_id') <> 1 then
    raise exception 'PRUEBA B01 Revolut · 2: poner otra vez creó otro secreto.';
  end if;
  begin perform public.conta_revolut_secreto_poner(emp, 'otra_cosa', 'x'); raise exception 'PRUEBA B01 Revolut · 2: guardó un «qué» que no es de Revolut.';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  begin v := public.conta_revolut_secreto(emp, 'client_id'); raise exception 'PRUEBA B01 Revolut · 2: un administrador leyó un secreto.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_revolut_secreto_poner(emp, 'client_id', 'x'); raise exception 'PRUEBA B01 Revolut · 2: un administrador puso un secreto.';
  exception when insufficient_privilege then null; end;
  insert into _r values ('vault', null, 'si');
end $$;

-- ── 3 · El proveedor «revolut» y sin duplicados ────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$
declare r jsonb; l public.bank_aggregator_link; movs jsonb := jsonb_build_array(
  jsonb_build_object('fecha', '2030-02-10', 'importe', -100.00, 'concepto_banco', 'TRANSFERENCIA INVENTADA B01 REVOLUT', 'ref2', 'tx-inventada-1:l1', 'huella', '2030-02-10|-10000|||tx-inventada-1:l1|1', 'huella_suave', '2030-02-10|-10000|1'),
  jsonb_build_object('fecha', '2030-02-10', 'importe', 250.00, 'concepto_banco', 'INGRESO INVENTADO B01 REVOLUT', 'ref2', 'tx-inventada-2:l1', 'huella', '2030-02-10|25000|||tx-inventada-2:l1|1', 'huella_suave', '2030-02-10|25000|1'));
begin
  r := public.bank_importar((select id from _r where que = 'banco'), 'agregador:revolut', 'agregador:revolut', 'Revolut Business · del 2030-02-10 al 2030-02-10', null,
    date '2030-02-10', date '2030-02-10', null, null, 'Prueba sin saldo.', null, movs);
  if (r->>'nuevos')::int <> 2 then raise exception 'PRUEBA B01 Revolut · 3: la primera lectura metió % (tenía que meter 2).', r->>'nuevos'; end if;
  r := public.bank_importar((select id from _r where que = 'banco'), 'agregador:revolut', 'agregador:revolut', 'Revolut Business · del 2030-02-10 al 2030-02-10 (otra vez)', null,
    date '2030-02-10', date '2030-02-10', null, null, 'Prueba sin saldo.', null, movs);
  if (r->>'nuevos')::int <> 0 or (r->>'repetidos')::int <> 2 then
    raise exception 'PRUEBA B01 Revolut · 3: la segunda lectura metió % nuevos y % repetidos (tenía que ser 0 y 2).', r->>'nuevos', r->>'repetidos';
  end if;
  if (select count(*) from public.bank_movement where treasury_account_id = (select id from _r where que = 'banco') and reference_2 like 'tx-inventada-%') <> 2 then
    raise exception 'PRUEBA B01 Revolut · 3: hay movimientos repetidos del mismo id de Revolut.';
  end if;

  perform public.bank_agregador_apuntar((select id from _r where que = 'banco'), 'revolut', 'cuenta-revolut-inventada', 'cuenta-revolut-inventada', 'Revolut',
    timestamptz '9999-12-31 00:00+00', null, 'al_dia', '2 nuevos y 0 que ya estaban.', 1150.00, date '2030-02-11', 2, 0, date '2030-02-10', date '2030-02-10');
  select * into l from public.bank_aggregator_link where treasury_account_id = (select id from _r where que = 'banco') and provider = 'revolut';
  if l.id is null or l.last_status <> 'al_dia' or l.bank_balance <> 1150.00 then
    raise exception 'PRUEBA B01 Revolut · 3: la cuenta de Revolut no quedó apuntada como al día con su saldo.';
  end if;
end $$;
reset role;

-- ── 3b · Lo de hoy entra hoy (2212, cambia bank_importar) ──────────────────
-- Dos lecturas de Revolut el MISMO día: la segunda sigue a la primera
-- («sigue», no «hueco»). Un fichero que empieza el mismo día en que acabó
-- otro, como antes: se mide contra el que acaba antes de ese día.
do $$
declare r jsonb; b uuid := (select id from _r where que = 'banco');
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  r := public.bank_importar(b, 'agregador:revolut', 'agregador:revolut', 'Revolut · 09:00', null, date '2030-03-01', date '2030-03-01', 0.00, -10.00, null, null,
    jsonb_build_array(jsonb_build_object('fecha', '2030-03-01', 'importe', -10.00, 'concepto_banco', 'PAGO INVENTADO 1', 'ref2', 'tx-hoy-1:l1', 'huella', 'h-hoy-1', 'huella_suave', '2030-03-01|-1000|1')));
  r := public.bank_importar(b, 'agregador:revolut', 'agregador:revolut', 'Revolut · 12:00', null, date '2030-03-01', date '2030-03-01', -10.00, -15.00, null, null,
    jsonb_build_array(jsonb_build_object('fecha', '2030-03-01', 'importe', -5.00, 'concepto_banco', 'PAGO INVENTADO 2', 'ref2', 'tx-hoy-2:l1', 'huella', 'h-hoy-2', 'huella_suave', '2030-03-01|-500|1')));
  if r->>'continuidad' <> 'sigue' or (r->>'nuevos')::int <> 1 then
    raise exception 'PRUEBA B01 Revolut · 3b: la segunda lectura del día dio % con % nuevos (tenía que «sigue» con 1).', r->>'continuidad', r->>'nuevos';
  end if;
  -- Un fichero del mismo día: lo de antes (se mide contra el que acaba antes del 01/04, el de Revolut del 01/03: −15 ≠ −1).
  r := public.bank_importar(b, 'fichero', 'norma43', 'b01rv-1.n43', repeat('d', 64), date '2030-04-01', date '2030-04-01', 0.00, -1.00, null, null,
    jsonb_build_array(jsonb_build_object('fecha', '2030-04-01', 'importe', -1.00, 'concepto_banco', 'RECIBO INVENTADO 1', 'huella', 'h-f-1', 'huella_suave', '2030-04-01|-100|1')));
  r := public.bank_importar(b, 'fichero', 'norma43', 'b01rv-2.n43', repeat('e', 64), date '2030-04-01', date '2030-04-01', -1.00, -2.00, null, null,
    jsonb_build_array(jsonb_build_object('fecha', '2030-04-01', 'importe', -1.00, 'concepto_banco', 'RECIBO INVENTADO 2', 'huella', 'h-f-2', 'huella_suave', '2030-04-01|-100|2')));
  if r->>'continuidad' <> 'hueco' then
    raise exception 'PRUEBA B01 Revolut · 3b: un fichero del mismo día cambió de comportamiento (%, tenía que seguir siendo «hueco»).', r->>'continuidad';
  end if;
end $$;

-- ── 4 · Desconectar ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.conta_revolut_desconectar((select id from _r where que = 'emp'), 'c01a0000-0000-4000-8000-0000000000a1', 'Admin A');
    raise exception 'PRUEBA B01 Revolut · 4: un administrador desconectó sin pasar por la función.';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$
declare r jsonb; c public.revolut_conexion; emp constant uuid := (select id from _r where que = 'emp');
begin
  update public.revolut_conexion set estado = 'conectada', permisos = 'READ', conectada_at = now() where company_id = emp;
  r := public.conta_revolut_desconectar(emp, 'c01a0000-0000-4000-8000-0000000000a1', 'Admin A');
  select * into c from public.revolut_conexion where company_id = emp;
  if c.estado <> 'desconectada' or c.permisos is not null or c.desconectada_por_nombre <> 'Admin A' then
    raise exception 'PRUEBA B01 Revolut · 4: la conexión no quedó desconectada con su nombre (%).', c.estado;
  end if;
  if (r->>'cuentas')::int <> 1 or exists (select 1 from public.bank_aggregator_link where company_id = emp and provider = 'revolut') then
    raise exception 'PRUEBA B01 Revolut · 4: quedaron cuentas conectadas a Revolut.';
  end if;
  if exists (select 1 from _r where que = 'vault') and exists (select 1 from vault.secrets where name like 'revolut:' || emp || ':%') then
    raise exception 'PRUEBA B01 Revolut · 4: quedaron secretos de Revolut en el Vault.';
  end if;
  if (select count(*) from public.bank_movement where treasury_account_id = (select id from _r where que = 'banco') and reference_2 like 'tx-inventada-%') <> 2 then
    raise exception 'PRUEBA B01 Revolut · 4: desconectar se llevó lo que ya había entrado.';
  end if;
  -- Desde Revolut: retirada, con su porqué.
  update public.revolut_conexion set estado = 'conectada' where company_id = emp;
  perform public.conta_revolut_desconectar(emp, null, null, true);
  select * into c from public.revolut_conexion where company_id = emp;
  if c.estado <> 'retirada' or coalesce(c.last_error, '') = '' then
    raise exception 'PRUEBA B01 Revolut · 4: retirada desde Revolut no quedó dicha.';
  end if;
end $$;

-- ── 5 · El despertador, sin nada conectado ─────────────────────────────────
do $$
begin
  perform public.conta_revolut_despertar();
end $$;

-- ── 6 · Las vueltas atrás ──────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
\ir ../../vuelta-atras/20261031T2212_b01rv_revolut_en_el_dia.down.sql
\ir ../../vuelta-atras/20261031T2211_b01rv_revolut_proveedor.down.sql
\ir ../../vuelta-atras/20261031T2210_b01rv_revolut_conexion.down.sql
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure) <> '09859e4297eb98e9ce75ea7efec8216f' then
    raise exception 'PRUEBA B01 Revolut · 6: bank_importar no volvió a ser la de la B02.';
  end if;
  if to_regclass('public.revolut_conexion') is not null then raise exception 'PRUEBA B01 Revolut · 6: la vuelta atrás dejó la tabla.'; end if;
  if to_regprocedure('public.conta_revolut_desconectar(uuid, uuid, text, boolean)') is not null then raise exception 'PRUEBA B01 Revolut · 6: la vuelta atrás dejó las funciones.'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'bank_aggregator_link_provider_check')) not like '%open_banking_io%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'bank_aggregator_link_provider_check')) like '%revolut%' then
    raise exception 'PRUEBA B01 Revolut · 6: el proveedor no quedó como lo dejó la 0753.';
  end if;
end $$;

rollback;
