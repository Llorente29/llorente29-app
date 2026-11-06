-- supabase/staging/sql/20261106_g01_clientes_cuotas_prueba.sql
--
-- SOLO STAGING. Prueba del G01 · Asesoría QBO (20261106T1530 y 20261106T1531):
-- conta_pasarela_cuenta (admite gocardless), party (admite el origen crm),
-- conta_mandato (el de GoCardless sin enlace de firma), _s01_cuenta_pasarela
-- (la cuenta «GoCardless · por abonar»), y lo nuevo: las conexiones en Vault,
-- las fichas de Bitrix24, servicios, tarifas, líneas, solicitudes, el
-- registro de cambios, lo que vale una línea un mes y las vistas de consulta.
-- Todo en una transacción con ROLLBACK, con datos inventados (T11): no cambia
-- staging.
--
--   1. GoCardless entra en las pasarelas; un proveedor inventado, no. Su
--      cuenta: «GoCardless · por abonar», 572, tesorería de tipo pasarela.
--   2. Un cliente con origen «crm» entra; uno con origen inventado, no.
--   3. Un mandato de GoCardless sin enlace de firma entra; uno de Sumied sin
--      enlace, no.
--   4. Las fichas de Bitrix24: 2 nuevas; otra vez, 2 iguales; una cambiada, 1.
--      Cada una con su cliente, su ficha fiscal y su ficha de la gestoría.
--   5. Lo que vale una línea: la tarifa propia manda sobre la general; sin
--      propia, la general; lo anual, entre 12; el mes de la baja se cobra
--      entero y el siguiente ya no; sin tarifa, nada (null).
--   6. Las reglas: un suelto es de un solo mes y con importe; un servicio por
--      uso lleva su unidad; una solicitud rechazada lleva su motivo.
--   7. Cada cambio de una tarifa o una línea queda en conta_gestoria_cambio.
--   8. Las conexiones: el token, en Vault; solo el servidor lo lee.
--   9. Las vistas de consulta salen, y ni anon ni nadie las escribe.
--  10. La vuelta atrás de las dos: todo queda como antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Lo de antes, para comparar al final. El ensayo de staging puede haber pasado
-- ya la tanda en esta transacción, así que «antes» no se mide ahora: las
-- restricciones como eran (las de producción y staging el 06/11) y la huella
-- de _s01_cuenta_pasarela de su respaldo (la misma con la que la compara su
-- vuelta atrás), o la de ahora si la 1531 aún no ha pasado.
create temp table _antes on commit drop as
select 'CHECK ((proveedor = ANY (ARRAY[''stripe''::text, ''redsys''::text])))'::text as pasarela,
       'CHECK ((source = ANY (ARRAY[''manual''::text, ''supplier''::text, ''migrated''::text, ''ticket''::text])))'::text as origen,
       coalesce((select huella from public.funcion_respaldo where firma = 'public._s01_cuenta_pasarela(uuid,text)' and migracion = '20261106T1531_g01_gocardless_cobro'),
                md5(pg_get_functiondef('public._s01_cuenta_pasarela(uuid,text)'::regprocedure))) as funcion,
       true as token_obligatorio;

-- Si el ensayo ya las pasó en esta transacción, no se vuelven a pasar.
select to_regclass('public.conta_linea') is not null as ya_esta_la_1530,
       exists (select 1 from public.funcion_respaldo where migracion = '20261106T1531_g01_gocardless_cobro') as ya_esta_la_1531,
       to_regprocedure('public.conta_tarifa_guardar(uuid,uuid,uuid,numeric,text,date,text)') is not null as ya_esta_la_1932,
       to_regclass('public.conta_gestoria_decision') is not null as ya_esta_la_2000 \gset
\if :ya_esta_la_1530
\else
\i supabase/migrations/20261106T1530_g01_clientes_cuotas.sql
\endif
\if :ya_esta_la_1531
\else
\i supabase/migrations/20261106T1531_g01_gocardless_cobro.sql
\endif
\if :ya_esta_la_1932
\else
\i supabase/migrations/20261106T1932_g01_tarifas_y_reintentos.sql
\endif
\if :ya_esta_la_2000
\else
\i supabase/migrations/20261106T2000_g01_ficha_acciones.sql
\endif

