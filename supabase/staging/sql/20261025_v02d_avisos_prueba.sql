-- supabase/staging/sql/20261025_v02d_avisos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261025T1912_v02d_avisos (cambia:
-- public._conta_puerta_llegadas, public.conta_puerta_fuentes y
-- public.conta_puerta_fuentes_proponer, misma firma), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A.
--
--   (Empieza con su vuelta atrás, por si ya estuviera.)
--   0. Lo de antes: la huella de las tres funciones que cambian.
--   1. Los abonos no son llegada: una factura de +100 y su abono de −100 diez
--      días después; solo cuenta la primera.
--   2. Un extracto cubre su periodo: el subido hoy del día −14 al −3 sale en
--      «cubre» de la fuente de su cuenta.
--   3. Las fuentes traen el corte de la empresa, la familia (plataforma,
--      banco, proveedor), el canal de unas liquidaciones y el correo de
--      Facturación del proveedor.
--   4. Proponer: corre, y ninguna «varias al mes» va a menos de 7 días.
--   5. Al día: apunta lo propuesto que no estaba; vuelve a aprender el ritmo de
--      lo aprendido que nadie tocó; no pisa lo que tocó una persona; apaga el
--      proveedor que lleva tres periodos sin llegar y lo enciende si llega algo.
--   6. «Ya lo tengo»: cuenta como llegada, y dos veces es la misma.
--   7. La vuelta atrás: sin el trabajo de la prueba, las tres funciones como
--      estaban (su huella) y sin lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V02d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261025T1912_v02d_avisos.down.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p select 'fn:' || p.proname, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('_conta_puerta_llegadas', 'conta_puerta_fuentes', 'conta_puerta_fuentes_proponer');

-- 0 · La empresa A, sus datos de prueba (como postgres: lo que hace la pantalla va después, como usuario).
-- Proponer pide ser de la cuenta: aquí, como el servicio.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid; v_s uuid; v_t uuid; v_canal text; v_banco text; v_otro_banco text;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA V02d: la cuenta A no tiene empresa.'; end if;
  select id into v_s from public.supplier where account_id = v_acc order by created_at limit 1;
  select id into v_t from public.treasury_account where company_id = v_e and account_id = v_acc order by created_at limit 1;
  if v_s is null or v_t is null then raise exception 'PRUEBA V02d: la cuenta A necesita un proveedor y una cuenta del banco.'; end if;
  insert into _p values ('empresa', v_e::text), ('cuenta', v_acc::text), ('proveedor', v_s::text), ('tesoreria', v_t::text);

  -- 1 · Una factura y su abono.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source)
  values (v_acc, v_e, v_s, 'V02D-PRUEBA-1', current_date - 20, 100, 'borrador', 'manual'),
         (v_acc, v_e, v_s, 'V02D-PRUEBA-1-ABONO', current_date - 10, -100, 'borrador', 'manual');
  -- 2 · Un extracto del día −14 al −3, subido hoy.
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to,
                                     movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (v_acc, v_e, v_t, 'fichero', 'n43', current_date - 14, current_date - 3, 0, 0, 0, 'sin_saldo', 'PRUEBA V02d');
  -- 3 · El corte (si la empresa no lo tenía) y el correo de Facturación del proveedor.
  insert into public.bank_settings (company_id, account_id, cutover_date)
  select v_e, v_acc, date '2026-10-01' where not exists (select 1 from public.bank_settings where company_id = v_e);
  insert into public.supplier_contact (account_id, supplier_id, name, role, email)
  values (v_acc, v_s, 'Facturación prueba', 'billing', 'facturas-v02d@proveedor-prueba.es');

  -- 5 · Lo que ya estaba apuntado: un canal aprendido sin tocar (con otro ritmo),
  -- un banco tocado por una persona (mensual) y un proveedor aprendido sin llegadas.
  select x->>'clave' into v_canal from jsonb_array_elements(public.conta_puerta_fuentes_proponer(v_e)) x where x->>'tipo' = 'intermediario' limit 1;
  select x->>'clave' into v_banco from jsonb_array_elements(public.conta_puerta_fuentes_proponer(v_e)) x where x->>'clave' = 'banco:' || v_t;
  select x->>'clave' into v_otro_banco from jsonb_array_elements(public.conta_puerta_fuentes_proponer(v_e)) x where x->>'tipo' = 'banco' and x->>'clave' <> 'banco:' || v_t limit 1;
  if v_canal is null or v_banco is null then raise exception 'PRUEBA V02d: en A tiene que proponer un canal y el banco de su cuenta principal (canal %, banco %).', v_canal, v_banco; end if;
  insert into _p values ('canal_clave', v_canal), ('banco_clave', v_banco), ('otro_banco', coalesce(v_otro_banco, ''));
  insert into public.supplier_expected_invoice (account_id, company_id, kind, cadence, gap_days, source, source_key, match, label)
  values (v_acc, v_e, 'intermediario', 'varias', 30, 'aprendido', v_canal, jsonb_build_object('canal', split_part(v_canal, ':', 2)), 'Canal de prueba');
  insert into public.supplier_expected_invoice (account_id, company_id, kind, cadence, typical_day, source, source_key, match, label, updated_by_name)
  values (v_acc, v_e, 'banco', 'mensual', 3, 'aprendido', v_banco, jsonb_build_object('tesoreria', v_t), 'Banco de prueba', 'Persona de prueba');
  insert into public.supplier_expected_invoice (account_id, company_id, kind, cadence, typical_day, source, source_key, match, label)
  values (v_acc, v_e, 'proveedor', 'mensual', 5, 'aprendido', 'nif:V02D-DORMIDO', '{}'::jsonb, 'Dormido de prueba');
