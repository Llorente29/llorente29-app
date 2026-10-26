-- supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
--
-- SOLO STAGING. Prueba de la 1835 del PC01 · E2b (el IBAN y la forma de pago
-- de las facturas recibidas), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. En la empresa A, con datos INVENTADOS que se siembra ella
-- misma (cuatro proveedores y cinco lecturas), por los CAMINOS de verdad: la
-- llegada por correo y su lectura (conta_entrada_llegada →
-- conta_factura_desde_lectura, como ocr-albaran), la remesa
-- (conta_remesa_pagos_crear), confirmar el IBAN (conta_remesa_iban_confirmar),
-- la lista de Pagos (conta_pagos_lista), «Poner IBAN»
-- (conta_proveedor_iban_poner), cambiar la ficha (supplier, disparador
-- _pc01e2_proveedor_iban_cambiado) y «Es el nuevo» del C01b
-- (supplier_invoice_iban_decide):
--
--   0. Lo de antes: las seis funciones que cambia son las de producción
--      (md5 de pg_get_functiondef medido en producción el 26/10).
--   1. El lector: un proveedor sin IBAN recibe el de su factura SIN CONFIRMAR;
--      uno con otro IBAN no cambia y la factura lo avisa; una domiciliada
--      guarda su forma de pago y no su IBAN; un IBAN que no pasa el control, o
--      que es de una cuenta nuestra, no se guarda.
--   2. Pagos y la remesa: la lista dice el distinto y el sin confirmar; la
--      remesa no admite el distinto sin decidir; el sin confirmar entra y para
--      la remesa hasta confirmarlo; confirmarlo lo deja confirmado en la ficha.
--   3. «Poner IBAN»: rechaza uno mal escrito, uno nuestro y a quien ya tiene;
--      el bueno queda con quién y cuándo. Ponerlo en la ficha, también.
--   4. «Es el nuevo»: la factura con el distinto ya entra en la remesa.
--   5. Un proveedor elegido DESPUÉS de leer la factura (supplier_id puesto a
--      mano) recibe también el IBAN sin confirmar.
--   6. La vuelta atrás: las seis funciones como en producción, sin el
--      disparador, «Poner IBAN», el módulo 97 ni las columnas nuevas.
--
-- Nombra lo que toca, para el analizador: supplier, supplier_invoice,
-- conta_factura_desde_lectura, _pc01e2_proveedor_iban_cambiado,
-- _pc01e2_iban_como_esta, conta_remesa_pagos_crear,
-- conta_remesa_iban_confirmar, conta_pagos_lista.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 E2b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 1835 se puede haber pasado ya de verdad desde la rama: primero su vuelta atrás.
\i supabase/vuelta-atras/20261026T1835_pc01e2b_iban_de_las_facturas.down.sql

-- ── 0 · Lo de antes es producción ───────────────────────────────────────────
do $$
declare r record; v_mal text := '';
begin
  for r in select * from (values
      ('conta_factura_desde_lectura(uuid,uuid)', '2279355e38145dd73f902a03e92e2808'),
      ('_pc01e2_iban_como_esta(uuid,text)', 'f0296a5809ca955149a68a924daccf27'),
      ('_pc01e2_proveedor_iban_cambiado()', '7f425beb5411a47bbdfe9c1c2201eaea'),
      ('conta_remesa_pagos_crear(uuid,uuid,date,jsonb)', '97c8712b380de46a8f39eb6e93193c62'),
      ('conta_remesa_iban_confirmar(uuid)', '7892fb85f132dd1271c490d6609fbc31'),
      ('conta_pagos_lista(uuid,date)', 'f0385838d4fdf0e733460db4aec0b335')) as x(f, md5) loop
    if md5(pg_get_functiondef(('public.' || r.f)::regprocedure)) <> r.md5 then v_mal := v_mal || ' ' || r.f; end if;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA PC01 E2b · 0: no son las de producción:%', v_mal; end if;
  raise notice '0 · las seis funciones de antes son las de producción';
end $$;

\i supabase/migrations/20261026T1835_pc01e2b_iban_de_las_facturas.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, service_role;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('banco', 'b0100000-0000-4000-8000-0000000000b3');