savepoint datos;

-- Una empresa de staging con su plan contable (la de las pruebas de cobros).
create temp table _e on commit drop as
select c.id as empresa, c.account_id as cuenta from public.company c
 where exists (select 1 from public.company_account a where a.company_id = c.id and a.code like '572%')
   and not exists (select 1 from public.conta_pasarela_cuenta p where p.company_id = c.id and p.proveedor = 'gocardless')
 order by c.created_at limit 1;

do $$
declare e uuid := (select empresa from _e); a uuid := (select cuenta from _e); v_code text; n int;
begin
  if e is null then raise exception 'PRUEBA G01 · 0: staging no tiene ninguna empresa con plan contable.'; end if;
  -- 1
  v_code := public._s01_cuenta_pasarela(e, 'gocardless');
  if v_code is null or v_code not like '572%' then raise exception 'PRUEBA G01 · 1: no se ha creado la cuenta 572 de GoCardless (%).', v_code; end if;
  if (select name from public.company_account where company_id = e and code = v_code) <> 'GoCardless · por abonar' then
    raise exception 'PRUEBA G01 · 1: la cuenta de GoCardless no se llama «GoCardless · por abonar».';
  end if;
  if not exists (select 1 from public.conta_pasarela_cuenta p join public.treasury_account t on t.id = p.treasury_account_id
                  where p.company_id = e and p.proveedor = 'gocardless' and t.kind = 'pasarela' and t.short_name = 'GoCardless') then
    raise exception 'PRUEBA G01 · 1: la tesorería de GoCardless no es de tipo pasarela.';
  end if;
  if public._s01_cuenta_pasarela(e, 'gocardless') <> v_code then raise exception 'PRUEBA G01 · 1: la segunda vez crea otra cuenta.'; end if;
  begin
    perform public._s01_cuenta_pasarela(e, 'inventado');
    raise exception 'PRUEBA G01 · 1: un proveedor inventado entra.';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.conta_pasarela_cuenta (company_id, proveedor, account_id, treasury_account_id, company_account_id, code)
    select company_id, 'paypal', account_id, treasury_account_id, company_account_id, code from public.conta_pasarela_cuenta where company_id = e and proveedor = 'gocardless';
    raise exception 'PRUEBA G01 · 1: la tabla admite un proveedor inventado.';
  exception when check_violation then null;
  end;
  raise notice 'G01 · 1: GoCardless en las pasarelas, con «GoCardless · por abonar». OK';
  -- 2
  insert into public.party (account_id, name, source) values (a, 'CLIENTE PRUEBA G01 CRM', 'crm');
  begin
    insert into public.party (account_id, name, source) values (a, 'CLIENTE PRUEBA G01 MAL', 'inventado');
    raise exception 'PRUEBA G01 · 2: entra un origen inventado.';
  exception when check_violation then null;
  end;
  raise notice 'G01 · 2: el origen «crm» entra; uno inventado, no. OK';
  -- 3
  insert into public.conta_mandato (account_id, company_id, party_id, ref, status, origen, gc_mandato_id, gc_estado)
  select a, e, id, 'G01-PRUEBA-1', 'firmado', 'gocardless', 'MD000000PRUEBA1', 'active' from public.party where account_id = a and name = 'CLIENTE PRUEBA G01 CRM';
  begin
    insert into public.conta_mandato (account_id, company_id, party_id, ref, status)
    select a, e, id, 'G01-PRUEBA-2', 'por_firmar' from public.party where account_id = a and name = 'CLIENTE PRUEBA G01 CRM';
    raise exception 'PRUEBA G01 · 3: un mandato de Sumied sin enlace de firma entra.';
  exception when check_violation then null;
  end;
  raise notice 'G01 · 3: el mandato de GoCardless sin enlace entra; uno de Sumied sin enlace, no. OK';
end $$;

