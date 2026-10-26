-- supabase/staging/sql/20261026_v03_ventas_sin_iva_prueba.sql
--
-- SOLO STAGING. Prueba de la 0146 (cambia en caliente conta_venta_guardar,
-- conta_venta_emitir, conta_motivos_para_validar y conta_vat_book_desde_asiento),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A
-- (Taberna de Prueba Norte, NIF B28000016), con clientes y facturas inventados.
-- Las ventas sin IVA se ensayan por sus CAMINOS (regla 10): guardar, emitir con
-- su asiento validado, el libro, el 303 y la rectificativa.
--
--   0. Lo de antes: las cuatro funciones con el md5 de producción (staging es
--      producción por construcción) y, hoy, guardar rechaza una línea exenta.
--   1. Suiza, un servicio a una empresa (N2), con una línea al 21 % y otra sin
--      IVA: sin decir por qué no se emite ni gasta número, con la frase de
--      Verifactu; con N2 (guardado en el borrador) se emite. El asiento cuadra
--      y se valida: 430 por el total, la 70x partida (la parte sin IVA con su
--      tipo, base y libro), una 477 solo para el 21 %. El libro: el 21 % S1, y
--      la sin IVA N2 con cuota 0 → casilla 120 del 303.
--   2. Suiza, mercancía que sale de España (E2): clave 02, casilla 60.
--   3. España, art. 20 (E1): se emite; sin casilla. «Exportación» a un cliente
--      de España no se emite, y lo dice.
--   4. La rectificativa que anula la 1: hereda el N2, su libro va en negativo
--      con cuota 0 (el 303 aún no reparte rectificativas emitidas: como antes).
--   5. El validador: un apunte sin IVA cuyo importe no es su base no se valida.
--   6. Verifactu en pruebas: la de Suiza N2 escribe su alta con el desglose N2
--      (sin tipo ni cuota) y el importe sin IVA.
--   7. La vuelta atrás: las cuatro con el md5 del principio.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V03 E2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- El ensayo aplica la 0146 delante de esta prueba, en la misma transacción:
-- primero su vuelta atrás (y la 0 comprueba que deja lo de producción).
\i supabase/vuelta-atras/20261026T0146_v03_ventas_sin_iva.down.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select, insert, update on _v to authenticated;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
insert into _v values ('t21', (select id::text from public.tax_rate where code = 'iva_general' and company_id is null)),
  ('t0', (select id::text from public.tax_rate where code = 'exento' and company_id is null and treatment = 'exempt')),
  ('c705', (select id::text from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '70500000'));

-- 0 · Lo de antes.
do $$
declare v_md5 text;
begin
  if exists (select 1 from _v where v is null) then raise exception 'PRUEBA V03 E2 · 0: falta algo de la empresa A (%).', (select string_agg(clave, ', ') from _v where v is null); end if;
  if (select tax_id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') <> 'B28000016' then raise exception 'PRUEBA V03 E2 · 0: la empresa A no es la de siempre.'; end if;
  select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname) into v_md5
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('conta_venta_guardar', 'conta_venta_emitir', 'conta_motivos_para_validar', 'conta_vat_book_desde_asiento');
  -- Los de producción, medidos el 26/10 (y los de la vuelta atrás).
  if v_md5 <> 'conta_motivos_para_validar=ddc58afc55de46de899c47efa8579c10 conta_vat_book_desde_asiento=c8d6c25449892cb2ffc4fefc9be2a0c8 conta_venta_emitir=99be83503411f6587bba11dc7a12a401 conta_venta_guardar=04a94c4aaa0706233888b417630c6a0b' then
    raise exception 'PRUEBA V03 E2 · 0: las cuatro funciones de staging no son las de producción (%).', v_md5;
  end if;
  insert into _v values ('md5_antes', v_md5);
  raise notice '0 · las cuatro, con el md5 de producción';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_msg text; r jsonb;
