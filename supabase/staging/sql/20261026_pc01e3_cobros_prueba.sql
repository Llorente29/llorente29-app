-- supabase/staging/sql/20261026_pc01e3_cobros_prueba.sql
--
-- SOLO STAGING. Prueba de la 2142 del PC01 · E3 (Ventas › Cobros: mandatos,
-- remesa de recibos y devueltos), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. En la empresa A, con datos INVENTADOS que se siembra ella
-- misma (tres clientes domiciliados y uno por transferencia, con sus facturas),
-- por los CAMINOS de verdad: el mandato se firma con el enlace SIN CUENTA
-- (anon), la remesa se prepara como el administrador, el abono y la devolución
-- llegan en un extracto (bank_importar) y se casan con bank_casar.
--
--   1. La lista: las cuatro facturas, cómo se cobran, y el cliente domiciliado
--      sin mandato en el aviso.
--   2. Lo que no entra en una remesa, y por qué: sin mandato, por transferencia.
--   3. El mandato por enlace: preparar, leerlo sin cuenta (con el identificador
--      de acreedor de la empresa), un IBAN mal escrito, firmar, la ficha del
--      cliente queda domiciliada con su mandato, y no se firma dos veces.
--   4. La remesa: dos recibos, primeros (FRST); el fichero y su descarga; ya no
--      se saca un recibo.
--   5. El abono: otro importe no casa; el bueno deja las dos facturas cobradas
--      con un asiento (572 contra las dos 430) y la remesa en plazo de
--      devoluciones.
--   6. El devuelto: el cargo (recibo + 3,50 de gastos) se casa con su recibo
--      (430 y 626 contra 572) y la factura vuelve a «Por cobrar»; deshacerlo en
--      Bancos la deja otra vez cobrada.
--   7. Otra remesa con el mismo mandato: recurrente (RCUR).
--   8. Lo que ofrece Bancos (conta_cobros_para_casar).
--   9. La vuelta atrás: sin tablas, vistas ni funciones de la E3.
--
-- Nombra lo que toca, para el analizador: conta_mandato, conta_cobro_remesa,
-- conta_cobro_remesa_linea, conta_cobro_remesa_evento, customer_fiscal,
-- customer_invoice_payment, bank_casar, bank_match_item.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 E3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 2142 solo añade: el ensayo de la rama puede haberla pasado ya de verdad (W05).
\i supabase/vuelta-atras/20261026T2142_pc01e3_cobros_mandatos_recibos.down.sql
do $$ begin
  if to_regclass('public.conta_cobro_remesa') is not null or to_regclass('public.conta_mandato') is not null then
    raise exception 'PRUEBA PC01 E3 · 0: la vuelta atrás no deja staging sin la E3.';
  end if;
end $$;
\i supabase/migrations/20261026T2142_pc01e3_cobros_mandatos_recibos.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('banco', 'b0100000-0000-4000-8000-0000000000b3');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        dom uuid := (select id from public.payment_method where code = 'domiciliacion' and account_id is null limit 1);
        tra uuid := (select id from public.payment_method where code = 'transferencia' and account_id is null limit 1);
        s uuid; i int := 0; k text; f uuid;