-- 4 · Las fichas de Bitrix24 (como las escribe conta-bitrix-leer)
do $$
declare a uuid := (select cuenta from _e); r jsonb;
  f jsonb := jsonb_build_array(
    jsonb_build_object('bitrixId', 'G01-1', 'nombre', 'CLIENTE PRUEBA G01 UNO, S.L.', 'nif', 'B00000001', 'calle', 'Calle de Prueba 1', 'cp', '28000',
                       'poblacion', 'Madrid', 'provincia', 'Madrid', 'situacion', 'activo', 'servicios', jsonb_build_array('C', 'L'), 'formaPago', 'Emisor A'),
    jsonb_build_object('bitrixId', 'G01-2', 'nombre', 'CLIENTE PRUEBA G01 DOS', 'nif', null, 'situacion', 'baja', 'servicios', jsonb_build_array()));
begin
  r := public.conta_bitrix_guardar_fichas(a, f);
  if r <> '{"nuevos": 2, "cambiados": 0, "iguales": 0}'::jsonb then raise exception 'PRUEBA G01 · 4: primera lectura %', r; end if;
  r := public.conta_bitrix_guardar_fichas(a, f);
  if r <> '{"nuevos": 0, "cambiados": 0, "iguales": 2}'::jsonb then raise exception 'PRUEBA G01 · 4: segunda lectura %', r; end if;
  r := public.conta_bitrix_guardar_fichas(a, jsonb_set(f, '{1,situacion}', '"activo"'));
  if r <> '{"nuevos": 0, "cambiados": 1, "iguales": 1}'::jsonb then raise exception 'PRUEBA G01 · 4: con una cambiada %', r; end if;
  if (select count(*) from public.conta_gestoria_cliente c join public.party p on p.id = c.party_id join public.customer_fiscal cf on cf.party_id = c.party_id
       where c.account_id = a and c.bitrix_id like 'G01-%' and p.source = 'crm') <> 2 then
    raise exception 'PRUEBA G01 · 4: no tienen las dos su cliente, su ficha fiscal y su ficha de la gestoría.';
  end if;
  if (select fiscal_city from public.customer_fiscal cf join public.conta_gestoria_cliente c on c.party_id = cf.party_id where c.bitrix_id = 'G01-1' and c.account_id = a) <> 'Madrid' then
    raise exception 'PRUEBA G01 · 4: la dirección fiscal no viene de Bitrix24.';
  end if;
  raise notice 'G01 · 4: fichas de Bitrix24 nuevas, iguales y cambiadas. OK';
end $$;

-- 5, 6 y 7 · Servicios, tarifas y líneas
do $$
declare e uuid := (select empresa from _e); a uuid := (select cuenta from _e);
  uno uuid; dos uuid; lab uuid; vig uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; t uuid; v numeric;