-- ── Siembra (como el dueño): cuatro proveedores con su 400 y cinco lecturas ──
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        s uuid; i int := 0; v_s uuid; k text;
        lect jsonb := '{"factura":{"proveedor":{"nombre":"X","nif":"X"},"numero":"X","fecha":"2026-10-20","vencimiento":"2026-11-20","clase":"completa","tipos":[{"tipo":21,"base":100,"cuota":21,"recargoTipo":null,"recargo":0}],"base":100,"cuota":21,"recargo":0,"retencion":null,"total":121,"iban":null,"forma":null},"comprobaciones":[],"confianza":"seguro","porque":["Prueba E2b."]}';
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'E2b Sin IBAN', 'E2b Sin IBAN SL', 'B00000611', true) returning id into s; insert into _p values ('p1', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, iban) values (a, 'E2b Con IBAN', 'E2b Con IBAN SL', 'B00000612', true, 'ES1720852066623456789011') returning id into s; insert into _p values ('p2', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'E2b Domiciliado', 'E2b Domiciliado SL', 'B00000613', true) returning id into s; insert into _p values ('p3', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'E2b Para poner', 'E2b Para poner SL', 'B00000614', true) returning id into s; insert into _p values ('p4', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'E2b Elegido después', 'E2b Elegido después SL', 'B00000615', true) returning id into s; insert into _p values ('p5', s);
  foreach k in array array['p1', 'p2', 'p3', 'p4', 'p5'] loop
    i := i + 1;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select a, e, ca.plan, '4000981' || i, ca.template_code, 'Proveedores · E2b ' || i, ca.kind, ca.source
      from public.company_account ca where ca.company_id = e and ca.code = '40000001';
    if not found then raise exception 'PRUEBA PC01 E2b · siembra: la empresa A no tiene la 40000001 de molde.'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'supplier', (select v from _p where clave = k), 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4000981' || i;
  end loop;
  -- Las lecturas que dejaría ocr-albaran (modo factura): (clave, NIF, número, IBAN leído, forma leída).
  for k, i in select * from (values ('s1', 1), ('s2', 2), ('s3', 3), ('s4', 4), ('s5', 5), ('s6', 6)) x loop
    insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
    values (a, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura',
      jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(lect,
        '{factura,proveedor,nif}', to_jsonb((array['B00000611', 'B00000612', 'B00000613', 'B00000614', 'B00000614', 'B00000615'])[i])),
        '{factura,proveedor,nombre}', to_jsonb((array['E2b Sin IBAN SL', 'E2b Con IBAN SL', 'E2b Domiciliado SL', 'E2b Para poner SL', 'E2b Para poner SL', 'E2b Elegido después SL'])[i])),
        '{factura,numero}', to_jsonb('E2B-' || i)),
        '{factura,iban}', to_jsonb((array['ES7921000813610123456789', 'ES6621000418401234567891', 'ES6000491500051234567892', 'ES0021000418450200051332', 'ES9121000418450200051332', 'ES6000491500051234567892'])[i])),
        '{factura,forma}', coalesce(to_jsonb((array['transfer', null, 'direct_debit', null, null, 'transfer'])[i]), 'null'::jsonb)),
        '{factura,total}', '121')), 'prueba', 'pending_review') returning id into v_s;
    insert into _p values (k, v_s);
  end loop;
end $$;

