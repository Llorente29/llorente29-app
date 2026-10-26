-- supabase/staging/sql/20261025_v03_verifactu_prueba.sql
--
-- SOLO STAGING. Prueba de la 2140 (añade el motor de Verifactu) y la 2141 (cambia
-- en caliente public.customer_invoice: el disparador customer_invoice_verifactu),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A
-- (Taberna de Prueba Norte, NIF B28000016), con clientes y facturas inventados.
--
--   0. Lo de antes: conta_venta_emitir con su md5 (la 2141 no la toca), y la
--      huella de la base contra los tres ejemplos oficiales de la AEAT.
--   1. Apagado (lo de partida): emitir no escribe ningún registro.
--   2. En pruebas, como usuario de A: dos facturas emitidas por el camino de
--      siempre (conta_venta_emitir) → dos altas F1, la segunda encadenada con la
--      primera, cada huella el SHA-256 de su cadena, y en la cola.
--   3. Suiza con IVA (3a, el camino de hoy: S1 con IDOtro 04). Lo que Hacienda
--      rechazaría se dice antes (3b): la comprobación previa sobre un borrador a
--      Suiza sin IVA y sin motivo lo dice en palabras de la calle, y con «N2»
--      queda limpia (no se emite: la V01 no emite líneas exentas); y una
--      emisión con el NIF mal se deshace entera sin gastar número.
--   4. El registro no se edita.
--   6. El despertar y el aviso del certificado (2249).
--   C. El candado: sin una prueba de conexión correcta, no se enciende (2351).
--   7. El certificado de la empresa, solo para Verifactu: autorizar, abrir para
--      un envío de real, no editar, retirar; presentar sigue pidiendo confirmación (2341).
--   5. Las vueltas atrás: sin el disparador ni las tablas; conta_venta_emitir
--      con el mismo md5 del principio.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 2140 solo añade y puede estar ya de verdad (W05): primero las vueltas atrás.
\i supabase/vuelta-atras/20261025T2351_v03_verifactu_candado.down.sql
\i supabase/vuelta-atras/20261025T2341_v03_verifactu_autorizacion.down.sql
\i supabase/vuelta-atras/20261025T2249_v03_verifactu_despertar.down.sql
\i supabase/vuelta-atras/20261025T2141_v03_verifactu_engancha.down.sql
\i supabase/vuelta-atras/20261025T2140_v03_verifactu_motor.down.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select, insert, update on _v to authenticated;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
insert into _v select 'md5_emitir', md5(pg_get_functiondef('public.conta_venta_emitir(uuid,text)'::regprocedure));
insert into _v values ('t21', (select id::text from public.tax_rate where code = 'iva_general' and company_id is null)),
  ('t0', (select id::text from public.tax_rate where code = 'exento' and company_id is null)),
  ('c705', (select id::text from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '70500000'));
