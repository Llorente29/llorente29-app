-- supabase/staging/sql/20261110_g05_devuelto_pagar_prueba.sql
--
-- SOLO STAGING. La 0055 (G05 · nº 71, punto 2: un recibo devuelto desde la
-- gestoría), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 0055, dos veces.
--   2. Un cliente con un recibo devuelto por el banco en el sandbox, y quien de
--      su lado puede pagar en su espacio.
--   3. Como la persona: se puede enviar el enlace y pasarlo de nuevo; otra cuenta
--      no lo ve.
--   4. Lo que no: sin nadie con «todo», no hay enlace; con la conexión real, no se
--      pasa de nuevo; retrocedido, tampoco; pagado en el portal, ninguno.
--   5. Pasado de nuevo: el recibo y lo leído de GoCardless quedan «enviado», con
--      su evento, y «seguir» no lo vuelve a dar por devuelto; a la tercera, no más.
--   6. La vuelta atrás de la 0055, y otra vez la 0055.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 DEVUELTO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 0055, dos veces.
\i supabase/migrations/20261110T0055_g05_devuelto_pagar.sql
\i supabase/migrations/20261110T0055_g05_devuelto_pagar.sql
do $$ begin
  if to_regprocedure('public.conta_recibo_devuelto_opciones(uuid)') is null or to_regprocedure('public._conta_recibo_devuelto_hecho(uuid,text,text,jsonb,text)') is null
     or to_regprocedure('public._conta_usuario_cobra(uuid,uuid)') is null then
    raise exception 'G05 DEVUELTO · 1: falta algo de la 0055.';
  end if;
  raise notice 'G05 DEVUELTO · 1: la 0055 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado (como el servidor).
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; r uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 DEVUELTO · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Devuelto, S.L.', 'B00000952') returning id into c;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, decision, estado, entorno, mandato_gc_id, gc_cobro_id, gc_estado, enviado_at)
  values (a, e, c, '2026-11', 'recibo:' || e || ':' || c || ':2026-11', 14520, 14520, 'aprobado', 'devuelto', 'pruebas', 'MD000PRUEBA952', 'PM000PRUEBA952', 'failed', now() - interval '3 days')
  returning id into r;
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe, moneda, motivo)
  values (e, 'PM000PRUEBA952', a, 'MD000PRUEBA952', 'failed', current_date - 1, 145.20, 'EUR', 'insufficient_funds');
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso) values (a, c, 'persona.prueba.952@example.com', 'Persona Prueba', 'todo');
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso) values (a, c, 'solo.facturas.952@example.com', 'Otra Persona Prueba', 'facturas_documentos');
  insert into _g values ('e', e), ('c', c), ('r', r);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare o jsonb := public.conta_recibo_devuelto_opciones((select v::uuid from _g where clave = 'r'));
begin
  if not (o->'enlace'->>'puede')::boolean then raise exception 'G05 DEVUELTO · 3: el enlace no se puede: %', o->'enlace'; end if;
  if not (o->'pasar'->>'puede')::boolean then raise exception 'G05 DEVUELTO · 3: no se puede pasar de nuevo: %', o->'pasar'; end if;
  if jsonb_array_length(o->'personas') <> 1 or o->'personas'->0->>'para' <> 'persona.prueba.952@example.com' then
    raise exception 'G05 DEVUELTO · 3: el enlace va a quien puede pagar, y solo a esa: %', o->'personas';
  end if;
  if (o->>'importe_cent')::int <> 14520 or o->>'cliente' <> 'Cliente Prueba Devuelto, S.L.' then raise exception 'G05 DEVUELTO · 3: %', o; end if;
  raise notice 'G05 DEVUELTO · 3: como la persona, el enlace y pasarlo de nuevo. OK';
end $$;
reset role;
-- Otra cuenta (la persona de la B) no lo ve.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibo_devuelto_opciones((select v::uuid from _g where clave = 'r'));
    raise exception 'G05 DEVUELTO · 3: otra cuenta ha visto el recibo.';
  exception when sqlstate 'P0002' then raise notice 'G05 DEVUELTO · 3: otra cuenta no lo ve. OK';
  end;
end $$;
reset role;
do $$ begin
  if public._conta_usuario_cobra('c01b0000-0000-4000-8000-0000000000b1', 'c01a0000-0000-4000-8000-00000000000a')
     or not public._conta_usuario_cobra('c01a0000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'G05 DEVUELTO · 3: _conta_usuario_cobra no distingue a quien puede.';
  end if;
  raise notice 'G05 DEVUELTO · 3: el servidor solo actúa en nombre de quien puede. OK';
end $$;

-- 4 · Lo que no.
do $$
declare r uuid := (select v::uuid from _g where clave = 'r'); o jsonb;
begin
  update public.conta_portal_acceso set permiso = 'facturas_documentos' where party_id = (select v::uuid from _g where clave = 'c');
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'enlace'->>'puede')::boolean or o->'enlace'->>'porque' not like 'Nadie de este cliente%' then raise exception 'G05 DEVUELTO · 4: sin nadie con «todo»: %', o->'enlace'; end if;
  update public.conta_portal_acceso set permiso = 'todo' where correo = 'persona.prueba.952@example.com';
  update public.conta_recibo set entorno = 'real' where id = r;
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'pasar'->>'puede')::boolean or o->'pasar'->>'porque' not like '%sandbox%' then raise exception 'G05 DEVUELTO · 4: con la conexión real: %', o->'pasar'; end if;
  if not (o->'enlace'->>'puede')::boolean then raise exception 'G05 DEVUELTO · 4: el enlace sí, con la real: %', o->'enlace'; end if;
  update public.conta_recibo set entorno = 'pruebas', estado = 'retrocedido', gc_estado = 'charged_back' where id = r;
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'pasar'->>'puede')::boolean or o->'pasar'->>'porque' not like 'Lo reclamó el cliente%' then raise exception 'G05 DEVUELTO · 4: retrocedido: %', o->'pasar'; end if;
  update public.conta_recibo set estado = 'devuelto', gc_estado = 'failed' where id = r;
  update public.conta_recibo set asiento_cobro = gen_random_uuid() where id = r;
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'pasar'->>'puede')::boolean or o->'pasar'->>'porque' not like 'Ya estaba contabilizado%' then raise exception 'G05 DEVUELTO · 4: ya contabilizado: %', o->'pasar'; end if;
  update public.conta_recibo set asiento_cobro = null where id = r;
  update public.conta_recibo set estado = 'cobrado', gc_estado = 'confirmed' where id = r;
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'enlace'->>'puede')::boolean or (o->'pasar'->>'puede')::boolean then raise exception 'G05 DEVUELTO · 4: un recibo cobrado: %', o; end if;
  update public.conta_recibo set estado = 'devuelto', gc_estado = 'failed' where id = r;
  raise notice 'G05 DEVUELTO · 4: sin nadie que pueda pagar, con la real, retrocedido, contabilizado o cobrado, no. OK';
