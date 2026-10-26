-- supabase/staging/sql/20261026_pc01e2_remesas_prueba.sql
--
-- SOLO STAGING. Prueba de la 0915 del PC01 · E2 (Compras › Pagos), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A, con
-- datos INVENTADOS que se siembra ella misma (cuatro proveedores y sus
-- facturas), como su usuario administrador:
--
--   1. Lo que no entra en una remesa, y por qué: domiciliada, sin IBAN, un
--      importe que se pasa.
--   2. Pagar seleccionadas: la remesa, con el IBAN recién cambiado por
--      confirmar (no se puede descargar el fichero hasta confirmarlo).
--   3. Confirmar el IBAN; los datos del fichero; la lista de Pagos con su remesa.
--   4. Descargado: ya no se saca; un pago rechazado vuelve a «Por pagar».
--   5. El cargo del banco: casarlo con la remesa deja las facturas pagadas con
--      un asiento (400 de cada proveedor contra la 572); deshacerlo lo devuelve.
--   6. Antifraude: otro IBAN que no coincide con el de los pagos anteriores.
--   7. «Ya la he pagado»: un pago a mano parcial, casado uno a uno.
--   8. «Ponerles vencimiento»: el plazo que se pregunta va a la ficha.
--   9. La vuelta atrás: sin tablas, funciones, vistas ni disparador del E2.
--
-- Nombra lo que toca, para el analizador: conta_pago_remesa,
-- conta_pago_remesa_linea, conta_pago_remesa_evento, supplier (disparador
-- pc01e2_proveedor_iban_cambiado), bank_casar, mark_supplier_invoice_paid.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 E2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 0915 solo añade: el ensayo de la rama puede haberla pasado ya de verdad (W05).
-- Primero su vuelta atrás, y desde ahí lo de antes es producción.
\i supabase/vuelta-atras/20261026T0915_pc01e2_remesas_de_pagos.down.sql
do $$ begin
  if to_regclass('public.conta_pago_remesa') is not null or exists (select 1 from pg_proc where proname like 'conta_remesa%' and pronamespace = 'public'::regnamespace) then
    raise exception 'PRUEBA PC01 E2 · 0: la vuelta atrás no deja staging sin el E2.';
  end if;
end $$;
\i supabase/migrations/20261026T0915_pc01e2_remesas_de_pagos.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('banco', 'b0100000-0000-4000-8000-0000000000b3');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        sa uuid; sb uuid; sc uuid; sd uuid; se uuid; f uuid; i int; s uuid; c text;
begin
  insert into public.supplier (account_id, name, legal_name, iban, payment_terms_days) values (a, 'Proveedor E2 Alfa', 'Alfa Distribuciones Prueba SL', 'ES9121000418450200051332', 30) returning id into sa;
  insert into public.supplier (account_id, name, iban) values (a, 'Proveedor E2 Beta', 'ES7921000813610123456789') returning id into sb;
  insert into public.supplier (account_id, name, iban, payment_method) values (a, 'Proveedor E2 Domiciliado', 'ES6000491500051234567892', 'direct_debit') returning id into sc;
  insert into public.supplier (account_id, name) values (a, 'Proveedor E2 Sin IBAN') returning id into sd;
  insert into public.supplier (account_id, name, iban) values (a, 'Proveedor E2 Sin plazo', 'ES1720852066623456789011') returning id into se;
  insert into _p values ('sa', sa), ('sb', sb), ('sc', sc), ('sd', sd), ('se', se);
  -- Cada uno con su 400 (las de la siembra de A).
  i := 0;
  foreach s in array array[sa, sb, sc, sd, se] loop
    i := i + 1;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4000000' || i;
    if not found then raise exception 'PRUEBA PC01 E2 · siembra: falta la 4000000%.', i; end if;
  end loop;
  -- Beta cambia de IBAN en su ficha: el disparador nuevo lo apunta.
  update public.supplier set iban = 'ES6621000418401234567891' where id = sb;
  if (select iban_changed_at from public.supplier where id = sb) is null or (select iban_previous from public.supplier where id = sb) <> 'ES7921000813610123456789' then
    raise exception 'PRUEBA PC01 E2 · siembra: cambiar el IBAN en la ficha no apuntó cuándo ni el de antes.';
  end if;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, sa, 'E2-A1', '2026-10-01', 100.00, 'en_revision'), (a, e, sa, 'E2-A2', '2026-10-02', 50.00, 'en_revision'),
    (a, e, sb, 'E2-B1', '2026-10-03', 200.00, 'en_revision'), (a, e, sc, 'E2-C1', '2026-10-04', 30.00, 'en_revision'),
    (a, e, sd, 'E2-D1', '2026-10-05', 40.00, 'en_revision'), (a, e, se, 'E2-E1', '2026-10-06', 60.00, 'en_revision');
  for f, c in select id, invoice_number from public.supplier_invoice where account_id = a and invoice_number like 'E2-__' and supplier_id in (sa, sb, sc, sd, se) loop
    insert into _p values (lower(replace(c, 'E2-', 'r')), f);
  end loop;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _p where clave in ('ra1', 'ra2', 'rb1', 'rc1', 'rd1', 're1'));