do $$ begin
  if exists (select 1 from _v where v is null) then raise exception 'PRUEBA V03 · 0: falta algo de la empresa A (%).', (select string_agg(clave, ', ') from _v where v is null); end if;
  if (select tax_id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') <> 'B28000016' then raise exception 'PRUEBA V03 · 0: la empresa A no es la de siempre.'; end if;
  if exists (select 1 from pg_trigger where tgname = 'customer_invoice_verifactu') then raise exception 'PRUEBA V03 · 0: el disparador ya estaba.'; end if;
end $$;

\i supabase/migrations/20261025T2140_v03_verifactu_motor.sql
\i supabase/migrations/20261025T2141_v03_verifactu_engancha.sql
\i supabase/migrations/20261025T2249_v03_verifactu_despertar.sql
\i supabase/migrations/20261025T2341_v03_verifactu_autorizacion.sql
\i supabase/migrations/20261025T2351_v03_verifactu_candado.sql

-- 0 · La huella de la base contra los ejemplos oficiales (v0.1.2 §6).
do $$ begin
  if public._verifactu_sha256(public._verifactu_cadena_alta('89890001K','12345678/G33','01-01-2024','F1','12.35','123.45',null,'2024-01-01T19:20:30+01:00')) <> '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'
  or public._verifactu_sha256(public._verifactu_cadena_alta('89890001K','12345679/G34','01-01-2024','F1','12.35','123.45','3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60','2024-01-01T19:20:35+01:00')) <> 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97'
  or public._verifactu_sha256(public._verifactu_cadena_anulacion('89890001K','12345679/G34','01-01-2024','F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97','2024-01-01T19:20:40+01:00')) <> '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68' then
    raise exception 'PRUEBA V03 · 0: la huella de la base no da la de los ejemplos oficiales.';
  end if;
  if (select md5(pg_get_functiondef('public.conta_venta_emitir(uuid,text)'::regprocedure))) <> (select v from _v where clave = 'md5_emitir') then
    raise exception 'PRUEBA V03 · 0: la 2140 o la 2141 han cambiado conta_venta_emitir.';
  end if;
  raise notice '0 · los tres ejemplos oficiales dan su huella; conta_venta_emitir, la misma';
end $$;

-- C · El candado (2351, respuesta 3): sin una prueba de conexión correcta con
-- la AEAT apuntada, no se pasa a pruebas; una que salió mal tampoco abre.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_msg text;
begin
  begin perform public.verifactu_modo((select v::uuid from _v where clave = 'empresa'), 'pruebas', null, null, 'Prueba V03');
    raise exception 'PRUEBA V03 · C: pasa a pruebas sin haber probado la conexión.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%no se ha probado la conexión con el entorno de pruebas%' then raise exception 'PRUEBA V03 · C: no dice por qué («%»).', v_msg; end if;
  raise notice 'C · sin probar la conexión, no pasa a pruebas: «%»', v_msg;
end $$;
reset role;
do $$
begin
  perform public.verifactu_conexion_apuntar('pruebas', 'B28000016', false, 4104, 'Prueba V03: salió mal', 'prueba V03');
  if public.verifactu_conexion_probada('pruebas', null) then raise exception 'PRUEBA V03 · C: una prueba que salió mal abre el candado.'; end if;
  perform public.verifactu_conexion_apuntar('pruebas', 'B28000016', true, null, 'Prueba V03: bien', 'prueba V03');
  if not public.verifactu_conexion_probada('pruebas', null) or public.verifactu_conexion_probada('real', 'B28000016') then
    raise exception 'PRUEBA V03 · C: la correcta de pruebas no abre pruebas, o abre real.';
  end if;
  raise notice 'C · una que salió mal no abre; la correcta de pruebas abre pruebas y no real';
end $$;

-- 1 a 4 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc uuid := (select v::uuid from _v where clave = 'cuenta'); v_e uuid := (select v::uuid from _v where clave = 'empresa');
  v_t21 uuid := (select v::uuid from _v where clave = 't21'); v_t0 uuid := (select v::uuid from _v where clave = 't0');
  v_c705 uuid := (select v::uuid from _v where clave = 'c705');
  v_cli uuid; v_ch uuid; r jsonb; v_f uuid; v_g uuid; v_h uuid; v_n1 text; v_n2 text; v_antes int; v_despues int; v_x record; v_msg text;
begin
  r := public.party_save_customer(v_acc, null, 'Colegio Prueba V03', '12345678Z', '{}'::jsonb, 'Prueba V03');
  v_cli := (r->>'party_id')::uuid;

  -- 1 · Apagado.
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú apagado', 'cantidad', 1, 'precio', 10, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  perform public.conta_venta_emitir((r->>'id')::uuid, 'Prueba V03');
  if exists (select 1 from public.verifactu_registro where company_id = v_e) then raise exception 'PRUEBA V03 · 1: con Verifactu apagado se ha escrito un registro.'; end if;
  raise notice '1 · apagado: emitir no escribe registro';

  -- 2 · En pruebas: dos altas encadenadas.
  r := public.verifactu_modo(v_e, 'pruebas', null, null, 'Prueba V03');
  if r->>'modo' <> 'pruebas' then raise exception 'PRUEBA V03 · 2: no pasa a pruebas (%).', r; end if;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú comedor', 'cantidad', 10, 'precio', 10, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  v_f := (r->>'id')::uuid;
  v_n1 := public.conta_venta_emitir(v_f, 'Prueba V03')->>'numero';
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú celíaco', 'cantidad', 2, 'precio', 12.5, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  v_g := (r->>'id')::uuid;
  v_n2 := public.conta_venta_emitir(v_g, 'Prueba V03')->>'numero';
  perform 1 from public.verifactu_registro a join public.verifactu_registro b on b.anterior_id = a.id
   where a.invoice_id = v_f and b.invoice_id = v_g and a.num_serie = v_n1 and b.num_serie = v_n2
     and a.tipo_factura = 'F1' and b.tipo_factura = 'F1' and a.entorno = 'pruebas' and a.nif_emisor = 'B28000016'
     and b.huella_anterior = a.huella and a.huella = public._verifactu_sha256(a.cadena_huella) and b.huella = public._verifactu_sha256(b.cadena_huella)
     and a.importe_total = 121.00 and a.cuota_total = 21.00 and b.importe_total = 30.25 and a.estado = 'pendiente' and b.estado = 'pendiente'
     and a.cadena_huella like 'IDEmisorFactura=B28000016&NumSerieFactura=' || v_n1 || '&FechaExpedicionFactura=' || to_char((now() at time zone 'Europe/Madrid')::date, 'DD-MM-YYYY') || '&TipoFactura=F1&CuotaTotal=21.00&ImporteTotal=121.00&Huella=%'
     and a.destinatarios->0->>'nif' = '12345678Z';
  if not found then raise exception 'PRUEBA V03 · 2: las dos altas no están encadenadas como deben (%).',
    (select jsonb_agg(jsonb_build_object('n', num_serie, 'h', left(huella, 8), 'ant', left(huella_anterior, 8), 'imp', importe_total, 'cadena', cadena_huella)) from public.verifactu_registro where company_id = v_e); end if;
  select estado into v_msg from public.verifactu_factura_estado where invoice_id = v_g;
  if v_msg <> 'pendiente' then raise exception 'PRUEBA V03 · 2: la factura no sale «pendiente» con Hacienda (%).', v_msg; end if;
  raise notice '2 · % y %: dos altas F1 encadenadas, con su huella, en la cola', v_n1, v_n2;

  -- 3a · Un cliente de Suiza, con IVA: el caso de un restaurante (el servicio
  -- se consume en España y lleva IVA, art. 70.Uno.5.º LIVA). S1, y el
  -- destinatario va como IDOtro 04 con su país, encadenado tras la anterior.
  r := public.party_save_customer(v_acc, null, 'Alpen Gastro AG (prueba V03)', 'CHE123456789', jsonb_build_object('countryCode', 'CH'), 'Prueba V03');
  v_ch := (r->>'party_id')::uuid;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_ch, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú de empresa (evento)', 'cantidad', 20, 'precio', 30, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  v_h := (r->>'id')::uuid;
  perform public.conta_venta_emitir(v_h, 'Prueba V03');
  perform 1 from public.verifactu_registro where invoice_id = v_h and tipo_factura = 'F1' and desglose->0->>'calificacion' = 'S1'
     and destinatarios->0->>'codigo_pais' = 'CH' and destinatarios->0->>'id_type' = '04' and destinatarios->0->>'id' = 'CHE123456789'
     and importe_total = 726.00 and huella_anterior = (select huella from public.verifactu_registro where invoice_id = v_g);
  if not found then raise exception 'PRUEBA V03 · 3a: la de Suiza con IVA no tiene su alta como debe (%).', (select row_to_json(r) from public.verifactu_registro r where invoice_id = v_h); end if;
  raise notice '3a · Suiza con IVA: S1, IDOtro 04 con CH, encadenada';

  -- 3b se prepara aquí: un borrador a Suiza que la V01 deja guardar (con IVA)
  -- y que el superusuario pasa a «exento» (la V01 aún no deja guardar líneas
  -- exentas: conta_venta_guardar solo admite «taxed»).
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_ch, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Asesoría de cocina', 'cantidad', 1, 'precio', 2150, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  insert into _v values ('exenta', r->>'id'), ('suiza_iva', v_h::text);
  -- Y otro al cliente de siempre, al que el superusuario le pondrá en la
  -- factura un NIF mal escrito (la letra no es la suya).
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú', 'cantidad', 1, 'precio', 10, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  insert into _v values ('nif_mal', r->>'id');

  -- 4 · El registro no se edita.
  begin
    update public.verifactu_registro set num_serie = 'X' where invoice_id = v_f;
    if found then raise exception 'PRUEBA V03 · 4: se ha podido editar un registro.'; end if;
  exception when check_violation or insufficient_privilege then null;
  end;
  raise notice '4 · el registro no se edita';
end $$;
reset role;

-- 3b · Lo que Hacienda rechazaría se dice antes, y no se emite.
--   · La comprobación previa (la que usará la pantalla) sobre el borrador a
--     Suiza ya sin IVA y sin decir por qué: lo dice en palabras de la calle;
--     con «N2» (servicio a una empresa de fuera de la UE), ya no falta nada.
--     No se EMITE: la V01 no emite líneas exentas (conta_venta_guardar solo
--     admite «taxed», y su asiento no cuadra una 477 a 0): queda para Julio.
--   · Una emisión con una falta (un NIF español mal escrito, que la V01 sí deja
--     llegar a emitir) se deshace entera y NO gasta número.
update public.customer_invoice_line set tax_rate_id = (select v::uuid from _v where clave = 't0'), tax_pct = 0, tax_amount = 0
 where invoice_id = (select v::uuid from _v where clave = 'exenta');
update public.customer_invoice set tax = 0, total = base where id = (select v::uuid from _v where clave = 'exenta');
update public.customer_invoice set customer = jsonb_set(customer, '{nif}', '"12345678A"') where id = (select v::uuid from _v where clave = 'nif_mal');
-- El contador no lo lee el usuario: se mide aquí, antes y después.
insert into _v select 'contador_antes', coalesce(max(last_number), 0)::text from public.customer_invoice_counter
 where company_id = (select v::uuid from _v where clave = 'empresa') and series_code = 'F';
set local role authenticated;
do $$
declare
  v_h uuid := (select v::uuid from _v where clave = 'exenta'); v_m uuid := (select v::uuid from _v where clave = 'nif_mal');
  k jsonb; v_msg text;
begin
  k := public.verifactu_comprobar(v_h);
  if not exists (select 1 from jsonb_array_elements(k->'faltas') x where x->>'campo' = 'tipo_venta' and x->>'frase' like '%fuera de la UE%dime qué le has vendido%') then
    raise exception 'PRUEBA V03 · 3b: la comprobación no dice qué falta en palabras de la calle (%).', k->'faltas';
  end if;
  v_msg := (select x->>'frase' from jsonb_array_elements(k->'faltas') x where x->>'campo' = 'tipo_venta' limit 1);
  perform public.verifactu_operacion_poner(v_h, 'N2', null, null, 'Prueba V03');
  k := public.verifactu_comprobar(v_h);
  if jsonb_array_length(k->'faltas') <> 0 or k->'desglose'->0->>'calificacion' <> 'N2' or k->'desglose'->0 ? 'tipo' or (k->>'cuota_total')::numeric <> 0 then
    raise exception 'PRUEBA V03 · 3b: con N2 la comprobación no queda limpia (%).', k;
  end if;
  raise notice '3b · Suiza sin IVA y sin motivo: «%»; con N2, nada que falte y el desglose N2 sin tipo', v_msg;

  if v_m is null then raise exception 'PRUEBA V03 · 3b: no encuentro el borrador del NIF mal.'; end if;
  begin
    perform public.conta_venta_emitir(v_m, 'Prueba V03');
    raise exception 'PRUEBA V03 · 3b: se ha emitido con el NIF mal.';
  exception when check_violation then v_msg := sqlerrm;
  end;
  if (select status from public.customer_invoice where id = v_m) <> 'borrador' or (select number_text from public.customer_invoice where id = v_m) is not null then
    raise exception 'PRUEBA V03 · 3b: la del NIF mal ha quedado emitida o con número.';
  end if;
  if v_msg not like '%NIF del cliente%no es un NIF español válido%' then raise exception 'PRUEBA V03 · 3b: el NIF mal no se dice en palabras de la calle («%»).', v_msg; end if;
  raise notice '3b · NIF mal: «%», y la factura sigue en borrador', v_msg;
end $$;
reset role;
-- Ni la del NIF mal ni nada de la 3b ha gastado número.
do $$
declare v_antes int := (select v::int from _v where clave = 'contador_antes'); v_despues int;
begin
  select coalesce(max(last_number), 0) into v_despues from public.customer_invoice_counter
   where company_id = (select v::uuid from _v where clave = 'empresa') and series_code = 'F';
  if v_despues <> v_antes then raise exception 'PRUEBA V03 · 3b: la emisión rechazada ha gastado número (% → %).', v_antes, v_despues; end if;
  raise notice '3b · el contador no se ha movido (%)', v_despues;
end $$;


-- 5 · Las vueltas atrás.
\i supabase/vuelta-atras/20261025T2351_v03_verifactu_candado.down.sql
\i supabase/vuelta-atras/20261025T2341_v03_verifactu_autorizacion.down.sql
\i supabase/vuelta-atras/20261025T2249_v03_verifactu_despertar.down.sql
\i supabase/vuelta-atras/20261025T2141_v03_verifactu_engancha.down.sql
\i supabase/vuelta-atras/20261025T2140_v03_verifactu_motor.down.sql
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'customer_invoice_verifactu') or to_regclass('public.verifactu_registro') is not null
     or exists (select 1 from pg_proc where proname like '%verifactu%' and pronamespace = 'public'::regnamespace) then
    raise exception 'PRUEBA V03 · 5: las vueltas atrás dejan algo del motor.';
  end if;
  if (select md5(pg_get_functiondef('public.conta_venta_emitir(uuid,text)'::regprocedure))) <> (select v from _v where clave = 'md5_emitir') then
    raise exception 'PRUEBA V03 · 5: conta_venta_emitir no es la del principio.';
  end if;
  raise notice '5 · las vueltas atrás: ni el disparador ni las tablas ni las funciones; conta_venta_emitir, la misma';