begin
  if dom is null or tra is null then raise exception 'PRUEBA PC01 E3 · siembra: faltan las formas de cobro globales.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Club E3 Vallecas', 'G00000301') returning id into s; insert into _p values ('club', s);
  insert into public.party (account_id, name, tax_id) values (a, 'Academia E3 Lavapiés', 'B00000302') returning id into s; insert into _p values ('acad', s);
  insert into public.party (account_id, name, tax_id) values (a, 'Bar E3 Usera', 'B00000303') returning id into s; insert into _p values ('bar', s);
  insert into public.party (account_id, name, tax_id) values (a, 'Catering E3 Rivas', 'B00000304') returning id into s; insert into _p values ('cat', s);
  -- El Club, con su mandato en papel en la ficha; la Academia y el Bar, domiciliados sin mandato; el Catering, por transferencia.
  insert into public.customer_fiscal (party_id, account_id, legal_name, payment_method, iban, sepa_mandate_ref, sepa_mandate_date) values
    ((select v::uuid from _p where clave = 'club'), a, 'Club E3 Vallecas', 'direct_debit', 'ES9121000418450200051332', 'PAPEL-0001', date '2026-09-03'),
    ((select v::uuid from _p where clave = 'acad'), a, 'Academia E3 Lavapiés SL', 'direct_debit', null, null, null),
    ((select v::uuid from _p where clave = 'bar'), a, 'Bar E3 Usera SL', 'direct_debit', null, null, null),
    ((select v::uuid from _p where clave = 'cat'), a, 'Catering E3 Rivas SL', 'transfer', null, null, null);
  foreach k in array array['club', 'acad', 'bar', 'cat'] loop
    i := i + 1;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select a, e, ca.plan, '4300981' || i, ca.template_code, 'Clientes · E3 ' || i, ca.kind, ca.source
      from public.company_account ca where ca.company_id = e and ca.code = '43000001';
    if not found then raise exception 'PRUEBA PC01 E3 · siembra: la empresa A no tiene la 43000001 de molde.'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'customer', (select v from _p where clave = k), 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4300981' || i;
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, base, tax, total)
    values (a, e, 'emitida', 'a_mano', 'E3P', 2026, i, 'E3P-' || i, public.conta_hoy() - 10, public.conta_hoy() + 5,
            (select v::uuid from _p where clave = k), jsonb_build_object('nombre', k),
            case when k = 'cat' then tra else dom end, (array[357.02, 545.45, 318.18, 645.04])[i], (array[74.98, 114.55, 66.82, 135.46])[i], (array[432.00, 660.00, 385.00, 780.50])[i])
    returning id into f;
    insert into _p values ('f_' || k, f);
  end loop;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 · La lista ────────────────────────────────────────────────────────────
do $$
declare x jsonb := public.conta_cobros_lista((select v::uuid from _p where clave = 'empresa'), public.conta_hoy()); fila jsonb;
begin
  select r into fila from jsonb_array_elements(x->'filas') r where r->>'id' = (select v from _p where clave = 'f_club');
  if fila->>'forma' <> 'direct_debit' or (fila->>'con_mandato')::boolean is not true or (fila->>'pendiente')::numeric <> 432 or fila->>'mandato' <> 'PAPEL-0001' then
    raise exception 'PRUEBA PC01 E3 · 1: el Club sale %.', fila;
  end if;
  select r into fila from jsonb_array_elements(x->'filas') r where r->>'id' = (select v from _p where clave = 'f_cat');
  if fila->>'forma' <> 'transfer' then raise exception 'PRUEBA PC01 E3 · 1: el Catering sale %.', fila; end if;
  if (select count(*) from jsonb_array_elements(x->'sin_mandato') s where s->>'nombre' in ('Academia E3 Lavapiés', 'Bar E3 Usera')) <> 2 then
    raise exception 'PRUEBA PC01 E3 · 1: el aviso de sin mandato dice %.', x->'sin_mandato';
  end if;
  raise notice '1 · la lista: forma de cobro, mandato y el aviso de los dos domiciliados sin mandato';
end $$;

