-- supabase/staging/sql/20261026_v03_e3_corregir_y_cuadrar_prueba.sql
--
-- SOLO STAGING. Prueba de la 1750 (V03 E3, solo añade), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A (Taberna de
-- Prueba Norte, NIF B28000016), en pruebas, con facturas emitidas por el
-- camino de siempre (conta_venta_emitir) y lo que contestaría Hacienda puesto
-- a mano (staging no habla con la AEAT).
--
--   0. Lo de antes: las funciones de la E1, la E2 y la V01 que la 1750 usa, con
--      su md5; ninguna de las nuevas existe (tras la vuelta atrás, por si W05
--      la dejó de verdad).
--   1. Lo que va a pasar (verifactu_previsto), para rectificar, anular y
--      subsanar, en cada estado con Hacienda.
--   2. Subsanar: una aceptada con un cambio de descripción, una aceptada con
--      errores tal cual, una rechazada (RechazoPrevio S); una correcta sin
--      cambios, no; y mientras va de camino, tampoco.
--   3. Anular (los cuatro caminos de la regla 10 que tocan: la factura, su
--      asiento, su libro de IVA y su registro): con cobros, no; sin ANULAR o
--      sin motivo, no; la buena: anulada, asiento anulado con su contrasiento
--      del mismo día y validado, el IVA del mes a cero y el registro de
--      anulación encadenado; una que Hacienda rechazó, «sin registro previo».
--   4. La cadena: entera; tocada a mano (con el disparador apagado, dentro de
--      la transacción), lo dice y dónde.
--   5. Comprobar con Hacienda: pedir (y no dos veces), otra cuenta no puede,
--      tomar, dos páginas de lo que contestaría la AEAT, y el cuadre: los que
--      cuadran, el que falta en Hacienda, el que solo tiene Hacienda, el
--      distinto y los que van de camino; un fallo; los permisos.
--   6. La vuelta atrás: nada de lo nuevo, y lo de antes con el md5 del principio.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V03 E3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- Solo añade y puede estar ya de verdad (W05): primero su vuelta atrás.
\i supabase/vuelta-atras/20261026T1750_v03_verifactu_corregir_y_cuadrar.down.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select, insert, update on _v to authenticated;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1');
insert into _v values ('t21', (select id::text from public.tax_rate where code = 'iva_general' and company_id is null)),
  ('c705', (select id::text from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '70500000'));
create temp table _md5 on commit drop as
  select p.oid::regprocedure::text firma, md5(pg_get_functiondef(p.oid)) h from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('conta_venta_emitir', 'conta_venta_corregir', 'journal_entry_anular', 'journal_entry_validar', 'verifactu_reenviar',
                       '_verifactu_alta_de_factura', '_verifactu_registrar', '_verifactu_anular', 'verifactu_comprobar', 'verifactu_despertar', 'verifactu_cert_abrir');