-- ── 1 · Lo que no entra en una remesa ───────────────────────────────────────
do $$
declare v_err text; e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco');
begin
  begin perform public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'rc1'))));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura E2-C1 de Proveedor E2 Domiciliado no se paga por remesa: la paga el banco solo (domiciliada).' then raise exception 'PRUEBA PC01 E2 · 1: domiciliada dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'rd1'))));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'Proveedor E2 Sin IBAN no tiene IBAN en su ficha%' then raise exception 'PRUEBA PC01 E2 · 1: sin IBAN dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'ra1'), 'importe', 150)));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura E2-A1 tiene pendientes 100,00 € sin remesa: no se le pueden pagar 150,00 €.' then raise exception 'PRUEBA PC01 E2 · 1: pasarse dijo «%».', v_err; end if;
  if exists (select 1 from public.conta_pago_remesa_linea l join public.supplier_invoice si on si.id = l.invoice_id where si.invoice_number like 'E2-%' and si.company_id = e) then
    raise exception 'PRUEBA PC01 E2 · 1: un intento fallido dejó una remesa a medias.';
  end if;
  raise notice '1 · no entran: domiciliada, sin IBAN y un importe que se pasa (y no queda nada a medias)';
end $$;

-- ── 2 · Pagar seleccionadas ─────────────────────────────────────────────────
do $$
declare x jsonb; v_err text; e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco'); r public.conta_pago_remesa_estado;
begin
  x := public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(
    jsonb_build_object('id', (select v from _p where clave = 'ra1')), jsonb_build_object('id', (select v from _p where clave = 'ra2')),
    jsonb_build_object('id', (select v from _p where clave = 'rb1'))));
  insert into _p values ('remesa', x->>'remesa');
  if x->>'frase' not like 'Remesa R-____/___ preparada: 3 pagos, 350,00 €. Antes de descargar el fichero, confirma 1 IBAN que ha cambiado.' then
    raise exception 'PRUEBA PC01 E2 · 2: la frase fue «%».', x->>'frase';
  end if;
  select * into r from public.conta_pago_remesa_estado where id = (x->>'remesa')::uuid;
  if r.estado <> 'preparada' or r.por_confirmar <> 1 or r.total <> 350 then raise exception 'PRUEBA PC01 E2 · 2: la remesa quedó % (% por confirmar, total %).', r.estado, r.por_confirmar, r.total; end if;
  if (select iban_check from public.conta_pago_remesa_linea where remesa_id = r.id and invoice_id = (select v::uuid from _p where clave = 'rb1')) <> 'cambiado'
     or (select iban_check from public.conta_pago_remesa_linea where remesa_id = r.id and invoice_id = (select v::uuid from _p where clave = 'ra1')) <> 'primer_pago' then
    raise exception 'PRUEBA PC01 E2 · 2: el antifraude no marcó Beta (cambiado) y Alfa (primer pago).';
  end if;
  begin perform public.conta_remesa_fichero_datos(r.id); exception when others then v_err := sqlerrm; end;
  if v_err not like 'Antes de descargar el fichero, confirma el IBAN%' then raise exception 'PRUEBA PC01 E2 · 2: el fichero con un IBAN sin confirmar dijo «%».', v_err; end if;
  -- La misma factura no entra dos veces en remesas vivas.
  v_err := null;
  begin perform public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'ra1'))));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura E2-A1 tiene pendientes 0,00 € sin remesa%' then raise exception 'PRUEBA PC01 E2 · 2: repetir la factura dijo «%».', v_err; end if;
  raise notice '2 · %', x->>'frase';
end $$;