end $$;

\i supabase/migrations/20261025T1912_v02d_avisos.sql

-- 1 a 6 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa');
  v_s uuid := (select v::uuid from _p where clave = 'proveedor');
  v_t text := (select v from _p where clave = 'tesoreria');
  v_d jsonb; v_f jsonb; v_r jsonb; v_x uuid; v_p jsonb;
begin
  -- Una fuente del proveedor, a mano (la que mira las facturas y su abono).
  v_r := public.conta_puerta_fuente_guardar(v_e, jsonb_build_object('tipo', 'proveedor', 'nombre', 'Proveedor V02d', 'proveedor_id', v_s, 'cadencia', 'mensual', 'dia', 5), 'Prueba V02d');
  insert into _p values ('fuente_proveedor', v_r->>'id');

  v_d := public.conta_puerta_fuentes(v_e);
  -- 1 · Los abonos no son llegada.
  select f into v_f from jsonb_array_elements(v_d->'fuentes') f where f->>'id' = v_r->>'id';
  if not (v_f->'llegadas' ? to_char(current_date - 20, 'YYYY-MM-DD')) then
    raise exception 'PRUEBA V02d 1: la factura de +100 no cuenta como llegada (%).', v_f->'llegadas';
  end if;
  if v_f->'llegadas' ? to_char(current_date - 10, 'YYYY-MM-DD') then
    raise exception 'PRUEBA V02d 1: el abono de −100 cuenta como llegada (%).', v_f->'llegadas';
  end if;
  raise notice '1 · los abonos no son llegada: %', v_f->'llegadas';
  -- 3 · El correo de Facturación, la familia y el corte.
  if v_f->>'correo' is distinct from 'facturas-v02d@proveedor-prueba.es' then raise exception 'PRUEBA V02d 3: el correo del proveedor es %.', v_f->>'correo'; end if;
  if v_f->>'familia' not in ('proveedor', 'suministro', 'plataforma') then raise exception 'PRUEBA V02d 3: la familia del proveedor es %.', v_f->>'familia'; end if;
  if v_f->>'tocada' is distinct from 'true' then raise exception 'PRUEBA V02d 3: una fuente a mano tiene que salir «tocada».'; end if;
  if v_d->>'corte' is null then raise exception 'PRUEBA V02d 3: las fuentes no traen el corte de la empresa.'; end if;
  -- 2 · El extracto cubre su periodo.
  select f into v_f from jsonb_array_elements(v_d->'fuentes') f where f->>'clave' = (select v from _p where clave = 'banco_clave');
  if not (v_f->'cubre' @> jsonb_build_array(jsonb_build_array(to_char(current_date - 14, 'YYYY-MM-DD'), to_char(current_date - 3, 'YYYY-MM-DD')))) then
    raise exception 'PRUEBA V02d 2: el extracto del −14 al −3 no sale en lo que cubre la cuenta (%).', v_f->'cubre';
  end if;
  if v_f->>'familia' <> 'banco' then raise exception 'PRUEBA V02d 3: la familia del banco es %.', v_f->>'familia'; end if;
  raise notice '2 · el extracto cubre su periodo: %', v_f->'cubre';
  select f into v_f from jsonb_array_elements(v_d->'fuentes') f where f->>'clave' = (select v from _p where clave = 'canal_clave');
  if v_f->>'familia' <> 'plataforma' or v_f->'canal'->>'id' is null then raise exception 'PRUEBA V02d 3: el canal sale como % con canal %.', v_f->>'familia', v_f->'canal'; end if;
  raise notice '3 · el corte %, el correo de Facturación, y las familias: proveedor, banco y plataforma (%)', v_d->>'corte', v_f->'canal'->>'nombre';

  -- 4 · Proponer.
  for v_p in select x from jsonb_array_elements(public.conta_puerta_fuentes_proponer(v_e)) x loop
    if v_p->>'cadencia' not in ('mensual', 'quincenal', 'semanal', 'varias') then raise exception 'PRUEBA V02d 4: ritmo % en %.', v_p->>'cadencia', v_p->>'clave'; end if;
    if v_p->>'cadencia' = 'varias' and v_p->>'tipo' in ('proveedor', 'alquiler') and (v_p->>'cada')::int < 7 then raise exception 'PRUEBA V02d 4: % cada % días.', v_p->>'clave', v_p->>'cada'; end if;
  end loop;
  raise notice '4 · proponer: corre, y ninguna «varias al mes» va a menos de 7 días';

  -- 5 · Al día (lo que cambia en la tabla se mira después, como postgres).
  v_r := public.conta_puerta_al_dia(v_e);
  insert into _p values ('al_dia_1', v_r::text);
  v_r := public.conta_puerta_al_dia(v_e);
  insert into _p values ('al_dia_2', v_r::text);

  -- 6 · «Ya lo tengo».
  v_x := (select v::uuid from _p where clave = 'fuente_proveedor');
  v_r := public.conta_puerta_ya_lo_tengo(v_x, current_date - 1, 'Prueba V02d');
  if (v_r->>'ya_estaba')::boolean then raise exception 'PRUEBA V02d 6: «Ya lo tengo» dice que ya estaba la primera vez.'; end if;
  v_r := public.conta_puerta_ya_lo_tengo(v_x, current_date - 1, 'Prueba V02d');
  if not (v_r->>'ya_estaba')::boolean then raise exception 'PRUEBA V02d 6: «Ya lo tengo» dos veces apunta dos.'; end if;
  select f into v_f from jsonb_array_elements(public.conta_puerta_fuentes(v_e)->'fuentes') f where f->>'id' = v_x::text;
  if not (v_f->'llegadas' ? to_char(current_date - 1, 'YYYY-MM-DD')) then raise exception 'PRUEBA V02d 6: «Ya lo tengo» no cuenta como llegada (%).', v_f->'llegadas'; end if;
  raise notice '6 · «Ya lo tengo»: cuenta como llegada, y dos veces es la misma';