begin
  r := public.party_save_customer((select v::uuid from _v where clave = 'cuenta'), null, 'Alpen Gastro AG (prueba V03 E2)', 'CHE123456789', jsonb_build_object('countryCode', 'CH'), 'Prueba V03 E2');
  insert into _v values ('suiza', r->>'party_id');
  r := public.party_save_customer((select v::uuid from _v where clave = 'cuenta'), null, 'Clínica Prueba V03 E2', '12345678Z', '{}'::jsonb, 'Prueba V03 E2');
  insert into _v values ('espana', r->>'party_id');
  begin
    perform public.conta_venta_guardar((select v::uuid from _v where clave = 'empresa'), null, jsonb_build_object('cliente_id', (select v from _v where clave = 'suiza')),
      jsonb_build_array(jsonb_build_object('concepto', 'Asesoría', 'cantidad', 1, 'precio', 100, 'tipo_id', (select v from _v where clave = 't0'), 'cuenta_id', (select v from _v where clave = 'c705'))), 'Prueba V03 E2');
    raise exception 'PRUEBA V03 E2 · 0: antes de la 0146 ya se guarda una línea exenta.';
  exception when invalid_parameter_value then v_msg := sqlerrm;
  end;
  raise notice '0 · antes, guardar rechaza la línea exenta: «%»', v_msg;
end $$;
reset role;

\i supabase/migrations/20261026T0146_v03_ventas_sin_iva.sql