-- ── 3 · Confirmar el IBAN, los datos del fichero y la lista ─────────────────
do $$
declare x jsonb; d jsonb; l jsonb; r uuid := (select v::uuid from _p where clave = 'remesa'); fila jsonb;
begin
  x := public.conta_remesa_iban_confirmar((select id from public.conta_pago_remesa_linea where remesa_id = r and invoice_id = (select v::uuid from _p where clave = 'rb1')));
  if x->>'frase' <> 'IBAN de Proveedor E2 Beta confirmado (···· 7891). Queda apuntado quién y cuándo.' then raise exception 'PRUEBA PC01 E2 · 3: confirmar dijo «%».', x->>'frase'; end if;
  if (select estado from public.conta_pago_remesa_estado where id = r) <> 'fichero' then raise exception 'PRUEBA PC01 E2 · 3: confirmado, la remesa no quedó lista para el fichero.'; end if;
  d := public.conta_remesa_fichero_datos(r);
  if jsonb_array_length(d->'pagos') <> 3 or d->'ordenante'->>'iban' <> 'ES6401829103210000000013' or (d->'pagos'->0->>'nombre') <> 'Alfa Distribuciones Prueba SL' then
    raise exception 'PRUEBA PC01 E2 · 3: los datos del fichero no son los esperados: %.', d;
  end if;
  l := public.conta_pagos_lista((select v::uuid from _p where clave = 'empresa'), public.conta_hoy());
  select f into fila from jsonb_array_elements(l->'filas') f where f->>'id' = (select v from _p where clave = 'rb1');
  if fila->'remesa'->>'id' <> r::text or (fila->>'iban4') <> '7891' or (fila->>'con_cuenta')::boolean is not true then raise exception 'PRUEBA PC01 E2 · 3: la lista no da la remesa de E2-B1: %.', fila; end if;
  if not exists (select 1 from jsonb_array_elements(l->'sin_plazo') s where s->>'id' = (select v from _p where clave = 'se')) then raise exception 'PRUEBA PC01 E2 · 3: «sin plazo» no lista al Proveedor E2 Sin plazo.'; end if;
  raise notice '3 · IBAN confirmado; el fichero lleva 3 pagos desde ···· 0013; la lista da la remesa de cada factura';
end $$;

-- ── 4 · Descargado; un pago rechazado ───────────────────────────────────────
do $$
declare x jsonb; v_err text; r uuid := (select v::uuid from _p where clave = 'remesa'); la2 uuid;
begin
  x := public.conta_remesa_descargada(r, md5('fichero de prueba'), 3);
  if x->>'frase' not like 'Fichero de la remesa R-____/___ descargado: 3 pagos. Súbelo a la banca de Banco B01 · Mercado; cuando llegue el cargo, la casas en Bancos y las facturas quedan pagadas.' then
    raise exception 'PRUEBA PC01 E2 · 4: descargar dijo «%».', x->>'frase';
  end if;
  if (select estado from public.conta_pago_remesa_estado where id = r) <> 'en_banco' then raise exception 'PRUEBA PC01 E2 · 4: descargada no quedó en el banco.'; end if;
  select id into la2 from public.conta_pago_remesa_linea where remesa_id = r and invoice_id = (select v::uuid from _p where clave = 'ra2');
  begin perform public.conta_remesa_linea_sacar(la2); exception when others then v_err := sqlerrm; end;
  if v_err not like 'El fichero de esta remesa ya se descargó%' then raise exception 'PRUEBA PC01 E2 · 4: sacar después del fichero dijo «%».', v_err; end if;
  x := public.conta_remesa_linea_rechazada(la2, 'Cuenta cancelada');
  if x->>'frase' <> 'Rechazado: la factura E2-A2 de Proveedor E2 Alfa vuelve a «Por pagar» con el motivo «Cuenta cancelada». Las demás siguen su curso.' then
    raise exception 'PRUEBA PC01 E2 · 4: rechazar dijo «%».', x->>'frase';
  end if;
  if (select por_cargar from public.conta_pago_remesa_estado where id = r) <> 300 then raise exception 'PRUEBA PC01 E2 · 4: rechazado, la remesa no espera 300 €.'; end if;
  raise notice '4 · descargada; ya no se saca; E2-A2 rechazada vuelve a por pagar (la remesa espera 300 €)';
end $$;