-- ── 2 · Lo que no entra en una remesa ───────────────────────────────────────
do $$
declare v_err text; e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco');
begin
  begin perform public.conta_remesa_cobros_crear(e, b, public.conta_hoy() + 3, jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f_bar'))));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Bar E3 Usera paga por domiciliación y no tiene mandato firmado: envíaselo para firmar antes de pasarle el recibo.' then
    raise exception 'PRUEBA PC01 E3 · 2: sin mandato dijo «%».', v_err;
  end if;
  v_err := null;
  begin perform public.conta_remesa_cobros_crear(e, b, public.conta_hoy() + 3, jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f_cat'))));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'La factura E3P-4 de Catering E3 Rivas no se cobra por domiciliación (paga por transferencia): no va en una remesa de recibos.' then
    raise exception 'PRUEBA PC01 E3 · 2: por transferencia dijo «%».', v_err;
  end if;
  v_err := null;
  begin perform public.conta_remesa_cobros_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f_club'))));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'El cargo tiene que ser como pronto mañana%' then raise exception 'PRUEBA PC01 E3 · 2: cargo hoy dijo «%».', v_err; end if;
  if exists (select 1 from public.conta_cobro_remesa where company_id = e) then raise exception 'PRUEBA PC01 E3 · 2: un intento fallido dejó una remesa a medias.'; end if;
  raise notice '2 · no entran: sin mandato, por transferencia, ni con cargo hoy (y no queda nada a medias)';
end $$;

-- ── 3 · El mandato por enlace ───────────────────────────────────────────────
do $$
declare x jsonb;
begin
  x := public.conta_mandato_preparar((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'acad'), 'administracion@academia-e3.example');
  if x->>'ref' !~ '^SUM-[0-9]{6}$' or x->>'enlace' <> '/mandato.html?t=' || (x->>'token') then raise exception 'PRUEBA PC01 E3 · 3: preparar dio %.', x; end if;
  insert into _p values ('token', x->>'token'), ('ref', x->>'ref');
  raise notice '3a · %', x->>'frase';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', json_build_object('x-forwarded-for', '203.0.113.7, 10.0.0.1', 'user-agent', 'Prueba E3')::text, true);
set local role anon;
do $$
declare x jsonb := public.conta_mandato_para_firmar((select v from _p where clave = 'token')); v_err text; v_ident text; n text;
begin
  if x->>'estado' <> 'por_firmar' or x->>'ref' <> (select v from _p where clave = 'ref') or x->'deudor'->>'nombre' <> 'Academia E3 Lavapiés SL' then
    raise exception 'PRUEBA PC01 E3 · 3: sin cuenta, el enlace dice %.', x;
  end if;
  -- El identificador de acreedor: ES + control + 000 + NIF, y el control cuadra (módulo 97, como el IBAN).
  v_ident := x->'acreedor'->>'identificador';
  if v_ident !~ '^ES[0-9]{2}000[A-Z0-9]{9}$' then raise exception 'PRUEBA PC01 E3 · 3: el identificador de acreedor es «%».', v_ident; end if;
  select string_agg(case when t.c ~ '[A-Z]' then (ascii(t.c) - 55)::text else t.c end, '' order by t.o) into n
    from regexp_split_to_table(substr(v_ident, 8) || 'ES' || substr(v_ident, 3, 2), '') with ordinality as t(c, o);
  if n::numeric % 97 <> 1 then raise exception 'PRUEBA PC01 E3 · 3: el control del identificador % no cuadra.', v_ident; end if;
  if (select public.conta_mandato_para_firmar(repeat('0', 64))->>'estado') <> 'no_existe' then raise exception 'PRUEBA PC01 E3 · 3: un token inventado no dice que no existe.'; end if;
  begin perform public.conta_mandato_firmar((select v from _p where clave = 'token'), 'Marta Prueba', null, 'ES00 2100 0418 4502 0005 1332', true); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Ese IBAN no es correcto: revisa los dígitos.' then raise exception 'PRUEBA PC01 E3 · 3: un IBAN mal escrito dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_mandato_firmar((select v from _p where clave = 'token'), 'Marta Prueba', null, 'ES7921000813610123456789', false); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Para firmar, marca que aceptas el mandato.' then raise exception 'PRUEBA PC01 E3 · 3: sin aceptar dijo «%».', v_err; end if;
  x := public.conta_mandato_firmar((select v from _p where clave = 'token'), 'Marta Prueba', 'b-00000302', 'es79 2100 0813 6101 2345 6789', true);
  if x->>'frase' <> format('Mandato %s firmado. Gracias: los próximos recibos se cargarán en la cuenta que termina en 6789.', (select v from _p where clave = 'ref')) then
    raise exception 'PRUEBA PC01 E3 · 3: firmar dijo «%».', x->>'frase';
  end if;
  v_err := null;
  begin perform public.conta_mandato_firmar((select v from _p where clave = 'token'), 'Otro', null, 'ES7921000813610123456789', true); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Este mandato ya está firmado.' then raise exception 'PRUEBA PC01 E3 · 3: firmar dos veces dijo «%».', v_err; end if;
  if (public.conta_mandato_para_firmar((select v from _p where clave = 'token'))->'firmado'->>'nombre') <> 'Marta Prueba' then raise exception 'PRUEBA PC01 E3 · 3: firmado no enseña quién.'; end if;
  -- Sin cuenta no se lee nada más.
  v_err := null;
  begin perform 1 from public.conta_mandato; exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA PC01 E3 · 3: anon lee la tabla de mandatos.'; end if;
  raise notice '3b · sin cuenta: lee el enlace, rechaza un IBAN mal escrito y sin aceptar, firma (%) y no firma dos veces', x->>'frase';
end $$;
reset role;
do $$
declare cf public.customer_fiscal; m public.conta_mandato;
begin
  select * into cf from public.customer_fiscal where party_id = (select v::uuid from _p where clave = 'acad');
  select * into m from public.conta_mandato where token = (select v from _p where clave = 'token');
  if cf.iban <> 'ES7921000813610123456789' or cf.sepa_mandate_ref <> m.ref or cf.sepa_mandate_date <> public.conta_hoy() or cf.payment_method <> 'direct_debit' then
    raise exception 'PRUEBA PC01 E3 · 3: la ficha de la Academia quedó % / % / % / %.', cf.iban, cf.sepa_mandate_ref, cf.sepa_mandate_date, cf.payment_method;
  end if;
  if m.signed_ip <> '203.0.113.7' or m.signed_agent <> 'Prueba E3' or m.signed_tax_id <> 'B00000302' then
    raise exception 'PRUEBA PC01 E3 · 3: la firma no guardó desde dónde (% / % / %).', m.signed_ip, m.signed_agent, m.signed_tax_id;
  end if;
  raise notice '3c · la ficha de la Academia, domiciliada con su mandato; la firma, con dirección y navegador';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 4 · La remesa ───────────────────────────────────────────────────────────
do $$
declare x jsonb; d jsonb; v_err text; e uuid := (select v::uuid from _p where clave = 'empresa'); b uuid := (select v::uuid from _p where clave = 'banco');
begin
  x := public.conta_remesa_cobros_crear(e, b, public.conta_hoy() + 3, jsonb_build_array(
    jsonb_build_object('id', (select v from _p where clave = 'f_club')), jsonb_build_object('id', (select v from _p where clave = 'f_acad'))));
  insert into _p values ('rem', x->>'remesa');
  if x->>'frase' not like 'Remesa C-____/___ preparada: 2 recibos, 1.092,00 €, con cargo el __/__. Descarga el fichero y súbelo a la banca de %' or (x->>'primeros')::int <> 2 then
    raise exception 'PRUEBA PC01 E3 · 4: preparar dijo «%» (primeros %).', x->>'frase', x->>'primeros';
  end if;
  if (select estado from public.conta_cobro_remesa_estado where id = (x->>'remesa')::uuid) <> 'preparada' then raise exception 'PRUEBA PC01 E3 · 4: la remesa no quedó preparada.'; end if;
  d := public.conta_remesa_cobros_fichero_datos((x->>'remesa')::uuid);
  if jsonb_array_length(d->'recibos') <> 2 or d->'acreedor'->>'nif' is null
     or (select r->>'mandato' from jsonb_array_elements(d->'recibos') r where r->>'nombre' = 'Club E3 Vallecas') <> 'PAPEL-0001' then
    raise exception 'PRUEBA PC01 E3 · 4: los datos del fichero son %.', d;
  end if;
  x := public.conta_remesa_cobros_descargada((select v::uuid from _p where clave = 'rem'), repeat('a', 64), 2);
  if (select estado from public.conta_cobro_remesa_estado where id = (select v::uuid from _p where clave = 'rem')) <> 'en_banco' then raise exception 'PRUEBA PC01 E3 · 4: descargado, no quedó en el banco.'; end if;
  begin perform public.conta_remesa_cobros_linea_sacar((select id from public.conta_cobro_remesa_linea where remesa_id = (select v::uuid from _p where clave = 'rem') limit 1));
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'El fichero de la remesa C-____/___ ya se descargó%' then raise exception 'PRUEBA PC01 E3 · 4: sacar tras descargar dijo «%».', v_err; end if;
  raise notice '4 · %', x->>'frase';
end $$;

-- ── 5 · El abono ────────────────────────────────────────────────────────────
do $$
declare mv jsonb := '[]'::jsonb; r jsonb; m record; x jsonb; v_err text; rem uuid := (select v::uuid from _p where clave = 'rem'); ent uuid; lin text;
begin
  for m in select * from (values (1, 1092.00, 'ABONO REMESA RECIBOS E3'), (2, -435.50, 'DEVOLUCION RECIBO E3'), (3, 50.00, 'ABONO OTRO E3')) x(i, imp, con) loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', to_char(public.conta_hoy(), 'YYYY-MM-DD'), 'importe', m.imp,
      'concepto_banco', m.con, 'concepto_limpio', initcap(m.con), 'contraparte', 'REMESA E3', 'tipo', 'ADEUDOS',
      'huella', 'pc01e3-' || m.i, 'huella_suave', 'pc01e3-s' || m.i));
  end loop;
  r := public.bank_importar((select v::uuid from _p where clave = 'banco'), 'fichero', 'csv:bbva', 'prueba-pc01e3.xlsx', repeat('f', 64),
    public.conta_hoy(), public.conta_hoy(), null, null, 'prueba', null, mv);
  for m in select distinct on (bm.bank_concept) bm.* from public.bank_movement bm
            where bm.statement_id = (r->>'extracto')::uuid and bm.bank_concept like '% E3' order by bm.bank_concept, bm.created_at desc loop
    insert into _p values (case m.bank_concept when 'ABONO REMESA RECIBOS E3' then 'abono' when 'DEVOLUCION RECIBO E3' then 'devol' else 'otro' end, m.id);
  end loop;
  if (select count(*) from _p where clave in ('abono', 'devol', 'otro')) <> 3 then raise exception 'PRUEBA PC01 E3 · 5: el extracto no trae los 3 movimientos.'; end if;
  begin perform public.conta_remesa_cobros_casar((select v::uuid from _p where clave = 'otro'), rem, null); exception when others then v_err := sqlerrm; end;
  if v_err not like 'El abono es de 50,00 € y lo que espera la remesa C-____/___ es 1.092,00 €.' then raise exception 'PRUEBA PC01 E3 · 5: otro importe dijo «%».', v_err; end if;
  x := public.conta_remesa_cobros_casar((select v::uuid from _p where clave = 'abono'), rem, null);
  if x->>'frase' not like 'Casado con la remesa C-____/___: 2 recibos, 1.092,00 €. 2 facturas quedan cobradas.%' then raise exception 'PRUEBA PC01 E3 · 5: casar dijo «%».', x->>'frase'; end if;
  if (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f_club')) <> 'cobrada'
     or (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f_acad')) <> 'cobrada' then
    raise exception 'PRUEBA PC01 E3 · 5: casado el abono, las dos facturas no quedaron cobradas.';
  end if;
  if exists (select 1 from public.customer_invoice_payment where bank_match_id = (x->>'casado')::uuid and method <> 'direct_debit') then
    raise exception 'PRUEBA PC01 E3 · 5: los cobros no quedaron como domiciliados.';
  end if;
  select journal_entry_id into ent from public.bank_match where id = (x->>'casado')::uuid;
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code) into lin
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent;
  if lin <> '43009811 0.00/432.00 · 43009812 0.00/660.00 · 57200913 1092.00/0.00' then raise exception 'PRUEBA PC01 E3 · 5: el asiento fue «%».', lin; end if;
  if (select estado from public.conta_cobro_remesa_estado where id = rem) <> 'plazo' then raise exception 'PRUEBA PC01 E3 · 5: abonada, la remesa no quedó en plazo de devoluciones.'; end if;
  raise notice '5 · %', x->>'frase';
end $$;

-- ── 6 · El devuelto ─────────────────────────────────────────────────────────
do $$
declare x jsonb; v_err text; rem uuid := (select v::uuid from _p where clave = 'rem'); lc uuid; ent uuid; lin text; fila jsonb;
begin
  select id into lc from public.conta_cobro_remesa_linea where remesa_id = rem and invoice_id = (select v::uuid from _p where clave = 'f_club');
  insert into _p values ('linea_club', lc);
  begin perform public.conta_recibo_devuelto(lc, (select v::uuid from _p where clave = 'otro'), 'sin fondos'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Una devolución sale del banco, y este movimiento entra.' then raise exception 'PRUEBA PC01 E3 · 6: un abono como devolución dijo «%».', v_err; end if;
  x := public.conta_recibo_devuelto(lc, (select v::uuid from _p where clave = 'devol'), 'sin fondos');
  insert into _p values ('casado_devol', x->>'casado');
  if x->>'frase' <> 'Club E3 Vallecas devolvió el recibo de la E3P-1 (sin fondos): su factura vuelve a «Por cobrar», y los 3,50 € de gastos van a la 62600000.' then
    raise exception 'PRUEBA PC01 E3 · 6: devolver dijo «%».', x->>'frase';
  end if;
  if (select pendiente from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f_club')) <> 432 then
    raise exception 'PRUEBA PC01 E3 · 6: la factura del Club no volvió a «Por cobrar».';
  end if;
  select journal_entry_id into ent from public.bank_match where id = (x->>'casado')::uuid;
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code) into lin
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent;
  if lin <> '43009811 432.00/0.00 · 57200913 0.00/435.50 · 62600000 3.50/0.00' then raise exception 'PRUEBA PC01 E3 · 6: el asiento de la devolución fue «%».', lin; end if;
  select r into fila from jsonb_array_elements(public.conta_cobros_lista((select v::uuid from _p where clave = 'empresa'), public.conta_hoy())->'filas') r
   where r->>'id' = (select v from _p where clave = 'f_club');
  if fila->'devuelto'->>'motivo' <> 'sin fondos' or (fila->'devuelto'->>'gastos')::numeric <> 3.50 then raise exception 'PRUEBA PC01 E3 · 6: la lista no dice el devuelto: %.', fila; end if;
  if (public.conta_remesa_cobros_ficha(rem)->>'devueltos')::int <> 1 then raise exception 'PRUEBA PC01 E3 · 6: la ficha no cuenta el devuelto.'; end if;
  -- Deshacer el casado de la devolución en Bancos: la factura, otra vez cobrada.
  perform public.bank_deshacer((x->>'casado')::uuid, 'Prueba PC01 E3');
  if (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f_club')) <> 'cobrada'
     or (select estado from public.conta_cobro_remesa_linea_estado where id = lc) <> 'cobrado' then
    raise exception 'PRUEBA PC01 E3 · 6: deshecha la devolución, el Club no volvió a cobrado.';
  end if;
  -- Y otra vez devuelto, para el paso 7.
  perform public.conta_recibo_devuelto(lc, (select v::uuid from _p where clave = 'devol'), 'sin fondos');
  raise notice '6 · %  → deshacerlo en Bancos la deja cobrada', x->>'frase';
end $$;

-- ── 7 · Otra remesa con el mismo mandato: recurrente ────────────────────────
do $$
declare x jsonb;
begin
  x := public.conta_remesa_cobros_crear((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'banco'), public.conta_hoy() + 5,
    jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'f_club'))));
  if (select seq from public.conta_cobro_remesa_linea where remesa_id = (x->>'remesa')::uuid) <> 'RCUR' or (x->>'primeros')::int <> 0 then
    raise exception 'PRUEBA PC01 E3 · 7: el segundo recibo del Club no es recurrente: %.', x;
  end if;
  raise notice '7 · el devuelto, en otra remesa y como recurrente: %', x->>'frase';