end $$;
reset role;

-- 5 · Al día: lo que ha cambiado.
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa');
  v_r jsonb := (select v::jsonb from _p where clave = 'al_dia_1');
  v_r2 jsonb := (select v::jsonb from _p where clave = 'al_dia_2');
begin
  if (v_r->>'reaprendidas')::int < 1 then raise exception 'PRUEBA V02d 5: no ha vuelto a aprender el canal sin tocar (%).', v_r; end if;
  if (v_r->>'dormidas')::int < 1 then raise exception 'PRUEBA V02d 5: no ha apagado el proveedor sin llegadas (%).', v_r; end if;
  if (select v from _p where clave = 'otro_banco') <> '' and (v_r->>'nuevas')::int < 1 then raise exception 'PRUEBA V02d 5: no ha apuntado el otro banco (%).', v_r; end if;
  if (select cadence from public.supplier_expected_invoice where company_id = v_e and source_key = (select v from _p where clave = 'canal_clave')) = 'varias' then
    raise exception 'PRUEBA V02d 5: el canal sin tocar sigue «varias al mes».';
  end if;
  if (select cadence from public.supplier_expected_invoice where company_id = v_e and source_key = (select v from _p where clave = 'banco_clave')) <> 'mensual' then
    raise exception 'PRUEBA V02d 5: ha pisado el ritmo del banco que tocó una persona.';
  end if;
  if (select active from public.supplier_expected_invoice where company_id = v_e and source_key = 'nif:V02D-DORMIDO') then
    raise exception 'PRUEBA V02d 5: el proveedor sin llegadas sigue encendido.';
  end if;
  if (v_r2->>'nuevas')::int + (v_r2->>'reaprendidas')::int + (v_r2->>'dormidas')::int + (v_r2->>'despiertas')::int <> 0 then
    raise exception 'PRUEBA V02d 5: la segunda vez aún cambia cosas (%).', v_r2;
  end if;
  raise notice '5 · al día (%): apunta lo nuevo, reaprende lo que nadie tocó, no pisa lo tocado y apaga lo dormido; la segunda vez, nada', v_r;