-- 1 a 4 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _v where clave = 'empresa');
  v_t21 uuid := (select v::uuid from _v where clave = 't21'); v_t0 uuid := (select v::uuid from _v where clave = 't0');
  v_c705 uuid := (select v::uuid from _v where clave = 'c705');
  v_ch uuid := (select v::uuid from _v where clave = 'suiza'); v_es uuid := (select v::uuid from _v where clave = 'espana');
  r jsonb; v_f uuid; v_g uuid; v_h uuid; v_k uuid; v_msg text; v_hint text; v_num text; v_entry uuid; v_n int;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- 1 · Suiza, servicio a una empresa: 2.150 sin IVA y 100 al 21 %.
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_ch, 'fecha', v_hoy),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Asesoría de cocina', 'cantidad', 1, 'precio', 2150, 'descuento', 0, 'tipo_id', v_t0, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Comida del equipo (en España)', 'cantidad', 1, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03 E2');
  v_f := (r->>'id')::uuid;
  if (r->>'total')::numeric <> 2271 then raise exception 'PRUEBA V03 E2 · 1: el total del borrador no es 2.150 + 121 (%).', r; end if;
  begin
    perform public.conta_venta_emitir(v_f, 'Prueba V03 E2');
    raise exception 'PRUEBA V03 E2 · 1: se emite una venta sin IVA sin decir por qué.';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
  end;
  if v_msg not like '%fuera de la UE: dime qué le has vendido%' or v_hint <> 'tipo_venta' then
    raise exception 'PRUEBA V03 E2 · 1: no dice qué falta en palabras de la calle («%», %).', v_msg, v_hint;
  end if;
  if (select status from public.customer_invoice where id = v_f) <> 'borrador' or (select number_text from public.customer_invoice where id = v_f) is not null then
    raise exception 'PRUEBA V03 E2 · 1: sin el porqué ha quedado emitida o con número.';
  end if;
  raise notice '1 · sin el porqué no se emite: «%»', v_msg;

  -- Con N2, guardado con el borrador (lo que hará la pantalla).
  r := public.conta_venta_guardar(v_e, v_f, jsonb_build_object('cliente_id', v_ch, 'fecha', v_hoy, 'tipo_venta', jsonb_build_object('calificacion', 'N2')),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Asesoría de cocina', 'cantidad', 1, 'precio', 2150, 'descuento', 0, 'tipo_id', v_t0, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Comida del equipo (en España)', 'cantidad', 1, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03 E2');
  if (select calificacion from public.verifactu_operacion where invoice_id = v_f) is distinct from 'N2' then raise exception 'PRUEBA V03 E2 · 1: guardar no apunta el N2.'; end if;
  r := public.conta_venta_emitir(v_f, 'Prueba V03 E2');
  v_num := r->>'numero'; v_entry := (r->>'asiento')::uuid;
  if v_entry is null or (select status from public.journal_entry where id = v_entry) <> 'validado' then
    raise exception 'PRUEBA V03 E2 · 1: el asiento no está validado (%).', r;
  end if;
  -- El asiento, apunte a apunte.
  select count(*) into v_n from (
    select a.code, l.debit, l.credit, l.tax_rate_id, l.tax_base, l.vat_book
      from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry
    except
    select * from (values
      ((select a.code from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code like '43%'), 2271.00::numeric, 0::numeric, null::uuid, null::numeric, null::text),
      ('70500000', 0, 2150.00, v_t0, 2150.00, 'issued'),
      ('70500000', 0, 100.00, null, null, null),
      ((select a.code from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code like '477%'), 0, 21.00, v_t21, 100.00, 'issued')) x(code, debit, credit, tax_rate_id, tax_base, vat_book)) d;
  if v_n <> 0 or (select count(*) from public.journal_line where entry_id = v_entry) <> 4 then
    raise exception 'PRUEBA V03 E2 · 1: el asiento no es el que debe (%).',
      (select jsonb_agg(jsonb_build_object('c', a.code, 'd', l.debit, 'h', l.credit, 't', l.tax_rate_id, 'b', l.tax_base, 'libro', l.vat_book) order by l.position)
         from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry);
  end if;
  raise notice '1 · % emitida: 430 2.271, 705 2.150 sin IVA (con su tipo, base y libro), 705 100, 477 21; validado', v_num;
  insert into _v values ('n2', v_f::text), ('n2_asiento', v_entry::text);

  -- 2 · Suiza, mercancía que sale de España: exportación (E2).
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_ch, 'fecha', v_hoy, 'tipo_venta', jsonb_build_object('exenta', 'E2')),
    jsonb_build_array(jsonb_build_object('concepto', 'Aceite de oliva (caja de 6)', 'cantidad', 10, 'precio', 45, 'descuento', 0, 'tipo_id', v_t0, 'cuenta_id', v_c705)), 'Prueba V03 E2');
  v_g := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_g, 'Prueba V03 E2');
  insert into _v values ('e2', v_g::text), ('e2_asiento', r->>'asiento');

  -- 3 · España, art. 20 (E1). Y «exportación» a un cliente de España no.
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_es, 'fecha', v_hoy, 'tipo_venta', jsonb_build_object('exenta', 'E2')),
    jsonb_build_array(jsonb_build_object('concepto', 'Comidas del servicio sanitario', 'cantidad', 1, 'precio', 300, 'descuento', 0, 'tipo_id', v_t0, 'cuenta_id', v_c705)), 'Prueba V03 E2');
  v_h := (r->>'id')::uuid;
  begin
    perform public.conta_venta_emitir(v_h, 'Prueba V03 E2');
    raise exception 'PRUEBA V03 E2 · 3: se emite una «exportación» a un cliente de España.';
  exception when check_violation then v_msg := sqlerrm;
  end;
  if v_msg not like '%exportación es una venta a fuera de la UE%' then raise exception 'PRUEBA V03 E2 · 3: no dice por qué («%»).', v_msg; end if;
  raise notice '3 · exportación a España no: «%»', v_msg;
  r := public.conta_venta_guardar(v_e, v_h, jsonb_build_object('cliente_id', v_es, 'fecha', v_hoy, 'tipo_venta', jsonb_build_object('exenta', 'E1')),
    jsonb_build_array(jsonb_build_object('concepto', 'Comidas del servicio sanitario', 'cantidad', 1, 'precio', 300, 'descuento', 0, 'tipo_id', v_t0, 'cuenta_id', v_c705)), 'Prueba V03 E2');
  r := public.conta_venta_emitir(v_h, 'Prueba V03 E2');
  insert into _v values ('e1', v_h::text), ('e1_asiento', r->>'asiento');

  -- 4 · La rectificativa que anula la 1: hereda el N2.
  r := public.conta_venta_corregir(v_f, 'anular', 'Prueba V03 E2: no se tenía que haber emitido', 'Prueba V03 E2');
  v_k := (r->>'id')::uuid;
  if exists (select 1 from public.verifactu_operacion where invoice_id = v_k) then raise exception 'PRUEBA V03 E2 · 4: la rectificativa ya traía el porqué (la prueba no mide la herencia).'; end if;
  r := public.conta_venta_emitir(v_k, 'Prueba V03 E2');
  if (select calificacion from public.verifactu_operacion where invoice_id = v_k) is distinct from 'N2' then raise exception 'PRUEBA V03 E2 · 4: la rectificativa no hereda el N2.'; end if;
  if (select status from public.customer_invoice where id = v_f) <> 'anulada' then raise exception 'PRUEBA V03 E2 · 4: la 1 no queda anulada.'; end if;
  insert into _v values ('r', v_k::text), ('r_asiento', r->>'asiento');