begin
  select party_id into uno from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-1';
  select party_id into dos from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-2';
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'gestion_laboral', 'Gestión laboral', 'por_empleado') returning id into lab;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma, por_confirmar) values (a, e, 'vigilancia de prueba', 'VIGILANCIA DE PRUEBA', 'fijo_anio', true) returning id into vig;
  insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, created_by_name)
  values (a, e, lab, null, 20.00, 'mes', date '2026-01-01', 'Prueba G01');
  insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, created_by_name)
  values (a, e, lab, uno, 24.20, 'mes', date '2026-01-01', 'Prueba G01') returning id into t;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, desde, created_by_name)
  values (a, e, uno, lab, 'EMPLEADO UNO PRUEBA', 'gocardless', date '2026-01-01', 'Prueba G01') returning id into l1;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, desde, hasta, created_by_name)
  values (a, e, uno, lab, 'EMPLEADO DOS PRUEBA', 'manual', date '2026-01-01', date '2026-10-01', 'Prueba G01') returning id into l2;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, desde, created_by_name)
  values (a, e, dos, lab, 'EMPLEADO TRES PRUEBA', 'manual', date '2026-01-01', 'Prueba G01') returning id into l3;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, importe_propio, periodo, desde, created_by_name)
  values (a, e, uno, vig, 'gocardless', 605.00, 'anio', date '2026-01-01', 'Prueba G01') returning id into l4;
  -- 5
  v := public.conta_linea_al_mes(l1, date '2026-11-01'); if v <> 24.20 then raise exception 'PRUEBA G01 · 5: la propia no manda (%).', v; end if;
  v := public.conta_linea_al_mes(l3, date '2026-11-01'); if v <> 20.00 then raise exception 'PRUEBA G01 · 5: sin propia no vale la general (%).', v; end if;
  v := public.conta_linea_al_mes(l4, date '2026-11-01'); if v <> 50.42 then raise exception 'PRUEBA G01 · 5: lo anual no va entre 12 (%).', v; end if;
  v := public.conta_linea_al_mes(l2, date '2026-10-01'); if v <> 24.20 then raise exception 'PRUEBA G01 · 5: el mes de la baja no se cobra entero (%).', v; end if;
  v := public.conta_linea_al_mes(l2, date '2026-11-01'); if v <> 0 then raise exception 'PRUEBA G01 · 5: después de la baja sigue contando (%).', v; end if;
  update public.conta_tarifa set hasta = date '2026-11-01', motivo = 'Prueba: sube en diciembre' where id = t;
  insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, created_by_name)
  values (a, e, lab, uno, 26.00, 'mes', date '2026-12-01', 'Prueba G01');
  v := public.conta_linea_al_mes(l1, date '2026-12-01'); if v <> 26.00 then raise exception 'PRUEBA G01 · 5: el cambio de tarifa no vale desde su mes (%).', v; end if;
  v := public.conta_linea_al_mes(l1, date '2026-11-01'); if v <> 24.20 then raise exception 'PRUEBA G01 · 5: el cambio de tarifa cambia los meses de antes (%).', v; end if;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, desde, created_by_name)
  values (a, e, dos, vig, 'manual', date '2026-01-01', 'Prueba G01') returning id into l5;
  if public.conta_linea_al_mes(l5, date '2026-11-01') is not null then raise exception 'PRUEBA G01 · 5: una línea sin tarifa se inventa un precio.'; end if;
  raise notice 'G01 · 5: propia sobre general, anual entre 12, el mes de la baja entero y sin tarifa, nada. OK';
  -- 6
  begin
    insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, detalle, origen, importe_propio, desde, hasta)
    values (a, e, uno, vig, 'suelto', 'RENTA DE PRUEBA', 'manual', 80.00, date '2026-11-01', date '2026-12-01');
    raise exception 'PRUEBA G01 · 6: un trabajo suelto de dos meses entra.';
  exception when check_violation then null;
  end;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, detalle, origen, importe_propio, desde, hasta)
  values (a, e, uno, vig, 'suelto', 'RENTA DE PRUEBA', 'manual', 80.00, date '2026-11-01', date '2026-11-01');
  begin
    insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'nominas de prueba', 'NÓMINAS DE PRUEBA', 'por_uso');
    raise exception 'PRUEBA G01 · 6: un servicio por uso sin unidad entra.';
  exception when check_violation then null;
  end;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma, unidad) values (a, e, 'nominas de prueba', 'NÓMINAS DE PRUEBA', 'por_uso', 'nomina');
  begin
    insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, estado, resuelta_at)
    values (a, e, uno, 'alta', 'EMPLEADO CUATRO PRUEBA', date '2026-12-01', 'rechazada', now());
    raise exception 'PRUEBA G01 · 6: una solicitud rechazada sin motivo entra.';
  exception when check_violation then null;
  end;
  raise notice 'G01 · 6: suelto de un mes, por uso con unidad y rechazo con motivo. OK';
  -- 7
  if (select count(*) from public.conta_gestoria_cambio where registro_id = t) <> 2 then raise exception 'PRUEBA G01 · 7: el alta y el cambio de la tarifa no están en el registro.'; end if;
  if (select accion || ' · ' || coalesce(to_char(desde_mes, 'YYYY-MM'), '-') from public.conta_gestoria_cambio where registro_id = t order by cuando desc, accion limit 1) is null then
    raise exception 'PRUEBA G01 · 7: el registro no dice desde qué mes.';
  end if;
  if not exists (select 1 from public.conta_gestoria_cambio where registro_id = l1 and accion = 'alta' and quien_name = 'Prueba G01') then
    raise exception 'PRUEBA G01 · 7: el alta de una línea no dice quién.';
  end if;
  raise notice 'G01 · 7: cada cambio, con quién y desde qué mes. OK';