-- ── 5 · El cargo del banco ──────────────────────────────────────────────────
do $$
declare r jsonb; x jsonb; m record; mv jsonb := '[]'::jsonb; i int; rem uuid := (select v::uuid from _p where clave = 'remesa'); v_err text; ent uuid; lin text;
begin
  for i in 1..2 loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', '2026-10-23', 'importe', (array[-300.00, -20.00])[i],
      'concepto_banco', 'TRANSFERENCIAS E2 ' || i, 'concepto_limpio', 'Transferencias e2 ' || i, 'contraparte', 'REMESA E2', 'tipo', 'TRANSFERENCIAS',
      'huella', 'pc01e2-' || i, 'huella_suave', 'pc01e2-s' || i));
  end loop;
  r := public.bank_importar((select v::uuid from _p where clave = 'banco'), 'fichero', 'csv:bbva', 'prueba-pc01e2.xlsx', repeat('e', 64),
    date '2026-10-23', date '2026-10-23', null, null, 'prueba', null, mv);
  for m in select distinct on (bm.bank_concept) bm.* from public.bank_movement bm
            where bm.statement_id = (r->>'extracto')::uuid and bm.bank_concept like 'TRANSFERENCIAS E2 _'
            order by bm.bank_concept, bm.created_at desc loop
    insert into _p values ('mov' || right(m.bank_concept, 1), m.id);
  end loop;
  if (select count(*) from _p where clave in ('mov1', 'mov2')) <> 2 then raise exception 'PRUEBA PC01 E2 · 5: el extracto no trae los 2 movimientos.'; end if;
  -- Un cargo de otro importe no la casa.
  begin perform public.conta_remesa_casar((select v::uuid from _p where clave = 'mov2'), rem, null); exception when others then v_err := sqlerrm; end;
  if v_err not like 'El cargo es de 20,00 € y lo que espera la remesa R-____/___ es 300,00 €.' then raise exception 'PRUEBA PC01 E2 · 5: otro importe dijo «%».', v_err; end if;
  x := public.conta_remesa_casar((select v::uuid from _p where clave = 'mov1'), rem, null);
  insert into _p values ('casado', x->>'casado');
  if x->>'frase' not like 'Casado con la remesa R-____/___: 2 pagos, 300,00 €. 2 facturas quedan pagadas con su asiento (propuesto, en «Por validar»).' then
    raise exception 'PRUEBA PC01 E2 · 5: casar dijo «%».', x->>'frase';
  end if;
  if (select status from public.supplier_invoice where id = (select v::uuid from _p where clave = 'ra1')) <> 'pagada'
     or (select status from public.supplier_invoice where id = (select v::uuid from _p where clave = 'rb1')) <> 'pagada' then
    raise exception 'PRUEBA PC01 E2 · 5: casada la remesa, E2-A1 y E2-B1 no quedaron pagadas.';
  end if;
  select journal_entry_id into ent from public.bank_match where id = (x->>'casado')::uuid;
  if (select count(*) from public.supplier_invoice_payment where entry_id = ent and invoice_id in (select v::uuid from _p where clave in ('ra1', 'rb1'))) <> 2 then
    raise exception 'PRUEBA PC01 E2 · 5: los dos pagos no quedaron con el asiento del banco.';
  end if;
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code) into lin
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent;
  if lin <> '40000001 100.00/0.00 · 40000002 200.00/0.00 · 57200913 0.00/300.00' then raise exception 'PRUEBA PC01 E2 · 5: el asiento fue «%».', lin; end if;
  if (select estado from public.conta_pago_remesa_estado where id = rem) <> 'pagada' then raise exception 'PRUEBA PC01 E2 · 5: la remesa no quedó pagada.'; end if;
  -- Deshacer el casado lo devuelve todo.
  perform public.bank_deshacer((x->>'casado')::uuid, 'Prueba PC01 E2');
  if (select status from public.supplier_invoice where id = (select v::uuid from _p where clave = 'ra1')) <> 'aprobada'
     or exists (select 1 from public.supplier_invoice_payment where invoice_id in (select v::uuid from _p where clave in ('ra1', 'rb1')))
     or (select estado from public.conta_pago_remesa_estado where id = rem) <> 'en_banco' then
    raise exception 'PRUEBA PC01 E2 · 5: deshacer el casado no devolvió las facturas ni la remesa.';
  end if;
  -- Y se vuelve a casar (para el 6).
  x := public.conta_remesa_casar((select v::uuid from _p where clave = 'mov1'), rem, null);
  raise notice '5 · casada: 400 de Alfa 100, 400 de Beta 200 contra la 572 300; deshacer lo devuelve; casada otra vez';
end $$;

-- ── 6 · Antifraude: no coincide con los pagos anteriores ────────────────────
reset role;
update public.supplier set iban = 'ES4321000418450200059999', iban_changed_at = now() - interval '60 days'
 where id = (select v::uuid from _p where clave = 'sa');  -- cambiado hace 60 días: solo lo caza «no coincide con sus pagos»
