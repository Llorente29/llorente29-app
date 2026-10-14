-- ============================================================================
-- PRUEBA (staging) · B01 · tarjetas de débito, IBAN recordados y ticket
-- (20261101T0140, y el «local_id» del destino en bank_casar de la 0110).
-- Todo en una transacción con ROLLBACK: no deja nada. Fichero entero y como
-- USUARIO (el administrador de A con su rol «authenticated»). Datos inventados.
-- Usa los bancos de la semilla del frente B (seed_b01_staging.sql):
-- «Banco B01 · Norte» (común) y «Banco B01 · Sur» (del local de A).
--
--   1. Alta de tarjeta: con 4 dígitos sí; con el número entero no; sin
--      titular no; sin local ni «común» pregunta «¿De qué local…?»; dos
--      tarjetas en la misma cuenta (Ana, del local; Luis, común); la misma
--      tarjeta viva dos veces no.
--   2. Qué tarjeta pagó: se apunta en el movimiento; una tarjeta de OTRA
--      cuenta no se acepta.
--   3. Casado con la tarjeta: la línea de la 572 y la del gasto llevan el
--      local de la tarjeta, no el de la cuenta (que es común).
--   4. Ticket: una ruta que no existe en el bucket se rechaza; la que existe,
--      en su carpeta, se guarda y queda en «Lo que ha hecho Folvy».
--   5. IBAN recordado: el IBAN de un extracto queda unido a su cuenta; el de
--      la propia cuenta no se duplica.
--   6. Baja: la tarjeta dada de baja deja de estar viva y se puede volver a
--      dar de alta con los mismos dígitos.
--   7. RLS: la cuenta de B no ve tarjetas ni IBAN de A, ni puede dar de alta.
-- ============================================================================

begin;

create temp table _t (que text primary key, id uuid) on commit drop;
grant all on _t to authenticated;

-- ── 0 · Siembra (como el dueño de la base): una foto de ticket en el bucket ──
--        (la sube la persona desde el móvil; aquí basta con que exista).
do $$
begin
  if (select count(*) from public.treasury_account
       where id in ('b0100000-0000-4000-8000-0000000000b1', 'b0100000-0000-4000-8000-0000000000b2')) <> 2 then
    raise exception 'PRUEBA B01 TARJETAS · 0: faltan los bancos de la semilla del frente B (seed_b01_staging.sql).';
  end if;
  if not exists (select 1 from storage.buckets where id = 'banco-tickets' and not public) then
    raise exception 'PRUEBA B01 TARJETAS · 0: el bucket banco-tickets no existe o es público.';
  end if;
  raise notice '0 · bancos de la semilla presentes; bucket banco-tickets privado';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 · Alta de tarjeta ─────────────────────────────────────────────────────
do $$
declare
  norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1'; sur constant uuid := 'b0100000-0000-4000-8000-0000000000b2';
  a_local constant uuid := 'c01a0000-0000-4000-8000-0000000000a2'; v uuid; v_ok boolean := false;
begin
  begin
    perform public.bank_tarjeta_guardar(norte, null, '4111 1111 1111 4821', 'Ana Prueba', a_local, false);
  exception when others then v_ok := sqlerrm like 'De la tarjeta solo se guardan los 4 últimos dígitos%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 1: entró el número entero de una tarjeta.'; end if;
  v_ok := false;
  begin
    perform public.bank_tarjeta_guardar(norte, null, '4821', '  ', a_local, false);
  exception when others then v_ok := sqlerrm like '¿Quién lleva esta tarjeta?%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 1: entró una tarjeta sin titular.'; end if;
  v_ok := false;
  begin
    perform public.bank_tarjeta_guardar(norte, null, '4821', 'Ana Prueba', null, false);
  exception when others then v_ok := sqlerrm like '¿De qué local es esta tarjeta?%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 1: dio de alta sin preguntar de qué local es.'; end if;
  v_ok := false;
  begin
    perform public.bank_tarjeta_guardar(norte, null, '4821', 'Ana Prueba', a_local, true);
  exception when others then v_ok := sqlerrm like '¿De qué local es esta tarjeta?%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 1: aceptó un local Y «común» a la vez.'; end if;

  v := public.bank_tarjeta_guardar(norte, null, '4821', 'Ana Prueba', a_local, false);
  insert into _t values ('ana', v);
  v := public.bank_tarjeta_guardar(norte, null, '·· 0937', 'Luis Prueba', null, true);
  insert into _t values ('luis', v);
  v := public.bank_tarjeta_guardar(sur, null, '5555', 'Marta Prueba', a_local, false);
  insert into _t values ('marta', v);
  if (select string_agg(last4 || ':' || holder_name || ':' || coalesce(location_id::text, 'común'), ' ' order by last4)
        from public.bank_card where treasury_account_id = norte and is_active) <> '0937:Luis Prueba:común 4821:Ana Prueba:' || a_local then
    raise exception 'PRUEBA B01 TARJETAS · 1: las dos tarjetas de Norte no quedaron como se dieron.';
  end if;
  v_ok := false;
  begin
    perform public.bank_tarjeta_guardar(norte, null, '4821', 'Otra Persona', null, true);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 1: la misma tarjeta quedó viva dos veces en la misma cuenta.'; end if;
  raise notice '1 · número entero, sin titular, sin local y local+común rechazados; Ana (···4821, del local) y Luis (···0937, común) en Norte; repetida no';
