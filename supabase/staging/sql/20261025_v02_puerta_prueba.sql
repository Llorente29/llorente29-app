-- supabase/staging/sql/20261025_v02_puerta_prueba.sql
--
-- SOLO STAGING. Prueba de 20261025T1212_v02_puerta (cambia:
-- public.company_inbound_address, public.supplier_expected_invoice,
-- public.supplier_invoice_request, public.company_inbound_sender,
-- public.document_inbox, public.conta_direccion_entrada y
-- public.conta_entrada_remitente), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A.
--
--   (Empieza con su vuelta atrás, por si ya estuviera.)
--   0. Lo de antes: la huella de las dos funciones que cambian.
--   1. La dirección de documentos: «<empresa>@entrada.folvy.app», sin prefijo;
--      la de facturas sigue con el suyo; pedirla dos veces no crea otra.
--   2. Las fuentes: proponer (corre aunque staging tenga pocas); guardar una
--      de proveedor, una de riders sin proveedor (quincenal) y la de un banco;
--      sus llegadas; apagar una; el margen de la empresa.
--   3. Un documento por correo sin saber qué es: «Dime qué es», recordando el
--      remitente; el servidor ya no lo pisa; el remitente se sabe.
--   4. La puerta: la dirección, lo conectado y lo último, con ese documento.
--   5. «Pedírsela» a la fuente de riders (sin proveedor): una vez por mes.
--   6. La vuelta atrás: sin el trabajo de la prueba, deja las funciones como
--      estaban y quita lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V02: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261025T1212_v02_puerta.down.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p select 'fn:' || p.proname, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('conta_direccion_entrada', 'conta_entrada_remitente');

do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA V02: la cuenta A no tiene empresa.'; end if;
  insert into _p values ('empresa', v_e::text), ('cuenta', v_acc::text);
  insert into _p select 'proveedor', id::text from public.supplier where account_id = v_acc order by created_at limit 1;
  insert into _p select 'tesoreria', id::text from public.treasury_account where company_id = v_e order by created_at limit 1;
  if (select v from _p where clave = 'proveedor') is null then raise exception 'PRUEBA V02: la cuenta A no tiene ningún proveedor.'; end if;
end $$;

\i supabase/migrations/20261025T1212_v02_puerta.sql

-- 1 a 5 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa');
  v_sup uuid := (select v::uuid from _p where clave = 'proveedor');
  v_tes uuid := (select v::uuid from _p where clave = 'tesoreria');
  r jsonb; r2 jsonb; v_riders uuid; v_prov uuid; v_banco uuid; v_f jsonb; v_n int;