set local role authenticated;
do $$
declare x jsonb; l public.conta_pago_remesa_linea;
begin
  x := public.conta_remesa_pagos_crear((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'banco'), public.conta_hoy(),
    jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'ra2'), 'importe', 10)));
  select * into l from public.conta_pago_remesa_linea where remesa_id = (x->>'remesa')::uuid;
  if l.iban_check <> 'cambiado' or l.iban_note <> 'No coincide con el de sus pagos anteriores (···· 1332).' then
    raise exception 'PRUEBA PC01 E2 · 6: el antifraude dio % («%»).', l.iban_check, l.iban_note;
  end if;
  perform public.conta_remesa_linea_sacar(l.id);
  raise notice '6 · antifraude: % → %', l.iban_check, l.iban_note;
end $$;

-- ── 7 · «Ya la he pagado», parcial ──────────────────────────────────────────
do $$
declare x jsonb; v_err text; e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco'); rem uuid; lid uuid;
begin
  begin perform public.conta_pago_a_mano(e, (select v::uuid from _p where clave = 'ra2'), b, public.conta_hoy(), 60); exception when others then v_err := sqlerrm; end;
  if v_err not like 'A la factura E2-A2 le quedan 50,00 € por pagar: no se le pueden apuntar 60,00 €.' then raise exception 'PRUEBA PC01 E2 · 7: pasarse dijo «%».', v_err; end if;
  x := public.conta_pago_a_mano(e, (select v::uuid from _p where clave = 'ra2'), b, public.conta_hoy(), 20);
  if x->>'frase' not like 'Apuntado: 20,00 € a Proveedor E2 Alfa el __/__ desde Banco B01 · Mercado. Queda esperando el cargo; cuando lo cases en Bancos, el pago queda con su asiento y la factura, pagada en parte.' then
    raise exception 'PRUEBA PC01 E2 · 7: apuntarlo dijo «%».', x->>'frase';
  end if;
  rem := (x->>'remesa')::uuid;
  if (select estado from public.conta_pago_remesa_estado where id = rem) <> 'en_banco' then raise exception 'PRUEBA PC01 E2 · 7: el pago a mano no quedó esperando el cargo.'; end if;
  select id into lid from public.conta_pago_remesa_linea where remesa_id = rem;
  x := public.conta_remesa_casar((select v::uuid from _p where clave = 'mov2'), rem, array[lid]);
  if (select estado from public.conta_recibida_pago where invoice_id = (select v::uuid from _p where clave = 'ra2')) <> 'pagada_parte'
     or (select pagado from public.conta_recibida_pago where invoice_id = (select v::uuid from _p where clave = 'ra2')) <> 20 then
    raise exception 'PRUEBA PC01 E2 · 7: casado el pago a mano, E2-A2 no quedó pagada en parte (20 €).';
  end if;
  raise notice '7 · ya la he pagado: 20 € de 50, esperando el cargo; casado uno a uno, pagada en parte';
end $$;

-- ── 8 · «Ponerles vencimiento» ──────────────────────────────────────────────
do $$
declare x jsonb;
begin
  if (select due_date from public.supplier_invoice where id = (select v::uuid from _p where clave = 're1')) is not null then raise exception 'PRUEBA PC01 E2 · 8: E2-E1 ya tenía vencimiento.'; end if;
  x := public.conta_recibidas_poner_vencimiento((select v::uuid from _p where clave = 'empresa'),
    jsonb_build_array(jsonb_build_object('proveedor', (select v from _p where clave = 'se'), 'dias', 15)));
  if (select due_date from public.supplier_invoice where id = (select v::uuid from _p where clave = 're1')) <> date '2026-10-21'
     or (select payment_terms_days from public.supplier where id = (select v::uuid from _p where clave = 'se')) <> 15 then
    raise exception 'PRUEBA PC01 E2 · 8: E2-E1 no vence el 21/10 o el plazo no quedó en la ficha (%).', x->>'frase';
  end if;
  raise notice '8 · %', x->>'frase';
end $$;
reset role;

-- ── 9 · La vuelta atrás ─────────────────────────────────────────────────────
-- (Con remesas de prueba dentro: la vuelta atrás borra las tablas con ellas.)
\i supabase/vuelta-atras/20261026T0915_pc01e2_remesas_de_pagos.down.sql
do $$ begin
  if to_regclass('public.conta_pago_remesa') is not null or to_regclass('public.conta_pago_remesa_estado') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'conta_remesa%' or proname like '_pc01e2%' or proname in ('conta_pago_a_mano', 'conta_pagos_lista', 'conta_recibidas_poner_vencimiento')))
     or exists (select 1 from pg_trigger where tgname = 'pc01e2_proveedor_iban_cambiado') then
    raise exception 'PRUEBA PC01 E2 · 9: la vuelta atrás deja algo del E2.';
  end if;
  raise notice '9 · la vuelta atrás: sin tablas, vistas, funciones ni disparador del E2';
end $$;
rollback;