end $$;
reset role;

-- El libro y el 303 de las tres y la rectificativa (como superusuario: el
-- libro lo escribe el disparador del asiento).
do $$
declare v_x record; v_mal text;
begin
  select string_agg(format('%s/%s: %s', t.que, coalesce(v.qualification, v.exempt_cause, '—'), row(v.book, v.invoice_type, v.qualification, v.exempt_cause, v.operation_key, v.tax_base, v.tax_rate, v.tax_amount, v.total, c.cajas)::text), '; ')
    into v_mal
    -- La rectificativa emitida aún no la reparte el 303 (no_sabe «rectificativa_expedida», como antes).
    from (values ('n2_asiento', 'N2', null, '01', 2150.00, 'F1', '{120}', null), ('n2_asiento', 'S1', null, '01', 100.00, 'F1', '{07,09}', null),
                 ('e2_asiento', null, 'E2', '02', 450.00, 'F1', '{60}', null), ('e1_asiento', null, 'E1', '01', 300.00, 'F1', '{}', null),
                 ('r_asiento', 'N2', null, '01', -2150.00, 'R4', '{}', 'rectificativa_expedida'), ('r_asiento', 'S1', null, '01', -100.00, 'R4', '{}', 'rectificativa_expedida'))
           t(que, calif, exenta, clave, base, tipo, cajas_esperadas, no_sabe)
    left join public.vat_book_entry v on v.entry_id = (select x.v::uuid from _v x where x.clave = t.que)
         and coalesce(v.qualification, '') = coalesce(t.calif, '') and coalesce(v.exempt_cause, '') = coalesce(t.exenta, '')
    left join lateral public.conta_impuesto_303_cajas(v) c on true
   where v.id is null or v.book <> 'issued' or v.operation_key <> t.clave or v.tax_base <> t.base or v.invoice_type <> t.tipo
      or (t.calif = 'S1' and v.tax_amount <> sign(t.base) * 21.00) or (coalesce(t.calif, '') <> 'S1' and (v.tax_amount <> 0 or v.total <> t.base))
      or coalesce(c.cajas, '{}') <> t.cajas_esperadas::text[] or c.no_sabe is distinct from t.no_sabe;
  if v_mal is not null then raise exception 'PRUEBA V03 E2 · libro: no es el que debe (%).', v_mal; end if;
  if (select count(*) from public.vat_book_entry where entry_id in (select x.v::uuid from _v x where x.clave like '%\_asiento')) <> 6 then
    raise exception 'PRUEBA V03 E2 · libro: sobran o faltan filas.';
  end if;
  raise notice 'libro · N2 2.150 cuota 0 → 120; S1 100 → 07/09; E2 450 clave 02 → 60; E1 300 sin casilla; la rectificativa R4, en negativo con cuota 0';
end $$;