do $$ begin
  if exists (select 1 from _v where v is null) then raise exception 'PRUEBA V03 E3 · 0: falta algo de la empresa A (%).', (select string_agg(clave, ', ') from _v where v is null); end if;
  if (select tax_id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') <> 'B28000016' then raise exception 'PRUEBA V03 E3 · 0: la empresa A no es la de siempre.'; end if;
  if (select count(*) from _md5) <> 11 then raise exception 'PRUEBA V03 E3 · 0: faltan funciones de la E1, la E2 o la V01 (hay %).', (select string_agg(firma, ', ') from _md5); end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_previsto', 'verifactu_anular_factura', 'verifactu_subsanar', 'verifactu_comprobar_cadena', 'verifactu_cuadre_pedir'))
     or to_regclass('public.verifactu_cuadre') is not null then
    raise exception 'PRUEBA V03 E3 · 0: lo de la 1750 ya estaba antes de aplicarla.';
  end if;
  raise notice '0 · las 11 de antes, con su md5; nada de la 1750';
end $$;

\i supabase/migrations/20261026T1750_v03_verifactu_corregir_y_cuadrar.sql

-- En pruebas: la conexión probada (el candado de la 2351) y el modo, como usuario de A.
do $$ begin
  perform public.verifactu_conexion_apuntar('pruebas', 'B28000016', true, null, 'Prueba V03 E3', 'prueba V03 E3');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc uuid := (select v::uuid from _v where clave = 'cuenta'); v_e uuid := (select v::uuid from _v where clave = 'empresa');
  v_t21 uuid := (select v::uuid from _v where clave = 't21'); v_c705 uuid := (select v::uuid from _v where clave = 'c705');
  v_cli uuid; r jsonb; v_id uuid; i int;
begin
  r := public.verifactu_modo(v_e, 'pruebas', null, null, 'Prueba V03 E3');
  if r->>'modo' <> 'pruebas' then raise exception 'PRUEBA V03 E3: no pasa a pruebas (%).', r; end if;
  r := public.party_save_customer(v_acc, null, 'Colegio Prueba V03 E3', '12345678Z', '{}'::jsonb, 'Prueba V03 E3');
  v_cli := (r->>'party_id')::uuid;
  -- Siete facturas: a (aceptada), b (aceptada con errores), c (rechazada), d
  -- (pendiente), e (rechazada, sin nada aceptado), f (aceptada, falta en
  -- Hacienda), g (aceptada, Hacienda con otro importe).
  for i in 1..7 loop
    r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', (now() at time zone 'Europe/Madrid')::date),
      jsonb_build_array(jsonb_build_object('concepto', 'Menú E3 ' || i, 'cantidad', i, 'precio', 10, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V03 E3');
    v_id := (r->>'id')::uuid;
    perform public.conta_venta_emitir(v_id, 'Prueba V03 E3');
    insert into _v values (chr(96 + i), v_id::text);
  end loop;
end $$;
reset role;
-- Lo que contestó Hacienda, puesto a mano (solo cambian los campos de estado: el registro no se edita).
update public.verifactu_registro set estado = 'correcto', respondido_at = now(), csv = 'CSV-E3'
 where invoice_id in (select v::uuid from _v where clave in ('a', 'f', 'g'));
update public.verifactu_registro set estado = 'aceptado_con_errores', codigo_error = 1100, descripcion_error = 'NIF no identificado (prueba E3)', respondido_at = now()
 where invoice_id = (select v::uuid from _v where clave = 'b');
update public.verifactu_registro set estado = 'incorrecto', codigo_error = 1195, descripcion_error = 'Falta la causa (prueba E3)', respondido_at = now()
 where invoice_id in (select v::uuid from _v where clave in ('c', 'e'));

-- ── 1 · Lo que va a pasar ──────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a uuid := (select v::uuid from _v where clave = 'a'); d uuid := (select v::uuid from _v where clave = 'd');
  p jsonb;
begin
  p := public.verifactu_previsto(a, 'rectificar');
  if not (p->>'puede')::boolean or p->>'frase' not like '%rectificativa%R4%no cambia ni se borra%' then raise exception 'PRUEBA V03 E3 · 1: rectificar (%).', p; end if;
  raise notice '1 · rectificar: «%»', p->>'frase';
  p := public.verifactu_previsto(a, 'subsanar');
  if (p->>'puede')::boolean or p->>'frase' not like 'No hay nada que subsanar%' then raise exception 'PRUEBA V03 E3 · 1: subsanar sin cambios una correcta (%).', p; end if;
  raise notice '1 · subsanar una correcta sin cambios, no: «%»', p->>'frase';
  p := public.verifactu_previsto(a, 'subsanar', '{"descripcion": "Menú del día de octubre (E3)"}');
  if not (p->>'puede')::boolean or p->'cambios'->0->>'campo' <> 'descripcion' or p->'cambios'->0->>'despues' <> 'Menú del día de octubre (E3)' then
    raise exception 'PRUEBA V03 E3 · 1: subsanar con otra descripción (%).', p;
  end if;
  raise notice '1 · subsanar con otra descripción: cambia «%» → «%»', p->'cambios'->0->>'antes', p->'cambios'->0->>'despues';
  p := public.verifactu_previsto(d, 'subsanar');
  if (p->>'puede')::boolean or p->>'frase' not like '%todavía no ha salido a Hacienda%' then raise exception 'PRUEBA V03 E3 · 1: subsanar una pendiente (%).', p; end if;
  p := public.verifactu_previsto(a, 'anular');
  if not (p->>'puede')::boolean or p->>'frase' not like '%queda anulada%contrasiento del mismo día%registro de anulación%' then raise exception 'PRUEBA V03 E3 · 1: anular (%).', p; end if;
  raise notice '1 · anular: «%»', p->>'frase';
  p := public.verifactu_previsto(d, 'anular');
  if not (p->>'puede')::boolean or p->>'frase' not like '%le llegan las dos%' then raise exception 'PRUEBA V03 E3 · 1: anular una pendiente (%).', p; end if;
  begin
    perform public.verifactu_previsto(a, 'borrar');
    raise exception 'PRUEBA V03 E3 · 1: acepta una acción que no existe.';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ── 2 · Subsanar ───────────────────────────────────────────────────────────
do $$
declare
  a uuid := (select v::uuid from _v where clave = 'a'); b uuid := (select v::uuid from _v where clave = 'b'); c uuid := (select v::uuid from _v where clave = 'c');
  r jsonb; x public.verifactu_registro; v_msg text; v_ult uuid;
begin
  v_ult := (select id from public.verifactu_registro where nif_emisor = 'B28000016' and entorno = 'pruebas' order by generado_at desc, id desc limit 1);
  r := public.verifactu_subsanar(a, 'Menú del día de octubre (E3)', 'Prueba V03 E3');
  select * into x from public.verifactu_registro where id = (r->>'registro_id')::uuid;
  if x.tipo <> 'alta' or not x.subsanacion or x.rechazo_previo is not null or x.descripcion <> 'Menú del día de octubre (E3)' or x.estado <> 'pendiente'
     or x.anterior_id <> v_ult or x.huella <> public._verifactu_sha256(x.cadena_huella) or x.invoice_id <> a
     or x.num_serie <> (select number_text from public.customer_invoice where id = a) then
    raise exception 'PRUEBA V03 E3 · 2: la subsanación de a no es como debe (%).', row_to_json(x);
  end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = a and kind = 'verifactu_subsanacion' and text like '%cambia la descripción%') then
    raise exception 'PRUEBA V03 E3 · 2: la subsanación no queda en el historial de la factura.';
  end if;
  raise notice '2 · a: subsanación S, sin rechazo previo, con la descripción nueva, encadenada tras el último y en la cola';
  begin
    perform public.verifactu_subsanar(a, 'Otra vez', 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 2: se subsana otra vez mientras va de camino.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%todavía no ha salido a Hacienda%' then raise exception 'PRUEBA V03 E3 · 2: no dice por qué no (%).', v_msg; end if;
  r := public.verifactu_subsanar(b, null, 'Prueba V03 E3');
  select * into x from public.verifactu_registro where id = (r->>'registro_id')::uuid;
  if not x.subsanacion or x.rechazo_previo is not null or jsonb_array_length(r->'cambios') <> 0 then raise exception 'PRUEBA V03 E3 · 2: la de b (%).', r; end if;
  raise notice '2 · b (aceptada con errores): subsanación tal cual';
  r := public.verifactu_subsanar(c, null, 'Prueba V03 E3');
  select * into x from public.verifactu_registro where id = (r->>'registro_id')::uuid;
  if not x.subsanacion or x.rechazo_previo is distinct from 'S' then raise exception 'PRUEBA V03 E3 · 2: la de c, rechazada, sin RechazoPrevio S (%).', row_to_json(x); end if;
  raise notice '2 · c (rechazada): subsanación con RechazoPrevio S';
end $$;
reset role;

-- ── 3 · Anular ─────────────────────────────────────────────────────────────
-- d con un cobro primero (no se anula), y luego sin él… no: el cobro no se
-- quita aquí. Se usa g para el cobro y d para la anulación buena.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d uuid := (select v::uuid from _v where clave = 'd'); e uuid := (select v::uuid from _v where clave = 'e'); g uuid := (select v::uuid from _v where clave = 'g');
  r jsonb; v_msg text; v_f public.customer_invoice; v_orig public.journal_entry; v_con public.journal_entry; x public.verifactu_registro; v_ult uuid; v_iva numeric;
begin
  perform public.conta_venta_cobrar(g, null, 10, 'transferencia', 'Prueba V03 E3', 'Prueba V03 E3');
  begin
    perform public.verifactu_anular_factura(g, 'Duplicada', 'ANULAR', 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 3: se anula una factura con cobros.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%tiene cobros%' then raise exception 'PRUEBA V03 E3 · 3: no dice lo de los cobros (%).', v_msg; end if;
  begin
    perform public.verifactu_anular_factura(d, 'Duplicada', 'anular', 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 3: se anula sin escribir ANULAR.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like '%escribe ANULAR%' then raise exception 'PRUEBA V03 E3 · 3: no pide ANULAR (%).', v_msg; end if;
  begin
    perform public.verifactu_anular_factura(d, '  ', 'ANULAR', 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 3: se anula sin motivo.';
  exception when check_violation then v_msg := sqlerrm; end;

  v_ult := (select id from public.verifactu_registro where nif_emisor = 'B28000016' and entorno = 'pruebas' order by generado_at desc, id desc limit 1);
  r := public.verifactu_anular_factura(d, 'La hice dos veces (prueba E3)', 'ANULAR', 'Prueba V03 E3');
  select * into v_f from public.customer_invoice where id = d;
  select * into v_orig from public.journal_entry where id = v_f.entry_id;
  select * into v_con from public.journal_entry where id = (r->>'contraasiento')::uuid;
  select * into x from public.verifactu_registro where id = (r->>'registro_id')::uuid;
  if v_f.status <> 'anulada' then raise exception 'PRUEBA V03 E3 · 3: la factura no queda anulada (%).', v_f.status; end if;
  if v_orig.status <> 'anulado' or v_orig.voided_by_entry_id <> v_con.id or v_con.status <> 'validado' or v_con.reverses_entry_id <> v_orig.id
     or v_con.entry_date <> v_orig.entry_date or v_con.source_type <> 'reversal' then
    raise exception 'PRUEBA V03 E3 · 3: el asiento y su contrasiento no son como deben (% / %).', row_to_json(v_orig), row_to_json(v_con);
  end if;
  if (select sum(debit) - sum(credit) from public.journal_line where entry_id in (v_orig.id, v_con.id) and company_account_id in
        (select id from public.company_account where company_id = v_f.company_id and code like '477%')) <> 0 then
    raise exception 'PRUEBA V03 E3 · 3: la 477 no queda a cero entre el asiento y su contrasiento.';
  end if;
  -- El libro sigue al asiento (journal_entry_libro_registro, C05): el
  -- contrasiento no apunta nada y los apuntes de la factura quedan anulados
  -- por él, así que lo vivo del libro para esa factura es cero.
  select coalesce(sum(tax_amount) filter (where voided_at is null), 0) into v_iva from public.vat_book_entry where entry_id in (v_orig.id, v_con.id);
  if v_iva <> 0 or exists (select 1 from public.vat_book_entry where entry_id = v_con.id)
     or not exists (select 1 from public.vat_book_entry where entry_id = v_orig.id)
     or exists (select 1 from public.vat_book_entry where entry_id = v_orig.id and (voided_at is null or voided_by_entry_id is distinct from v_con.id)) then
    raise exception 'PRUEBA V03 E3 · 3: el libro de IVA no queda a cero (vivo %; %).', v_iva,
      (select json_agg(json_build_object('entry', entry_id, 'cuota', tax_amount, 'anulado', voided_at, 'por', voided_by_entry_id)) from public.vat_book_entry where entry_id in (v_orig.id, v_con.id));
  end if;
  if x.tipo <> 'anulacion' or x.invoice_id <> d or x.sin_registro_previo or x.anterior_id <> v_ult or x.huella <> public._verifactu_sha256(x.cadena_huella)
     or x.alta_id <> (select id from public.verifactu_registro where invoice_id = d and tipo = 'alta' order by generado_at limit 1)
     or x.cadena_huella not like 'IDEmisorFacturaAnulada=B28000016&NumSerieFacturaAnulada=' || v_f.number_text || '&%' then
    raise exception 'PRUEBA V03 E3 · 3: el registro de anulación de d (%).', row_to_json(x);
  end if;
  if (select estado from public.verifactu_factura_estado where invoice_id = d) <> 'pendiente' then
    raise exception 'PRUEBA V03 E3 · 3: la anulada no sale «pendiente» con Hacienda (sale %).', (select estado from public.verifactu_factura_estado where invoice_id = d);
  end if;
  raise notice '3 · d anulada: asiento % anulado con el % del mismo día (477 y libro de IVA a cero) y su registro de anulación encadenado', v_orig.number, v_con.number;
  r := public.verifactu_previsto(d, 'anular');
  if (r->>'puede')::boolean or r->>'frase' not like '%ya está anulada%' then raise exception 'PRUEBA V03 E3 · 3: anular dos veces (%).', r; end if;
  -- e: Hacienda la rechazó y no tiene nada aceptado → «sin registro previo».
  r := public.verifactu_anular_factura(e, 'Era una prueba (E3)', 'ANULAR', 'Prueba V03 E3');
  if not (r->>'sin_registro_previo')::boolean then raise exception 'PRUEBA V03 E3 · 3: la anulación de una rechazada sin «sin registro previo» (%).', r; end if;
  raise notice '3 · e (rechazada, nada aceptado): la anulación lleva «sin registro previo»';
end $$;
reset role;

-- ── 4 · La cadena ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare k jsonb; v_n int;
begin
  k := public.verifactu_comprobar_cadena((select v::uuid from _v where clave = 'empresa'));
  select count(*) into v_n from public.verifactu_registro where nif_emisor = 'B28000016' and entorno = 'pruebas';
  if not (k->>'ok')::boolean or (k->>'registros')::int <> v_n or k->'cadenas'->0->>'entorno' <> 'pruebas' then
    raise exception 'PRUEBA V03 E3 · 4: la cadena entera no sale entera (% registros; %).', v_n, k;
  end if;
  raise notice '4 · la cadena: «%»', k->>'frase';
end $$;
reset role;
alter table public.verifactu_registro disable trigger verifactu_registro_inalterable;
update public.verifactu_registro set importe_total = importe_total + 1
 where id = (select id from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'f') and tipo = 'alta' limit 1);
alter table public.verifactu_registro enable trigger verifactu_registro_inalterable;
set local role authenticated;
do $$
declare k jsonb; v_num text := (select number_text from public.customer_invoice where id = (select v::uuid from _v where clave = 'f'));
begin
  k := public.verifactu_comprobar_cadena((select v::uuid from _v where clave = 'empresa'));
  if (k->>'ok')::boolean or not exists (select 1 from jsonb_array_elements(k->'cadenas'->0->'problemas') x where x->>'que' = 'tocado' and x->>'num_serie' = v_num) then
    raise exception 'PRUEBA V03 E3 · 4: la tocada no se ve (%).', k;
  end if;
  raise notice '4 · tocada a mano: «%» · «%»', k->>'frase', (select x->>'frase' from jsonb_array_elements(k->'cadenas'->0->'problemas') x where x->>'que' = 'tocado' limit 1);
end $$;
reset role;
alter table public.verifactu_registro disable trigger verifactu_registro_inalterable;
update public.verifactu_registro set importe_total = importe_total - 1
 where id = (select id from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'f') and tipo = 'alta' limit 1);
alter table public.verifactu_registro enable trigger verifactu_registro_inalterable;

-- ── 5 · Comprobar con Hacienda ─────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); r jsonb; s jsonb; v_msg text;
begin
  r := public.verifactu_cuadre_pedir(v_e, (now() at time zone 'Europe/Madrid')::date, null, 'Prueba V03 E3');
  if (r->>'ya_estaba')::boolean or r->>'estado' <> 'pedido' or r->>'entorno' <> 'pruebas' then raise exception 'PRUEBA V03 E3 · 5: pedir (%).', r; end if;
  s := public.verifactu_cuadre_pedir(v_e, (now() at time zone 'Europe/Madrid')::date, null, 'Prueba V03 E3');
  if not (s->>'ya_estaba')::boolean or s->>'id' <> r->>'id' then raise exception 'PRUEBA V03 E3 · 5: pedir dos veces el mismo mes (%).', s; end if;
  insert into _v values ('cuadre', r->>'id');
  begin
    perform public.verifactu_cuadre_pedir(v_e, ((now() at time zone 'Europe/Madrid')::date + interval '2 months')::date, null, 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 5: pide un mes que no ha llegado.';
  exception when check_violation then null;
  end;
  r := public.verifactu_cuadre_ver(v_e, (now() at time zone 'Europe/Madrid')::date);
  if r->>'estado' <> 'pedido' or r->'resultado' <> 'null'::jsonb then raise exception 'PRUEBA V03 E3 · 5: ver lo pedido (%).', r; end if;
  raise notice '5 · pedido el cuadre de este mes (y no dos veces)';
  -- Las tablas del cuadre no se leen directamente (solo por funciones).
  begin
    perform 1 from public.verifactu_cuadre limit 1;
    raise exception 'PRUEBA V03 E3 · 5: un usuario lee verifactu_cuadre directamente.';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Otra cuenta no puede.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.verifactu_cuadre_pedir((select v::uuid from _v where clave = 'empresa'), (now() at time zone 'Europe/Madrid')::date, null, 'Prueba V03 E3');
    raise exception 'PRUEBA V03 E3 · 5: otra cuenta pide el cuadre de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.verifactu_comprobar_cadena((select v::uuid from _v where clave = 'empresa'));
    raise exception 'PRUEBA V03 E3 · 5: otra cuenta comprueba la cadena de A.';
  exception when no_data_found then null;
  end;
  raise notice '5 · otra cuenta no pide el cuadre de A ni mira su cadena';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
-- Lo que haría conta-verifactu (con la clave de servicio).
do $$
declare
  t jsonb; r jsonb; v_c uuid := (select v::uuid from _v where clave = 'cuadre');
  ra public.verifactu_registro; rb public.verifactu_registro; rg public.verifactu_registro; rf public.verifactu_registro;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  t := public.verifactu_cuadre_tomar('pruebas');
  if t->>'cuadre_id' <> v_c::text or t->>'nif_emisor' <> 'B28000016' or (t->>'ejercicio')::int <> extract(year from v_hoy)::int or t->>'periodo' <> to_char(v_hoy, 'MM') then
    raise exception 'PRUEBA V03 E3 · 5: tomar (%).', t;
  end if;
  -- Lo que Hacienda tiene: a y b con su alta de antes (la subsanación va de
  -- camino), g con otro importe, d (anulada) aún sin su anulación, y una que
  -- Sumied no envió. f no (falta). c y e: rechazadas, no las tiene.
  select * into ra from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'a') and tipo = 'alta' and not subsanacion;
  select * into rb from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'b') and tipo = 'alta' and not subsanacion;
  select * into rg from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'g') and tipo = 'alta';
  select * into rf from public.verifactu_registro where invoice_id = (select v::uuid from _v where clave = 'f') and tipo = 'alta';
  r := public.verifactu_cuadre_pagina(v_c, jsonb_build_array(
    jsonb_build_object('num_serie', ra.num_serie, 'fecha', ra.fecha_expedicion, 'tipo_factura', 'F1', 'cuota_total', ra.cuota_total, 'importe_total', ra.importe_total, 'huella', ra.huella, 'estado', 'Correcto'),
    jsonb_build_object('num_serie', rb.num_serie, 'fecha', rb.fecha_expedicion, 'tipo_factura', 'F1', 'cuota_total', rb.cuota_total, 'importe_total', rb.importe_total, 'huella', rb.huella, 'estado', 'AceptadoConErrores', 'codigo', 1100)
  ), false);
  if (r->>'registros')::int <> 2 then raise exception 'PRUEBA V03 E3 · 5: la primera página (%).', r; end if;
  r := public.verifactu_cuadre_pagina(v_c, jsonb_build_array(
    jsonb_build_object('num_serie', rg.num_serie, 'fecha', rg.fecha_expedicion, 'tipo_factura', 'F1', 'cuota_total', rg.cuota_total, 'importe_total', rg.importe_total + 5, 'huella', rg.huella, 'estado', 'Correcto'),
    jsonb_build_object('num_serie', 'TPV-0001', 'fecha', v_hoy, 'tipo_factura', 'F2', 'cuota_total', 2.10, 'importe_total', 12.10, 'huella', repeat('A', 64), 'estado', 'Correcto')
  ), true);
  r := public.verifactu_cuadre_ver((select v::uuid from _v where clave = 'empresa'), null, v_c);
  if r->>'estado' <> 'hecho' or (r->>'paginas')::int <> 2 then raise exception 'PRUEBA V03 E3 · 5: el cuadre no queda hecho (%).', r; end if;
  r := r->'resultado';
  if (r->>'ok')::boolean or (r->>'hacienda')::int <> 4 or (r->>'cuadran')::int <> 2
     or jsonb_array_length(r->'falta_en_hacienda') <> 1 or r->'falta_en_hacienda'->0->>'num_serie' <> rf.num_serie
     or jsonb_array_length(r->'solo_en_hacienda') <> 1 or r->'solo_en_hacienda'->0->>'num_serie' <> 'TPV-0001'
     or jsonb_array_length(r->'distintas') <> 1 or r->'distintas'->0->>'num_serie' <> rg.num_serie or r->'distintas'->0->>'que' <> 'importe'
     or (r->>'rechazadas')::int <> 0 or (r->>'en_camino')::int < 2 then
    raise exception 'PRUEBA V03 E3 · 5: el cuadre no da lo que debe (%).', r;
  end if;
  raise notice '5 · el cuadre: % cuadran (% de camino), falta en Hacienda la %, solo Hacienda tiene la TPV-0001, la % con otro importe; d y c, de camino',
    r->>'cuadran', r->>'en_camino', rf.num_serie, rg.num_serie;
  -- Un fallo: otro mes, tomado y fallado.
  insert into public.verifactu_cuadre (account_id, company_id, pedido_por_account, entorno, nif_emisor, nombre_emisor, ejercicio, periodo, pedido_por_nombre)
  select c.account_id, c.id, c.account_id, 'pruebas', 'B28000016', 'Taberna de Prueba Norte', 2026, '09', 'Prueba V03 E3'
    from public.company c where c.id = (select v::uuid from _v where clave = 'empresa');
  t := public.verifactu_cuadre_tomar('pruebas');
  perform public.verifactu_cuadre_fallo((t->>'cuadre_id')::uuid, 'Hacienda no contesta (prueba E3)');
  if (select estado || ' · ' || error from public.verifactu_cuadre where id = (t->>'cuadre_id')::uuid) <> 'fallo · Hacienda no contesta (prueba E3)' then
    raise exception 'PRUEBA V03 E3 · 5: el fallo no queda dicho.';
  end if;
  -- Uno que se quedó «consultando» (la función murió a mitad): pasados 10
  -- minutos se vuelve a tomar; antes, no.
  insert into public.verifactu_cuadre (account_id, company_id, pedido_por_account, entorno, nif_emisor, nombre_emisor, ejercicio, periodo, pedido_por_nombre, estado, empezado_at)
  select c.account_id, c.id, c.account_id, 'pruebas', 'B28000016', 'Taberna de Prueba Norte', 2026, x.p, 'Prueba V03 E3', 'consultando', now() - x.hace
    from public.company c, (values ('08', interval '15 minutes'), ('07', interval '2 minutes')) x(p, hace)
   where c.id = (select v::uuid from _v where clave = 'empresa');
  t := public.verifactu_cuadre_tomar('pruebas');
  if t->>'periodo' is distinct from '08' then raise exception 'PRUEBA V03 E3 · 5: el atascado no se vuelve a tomar (%).', t; end if;
  perform public.verifactu_cuadre_fallo((t->>'cuadre_id')::uuid, 'Prueba E3');
  if public.verifactu_cuadre_tomar('pruebas') is not null then raise exception 'PRUEBA V03 E3 · 5: queda algo por tomar (el de hace 2 minutos sigue consultándose).'; end if;
  raise notice '5 · un fallo queda dicho, con su texto; un atascado de más de 10 minutos se vuelve a tomar y uno de 2, no';
end $$;
do $$
declare f text;
begin
  -- Solo la clave de servicio toma, guarda, falla, abre el certificado o despierta.
  foreach f in array array['public.verifactu_cuadre_tomar(text)', 'public.verifactu_cuadre_pagina(uuid,jsonb,boolean)', 'public.verifactu_cuadre_fallo(uuid,text)',
                          'public.verifactu_cert_abrir_cuadre(uuid)', 'public.verifactu_despertar_cuadre()', 'public._verifactu_cuadrar(uuid)',
                          'public._verifactu_contrasiento(uuid,text,text)', 'public._verifactu_carga_de_factura(uuid,text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'PRUEBA V03 E3 · 5: % la puede llamar un usuario.', f;
    end if;
  end loop;
  foreach f in array array['public.verifactu_previsto(uuid,text,jsonb)', 'public.verifactu_anular_factura(uuid,text,text,text)', 'public.verifactu_subsanar(uuid,text,text)',
                          'public.verifactu_comprobar_cadena(uuid)', 'public.verifactu_cuadre_pedir(uuid,date,uuid,text)', 'public.verifactu_cuadre_ver(uuid,date,uuid,uuid)',
                          'public.verifactu_despacho_empresas(uuid)'] loop
    if not has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'PRUEBA V03 E3 · 5: % no la puede llamar el usuario, o la puede llamar cualquiera.', f;
    end if;
  end loop;
  raise notice '5 · permisos: 8 solo de servicio, 7 del usuario y ninguna del anónimo';
end $$;

-- ── 6 · La vuelta atrás ────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T1750_v03_verifactu_corregir_y_cuadrar.down.sql
do $$
declare v_mal text;
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_previsto', 'verifactu_anular_factura', 'verifactu_subsanar',
               'verifactu_comprobar_cadena', 'verifactu_cuadre_pedir', 'verifactu_cuadre_ver', 'verifactu_cuadre_tomar', 'verifactu_cuadre_pagina', 'verifactu_cuadre_fallo',
               'verifactu_cert_abrir_cuadre', 'verifactu_despertar_cuadre', 'verifactu_despacho_empresas', '_verifactu_cuadrar', '_verifactu_puede_cuadrar',
               '_verifactu_contrasiento', '_verifactu_cambios', '_verifactu_carga_de_factura', '_verifactu_anulacion_de', '_verifactu_ultima_alta'))
     or to_regclass('public.verifactu_cuadre') is not null or to_regclass('public.verifactu_cuadre_hacienda') is not null then
    raise exception 'PRUEBA V03 E3 · 6: la vuelta atrás deja algo de la 1750.';
  end if;
  select string_agg(m.firma, ', ') into v_mal from _md5 m
    left join (select p.oid::regprocedure::text firma, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace = 'public'::regnamespace) x on x.firma = m.firma
   where x.h is distinct from m.h;
  if v_mal is not null then raise exception 'PRUEBA V03 E3 · 6: cambian funciones de antes: %.', v_mal; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_venta_emitir', 'verifactu_reenviar', '_verifactu_registrar', '_verifactu_anular', 'verifactu_comprobar')) <> 5 then
    raise exception 'PRUEBA V03 E3 · 6: sobrecargas (regla 2).';
  end if;
  raise notice '6 · la vuelta atrás: nada de la 1750, las 11 de antes con su md5 del principio y sin sobrecargas';
end $$;

rollback;