end $$;

-- 6 · El despertar y el aviso del certificado (2249).
--   · Sin nada de real, verifactu_despertar no llama (ninguna petición nueva).
--   · A pasa a real con su serie nueva y sin certificado: el aviso sale (uno).
--   · Con un alta de real pendiente, despertar SÍ llamaría: en staging no hay
--     cron_secret, así que falla diciéndolo (55000) en vez de callar.
--   Va DESPUÉS de la 5, con las tres otra vez: deja un registro de REAL, y la
--   vuelta atrás de la 2140 se niega a deshacer con registros de real (es su
--   guarda; el run 571 lo probó). El rollback final se lo lleva todo.
\i supabase/migrations/20261025T2140_v03_verifactu_motor.sql
\i supabase/migrations/20261025T2141_v03_verifactu_engancha.sql
\i supabase/migrations/20261025T2249_v03_verifactu_despertar.sql
\i supabase/migrations/20261025T2341_v03_verifactu_autorizacion.sql
\i supabase/migrations/20261025T2351_v03_verifactu_candado.sql
do $$
declare v_n bigint; v_m bigint;
begin
  -- Todo se ha vuelto a aplicar: las marcas del candado, otra vez (pruebas y real de A).
  perform public.verifactu_conexion_apuntar('pruebas', 'B28000016', true, null, 'Prueba V03', 'prueba V03');
  perform public.verifactu_conexion_apuntar('real', 'B28000016', true, null, 'Prueba V03', 'prueba V03');
  select count(*) into v_n from net.http_request_queue;
  perform public.verifactu_despertar();
  select count(*) into v_m from net.http_request_queue;
  if v_m <> v_n then raise exception 'PRUEBA V03 · 6: sin nada de real, despertar ha llamado.'; end if;
  raise notice '6 · sin nada de real, despertar no llama';