-- 5 · El validador: un apunte sin IVA cuyo importe no es su base.
do $$
declare v_r jsonb; v_entry uuid; v_m text; v_cta430 text;
begin
  select a.code into v_cta430 from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (select v::uuid from _v where clave = 'e2_asiento') and a.code like '43%' limit 1;
  v_r := public._journal_entry_proponer((select v::uuid from _v where clave = 'empresa'),
    jsonb_build_object('series', 1, 'fecha', (now() at time zone 'Europe/Madrid')::date, 'concepto', 'Prueba V03 E2 · base mal', 'confianza', 'seguro', 'porque', 'Prueba V03 E2'),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_cta430, 'debe', 100, 'comun', true),
      jsonb_build_object('cuenta', '70500000', 'haber', 100, 'comun', true,
        'iva', jsonb_build_object('tipo_id', (select v from _v where clave = 't0'), 'base', 90, 'libro', 'issued', 'facturas', 1))),
    null, 'Prueba V03 E2', null);
  v_entry := (v_r->>'id')::uuid;
  select string_agg(motivo, ' | ') into v_m from public.conta_motivos_para_validar(v_entry) where codigo = 'apuntes';
  if v_m is null or v_m not like '%un apunte sin IVA es su base: el importe 100.00 no es la base 90%' then
    raise exception 'PRUEBA V03 E2 · 5: el validador no para un apunte sin IVA con la base mal (%).', v_m;
  end if;
  raise notice '5 · %', v_m;
end $$;

-- 6 · Verifactu en pruebas: la de Suiza N2, por la emisión de siempre.
do $$ begin
  perform public.verifactu_conexion_apuntar('pruebas', 'B28000016', true, null, 'Prueba V03 E2', 'prueba V03 E2');
end $$;
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_ch uuid := (select v::uuid from _v where clave = 'suiza');
  r jsonb; v_f uuid; v_reg public.verifactu_registro;
begin
  r := public.verifactu_modo(v_e, 'pruebas', null, null, 'Prueba V03 E2');
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_ch, 'fecha', (now() at time zone 'Europe/Madrid')::date, 'tipo_venta', jsonb_build_object('calificacion', 'N2')),
    jsonb_build_array(jsonb_build_object('concepto', 'Asesoría de cocina', 'cantidad', 1, 'precio', 2150, 'descuento', 0,
      'tipo_id', (select v from _v where clave = 't0'), 'cuenta_id', (select v from _v where clave = 'c705'))), 'Prueba V03 E2');
  v_f := (r->>'id')::uuid;
  perform public.conta_venta_emitir(v_f, 'Prueba V03 E2');
  select * into v_reg from public.verifactu_registro where invoice_id = v_f;
  if v_reg.id is null or v_reg.desglose->0->>'calificacion' <> 'N2' or v_reg.desglose->0 ? 'tipo' or v_reg.desglose->0 ? 'cuota'
     or (v_reg.desglose->0->>'base')::numeric <> 2150 or v_reg.cuota_total <> 0 or v_reg.importe_total <> 2150
     or v_reg.destinatarios->0->>'id_type' <> '04' then
    raise exception 'PRUEBA V03 E2 · 6: el alta no es la de una N2 (%).', row_to_json(v_reg);
  end if;
  raise notice '6 · en pruebas: alta % con el desglose N2 sin tipo ni cuota, 2.150,00 y el cliente como IDOtro 04', v_reg.num_serie;
end $$;
reset role;

-- 7 · La vuelta atrás.
\i supabase/vuelta-atras/20261026T0146_v03_ventas_sin_iva.down.sql
do $$
declare v_md5 text;
begin
  select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname) into v_md5
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('conta_venta_guardar', 'conta_venta_emitir', 'conta_motivos_para_validar', 'conta_vat_book_desde_asiento');
  if v_md5 <> (select v from _v where clave = 'md5_antes') then raise exception 'PRUEBA V03 E2 · 7: la vuelta atrás no deja las cuatro como estaban (%).', v_md5; end if;
  if (select count(*) from pg_proc where proname in ('conta_venta_guardar', 'conta_venta_emitir', 'conta_motivos_para_validar', 'conta_vat_book_desde_asiento')
        and pronamespace = 'public'::regnamespace) <> 4 then
    raise exception 'PRUEBA V03 E2 · 7: hay sobrecargas.';
  end if;
  raise notice '7 · la vuelta atrás: las cuatro, con el md5 del principio y sin sobrecargas';
end $$;
rollback;
