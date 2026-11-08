-- supabase/staging/sql/20261108_g04_tarifa_y_clientes_prueba.sql
--
-- SOLO STAGING. Prueba del G04 · Tarea 3 (20261108T0930). Todo en una
-- transacción con ROLLBACK, con datos inventados (T11): no cambia staging.
--
--   1. Apagado por defecto: las acciones ensayan, pero no escriben hasta que
--      los cambios de tarifa estén encendidos en la empresa.
--   2. Encendido, como la persona: un nivel, un precio general por trabajador y
--      otro de nivel, unos tramos que se pisan (no entran) y unos buenos, un
--      paquete con su exceso.
--   3. «+ Añadir» (un nivel; un servicio con niveles sin elegir nivel no entra;
--      un servicio con precio suyo) y «Cambiar de nivel».
--   4. «Cambiar precios»: ensayar, aplicar (el general y un precio importado
--      acaban el mes anterior; el nuevo, desde enero), volver a aplicar no se
--      puede, con los precios cambiados desde el ensayo hay que volver a
--      ensayar, y deshacer.
--   5. «Cobrado por otra vía»: saca el cargo de «Te deben» y se puede quitar.
--   6. La lista: una fila por cliente y empresa, sin repetir, y una sin empresa
--      para quien no tiene nada.
--   7. Ajustes: «Altas y bajas a mitad de mes».
--   8. La vuelta atrás: fuera todo lo nuevo; lo importado, como estaba.
--
-- sin usuario: sembrar los datos inventados y encender los cambios lo hace el servidor; todas las acciones se prueban como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G04-3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 0930 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás: así parte siempre de lo de antes.
select to_regclass('public.conta_precio') is not null as ya_esta_la_0930 \gset
\if :ya_esta_la_0930
\i supabase/vuelta-atras/20261108T0930_g04_tarifa_y_clientes.down.sql
\endif

-- Una cuenta de staging con una persona administradora o encargada activa y una empresa.
create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id::text as sub,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa
  from public.user_profiles p where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
create temp table _id (clave text primary key, id text) on commit drop;
create temp table _antes on commit drop as select count(*) as lineas from public.conta_linea;

-- Lo de antes de la 0930, inventado: tres clientes, dos servicios importados y un precio importado.
do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; c3 uuid; sg uuid; sl uuid; t3 uuid;
begin
  if a is null or e is null then raise exception 'PRUEBA G04-3 · 0: staging no tiene una persona administradora o encargada con una empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 Uno, S.L.', 'B00000901') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 Dos, S.L.', 'B00000902') returning id into c2;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba G04 Tres', null) returning id into c3;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha) select a, x, 'activo', '{"telefonos":[],"correos":[]}' from unnest(array[c1, c2, c3]) x;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g04_prueba_gestoria', 'Gestoría Prueba G04', 'fijo_mes') returning id into sg;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g04_prueba_laboral', 'Laboral Prueba G04', 'por_empleado') returning id into sl;
  insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, origen) values (a, e, sl, c3, 22.00, 'mes', '2025-01-01', 'gocardless') returning id into t3;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, origen, periodo, desde, empleado_nombre) values (a, e, c3, sl, 'cuota', 'gocardless', 'mes', '2025-01-01', 'Persona Prueba G04');
  -- Un cargo devuelto en GoCardless de c2, con su mandato activo.
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c2, 'gocardless', 'CUG04PRUEBA')
    on conflict do nothing;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MDG04PRUEBA', 'CUG04PRUEBA', 'active', now());
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe) values (a, e, 'PMG04PRUEBA', 'MDG04PRUEBA', 'SBG04PRUEBA', 'failed', '2026-09-04', 108.90);
  insert into _id values ('c1', c1), ('c2', c2), ('c3', c3), ('sg', sg), ('sl', sl), ('t3', t3);
end $$;

\i supabase/migrations/20261108T0930_g04_tarifa_y_clientes.sql