end $$;

-- ── 8 · Lo que ofrece Bancos ────────────────────────────────────────────────
do $$
declare x jsonb := public.conta_cobros_para_casar((select v::uuid from _p where clave = 'empresa'));
begin
  if jsonb_typeof(x->'abonos') <> 'array' or jsonb_typeof(x->'devoluciones') <> 'array'
     or not exists (select 1 from jsonb_array_elements(x->'devoluciones') d where d->>'cliente' = 'Academia E3 Lavapiés') then
    raise exception 'PRUEBA PC01 E3 · 8: Bancos recibe %.', x;
  end if;
  raise notice '8 · Bancos: % remesas esperando abono, % recibos que aún pueden volver devueltos', jsonb_array_length(x->'abonos'), jsonb_array_length(x->'devoluciones');
end $$;
reset role;

-- ── 9 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T2142_pc01e3_cobros_mandatos_recibos.down.sql
do $$ begin
  if to_regclass('public.conta_cobro_remesa') is not null or to_regclass('public.conta_mandato') is not null or to_regclass('public.conta_cobro_remesa_estado') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and (proname like '\_pc01e3\_%' or proname like 'conta\_mandato\_%' or proname like 'conta\_remesa\_cobros%' or proname like 'conta\_remesas\_cobros%'
                      or proname in ('conta_cobros_lista', 'conta_cobros_para_casar', 'conta_recibo_devuelto'))) then
    raise exception 'PRUEBA PC01 E3 · 9: la vuelta atrás deja algo de la E3.';
  end if;
  raise notice '9 · la vuelta atrás: sin tablas, vistas ni funciones de la E3';
end $$;
rollback;