-- ── 1 · El lector, como la función de correo (service_role) ─────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        l jsonb; r jsonb; i int; f public.supplier_invoice; p public.supplier;
begin
  for i in 1..5 loop
    l := public.conta_entrada_llegada(jsonb_build_object('account_id', a, 'company_id', e, 'email_id', 'prueba-e2b-' || i, 'to', 'facturas-prueba-e2b@entrada.folvy.app',
           'ruta', a::text || '/_correo/prueba-e2b-' || i || '/01.pdf', 'nombre', 'factura.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', repeat(lpad(i::text, 2, 'b'), 32)));
    r := public.conta_factura_desde_lectura((l->>'id')::uuid, (select v::uuid from _p where clave = 's' || i));
    if r->>'estado' <> 'factura' then raise exception 'PRUEBA PC01 E2b · 1: la lectura % no dio factura: %', i, r; end if;
    insert into _p values ('f' || i, r->>'factura_id');
  end loop;

  -- 1a · Sin IBAN: se lo pongo, sin confirmar, y lo digo.
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f1');
  select * into p from public.supplier where id = (select v::uuid from _p where clave = 'p1');
  if f.read_iban is distinct from 'ES7921000813610123456789' or f.payment_method is distinct from 'transfer'
     or p.iban is distinct from 'ES7921000813610123456789' or p.iban_unconfirmed_invoice_id is distinct from f.id or p.iban_set_by_name is distinct from 'Sumied' or p.iban_set_at is null
     or not exists (select 1 from public.document_activity d where d.supplier_invoice_id = f.id and d.action = 'corregida' and (d.detail->>'iban_puesto')::boolean) then
    raise exception 'PRUEBA PC01 E2b · 1a: el proveedor sin IBAN no lo recibió sin confirmar (factura %/%, ficha %/%/%).', f.read_iban, f.payment_method, p.iban, p.iban_unconfirmed_invoice_id, p.iban_set_by_name;
  end if;
  -- 1b · Con otro IBAN: la ficha no cambia y la factura lo avisa.
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f2');
  select * into p from public.supplier where id = (select v::uuid from _p where clave = 'p2');
  if f.read_iban is distinct from 'ES6621000418401234567891' or f.payment_method is not null or p.iban <> 'ES1720852066623456789011' or p.iban_unconfirmed_invoice_id is not null
     or not exists (select 1 from public.document_activity d where d.supplier_invoice_id = f.id and (d.detail->>'iban_distinto')::boolean
                     and d.text = 'Esta factura trae otro IBAN (···· 7891) que el de la ficha de E2b Con IBAN (···· 9011). No se paga hasta que alguien decida si es el nuevo.') then
    raise exception 'PRUEBA PC01 E2b · 1b: el IBAN distinto no quedó como aviso (factura %, ficha %).', f.read_iban, p.iban;
  end if;
  -- 1c · Domiciliada: guarda su forma de pago, no su IBAN (suele ser el nuestro), y no toca la ficha.
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f3');
  if f.read_iban is not null or f.payment_method is distinct from 'direct_debit' or (select iban from public.supplier where id = (select v::uuid from _p where clave = 'p3')) is not null then
    raise exception 'PRUEBA PC01 E2b · 1c: la domiciliada guardó % / %.', f.read_iban, f.payment_method;
  end if;
  -- 1d · Un IBAN que no pasa el control, y uno que es de una cuenta nuestra: ni a la factura ni a la ficha.
  if (select read_iban from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f4')) is not null
     or (select read_iban from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f5')) is not null
     or (select iban from public.supplier where id = (select v::uuid from _p where clave = 'p4')) is not null then
    raise exception 'PRUEBA PC01 E2b · 1d: un IBAN mal escrito o nuestro se guardó.';
  end if;
  raise notice '1 · el lector: sin IBAN → sin confirmar; otro → aviso; domiciliada → su forma; mal escrito o nuestro → nada';
end $$;
reset role;

-- ── 2 · Pagos y la remesa (como el administrador de A) ──────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _p where clave in ('f1', 'f2', 'f3'));
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco');
        x jsonb; v_err text; fila jsonb; v_l public.conta_pago_remesa_linea;
begin
  x := public.conta_pagos_lista(e, public.conta_hoy());
  select r into fila from jsonb_array_elements(x->'filas') r where r->>'id' = (select v from _p where clave = 'f2');
  if (fila->>'iban_distinto')::boolean is not true or fila->>'iban_leido4' <> '7891' then raise exception 'PRUEBA PC01 E2b · 2: la lista no dice el IBAN distinto: %', fila; end if;
  select r into fila from jsonb_array_elements(x->'filas') r where r->>'id' = (select v from _p where clave = 'f1');
  if (fila->>'iban_sin_confirmar')::boolean is not true or (fila->>'con_iban')::boolean is not true or (fila->>'iban_distinto')::boolean then raise exception 'PRUEBA PC01 E2b · 2: la lista no dice el sin confirmar: %', fila; end if;
  select r into fila from jsonb_array_elements(x->'filas') r where r->>'id' = (select v from _p where clave = 'f3');
  if fila->>'forma' <> 'direct_debit' then raise exception 'PRUEBA PC01 E2b · 2: la domiciliada no sale domiciliada en la lista: %', fila; end if;

  begin perform public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f2'))));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'La factura E2B-2 trae otro IBAN (···· 7891) que el de la ficha de E2b Con IBAN (···· 9011): decide en su ficha si es el nuevo antes de pagarla.' then
    raise exception 'PRUEBA PC01 E2b · 2: el IBAN distinto sin decidir dijo «%».', v_err;
  end if;

  x := public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f1'))));
  if (x->>'por_confirmar')::int <> 1 then raise exception 'PRUEBA PC01 E2b · 2: el IBAN sin confirmar no para la remesa: %', x; end if;
  select * into v_l from public.conta_pago_remesa_linea where remesa_id = (x->>'remesa')::uuid;
  if v_l.iban_check <> 'cambiado' or v_l.iban_note <> 'Sin confirmar: lo leí de la factura E2B-1 el ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM') || '.' then
    raise exception 'PRUEBA PC01 E2b · 2: la línea quedó % «%».', v_l.iban_check, v_l.iban_note;
  end if;
  v_err := null;
  begin perform public.conta_remesa_fichero_datos((x->>'remesa')::uuid); exception when others then v_err := sqlerrm; end;
  if v_err not like 'Antes de descargar el fichero, confirma el IBAN%' then raise exception 'PRUEBA PC01 E2b · 2: el fichero con el IBAN sin confirmar dijo «%».', v_err; end if;

  perform public.conta_remesa_iban_confirmar(v_l.id);
  if (select iban_unconfirmed_invoice_id from public.supplier where id = (select v::uuid from _p where clave = 'p1')) is not null then
    raise exception 'PRUEBA PC01 E2b · 2: confirmarlo en la remesa no lo dejó confirmado en la ficha.';
  end if;
  perform public.conta_remesa_fichero_datos((x->>'remesa')::uuid);
  raise notice '2 · %  → confirmado en la ficha y el fichero ya sale', x->>'frase';