begin
  -- 1 · La dirección.
  r := public.conta_direccion_entrada(v_e, 'documentos', 'Prueba V02');
  if r->>'direccion' !~ '^[a-z0-9][a-z0-9-]+@entrada\.folvy\.app$' or r->>'local_part' like 'documentos-%' then
    raise exception 'PRUEBA V02 · 1: la dirección de documentos no es «<empresa>@entrada.folvy.app»: %.', r->>'direccion';
  end if;
  r2 := public.conta_direccion_entrada(v_e, 'documentos', 'Prueba V02');
  if (r2->>'ya_estaba')::boolean is not true or r2->>'direccion' <> r->>'direccion' then raise exception 'PRUEBA V02 · 1: pedirla dos veces crea otra.'; end if;
  r2 := public.conta_direccion_entrada(v_e, 'facturas', 'Prueba V02');
  if r2->>'local_part' not like 'facturas-%' then raise exception 'PRUEBA V02 · 1: la de facturas ya no lleva su prefijo (%).', r2->>'local_part'; end if;
  insert into _p values ('direccion', r->>'direccion');
  raise notice '1 · la dirección: % (la de facturas sigue con su prefijo)', r->>'direccion';

  -- 2 · Las fuentes.
  r := public.conta_puerta_fuentes_proponer(v_e);
  if jsonb_typeof(r) <> 'array' then raise exception 'PRUEBA V02 · 2: proponer no da una lista.'; end if;
  r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('tipo', 'proveedor', 'nombre', 'Luz de prueba', 'proveedor_id', v_sup, 'cadencia', 'mensual', 'dia', 16, 'margen', 7), 'Prueba V02');
  v_prov := (r->>'id')::uuid;
  r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('clave', 'riders', 'tipo', 'riders', 'nombre', 'Riders de Catcher', 'cadencia', 'quincenal', 'numero_prefijo', 'ES I'), 'Prueba V02');
  v_riders := (r->>'id')::uuid;
  if (r->>'nueva')::boolean is not true then raise exception 'PRUEBA V02 · 2: la fuente de riders no es nueva.'; end if;
  r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('clave', 'riders', 'tipo', 'riders', 'nombre', 'Riders de Catcher', 'cadencia', 'quincenal', 'margen', 5), 'Prueba V02');
  if (r->>'id')::uuid <> v_riders or (r->>'nueva')::boolean then raise exception 'PRUEBA V02 · 2: guardar la misma clave crea otra fuente.'; end if;
  if v_tes is not null then
    r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('clave', 'banco:' || v_tes, 'tipo', 'banco', 'nombre', 'Extracto', 'cadencia', 'semanal', 'tesoreria', v_tes), 'Prueba V02');
    v_banco := (r->>'id')::uuid;
  end if;
  r := public.conta_puerta_fuentes(v_e);
  select count(*) into v_n from jsonb_array_elements(r->'fuentes') f where jsonb_typeof(f->'llegadas') = 'array';
  if v_n < 2 then raise exception 'PRUEBA V02 · 2: las fuentes no salen con sus llegadas (%).', r; end if;
  select f into v_f from jsonb_array_elements(r->'fuentes') f where (f->>'id')::uuid = v_riders;
  if v_f->>'proveedor_id' is not null or v_f->>'cadencia' <> 'quincenal' or (v_f->>'margen')::int <> 5 then
    raise exception 'PRUEBA V02 · 2: la fuente de riders no es la guardada: %.', v_f;
  end if;
  r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('id', v_prov, 'activa', false), 'Prueba V02');
  if (r->>'activa')::boolean or r->>'texto' not like 'Apagado:%' then raise exception 'PRUEBA V02 · 2: apagar una fuente no la apaga (%).', r; end if;
  r := public.conta_puerta_ajustes_poner(v_e, true, 4::smallint, 'Prueba V02');
  if ((public.conta_puerta_fuentes(v_e))->'ajustes'->>'margen')::int <> 4 then raise exception 'PRUEBA V02 · 2: el margen de la empresa no queda.'; end if;
  insert into _p values ('riders', v_riders::text);
  raise notice '2 · las fuentes: proveedor, riders sin proveedor y banco, con sus llegadas; apagar y el margen';
end $$;
reset role;

-- 3 · Un documento sin saber qué es (llega por correo: lo apunta el servidor).
do $$
declare v_e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb;
begin
  r := public.conta_entrada_llegada(jsonb_build_object('account_id', (select v from _p where clave = 'cuenta'), 'company_id', v_e, 'canal', 'correo',
    'email_id', 'prueba-v02-1', 'to', (select v from _p where clave = 'direccion'), 'from', 'Gestoría Prueba <nominas@gestoria-prueba.test>',
    'subject', 'Documentación del mes', 'ruta', (select v from _p where clave = 'cuenta') || '/_correo/prueba-v02-1/01-doc.pdf', 'nombre', '01-doc.pdf',
    'tipo', 'application/pdf', 'bytes', 2048, 'sha256', repeat('e', 64)));
  insert into _p values ('inbox', r->>'id');
end $$;
set local role authenticated;
do $$
declare v_i uuid := (select v::uuid from _p where clave = 'inbox'); r jsonb;
begin
  r := public.conta_puerta_dime_que_es(v_i, 'nomina', true, 'Prueba V02');
  if (r->>'recordado')::boolean is not true or r->>'texto' not like 'Apuntado: es una nómina.%' then raise exception 'PRUEBA V02 · 3: «Dime qué es» no lo dice o no lo recuerda (%).', r; end if;
  begin
    perform public.conta_puerta_dime_que_es(v_i, 'cosa', false, 'Prueba V02');
    raise exception 'PRUEBA V02 · 3: un tipo que no existe se ha guardado.';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