end $$;

-- 5b · Si llega algo del dormido («Ya lo tengo»), se enciende.
insert into _p select 'dormido', id::text from public.supplier_expected_invoice
 where company_id = (select v::uuid from _p where clave = 'empresa') and source_key = 'nif:V02D-DORMIDO';
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_r jsonb;
begin
  perform public.conta_puerta_ya_lo_tengo((select v::uuid from _p where clave = 'dormido'), current_date - 2, 'Prueba V02d');
  v_r := public.conta_puerta_al_dia(v_e);
  if (v_r->>'despiertas')::int < 1 then raise exception 'PRUEBA V02d 5b: el proveedor dormido no se enciende al llegarle algo (%).', v_r; end if;
  raise notice '5b · lo dormido se enciende si llega algo';
end $$;
reset role;

-- 7 · La vuelta atrás: sin el trabajo de la prueba (su guarda para si lo hay), todo como estaba.
delete from public.conta_puerta_recibido where company_id = (select v::uuid from _p where clave = 'empresa');
\i supabase/vuelta-atras/20261025T1912_v02d_avisos.down.sql
do $$ begin
  if exists (select 1 from _p b join pg_proc p on 'fn:' || p.proname = b.clave join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) <> b.v) then
    raise exception 'PRUEBA V02d 7: _conta_puerta_llegadas, conta_puerta_fuentes o conta_puerta_fuentes_proponer no vuelven como estaban.';
  end if;
  if to_regclass('public.conta_puerta_recibido') is not null or to_regprocedure('public.conta_puerta_al_dia(uuid)') is not null
     or to_regprocedure('public.conta_puerta_ya_lo_tengo(uuid,date,text)') is not null
     or exists (select 1 from pg_proc where proname = '_conta_puerta_cubre') then
    raise exception 'PRUEBA V02d 7: la vuelta atrás se deja tablas o funciones.';
  end if;
  raise notice '7 · la vuelta atrás: todo como estaba';
  raise notice 'PRUEBA V02d en verde: los abonos, los extractos, el corte, la familia, el correo, proponer, al día, «Ya lo tengo» y la vuelta atrás.';
end $$;

rollback;