end $$;

-- ── 3 · «Poner IBAN» ─────────────────────────────────────────────────────────
do $$
declare p uuid := (select v::uuid from _p where clave = 'p4'); x jsonb; v_err text; s public.supplier;
begin
  begin perform public.conta_proveedor_iban_poner(p, 'ES00 2100 0418 4502 0005 1332'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Ese IBAN no es correcto: revisa los dígitos.' then raise exception 'PRUEBA PC01 E2b · 3: uno mal escrito dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_proveedor_iban_poner(p, 'ES64 0182 9103 2100 0000 0013'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Ese IBAN es de una cuenta vuestra, no de E2b Para poner.' then raise exception 'PRUEBA PC01 E2b · 3: uno nuestro dijo «%».', v_err; end if;
  x := public.conta_proveedor_iban_poner(p, 'es10 0049-2352 0824 1420 5416');
  select * into s from public.supplier where id = p;
  if s.iban <> 'ES1000492352082414205416' or s.iban_set_by <> 'c01a0000-0000-4000-8000-0000000000a1' or s.iban_set_by_name is null or s.iban_set_at is null
     or x->>'frase' not like 'IBAN de E2b Para poner puesto (···· 5416). Queda apuntado: %, el __/__ a las __:__.' then
    raise exception 'PRUEBA PC01 E2b · 3: «Poner IBAN» dejó % (% / %) y dijo «%».', s.iban, s.iban_set_by, s.iban_set_by_name, x->>'frase';
  end if;
  v_err := null;
  begin perform public.conta_proveedor_iban_poner(p, 'ES7921000813610123456789'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'E2b Para poner ya tiene IBAN (···· 5416): para cambiarlo, ve a su ficha.' then raise exception 'PRUEBA PC01 E2b · 3: poner sobre uno que ya tiene dijo «%».', v_err; end if;
  -- En la ficha, a mano (como Contactos): el disparador del E2 apunta quién.
  update public.supplier set iban = 'DE89370400440532013000' where id = (select v::uuid from _p where clave = 'p3');
  select * into s from public.supplier where id = (select v::uuid from _p where clave = 'p3');
  if s.iban_set_by is distinct from 'c01a0000-0000-4000-8000-0000000000a1' or s.iban_set_at is null or s.iban_changed_at is not null then
    raise exception 'PRUEBA PC01 E2b · 3: poner el IBAN en la ficha no apuntó quién (% / %).', s.iban_set_by, s.iban_changed_at;
  end if;
  raise notice '3 · %', x->>'frase';
end $$;

-- ── 4 · «Es el nuevo»: la del IBAN distinto ya entra (y se confirma por haber cambiado) ──
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco'); x jsonb;
begin
  perform public.supplier_invoice_iban_decide((select v::uuid from _p where clave = 'f2'), 'es_el_nuevo', 'Prueba E2b');
  x := public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f2'))));
  if (x->>'por_confirmar')::int <> 1 or (select iban from public.conta_pago_remesa_linea where remesa_id = (x->>'remesa')::uuid) <> 'ES6621000418401234567891' then
    raise exception 'PRUEBA PC01 E2b · 4: después de «Es el nuevo» la remesa quedó %.', x;
  end if;
  raise notice '4 · «Es el nuevo» → %', x->>'frase';
end $$;
reset role;

-- ── 5 · El proveedor elegido después de leer la factura ─────────────────────
-- La lectura 6 no encuentra proveedor (se le quita el NIF a la ficha antes de leer) y se elige a mano.
update public.supplier set tax_id = null where id = (select v::uuid from _p where clave = 'p5');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa'); l jsonb; r jsonb; v_f uuid;
begin
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', a, 'company_id', e, 'email_id', 'prueba-e2b-6', 'to', 'facturas-prueba-e2b@entrada.folvy.app',
         'ruta', a::text || '/_correo/prueba-e2b-6/01.pdf', 'nombre', 'factura.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', repeat('b6', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, (select v::uuid from _p where clave = 's6'));
  v_f := (r->>'factura_id')::uuid;
  if (select supplier_id from public.supplier_invoice where id = v_f) is not null or (select read_iban from public.supplier_invoice where id = v_f) <> 'ES6000491500051234567892' then
    raise exception 'PRUEBA PC01 E2b · 5: la factura sin proveedor quedó %.', r;
  end if;
  update public.supplier_invoice set supplier_id = (select v::uuid from _p where clave = 'p5') where id = v_f;
  if (select iban from public.supplier where id = (select v::uuid from _p where clave = 'p5')) is distinct from 'ES6000491500051234567892'
     or (select iban_unconfirmed_invoice_id from public.supplier where id = (select v::uuid from _p where clave = 'p5')) is distinct from v_f then
    raise exception 'PRUEBA PC01 E2b · 5: el proveedor elegido después no recibió el IBAN sin confirmar.';
  end if;
  raise notice '5 · elegido después: recibe el IBAN de la factura, sin confirmar';
end $$;
reset role;

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T1835_pc01e2b_iban_de_las_facturas.down.sql
do $$
declare r record; v_mal text := '';
begin
  for r in select * from (values
      ('conta_factura_desde_lectura(uuid,uuid)', '2279355e38145dd73f902a03e92e2808'),
      ('_pc01e2_iban_como_esta(uuid,text)', 'f0296a5809ca955149a68a924daccf27'),
      ('_pc01e2_proveedor_iban_cambiado()', '7f425beb5411a47bbdfe9c1c2201eaea'),
      ('conta_remesa_pagos_crear(uuid,uuid,date,jsonb)', '97c8712b380de46a8f39eb6e93193c62'),
      ('conta_remesa_iban_confirmar(uuid)', '7892fb85f132dd1271c490d6609fbc31'),
      ('conta_pagos_lista(uuid,date)', 'f0385838d4fdf0e733460db4aec0b335')) as x(f, md5) loop
    if md5(pg_get_functiondef(('public.' || r.f)::regprocedure)) <> r.md5 then v_mal := v_mal || ' ' || r.f; end if;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA PC01 E2b · 6: la vuelta atrás no deja como en producción:%', v_mal; end if;
  if exists (select 1 from pg_trigger where tgname = 'pc01e2b_iban_de_la_factura')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like '_pc01e2b%' or proname = 'conta_proveedor_iban_poner'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier'
                  and column_name in ('iban_set_at', 'iban_set_by', 'iban_set_by_name', 'iban_unconfirmed_invoice_id')) then
    raise exception 'PRUEBA PC01 E2b · 6: la vuelta atrás deja algo de la E2b.';
  end if;
  raise notice '6 · la vuelta atrás: las seis como en producción, sin nada de la E2b';
end $$;
rollback;