end $$;
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_c705 uuid := (select v::uuid from _v where clave = 'c705');
  v_t21 uuid := (select v::uuid from _v where clave = 't21'); r jsonb; v_cli uuid;
begin
  r := public.verifactu_modo(v_e, 'real', 'V03R', 'EMPEZAR', 'Prueba V03');
  if r->>'modo' <> 'real' then raise exception 'PRUEBA V03 · 6: no pasa a real (%).', r; end if;
  select party_id into v_cli from public.customer_invoice where id = (select v::uuid from _v where clave = 'nif_mal');
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'serie', 'V03R', 'fecha', (now() at time zone 'Europe/Madrid')::date),
    jsonb_build_array(jsonb_build_object('concepto', 'Menú en real', 'cantidad', 1, 'precio', 10, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03');
  perform public.conta_venta_emitir((r->>'id')::uuid, 'Prueba V03');
  if not exists (select 1 from public.verifactu_registro where invoice_id = (r->>'id')::uuid and entorno = 'real' and primer_registro) then
    raise exception 'PRUEBA V03 · 6: la primera de real no es el primer registro de su cadena.';
  end if;
  raise notice '6 · A en real: su primera factura (V03R) abre la cadena de real';
end $$;
reset role;
do $$
declare v_n int; v_msg text;
begin
  v_n := public.verifactu_aviso_certificado();
  if v_n <> 1 then raise exception 'PRUEBA V03 · 6: el aviso del certificado no sale una vez (%).', v_n; end if;
  if not exists (select 1 from public.system_alert_queue where kind = 'verifactu_certificado' and subject like '%no tiene certificado%') then
    raise exception 'PRUEBA V03 · 6: el aviso del certificado no está en la cola.';
  end if;
  begin
    perform public.verifactu_despertar();
    raise exception 'PRUEBA V03 · 6: con real pendiente y sin cron_secret, despertar no ha dicho nada.';
  exception when sqlstate '55000' then v_msg := sqlerrm;
  end;
  raise notice '6 · el aviso del certificado sale (1); con real pendiente despertar llamaría: «%»', v_msg;
end $$;

-- 7 · El certificado de la empresa, solo para Verifactu (2341, respuesta 2 b).
-- Un certificado de mentira en el Vault (se va con el rollback), del NIF de A,
-- y otro de otro NIF. Después de la 6, A está en real con un alta pendiente.
do $$
declare v_s uuid; v_acc uuid := (select v::uuid from _v where clave = 'cuenta');
begin
  v_s := vault.create_secret('{"cert":"CERT-DE-PRUEBA","key":"CLAVE-DE-PRUEBA"}', 'v03-prueba-' || gen_random_uuid());
  insert into public.tax_certificate (owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial, valid_from, valid_to,
         fingerprint_sha256, kind, storage, vault_secret_id)
  values (v_acc, 'Prueba V03 (de mentira)', encode(sha256(convert_to('B28000016', 'UTF8')), 'hex'), '016', 'Prueba', 'V03-1', now() - interval '1 day', now() + interval '1 year',
          encode(sha256(convert_to('v03-cert-1', 'UTF8')), 'hex'), 'legal_representative', 'vault', v_s)
  returning id::text into strict v_s;
  insert into _v values ('cert', v_s::text);
  v_s := vault.create_secret('{"cert":"OTRO","key":"OTRA"}', 'v03-prueba-' || gen_random_uuid());
  insert into public.tax_certificate (owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial, valid_from, valid_to,
         fingerprint_sha256, kind, storage, vault_secret_id)
  values (v_acc, 'Otro NIF (de mentira)', encode(sha256(convert_to('A12345674', 'UTF8')), 'hex'), '674', 'Prueba', 'V03-2', now() - interval '1 day', now() + interval '1 year',
          encode(sha256(convert_to('v03-cert-2', 'UTF8')), 'hex'), 'legal_representative', 'vault', v_s)
  returning id::text into strict v_s;
  insert into _v values ('cert_otro', v_s::text);
end $$;
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_c uuid := (select v::uuid from _v where clave = 'cert');
  v_o uuid := (select v::uuid from _v where clave = 'cert_otro'); r jsonb; v_msg text;
begin
  begin perform public.verifactu_autorizar_certificado(v_e, v_c, 'SI', 'Prueba V03'); raise exception 'PRUEBA V03 · 7: autoriza sin AUTORIZO.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%escribe AUTORIZO%solo para enviar%Verifactu%' then raise exception 'PRUEBA V03 · 7: sin AUTORIZO no lo dice claro («%»).', v_msg; end if;
  begin perform public.verifactu_autorizar_certificado(v_e, v_o, 'AUTORIZO', 'Prueba V03'); raise exception 'PRUEBA V03 · 7: autoriza un certificado de otro NIF.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%otro NIF (acaba en 674)%' then raise exception 'PRUEBA V03 · 7: el de otro NIF no lo dice («%»).', v_msg; end if;
  r := public.verifactu_autorizar_certificado(v_e, v_c, 'AUTORIZO', 'Prueba V03');
  if (select via from public.verifactu_empresa where company_id = v_e) <> 'certificado' then raise exception 'PRUEBA V03 · 7: autorizada, la vía no es la del certificado.'; end if;
  insert into _v values ('autorizacion', r->>'id');
  begin
    update public.verifactu_autorizacion set autorizada_por_nombre = 'Otro' where id = (r->>'id')::uuid;
    if found then raise exception 'PRUEBA V03 · 7: la autorización se ha podido editar.'; end if;
  exception when insufficient_privilege then null; end;
  raise notice '7 · sin AUTORIZO no; de otro NIF no («%»); autorizada, por la vía del certificado, y no se edita', v_msg;
end $$;
reset role;
do $$
declare v_l jsonb; r jsonb; v_aut uuid := (select v::uuid from _v where clave = 'autorizacion');
begin
  begin update public.verifactu_autorizacion set autorizada_at = now() - interval '1 day' where id = v_aut; raise exception 'PRUEBA V03 · 7: la autorización se edita (superusuario).';
  exception when insufficient_privilege then null; end;
  v_l := public.verifactu_cola_tomar('real', 1000);
  if v_l is null then raise exception 'PRUEBA V03 · 7: no hay envío de real que tomar.'; end if;
  insert into _v values ('envio_real', v_l->>'envio_id');
  r := public.verifactu_cert_abrir((v_l->>'envio_id')::uuid);
  if not (r->>'ok')::boolean or r->>'material' <> '{"cert":"CERT-DE-PRUEBA","key":"CLAVE-DE-PRUEBA"}' or (r->>'autorizacion_id')::uuid <> v_aut
     or (select autorizacion_id from public.verifactu_envio where id = (v_l->>'envio_id')::uuid) is distinct from v_aut then
    raise exception 'PRUEBA V03 · 7: autorizada, no abre el certificado para su envío o no lo apunta (%).', r - 'material';
  end if;
  -- Presentar impuestos sigue pidiendo su confirmación: la autorización de Verifactu no la abre.
  r := public.conta_cert_abrir(gen_random_uuid(), (select autorizada_por from public.verifactu_autorizacion where id = v_aut));
  if (r->>'ok')::boolean then raise exception 'PRUEBA V03 · 7: el certificado se abre para presentar sin confirmación.'; end if;
  raise notice '7 · autorizada: abre el certificado para el envío de real y apunta su autorización; presentar sigue pidiendo confirmación («%»)', r->>'mensaje';
end $$;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.verifactu_retirar_autorizacion((select v::uuid from _v where clave = 'empresa'), 'Prueba de retirar', 'Prueba V03');
  if not (r->>'retirada')::boolean or (select via from public.verifactu_empresa where company_id = (select v::uuid from _v where clave = 'empresa')) <> 'colaborador' then
    raise exception 'PRUEBA V03 · 7: retirar no vuelve a la vía de colaborador social (%).', r;
  end if;
end $$;
reset role;
do $$
declare r jsonb;
begin
  r := public.verifactu_cert_abrir((select v::uuid from _v where clave = 'envio_real'));
  if (r->>'ok')::boolean or r->>'mensaje' not like '%colaborador social%' then raise exception 'PRUEBA V03 · 7: retirada, aún abre el certificado (%).', r - 'material'; end if;
  if (select retirada_motivo from public.verifactu_autorizacion where id = (select v::uuid from _v where clave = 'autorizacion')) <> 'Prueba de retirar' then
    raise exception 'PRUEBA V03 · 7: la retirada no apunta su porqué.';
  end if;
  raise notice '7 · retirada: vuelve a colaborador social y ya no abre («%»)', r->>'mensaje';
end $$;
rollback;