end $$;

-- 8 · Las conexiones, en Vault
do $$
declare e uuid := (select empresa from _e); a uuid := (select cuenta from _e); t text;
begin
  perform public.conta_gocardless_guardar_conexion(e, 'pruebas', 'token-de-prueba-g01', 'Prueba G01');
  select token into t from public.conta_gocardless_secreto(e);
  if t is distinct from 'token-de-prueba-g01' then raise exception 'PRUEBA G01 · 8: el token no vuelve de Vault.'; end if;
  if exists (select 1 from public.conta_cobro_gocardless where company_id = e and token_ref is null) then raise exception 'PRUEBA G01 · 8: sin referencia a Vault.'; end if;
  perform public.conta_bitrix_guardar_conexion(a, 'pruebas', 'https://prueba-g01.bitrix24.es/rest/1/clavedeprueba/', 'prueba-g01.bitrix24.es', 'Prueba G01');
  if (select url from public.conta_bitrix_secreto(a)) <> 'https://prueba-g01.bitrix24.es/rest/1/clavedeprueba/' then raise exception 'PRUEBA G01 · 8: la dirección no vuelve de Vault.'; end if;
  begin
    perform public.conta_bitrix_guardar_conexion(a, 'pruebas', 'http://sin-https.test/', null, 'Prueba G01');
    raise exception 'PRUEBA G01 · 8: entra una dirección de Bitrix24 que no lo es.';
  exception when sqlstate '22023' then null;
  end;
  if has_function_privilege('authenticated', 'public.conta_gocardless_secreto(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_secreto(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_gocardless_guardar_conexion(uuid,text,text,text)', 'execute') then
    raise exception 'PRUEBA G01 · 8: una persona puede leer o guardar un token.';
  end if;
  raise notice 'G01 · 8: token y dirección en Vault, solo para el servidor. OK';
end $$;

-- 9 · Las vistas de consulta
do $$
declare a uuid := (select cuenta from _e); n int;
begin
  select count(*) into n from public.conta_consulta_clientes where cuenta_id = a and cliente like 'CLIENTE PRUEBA G01%';
  if n = 0 then raise exception 'PRUEBA G01 · 9: conta_consulta_clientes no saca los clientes.'; end if;
  select count(*) into n from public.conta_consulta_lineas where cuenta_id = a and cliente like 'CLIENTE PRUEBA G01%';
  if n < 5 then raise exception 'PRUEBA G01 · 9: conta_consulta_lineas no saca las líneas (%).', n; end if;
  perform * from public.conta_consulta_diferencias where cuenta_id = a;
  if has_table_privilege('anon', 'public.conta_consulta_clientes', 'select') or has_table_privilege('authenticated', 'public.conta_consulta_lineas', 'insert')
     or has_table_privilege('anon', 'public.conta_linea', 'select') or has_table_privilege('authenticated', 'public.conta_tarifa', 'insert') then
    raise exception 'PRUEBA G01 · 9: anon lee o una persona escribe directamente.';
  end if;
  raise notice 'G01 · 9: las vistas salen y son de solo lectura. OK';
end $$;