end $$;

-- 5 · Pasado de nuevo, tres veces como mucho; «seguir» no lo deshace.
do $$
declare r uuid := (select v::uuid from _g where clave = 'r'); e uuid := (select v::uuid from _g where clave = 'e'); h jsonb; o jsonb; n int;
begin
  h := public._conta_recibo_devuelto_hecho(r, 'pasado', 'pending_submission', jsonb_build_object('cargo_el', '2026-11-14'), 'Persona Prueba Gestoría');
  if h->>'estado' <> 'enviado' or h->>'frase' <> 'Pasado de nuevo en GoCardless, para el 14/11/2026.' then raise exception 'G05 DEVUELTO · 5: %', h; end if;
  if (select estado from public.conta_gc_cobro where company_id = e and gc_id = 'PM000PRUEBA952') <> 'pending_submission' then raise exception 'G05 DEVUELTO · 5: lo leído de GoCardless no ha cambiado.'; end if;
  perform public.conta_cobro_seguir(e);
  if (select estado from public.conta_recibo where id = r) <> 'enviado' then raise exception 'G05 DEVUELTO · 5: «seguir» lo ha vuelto a dar por devuelto.'; end if;
  select count(*) into n from public.conta_recibo_evento where recibo_id = r and tipo = 'pasado_de_nuevo' and quien_name = 'Persona Prueba Gestoría';
  if n <> 1 then raise exception 'G05 DEVUELTO · 5: el evento: %', n; end if;
  begin
    perform public._conta_recibo_devuelto_hecho(r, 'pasado', 'pending_submission', null, 'x');
    raise exception 'G05 DEVUELTO · 5: se ha apuntado otra vez sin estar devuelto.';
  exception when sqlstate '23514' then null;
  end;
  -- Dos devoluciones y dos reintentos más: a la tercera, no más.
  update public.conta_recibo set estado = 'devuelto', gc_estado = 'failed' where id = r;
  update public.conta_gc_cobro set estado = 'failed' where company_id = e and gc_id = 'PM000PRUEBA952';
  perform public._conta_recibo_devuelto_hecho(r, 'pasado', 'pending_submission', null, 'x');
  update public.conta_recibo set estado = 'devuelto', gc_estado = 'failed' where id = r;
  update public.conta_gc_cobro set estado = 'failed' where company_id = e and gc_id = 'PM000PRUEBA952';
  perform public._conta_recibo_devuelto_hecho(r, 'pasado', 'pending_submission', null, 'x');
  update public.conta_recibo set estado = 'devuelto', gc_estado = 'failed' where id = r;
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'pasar'->>'puede')::boolean or (o->>'veces_pasado')::int <> 3 then raise exception 'G05 DEVUELTO · 5: a la tercera: %', o->'pasar'; end if;
  h := public._conta_recibo_devuelto_hecho(r, 'enlace', null, jsonb_build_object('a', 'persona.prueba.952@example.com'), 'Persona Prueba Gestoría');
  if h->>'frase' <> 'Enviado el enlace para pagar a persona.prueba.952@example.com.' then raise exception 'G05 DEVUELTO · 5: el enlace: %', h; end if;
  -- Pagado en el portal: ni enlace ni pasarlo.
  insert into public.conta_portal_operacion (account_id, party_id, recibo_id, tipo, estado)
  values ('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'c'), r, 'pagar_tarjeta', 'hecha');
  o := public._conta_recibo_devuelto_opciones(r);
  if (o->'enlace'->>'puede')::boolean or o->'enlace'->>'porque' <> 'Ya lo ha pagado desde su espacio.' then raise exception 'G05 DEVUELTO · 5: pagado en el portal: %', o; end if;
  raise notice 'G05 DEVUELTO · 5: pasado de nuevo (y «seguir» lo respeta), tres veces como mucho; el enlace apuntado; pagado en el portal, nada. OK';
end $$;

-- 6 · La vuelta atrás, y otra vez la 0055.
\i supabase/vuelta-atras/20261110T0055_g05_devuelto_pagar.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibo_devuelto_opciones(uuid)') is not null or to_regprocedure('public._conta_usuario_cobra(uuid,uuid)') is not null then
    raise exception 'G05 DEVUELTO · 6: la vuelta atrás ha dejado algo.';
  end if;
end $$;
\i supabase/migrations/20261110T0055_g05_devuelto_pagar.sql
do $$ begin raise notice 'G05 DEVUELTO · 6: vuelta atrás y otra vez la 0055. OK'; end $$;

rollback;