end $$;

-- ── 2 · Qué tarjeta pagó ────────────────────────────────────────────────────
do $$
declare
  norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1';
  v_r jsonb; m_ana uuid; m_luis uuid; v_ok boolean := false;
begin
  v_r := public.bank_importar(norte, 'fichero', 'csv:bbva', 'tarjetas.xlsx', repeat('9', 64), '2026-10-09', '2026-10-10', null, null,
    'El fichero no trae saldos.', null, '[
      {"fecha":"2026-10-09","importe":-23.40,"concepto_banco":"COMPRA TARJ. 4821 MERCADO CENTRAL","concepto_limpio":"compra con tarjeta MERCADO CENTRAL","comun":"12","huella":"tj-prueba-1","huella_suave":"tjs-prueba-1"},
      {"fecha":"2026-10-10","importe":-61.90,"concepto_banco":"COMPRA TARJ. 0937 FERRETERIA LOPEZ","concepto_limpio":"compra con tarjeta FERRETERIA LOPEZ","comun":"12","huella":"tj-prueba-2","huella_suave":"tjs-prueba-2"}
    ]');
  if (v_r->>'nuevos')::int <> 2 then raise exception 'PRUEBA B01 TARJETAS · 2: importación: %', v_r; end if;
  select id into m_ana from public.bank_movement where treasury_account_id = norte and fingerprint = 'tj-prueba-1';
  select id into m_luis from public.bank_movement where treasury_account_id = norte and fingerprint = 'tj-prueba-2';
  perform public.bank_tarjeta_del_movimiento(m_ana, (select id from _t where que = 'ana'));
  perform public.bank_tarjeta_del_movimiento(m_luis, (select id from _t where que = 'luis'));
  if (select string_agg(c.holder_name, ' ' order by m.op_date) from public.bank_movement m join public.bank_card c on c.id = m.card_id
       where m.id in (m_ana, m_luis)) <> 'Ana Prueba Luis Prueba' then
    raise exception 'PRUEBA B01 TARJETAS · 2: cada pago no quedó con su titular.';
  end if;
  begin
    perform public.bank_tarjeta_del_movimiento(m_ana, (select id from _t where que = 'marta'));
  exception when others then v_ok := sqlerrm like 'Esa tarjeta no es de la cuenta de este movimiento.%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 2: aceptó una tarjeta de otra cuenta.'; end if;
  insert into _t values ('m_ana', m_ana), ('m_luis', m_luis);
  raise notice '2 · ···4821 → Ana y ···0937 → Luis en la misma cuenta; la de Marta (otra cuenta) rechazada';
end $$;

-- ── 3 · Casado con el local de la tarjeta ───────────────────────────────────
do $$
declare
  a_local constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  m_ana uuid := (select id from _t where que = 'm_ana'); v_r jsonb; v_lineas text;
begin
  v_r := public.bank_casar(m_ana, jsonb_build_object('tipo', 'cuenta', 'local_id', a_local,
                                                     'lineas', '[{"cuenta":"62600000","importe":23.40}]'::jsonb),
                           'probable', 'Tarjeta de Ana (···4821): pídele el ticket.', '[]', 'persona', null);
  select string_agg(ca.code || ':' || coalesce(jl.location_id::text, 'común'), ' ' order by jl.position) into v_lineas
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = (v_r->>'asiento')::uuid;
  if v_lineas <> '57200911:' || a_local || ' 62600000:' || a_local then
    raise exception 'PRUEBA B01 TARJETAS · 3: las líneas no llevan el local de la tarjeta: %', v_lineas;
  end if;
  raise notice '3 · casado el pago de Ana: 572 y gasto con el local de la tarjeta (la cuenta es común)';
end $$;

-- ── 4 · Ticket ──────────────────────────────────────────────────────────────
reset role;
do $$
declare m_ana uuid := (select id from _t where que = 'm_ana'); a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
begin
  -- La foto que la persona sube desde el móvil (como dueño: aquí solo hace falta que exista).
  insert into storage.objects (bucket_id, name) values ('banco-tickets', a_cuenta || '/' || m_ana || '/prueba.jpg');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare m_ana uuid := (select id from _t where que = 'm_ana'); a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
        v_ok boolean := false; v_m public.bank_movement;