-- 9c (preparación) · Lo leído de GoCardless (inventado) y tres diferencias, para
-- probar en 9b lo que se hace desde la ficha (la 2000).
do $$
declare e uuid := (select empresa from _e); a uuid := (select cuenta from _e); uno uuid; dos uuid; l uuid;
begin
  select party_id into uno from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-1';
  select party_id into dos from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-2';
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id, casado_por) values
    (e, 'CU-G01-A', a, 'ACADEMIA PRUEBA G01 SIN FICHA', null, null), (e, 'CU-G01-B', a, 'CLIENTE PRUEBA G01 UNO', uno, 'nif');
  insert into public.conta_gc_suscripcion (company_id, gc_id, account_id, gc_cliente_id, nombre, importe, moneda, intervalo, cada, estado, al_mes, inicio) values
    (e, 'SB-G01-1', a, 'CU-G01-B', 'GESTION LABORAL', 24.20, 'EUR', 'monthly', 1, 'active', 24.20, date '2026-01-05'),
    (e, 'SB-G01-2', a, 'CU-G01-B', 'GESTION LABORAL ANTIGUA', 24.20, 'EUR', 'monthly', 1, 'active', 24.20, date '2026-01-05');
  insert into public.conta_gestoria_lectura (account_id, company_id, origen, entorno, por) values (a, e, 'gocardless', 'pruebas', 'persona') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, gc_cliente_id, tipo, porque_codigo, porque) values
    (a, l, e, null, 'CU-G01-A', 'gocardless_sin_ficha', 'sin_ficha', 'En GoCardless y sin ficha en Bitrix24.'),
    (a, l, e, uno, 'CU-G01-B', 'totales_distintos', 'gocardless_mas', 'GoCardless cobra «GESTION LABORAL», que no es ninguna línea en Sumied.'),
    (a, l, e, dos, null, 'falla_a_menudo', 'tres_o_mas_fallos', '3 cobros fallidos desde el 1 de mayo.');
end $$;