do $$
declare v_i uuid := (select v::uuid from _p where clave = 'inbox'); v_e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb;
begin
  perform public.conta_entrada_tipo(v_i, 'factura', 'lectura');
  if (select doc_kind from public.document_inbox where id = v_i) <> 'nomina' then raise exception 'PRUEBA V02 · 3: el servidor pisa lo que dijo la persona.'; end if;
  r := public.conta_entrada_remitente(v_e, 'Otra firma <NOMINAS@gestoria-prueba.test>');
  if r->>'decision' <> 'tipo' or r->>'tipo' <> 'nomina' then raise exception 'PRUEBA V02 · 3: el remitente no se recuerda (%).', r; end if;
  raise notice '3 · «Dime qué es»: nómina, recordada por su remitente, y el servidor no la pisa';
end $$;

-- 4 y 5 · Como usuario de A.
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_r uuid := (select v::uuid from _p where clave = 'riders'); r jsonb;
begin
  r := public.conta_puerta(v_e, 30);
  if not exists (select 1 from jsonb_array_elements(r->'direcciones') d where d->>'tipo' = 'documentos') then raise exception 'PRUEBA V02 · 4: la puerta no da su dirección.'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'ultimos') u where u->>'id' = (select v from _p where clave = 'inbox') and u->>'que' = 'nomina' and u->>'donde' = 'laboral') then
    raise exception 'PRUEBA V02 · 4: lo último no trae el documento con lo que es y dónde va (%).', r->'ultimos';
  end if;
  raise notice '4 · la puerta: su dirección y lo último, con qué es y dónde va';

  r := public.conta_puerta_pedir(v_r, current_date, 'riders@catcher.test', 'Facturas de los riders', 'Hola…', 'Prueba V02');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA V02 · 5: la primera petición sale como repetida.'; end if;
  r := public.conta_puerta_pedir(v_r, current_date, 'riders@catcher.test', 'Facturas de los riders', 'Hola…', 'Prueba V02');
  if (r->>'ya_estaba')::boolean is not true then raise exception 'PRUEBA V02 · 5: pedirla dos veces el mismo mes crea otra.'; end if;
  raise notice '5 · «Pedírsela» a una fuente sin proveedor, una vez por mes';
end $$;
reset role;

-- 6 · La vuelta atrás: sin el trabajo de la prueba (su guarda para si lo hay), todo como estaba.
delete from public.supplier_invoice_request where expected_id in (select id from public.supplier_expected_invoice where company_id = (select v::uuid from _p where clave = 'empresa'));
delete from public.supplier_expected_invoice where company_id = (select v::uuid from _p where clave = 'empresa');
delete from public.company_inbound_sender where decision = 'tipo';
delete from public.company_inbound_address where kind = 'documentos';
\i supabase/vuelta-atras/20261025T1212_v02_puerta.down.sql
do $$ begin
  if exists (select 1 from _p b join pg_proc p on 'fn:' || p.proname = b.clave join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) <> b.v) then
    raise exception 'PRUEBA V02 · 6: conta_direccion_entrada o conta_entrada_remitente no vuelven como estaban.';
  end if;
  if to_regprocedure('public.conta_puerta(uuid,integer)') is not null or to_regclass('public.conta_puerta_ajustes') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name = 'doc_kind') then
    raise exception 'PRUEBA V02 · 6: la vuelta atrás se deja funciones, tablas o columnas.';
  end if;
  raise notice '6 · la vuelta atrás: todo como estaba';
  raise notice 'PRUEBA V02 en verde: la dirección, las fuentes, «Dime qué es», la puerta, «Pedírsela» y la vuelta atrás.';
end $$;

rollback;