begin
  begin
    perform public.bank_ticket_guardar(m_ana, a_cuenta || '/' || m_ana || '/no-existe.jpg');
  exception when others then v_ok := sqlerrm like 'No encuentro esa foto del ticket.%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 4: aceptó un ticket que no existe.'; end if;
  v_ok := false;
  begin
    perform public.bank_ticket_guardar(m_ana, a_cuenta || '/' || (select id from _t where que = 'm_luis') || '/prueba.jpg');
  exception when others then v_ok := sqlerrm like 'No encuentro esa foto del ticket.%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 4: aceptó un ticket de la carpeta de otro movimiento.'; end if;
  perform public.bank_ticket_guardar(m_ana, a_cuenta || '/' || m_ana || '/prueba.jpg');
  select * into v_m from public.bank_movement where id = m_ana;
  if v_m.receipt_path is distinct from a_cuenta || '/' || m_ana || '/prueba.jpg' or v_m.receipt_at is null then
    raise exception 'PRUEBA B01 TARJETAS · 4: el ticket no quedó en el movimiento.';
  end if;
  if not exists (select 1 from public.bank_activity_log where movement_id = m_ana and summary = 'Ticket subido') then
    raise exception 'PRUEBA B01 TARJETAS · 4: el ticket no quedó en «Lo que ha hecho Folvy».';
  end if;
  raise notice '4 · ticket inexistente y de otra carpeta rechazados; el bueno guardado y registrado';
end $$;

-- ── 5 · IBAN recordado ──────────────────────────────────────────────────────
do $$
declare norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1'; sur constant uuid := 'b0100000-0000-4000-8000-0000000000b2';
begin
  perform public.bank_iban_recordar(norte, 'ES02 0182 9101 3200 0000 0011');   -- el suyo: no se apunta
  perform public.bank_iban_recordar(norte, 'es91 2100 0418 4502 0005 1332');
  if (select string_agg(iban, ' ') from public.bank_account_iban where treasury_account_id = norte) <> 'ES9121000418450200051332' then
    raise exception 'PRUEBA B01 TARJETAS · 5: el IBAN no quedó recordado (o se duplicó el propio).';
  end if;
  -- La persona se equivocó: ese IBAN es de Sur. Se mueve, no se duplica.
  perform public.bank_iban_recordar(sur, 'ES9121000418450200051332');
  if (select count(*) from public.bank_account_iban where iban = 'ES9121000418450200051332') <> 1
     or (select treasury_account_id from public.bank_account_iban where iban = 'ES9121000418450200051332') <> sur then
    raise exception 'PRUEBA B01 TARJETAS · 5: corregir a qué cuenta va un IBAN lo duplicó.';
  end if;
  raise notice '5 · IBAN recordado; el propio no se apunta; corregir la cuenta lo mueve sin duplicar';
end $$;

-- ── 6 · Baja ────────────────────────────────────────────────────────────────
do $$
declare norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1'; v uuid;
begin
  perform public.bank_tarjeta_baja((select id from _t where que = 'luis'));
  if exists (select 1 from public.bank_card where id = (select id from _t where que = 'luis') and (is_active or deactivated_at is null)) then
    raise exception 'PRUEBA B01 TARJETAS · 6: la baja no dejó la tarjeta inactiva.';
  end if;
  if (select c.holder_name from public.bank_movement m join public.bank_card c on c.id = m.card_id where m.id = (select id from _t where que = 'm_luis')) <> 'Luis Prueba' then
    raise exception 'PRUEBA B01 TARJETAS · 6: la baja borró a quién se atribuyó un pago ya hecho.';
  end if;
  v := public.bank_tarjeta_guardar(norte, null, '0937', 'Nuevo Titular', null, true);
  raise notice '6 · baja: inactiva, el pago ya atribuido sigue siendo de Luis; los mismos dígitos se pueden dar de alta otra vez';
end $$;
reset role;

-- ── 7 · RLS: la cuenta de B no ve tarjetas ni IBAN de A, ni puede dar de alta ──
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  if (select count(*) from public.bank_card) + (select count(*) from public.bank_account_iban) <> 0 then
    raise exception 'PRUEBA B01 TARJETAS · 7: B ve tarjetas o IBAN de A.';
  end if;
  begin
    perform public.bank_tarjeta_guardar('b0100000-0000-4000-8000-0000000000b1', null, '1111', 'Intrusa', null, true);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA B01 TARJETAS · 7: B dio de alta una tarjeta en una cuenta de A.'; end if;
  raise notice '7 · B no ve ni una tarjeta ni un IBAN de A y no puede dar de alta (42501)';
end $$;
reset role;

do $$ begin raise notice 'PRUEBA B01 · tarjetas en verde: 7 de 7.'; end $$;
rollback;