-- 9b · Como una persona de la cuenta (authenticated, con su sub): ve en las
-- vistas las líneas de su cuenta y ninguna de otra, y no escribe en las tablas.
create temp table _u on commit drop as
select p.user_id::text as sub from public.user_profiles p where p.account_id = (select cuenta from _e) and p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
grant select on _e, _u to authenticated;
select coalesce((select sub from _u), '') as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select cuenta from _e); n int;
begin
  if (select sub from _u) is null then raise notice 'G01 · 9b: la empresa de staging no tiene ninguna persona administradora o encargada activa: se salta.'; return; end if;
  select count(*) into n from public.conta_consulta_lineas where cuenta_id = a and cliente like 'CLIENTE PRUEBA G01%';
  if n < 5 then raise exception 'PRUEBA G01 · 9b: la persona de la cuenta no ve sus líneas (%).', n; end if;
  select count(*) into n from public.conta_consulta_lineas where cuenta_id <> a;
  if n <> 0 then raise exception 'PRUEBA G01 · 9b: la persona ve % líneas de otras cuentas.', n; end if;
  if (select al_mes_este_mes from public.conta_consulta_lineas where cuenta_id = a and empleado = 'EMPLEADO UNO PRUEBA' limit 1) is null then
    raise exception 'PRUEBA G01 · 9b: la persona no ve lo que vale su línea este mes.';
  end if;
  begin
    insert into public.conta_tarifa (account_id, company_id, servicio_id, importe, periodo, desde)
    select account_id, company_id, servicio_id, 1, 'mes', date '2026-01-01' from public.conta_tarifa limit 1;
    raise exception 'PRUEBA G01 · 9b: la persona escribe una tarifa directamente.';
  exception when insufficient_privilege then null;
  end;
  -- La 1932, como la usa la pantalla: la tarifa propia «desde diciembre», con su frase; y los reintentos.
  declare r jsonb; e uuid := (select empresa from _e); lab uuid; uno uuid;
  begin
    select id into lab from public.conta_servicio where company_id = e and clave = 'gestion_laboral';
    select party_id into uno from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-1';
    r := public.conta_tarifa_guardar(e, lab, uno, 27.50, 'mes', date '2026-12-15', 'Prueba G01: sube en diciembre');
    if r->>'frase' <> 'Tarifa laboral de CLIENTE PRUEBA G01 UNO, S.L.: 27,50 € desde diciembre. Afecta a 1 empleado.' then
      raise exception 'PRUEBA G01 · 9b: la frase de la tarifa no es la esperada: %', r->>'frase';
    end if;
    if (select hasta from public.conta_tarifa where company_id = e and servicio_id = lab and party_id = uno and importe = 24.20) is distinct from date '2026-11-01' then
      raise exception 'PRUEBA G01 · 9b: la tarifa de antes no queda cerrada en noviembre.';
    end if;
    r := public.conta_gocardless_reintentos(e, true);
    if not (r->>'encendido')::boolean or not (select reintentos_inteligentes from public.conta_cobro_gocardless where company_id = e) then
      raise exception 'PRUEBA G01 · 9b: los reintentos no se encienden.';
    end if;
  end;
  -- La 2000, como la usa la ficha: alta y baja de un trabajador, lo de GoCardless como línea o sin contar, enlazar y dar por revisada.
  declare r jsonb; e uuid := (select empresa from _e); lab uuid; uno uuid; dos uuid; lin uuid; dif uuid;
  begin
    select id into lab from public.conta_servicio where company_id = e and clave = 'gestion_laboral';
    select party_id into uno from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-1';
    select party_id into dos from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01-2';
    r := public.conta_gestoria_alta_empleado(e, uno, lab, 'empleada cuatro prueba', date '2026-12-01');
    if r->>'frase' <> 'Alta de EMPLEADA CUATRO PRUEBA en gestión laboral de CLIENTE PRUEBA G01 UNO, S.L. desde diciembre: 27,50 € al mes.' then
      raise exception 'PRUEBA G01 · 9b: la frase del alta no es la esperada: %', r->>'frase';
    end if;
    lin := (r->>'id')::uuid;
    begin
      perform public.conta_gestoria_alta_empleado(e, uno, lab, 'Empleada Cuatro Prueba', date '2027-01-01');
      raise exception 'PRUEBA G01 · 9b: se da de alta dos veces al mismo trabajador.';
    exception when unique_violation then null;
    end;
    r := public.conta_gestoria_baja_linea(lin, date '2027-02-15');
    if (select hasta from public.conta_linea where id = lin) <> date '2027-02-01'
       or r->>'frase' <> 'Baja de EMPLEADA CUATRO PRUEBA en gestión laboral de CLIENTE PRUEBA G01 UNO, S.L.: febrero se cobra entero y ya no se cobra desde marzo.' then
      raise exception 'PRUEBA G01 · 9b: la baja no deja cobrar entero su mes: %', r->>'frase';
    end if;
    if public.conta_linea_al_mes(lin, date '2027-02-01') <> 27.50 or public.conta_linea_al_mes(lin, date '2027-03-01') <> 0 then
      raise exception 'PRUEBA G01 · 9b: el mes de la baja no vale entero o el siguiente sigue valiendo.';
    end if;
    if not exists (select 1 from public.conta_gestoria_cambio where registro_id = lin and accion = 'alta')
       or not exists (select 1 from public.conta_gestoria_cambio where registro_id = lin and accion = 'cambio') then
      raise exception 'PRUEBA G01 · 9b: el alta o la baja no quedan en el registro.';
    end if;
    r := public.conta_gestoria_linea_desde_gc(e, 'SB-G01-1', lab, 'Empleado cinco prueba');
    if not exists (select 1 from public.conta_linea where suscripcion_gc_id = 'SB-G01-1' and party_id = uno and empleado_nombre = 'EMPLEADO CINCO PRUEBA')
       or exists (select 1 from public.conta_gestoria_diferencia where party_id = uno and tipo = 'totales_distintos' and vigente) then
      raise exception 'PRUEBA G01 · 9b: «Añadirla como línea» no la añade o la diferencia sigue: %', r->>'frase';
    end if;
    r := public.conta_gestoria_no_contar(e, 'SB-G01-2', 'Se fue en octubre');
    if not exists (select 1 from public.conta_gestoria_decision where tipo = 'no_contar' and suscripcion_gc_id = 'SB-G01-2' and motivo = 'Se fue en octubre') then
      raise exception 'PRUEBA G01 · 9b: «No la cuentes» no queda apuntado.';
    end if;
    r := public.conta_gestoria_enlazar(e, 'CU-G01-A', dos);
    if (select party_id from public.conta_gc_cliente where company_id = e and gc_id = 'CU-G01-A') is distinct from dos
       or (select gc_casado_por from public.conta_cobro_cliente where company_id = e and party_id = dos) <> 'persona'
       or exists (select 1 from public.conta_gestoria_diferencia where gc_cliente_id = 'CU-G01-A' and vigente) then
      raise exception 'PRUEBA G01 · 9b: «Enlazar con una ficha» no enlaza: %', r->>'frase';
    end if;
    select id into dif from public.conta_gestoria_diferencia where party_id = dos and tipo = 'falla_a_menudo' and vigente;
    begin
      perform public.conta_gestoria_revisada(dif, '  ');
      raise exception 'PRUEBA G01 · 9b: se da por revisada sin decir por qué.';
    exception when invalid_parameter_value then null;
    end;
    r := public.conta_gestoria_revisada(dif, 'Ha cambiado de banco');
    if (select vigente from public.conta_gestoria_diferencia where id = dif) or (select count(*) from public.conta_gestoria_decision where company_id = e) <> 4 then
      raise exception 'PRUEBA G01 · 9b: «Ya lo he revisado» no la quita o no queda apuntado: %', r->>'frase';
    end if;
    begin
      insert into public.conta_gestoria_decision (account_id, company_id, tipo, frase) values (a, e, 'revisada', 'x');
      raise exception 'PRUEBA G01 · 9b: la persona escribe una decisión directamente.';
    exception when insufficient_privilege then null;
    end;
  end;
  raise notice 'G01 · 9b: como persona, solo lo de su cuenta, y sin escribir directamente; la tarifa «desde diciembre» y los reintentos, por sus funciones. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 10 · La vuelta atrás de las dos: sin los datos de la prueba, todo como antes.