-- Como la persona.
grant select on _u to authenticated;
grant select, insert on _id to authenticated;
select (select sub from _u) as sub_prueba \gset
select set_config('request.jwt.claims', json_build_object('sub', :'sub_prueba', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Apagado por defecto.
do $$
declare e uuid := (select empresa from _u); sg uuid := (select id::uuid from _id where clave = 'sg'); r jsonb;
begin
  r := public.conta_tarifa_nivel_guardar(e, sg, null, 'Básica', 1, array['Contabilidad'], false);
  if not (r->>'ensayo')::boolean or r->>'frase' not like 'Se creará el nivel Gestoría Prueba G04 · Básica%' then raise exception 'PRUEBA G04-3 · 1: el ensayo no dice lo que hará (%).', r; end if;
  if exists (select 1 from public.conta_servicio_nivel where servicio_id = sg) then raise exception 'PRUEBA G04-3 · 1: el ensayo escribe.'; end if;
  begin
    perform public.conta_tarifa_nivel_guardar(e, sg, null, 'Básica', 1, array['Contabilidad'], false, false);
    raise exception 'PRUEBA G04-3 · 1: con los cambios apagados, escribe.';
  exception when sqlstate '42501' then
    if sqlerrm not like '%aún no están encendidos%' then raise exception 'PRUEBA G04-3 · 1: el error no dice por qué (%).', sqlerrm; end if;
  end;
  raise notice 'G04-3 · 1: apagado por defecto: ensaya y no escribe. OK';
end $$;

-- Encender, como el servidor (en la cuenta real lo decide Julio).
reset role;
insert into public.conta_gestoria_ajustes (company_id, account_id, cambios_de_tarifa) select empresa, cuenta, true from _u;
set local role authenticated;

-- 2 · Niveles, precios, tramos, paquete.
do $$
declare e uuid := (select empresa from _u); sg uuid := (select id::uuid from _id where clave = 'sg'); sl uuid := (select id::uuid from _id where clave = 'sl');
        r jsonb; nb uuid; ne uuid; pq uuid;
begin
  nb := (public.conta_tarifa_nivel_guardar(e, sg, null, 'Básica', 1, array['Contabilidad'], false, false)->>'id')::uuid;
  r := public.conta_tarifa_nivel_guardar(e, sg, null, 'Estándar', 2, array['Contabilidad', 'Impuestos trimestrales'], true, false);
  ne := (r->>'id')::uuid;
  if r->>'frase' <> 'Creado el nivel Gestoría Prueba G04 · Estándar, marcado como el más elegido.' then raise exception 'PRUEBA G04-3 · 2: la frase del nivel (%).', r->>'frase'; end if;
  perform public.conta_tarifa_precio_guardar(e, sg, ne, null, null, 'fijo', 'mes', 60.50, null, '2026-01-01', false);
  perform public.conta_tarifa_precio_guardar(e, sg, nb, null, null, 'fijo', 'mes', 45.00, null, '2026-01-01', false);
  r := public.conta_tarifa_precio_guardar(e, sl, null, null, null, 'por_trabajador', null, 24.20, null, '2026-01-01', false);
  if r->>'frase' <> 'Guardado Laboral Prueba G04 (precio de tarifa): 24,20 € por trabajador desde enero de 2026.' then raise exception 'PRUEBA G04-3 · 2: la frase del precio (%).', r->>'frase'; end if;
  begin
    perform public.conta_tarifa_paquete_guardar(e, null, 'Pack Prueba G04', null, 18, jsonb_build_array(jsonb_build_object('servicio', sg, 'nivel', ne), jsonb_build_object('servicio', sl, 'limiteTrabajadores', 5)), false);
  end;
  pq := (select id from public.conta_paquete where company_id = e and nombre = 'Pack Prueba G04');
  begin
    perform public.conta_tarifa_precio_guardar(e, null, null, pq, null, 'tramos', null, null,
      '[{"desde":1,"hasta":5,"importe":150,"porUnidad":false},{"desde":5,"hasta":null,"importe":20,"porUnidad":true}]', '2026-01-01', false);
    raise exception 'PRUEBA G04-3 · 2: entran unos tramos que se pisan.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%se pisan%' then raise exception 'PRUEBA G04-3 · 2: el error de los tramos no dice por qué (%).', sqlerrm; end if;
  end;
  perform public.conta_tarifa_precio_guardar(e, null, null, pq, null, 'tramo_y_por_trabajador', null, null,
    '[{"desde":1,"hasta":5,"importe":150,"porUnidad":false},{"desde":6,"hasta":null,"importe":18,"porUnidad":true}]', '2026-01-01', false);
  if (select jsonb_array_length(tramos) from public.conta_consulta_tarifa_precio where paquete_id = pq) <> 2 then raise exception 'PRUEBA G04-3 · 2: los tramos no salen en la vista.'; end if;
  if (select count(*) from public.conta_paquete_linea where paquete_id = pq) <> 2 then raise exception 'PRUEBA G04-3 · 2: el paquete no guarda sus dos líneas.'; end if;
  insert into _id values ('nb', nb), ('ne', ne), ('pq', pq);
  raise notice 'G04-3 · 2: niveles, precios de tarifa, tramos (los que se pisan, no) y un paquete con exceso. OK';
end $$;

-- 3 · «+ Añadir» y «Cambiar de nivel».
do $$
declare e uuid := (select empresa from _u); c1 uuid := (select id::uuid from _id where clave = 'c1'); c2 uuid := (select id::uuid from _id where clave = 'c2');
        sg uuid := (select id::uuid from _id where clave = 'sg'); sl uuid := (select id::uuid from _id where clave = 'sl');
        ne uuid := (select id::uuid from _id where clave = 'ne'); nb uuid := (select id::uuid from _id where clave = 'nb'); r jsonb; l uuid;
begin
  begin
    perform public.conta_tarifa_servicio_anadir(e, c1, sg, null, null, '2026-11-01', null, false);
    raise exception 'PRUEBA G04-3 · 3: entra un servicio con niveles sin elegir nivel.';
  exception when sqlstate '22023' then null;
  end;
  r := public.conta_tarifa_servicio_anadir(e, c1, sg, ne, null, '2026-11-01');
  if not (r->>'ensayo')::boolean or exists (select 1 from public.conta_linea where party_id = c1) then raise exception 'PRUEBA G04-3 · 3: el ensayo de «+ Añadir» escribe.'; end if;
  r := public.conta_tarifa_servicio_anadir(e, c1, sg, ne, null, '2026-11-01', null, false);
  if r->>'frase' <> 'Añadido Gestoría Prueba G04 · Estándar para Cliente Prueba G04 Uno, S.L. desde noviembre de 2026, a precio de tarifa.' then raise exception 'PRUEBA G04-3 · 3: la frase de «+ Añadir» (%).', r->>'frase'; end if;
  l := (r->>'id')::uuid;
  r := public.conta_tarifa_servicio_anadir(e, c2, sl, null, null, '2026-11-01', '{"forma":"por_trabajador","importe":20}', false);
  if not exists (select 1 from public.conta_consulta_tarifa_precio where cliente_id = c2 and servicio_id = sl and importe = 20 and desde = '2026-11-01') then
    raise exception 'PRUEBA G04-3 · 3: el precio suyo de «+ Añadir» no se guarda.';
  end if;
  begin
    perform public.conta_tarifa_nivel_cambiar(l, nb, '2026-11-01', false);
    raise exception 'PRUEBA G04-3 · 3: el cambio de nivel entra el mismo mes del alta.';
  exception when sqlstate '22023' then null;
  end;
  r := public.conta_tarifa_nivel_cambiar(l, nb, '2027-01-01', false);
  if r->>'frase' <> 'Cliente Prueba G04 Uno, S.L. pasa de Gestoría Prueba G04 · Estándar a Gestoría Prueba G04 · Básica desde enero de 2027.' then raise exception 'PRUEBA G04-3 · 3: la frase del cambio de nivel (%).', r->>'frase'; end if;
  if (select hasta from public.conta_linea where id = l) <> '2026-12-01' or not exists (select 1 from public.conta_linea where party_id = c1 and nivel_id = nb and desde = '2027-01-01') then
    raise exception 'PRUEBA G04-3 · 3: el cambio de nivel no cierra la línea o no abre la nueva.';
  end if;
  raise notice 'G04-3 · 3: «+ Añadir» (con nivel y con precio suyo) y «Cambiar de nivel». OK';
end $$;

-- 4 · «Cambiar precios»: ensayar, aplicar, no dos veces, huella, deshacer.
do $$
declare e uuid := (select empresa from _u); sl uuid := (select id::uuid from _id where clave = 'sl'); c3 uuid := (select id::uuid from _id where clave = 'c3');
        t3 uuid := (select id::uuid from _id where clave = 't3'); gl uuid; r jsonb; k1 uuid; k2 uuid; v_res jsonb;
begin
  gl := (select id from public.conta_precio where company_id = e and servicio_id = sl and party_id is null);
  -- Lo que devolvería cambioPrecios.ts: el general de la laboral y el importado de c3 suben un 3 % desde enero de 2027.
  v_res := jsonb_build_object('frase', 'Laboral Prueba G04 sube un 3 % desde enero para 1 cliente.', 'clientes', 1, 'antesCent', 2200, 'despuesCent', 2266,
    'lineas', jsonb_build_array(jsonb_build_object('clienteId', c3, 'objetivo', jsonb_build_object('tipo', 'servicio', 'servicioId', sl), 'antesCent', 2200, 'despuesCent', 2266, 'como', 'suyo')),
    'guardar', jsonb_build_object('acabanAntes', jsonb_build_array('precio:' || gl, 'tarifa:' || t3), 'nuevos', jsonb_build_array(
      jsonb_build_object('empresaId', e, 'objetivo', jsonb_build_object('tipo', 'servicio', 'servicioId', sl), 'clienteId', null, 'forma', jsonb_build_object('tipo', 'por_trabajador', 'importeCent', 2493), 'desde', '2027-01', 'hasta', null),
      jsonb_build_object('empresaId', e, 'objetivo', jsonb_build_object('tipo', 'servicio', 'servicioId', sl), 'clienteId', c3, 'forma', jsonb_build_object('tipo', 'por_trabajador', 'importeCent', 2266), 'desde', '2027-01', 'hasta', null))));
  k1 := (public.conta_tarifa_cambio_ensayar(e, '{"desde":"2027-01","sentido":"subir"}', v_res)->>'id')::uuid;
  if (select estado from public.conta_cambio_precios where id = k1) <> 'ensayo' or (select count(*) from public.conta_cambio_precios_linea where cambio_id = k1) <> 1 then
    raise exception 'PRUEBA G04-3 · 4: el ensayo no se guarda con sus líneas.';
  end if;
  r := public.conta_tarifa_cambio_aplicar(k1);
  if (select hasta from public.conta_precio where id = gl) <> '2026-12-01' or (select hasta from public.conta_tarifa where id = t3) <> '2026-12-01'
     or (select count(*) from public.conta_precio where cambio_id = k1 and desde = '2027-01-01') <> 2 then
    raise exception 'PRUEBA G04-3 · 4: aplicar no hace lo ensayado.';
  end if;
  begin
    perform public.conta_tarifa_cambio_aplicar(k1);
    raise exception 'PRUEBA G04-3 · 4: se aplica dos veces.';
  exception when sqlstate '22023' then null;
  end;
  -- Un segundo ensayo, y un precio que cambia antes de aplicarlo: hay que volver a ensayar.
  k2 := (public.conta_tarifa_cambio_ensayar(e, '{"desde":"2027-03","sentido":"subir"}', jsonb_set(v_res, '{guardar}', '{"acabanAntes":[],"nuevos":[]}'))->>'id')::uuid;
  perform public.conta_tarifa_precio_guardar(e, sl, null, null, null, 'por_trabajador', null, 26.00, null, '2027-02-01', false);
  begin
    perform public.conta_tarifa_cambio_aplicar(k2);
    raise exception 'PRUEBA G04-3 · 4: se aplica un ensayo con los precios cambiados.';
  exception when sqlstate '40001' then
    if sqlerrm not like '%vuelve a ensayar%' then raise exception 'PRUEBA G04-3 · 4: el error de la huella no dice qué hacer (%).', sqlerrm; end if;
  end;
  r := public.conta_tarifa_cambio_deshacer(k1);
  if (select hasta from public.conta_tarifa where id = t3) is not null or exists (select 1 from public.conta_precio where cambio_id = k1) then
    raise exception 'PRUEBA G04-3 · 4: deshacer no deja los precios como antes.';
  end if;
  raise notice 'G04-3 · 4: «Cambiar precios»: ensayar, aplicar lo ensayado, no dos veces, la huella y deshacer. OK';
  -- Uno aplicado y sin deshacer, para la vuelta atrás (paso 8).
  k1 := (public.conta_tarifa_cambio_ensayar(e, '{"desde":"2027-06","sentido":"subir"}', jsonb_set(v_res, '{guardar}', jsonb_build_object('acabanAntes', jsonb_build_array('tarifa:' || t3), 'nuevos', '[]'::jsonb)))->>'id')::uuid;
  perform public.conta_tarifa_cambio_aplicar(k1);
end $$;

-- 5 · «Cobrado por otra vía».
do $$
declare e uuid := (select empresa from _u); r jsonb;
begin
  if not (select mandato_activo and not cobrado_despues and otra_via is null from public.conta_consulta_cargo_devuelto where gc_id = 'PMG04PRUEBA') then
    raise exception 'PRUEBA G04-3 · 5: el cargo devuelto no sale como «te debe».';
  end if;
  begin
    perform public.conta_gc_cobro_otra_via(e, 'PMG04PRUEBA', 'bizum', '2026-10-01');
    raise exception 'PRUEBA G04-3 · 5: entra una vía que no es transferencia ni efectivo.';
  exception when sqlstate '22023' then null;
  end;
  r := public.conta_gc_cobro_otra_via(e, 'PMG04PRUEBA', 'transferencia', '2026-10-01');
  if r->>'frase' <> 'Guardado: el cargo de 108,90 € del 04/09/2026 se cobró por transferencia el 01/10/2026. Ya no sale en «Te deben». En GoCardless no cambia nada.' then
    raise exception 'PRUEBA G04-3 · 5: la frase (%).', r->>'frase';
  end if;
  if (select otra_via from public.conta_consulta_cargo_devuelto where gc_id = 'PMG04PRUEBA') <> 'transferencia' then raise exception 'PRUEBA G04-3 · 5: la vista no lo dice.'; end if;
  perform public.conta_gc_cobro_otra_via_quitar(e, 'PMG04PRUEBA');
  if (select otra_via from public.conta_consulta_cargo_devuelto where gc_id = 'PMG04PRUEBA') is not null then raise exception 'PRUEBA G04-3 · 5: quitarlo no lo quita.'; end if;
  raise notice 'G04-3 · 5: «Cobrado por otra vía», guardar y quitar. OK';
end $$;

-- 6 · La lista: una fila por cliente y empresa, sin repetir; una sin empresa para quien no tiene nada.
reset role;
do $$
declare a uuid := (select cuenta from _u); c4 uuid;
begin
  insert into public.party (account_id, name) values (a, 'Cliente Prueba G04 Cuatro') returning id into c4;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha) values (a, c4, 'baja', '{}');
  insert into _id values ('c4', c4);
end $$;
set local role authenticated;
do $$
declare e uuid := (select empresa from _u); ids uuid[] := (select array_agg(id::uuid) from _id where clave in ('c1', 'c2', 'c3', 'c4'));
begin
  if (select count(*) from public.conta_consulta_cliente_empresa where cliente_id = any(ids)) <> 4 then
    raise exception 'PRUEBA G04-3 · 6: la lista no da una fila por cliente y empresa (%).', (select count(*) from public.conta_consulta_cliente_empresa where cliente_id = any(ids));
  end if;
  if exists (select 1 from public.conta_consulta_cliente_empresa group by cliente_id, empresa_id having count(*) > 1) then
    raise exception 'PRUEBA G04-3 · 6: la lista repite un cliente con la misma empresa.';
  end if;
  if (select empresa_id from public.conta_consulta_cliente_empresa where cliente_id = (select id::uuid from _id where clave = 'c4')) is not null then
    raise exception 'PRUEBA G04-3 · 6: un cliente sin nada sale con empresa.';
  end if;
  if (select empresa_id from public.conta_consulta_cliente_empresa where cliente_id = (select id::uuid from _id where clave = 'c2')) <> e then
    raise exception 'PRUEBA G04-3 · 6: el cliente con cobro y línea no sale con su empresa.';
  end if;
  raise notice 'G04-3 · 6: la lista, una fila por cliente y empresa, sin repetir, y la de sin empresa. OK';
end $$;

-- 7 · Ajustes: «Altas y bajas a mitad de mes».
do $$
declare e uuid := (select empresa from _u); r jsonb;
begin
  r := public.conta_gestoria_ajustes_guardar(e, 'proporcional');
  if r->>'frase' <> 'Guardado: las altas y bajas a mitad de mes se cobran por los días de alta.' or (select mitad_de_mes from public.conta_gestoria_ajustes where company_id = e) <> 'proporcional' then
    raise exception 'PRUEBA G04-3 · 7: el ajuste no se guarda (%).', r;
  end if;
  begin
    perform public.conta_gestoria_ajustes_guardar(e, 'a_medias');
    raise exception 'PRUEBA G04-3 · 7: entra un ajuste que no existe.';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'G04-3 · 7: el ajuste de mitad de mes se guarda. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 8 · La vuelta atrás.
\i supabase/vuelta-atras/20261108T0930_g04_tarifa_y_clientes.down.sql
do $$
declare t3 uuid := (select id::uuid from _id where clave = 't3');
begin
  if to_regclass('public.conta_precio') is not null or to_regclass('public.conta_consulta_cliente_empresa') is not null
     or to_regprocedure('public.conta_tarifa_cambio_aplicar(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_linea' and column_name in ('nivel_id', 'alta_el', 'baja_el'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_suscripcion' and column_name like 'proximo_cobro%') then
    raise exception 'PRUEBA G04-3 · 8: la vuelta atrás deja algo de la 0930.';
  end if;
  if (select hasta from public.conta_tarifa where id = t3) is not null then raise exception 'PRUEBA G04-3 · 8: el precio importado que cerró un «Cambiar precios» no vuelve a como estaba.'; end if;
  raise notice 'G04-3 · 8: la vuelta atrás quita lo nuevo y deja lo importado como estaba. OK';
end $$;

rollback;