rollback to savepoint datos;
\i supabase/vuelta-atras/20261106T2000_g01_ficha_acciones.down.sql
\i supabase/vuelta-atras/20261106T1932_g01_tarifas_y_reintentos.down.sql
\i supabase/vuelta-atras/20261106T1531_g01_gocardless_cobro.down.sql
\i supabase/vuelta-atras/20261106T1530_g01_clientes_cuotas.down.sql
do $$
declare x record;
begin
  select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'conta_pasarela_cuenta_proveedor_check') as pasarela,
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'party_source_check') as origen,
         (select md5(pg_get_functiondef('public._s01_cuenta_pasarela(uuid,text)'::regprocedure))) as funcion,
         (select attnotnull from pg_attribute where attrelid = 'public.conta_mandato'::regclass and attname = 'token') as token_obligatorio
    into x;
  if exists (select 1 from _antes y where y.pasarela is distinct from x.pasarela or y.origen is distinct from x.origen
              or y.funcion is distinct from x.funcion or y.token_obligatorio is distinct from x.token_obligatorio) then
    raise exception 'PRUEBA G01 · 10: la vuelta atrás no deja todo como antes: pasarela %, origen %, función %, enlace obligatorio %.',
      (select pasarela from _antes) = x.pasarela, (select origen from _antes) = x.origen, (select funcion from _antes) = x.funcion, x.token_obligatorio;
  end if;
  if to_regclass('public.conta_linea') is not null or to_regclass('public.conta_gestoria_decision') is not null
     or to_regprocedure('public.conta_gestoria_enlazar(uuid,text,uuid)') is not null or to_regclass('public.conta_consulta_clientes') is not null
     or exists (select 1 from information_schema.columns where table_name = 'conta_mandato' and column_name = 'origen')
     or exists (select 1 from information_schema.columns where table_name = 'conta_cobro_cliente' and column_name = 'forma_cobro') then
    raise exception 'PRUEBA G01 · 10: la vuelta atrás deja tablas, vistas o columnas.';
  end if;
  if exists (select 1 from cron.job where jobname = 'conta-gestoria-leer') then raise exception 'PRUEBA G01 · 10: queda la lectura de cada noche.'; end if;
  raise notice 'G01 · 10: la vuelta atrás deja todo como antes. OK';
end $$;

rollback;
