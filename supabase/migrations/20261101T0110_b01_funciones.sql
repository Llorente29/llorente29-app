-- ============================================================================
-- B01 · 2 · BANCOS Y CONCILIACIÓN: LAS FUNCIONES
-- ----------------------------------------------------------------------------
-- Encargo B01, tarea 3. Todo NUEVO: funciones que no existían. Solo ellas
-- escriben en las tablas de 20261101T0100; cada una comprueba que quien llama
-- es administrador o encargado de la cuenta (como validar en el libro).
--
--   bank_ajustes_guardar        serie de tesorería, validar solo lo seguro, corte.
--   bank_cuenta_alta            dar de alta un banco (o tarjeta) con su IBAN, la
--                               cuenta contable que ya tenga en el plan y la
--                               respuesta a «¿De qué local es esta cuenta?» (P1).
--   bank_cuenta_local           contestar esa pregunta después.
--   bank_cuenta_iban_corregir   aceptar la corrección propuesta del IBAN (P1:
--                               nunca solo).
--   bank_cuentas_por_dar_de_alta  las 572 del plan sin banco en Folvy, con el
--                               IBAN que lleven en el nombre (57200002 y 57200003
--                               en Foodint).
--   bank_importar               un extracto de una cuenta: lo vuelve a cuadrar
--                               aquí, no entra dos veces, mide la continuidad con
--                               el anterior y marca lo anterior al corte.
--   bank_proponer               guardar lo que el motor cree («Para confirmar»,
--                               «Por aclarar», «Antes del corte · sin pareja»).
--   bank_casar                  casar un movimiento: enlaza el asiento que ya
--                               existe (P2: un pago por dos caminos, un asiento)
--                               o propone el suyo por _journal_entry_proponer
--                               (C04: numeración al validar, huella encadenada);
--                               lo seguro se valida solo si la empresa lo activa.
--   bank_deshacer               deshace un casado: su asiento propuesto se quita,
--                               el validado se anula con contraasiento.
--   bank_ignorar / bank_repetido_resolver
--   bank_regla_guardar / bank_regla_estado   (con su registro)
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0110_b01_funciones.down.sql
-- Prueba: supabase/staging/sql/20261101_b01_bancos_prueba.sql
-- ============================================================================

-- ── Ayudantes ──────────────────────────────────────────────────────────────
create or replace function public._bank_cuenta_de_empresa(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.company where id = p_company;
  if v is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v) then
    raise exception 'Solo un administrador o un encargado de la cuenta trabaja los bancos.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._bank_cuenta_de_empresa(uuid) from public, anon, authenticated;

/** La cuenta contable (código) de un banco de Folvy: su enlace del plan. */
create or replace function public._bank_cuenta_572(p_treasury uuid)
returns text language sql stable security definer set search_path = public as $$
  select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
   where l.entity = 'bank_account' and l.entity_id = p_treasury::text and l.role = 'principal' limit 1
$$;
revoke all on function public._bank_cuenta_572(uuid) from public, anon, authenticated;

create or replace function public._bank_ajustes(p_company uuid)
returns public.bank_settings language plpgsql stable security definer set search_path = public as $$
declare v public.bank_settings;
begin
  select * into v from public.bank_settings where company_id = p_company;
  if v.company_id is null then
    -- Sin fila: los valores por defecto. El corte, el de la empresa (lo traído llega hasta imported_until).
    v.company_id := p_company; v.treasury_series := 3; v.validate_safe := false;
    select max(imported_until) + 1 into v.cutover_date from public.fiscal_year where company_id = p_company and imported_until is not null;
  end if;
  return v;
end $$;
revoke all on function public._bank_ajustes(uuid) from public, anon, authenticated;

create or replace function public._bank_log(p_account uuid, p_company uuid, p_mov uuid, p_match uuid, p_ext uuid, p_accion text, p_por text, p_resumen text, p_detalle jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.bank_activity_log (account_id, company_id, movement_id, match_id, statement_id, action, by_who, summary, detail, created_by, created_by_name)
  values (p_account, p_company, p_mov, p_match, p_ext, p_accion, p_por, p_resumen, coalesce(p_detalle, '{}'::jsonb), auth.uid(),
          case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end)
$$;
revoke all on function public._bank_log(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ── Ajustes ────────────────────────────────────────────────────────────────
create or replace function public.bank_ajustes_guardar(p_company uuid, p_serie smallint, p_validar_seguro boolean, p_corte date)
returns public.bank_settings language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company); v public.bank_settings;
begin
  if not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Los ajustes del banco los cambia un administrador.' using errcode = '42501';
  end if;
  insert into public.bank_settings (company_id, account_id, treasury_series, validate_safe, cutover_date, updated_by, updated_by_name)
  values (p_company, v_cuenta, p_serie, p_validar_seguro, p_corte, auth.uid(), public.conta_nombre_actor())
  on conflict (company_id) do update set treasury_series = excluded.treasury_series, validate_safe = excluded.validate_safe,
     cutover_date = excluded.cutover_date, updated_at = now(), updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name
  returning * into v;
  return v;
end $$;
grant execute on function public.bank_ajustes_guardar(uuid, smallint, boolean, date) to authenticated;

-- ── Cuentas del banco ──────────────────────────────────────────────────────
create or replace function public.bank_cuenta_alta(p_company uuid, p_kind text, p_nombre text, p_iban text, p_cuenta_contable text,
                                                   p_local uuid, p_comun boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company); v_id uuid; v_ca uuid;
begin
  if p_kind not in ('bank', 'card') then raise exception 'Una cuenta del banco es «bank» o «card».' using errcode = '23514'; end if;
  if p_kind = 'bank' and coalesce(trim(p_iban), '') = '' then
    raise exception 'Una cuenta del banco necesita su IBAN: escríbelo o súbela desde su primer extracto, que lo trae.' using errcode = '23514';
  end if;
  -- P1: la pregunta se contesta al dar de alta: un local o «común», nunca supuesto.
  if (p_local is null) = (coalesce(p_comun, false) = false) then
    raise exception '¿De qué local es esta cuenta? Elige un local o «común».' using errcode = '23514';
  end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_cuenta) then
    raise exception 'Ese local no es de la cuenta.' using errcode = '23514';
  end if;
  if p_cuenta_contable is not null then
    select id into v_ca from public.company_account where company_id = p_company and code = p_cuenta_contable;
    if v_ca is null or p_cuenta_contable not like '57%' then
      raise exception 'La cuenta % no está en el plan o no es de tesorería (57).', p_cuenta_contable using errcode = '23514';
    end if;
    if exists (select 1 from public.company_account_link where company_account_id = v_ca and entity = 'bank_account') then
      raise exception 'La cuenta % ya es de otro banco de Folvy.', p_cuenta_contable using errcode = '23514';
    end if;
  end if;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active, created_by, location_id)
  values (v_cuenta, p_company, p_kind, trim(p_nombre), nullif(upper(replace(coalesce(p_iban, ''), ' ', '')), ''), '572', false, true, auth.uid(), p_local)
  returning id into v_id;
  if v_ca is not null then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, p_company, v_ca, 'bank_account', v_id::text, 'principal', 'manual', auth.uid());
  end if;
  return v_id;
end $$;
grant execute on function public.bank_cuenta_alta(uuid, text, text, text, text, uuid, boolean) to authenticated;

create or replace function public.bank_cuenta_local(p_treasury uuid, p_local uuid, p_comun boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account;
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  if (p_local is null) = (coalesce(p_comun, false) = false) then
    raise exception '¿De qué local es esta cuenta? Elige un local o «común».' using errcode = '23514';
  end if;
  update public.treasury_account set location_id = p_local where id = p_treasury;
end $$;
grant execute on function public.bank_cuenta_local(uuid, uuid, boolean) to authenticated;

create or replace function public.bank_cuenta_iban_corregir(p_treasury uuid, p_iban text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_nuevo text := upper(replace(coalesce(p_iban, ''), ' ', ''));
begin
  select * into v_t from public.treasury_account where id = p_treasury for update;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  if v_nuevo = '' then raise exception 'Escribe el IBAN.' using errcode = '23514'; end if;
  update public.treasury_account set iban = v_nuevo, iban_review = null where id = p_treasury;
  perform public._bank_log(v_t.account_id, v_t.company_id, null, null, null, 'regla', 'persona',
    'IBAN de «' || v_t.name || '» corregido', jsonb_build_object('antes', v_t.iban, 'despues', v_nuevo));
end $$;
grant execute on function public.bank_cuenta_iban_corregir(uuid, text) to authenticated;

create or replace function public.bank_cuentas_por_dar_de_alta(p_company uuid)
returns table (code text, name text, iban_en_nombre text)
language sql stable security definer set search_path = public as $$
  select ca.code, ca.name, upper(replace((regexp_match(upper(ca.name), '([A-Z]{2}\d{2}(?:\s?[0-9A-Z]{4}){5})'))[1], ' ', ''))
    from public.company_account ca
   where ca.company_id = p_company and ca.code like '572%' and ca.kind <> 'template' and ca.status = 'activa'
     and public.belongs_to_account(ca.account_id)
     and not exists (select 1 from public.company_account_link l where l.company_account_id = ca.id and l.entity = 'bank_account')
   order by ca.code
$$;
grant execute on function public.bank_cuentas_por_dar_de_alta(uuid) to authenticated;

-- ── Importar un extracto ───────────────────────────────────────────────────
-- p_movs: [{fecha, fecha_valor, importe, concepto_banco, concepto_limpio, comun, propio, documento, ref1, ref2, divisa_origen?,
--           importe_origen?, huella, huella_suave}]. Las huellas las calcula el núcleo (extractoBanco.ts) y la base
-- las hace únicas por cuenta; el cuadre se vuelve a hacer aquí con lo que llega.
create or replace function public.bank_importar(p_treasury uuid, p_fuente text, p_formato text, p_fichero text, p_sha256 text,
                                                p_desde date, p_hasta date, p_saldo_inicial numeric, p_saldo_final numeric,
                                                p_sin_comprobar text, p_iban_fichero text, p_movs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t public.treasury_account; v_cuenta uuid; v_aj public.bank_settings; v_ext uuid; v_suma numeric := 0; v_m jsonb;
  v_nuevos int := 0; v_rep int := 0; v_pos int := 0; v_prev public.bank_statement; v_cont text; v_hueco numeric;
  v_id uuid; v_estado text; v_n int := coalesce(jsonb_array_length(p_movs), 0);
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._bank_cuenta_de_empresa(v_t.company_id);
  perform pg_advisory_xact_lock(hashtextextended('bank_importar:' || p_treasury::text, 0));
  if p_sha256 is not null then
    select * into v_prev from public.bank_statement where treasury_account_id = p_treasury and file_sha256 = p_sha256;
    if v_prev.id is not null then
      return jsonb_build_object('repetido', true, 'extracto', v_prev.id,
        'mensaje', 'Este fichero ya se subió el ' || to_char(v_prev.imported_at at time zone 'Europe/Madrid', 'DD/MM/YYYY "a las" HH24:MI') || ': no cambia nada.');
    end if;
  end if;
  for v_m in select * from jsonb_array_elements(coalesce(p_movs, '[]'::jsonb)) loop v_suma := v_suma + (v_m->>'importe')::numeric; end loop;
  -- El cuadre, otra vez aquí: lo que no cuadra no entra.
  if (p_saldo_inicial is null) <> (p_saldo_final is null) then raise exception 'Llega un saldo sin el otro.' using errcode = '23514'; end if;
  if p_saldo_inicial is not null and p_saldo_inicial + v_suma <> p_saldo_final then
    raise exception 'No cuadra: saldo inicial % + movimientos % = %, y el banco dice %. No se importa.',
      public.conta_euros_exactos(p_saldo_inicial), public.conta_euros_exactos(v_suma), public.conta_euros_exactos(p_saldo_inicial + v_suma),
      public.conta_euros_exactos(p_saldo_final) using errcode = '23514';
  end if;
  if p_saldo_inicial is null and coalesce(trim(p_sin_comprobar), '') = '' then
    raise exception 'Un extracto sin saldos tiene que decir por qué no se ha podido comprobar.' using errcode = '23514';
  end if;
  -- Continuidad con el anterior de la cuenta (cuaderno 43, registro 11).
  select * into v_prev from public.bank_statement where treasury_account_id = p_treasury and period_to < p_desde and closing_balance is not null
   order by period_to desc, imported_at desc limit 1;
  if p_saldo_inicial is null then v_cont := 'sin_saldo';
  elsif v_prev.id is null then v_cont := 'primero';
  elsif v_prev.closing_balance = p_saldo_inicial then v_cont := 'sigue';
  else v_cont := 'hueco'; v_hueco := p_saldo_inicial - v_prev.closing_balance;
  end if;
  v_aj := public._bank_ajustes(v_t.company_id);

  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, file_sha256, period_from, period_to,
                                     opening_balance, closing_balance, movements_count, new_count, repeated_count, balanced, unchecked_reason,
                                     continuity, continuity_gap, imported_by, imported_by_name)
  values (v_cuenta, v_t.company_id, p_treasury, p_fuente, p_formato, p_fichero, p_sha256, p_desde, p_hasta, p_saldo_inicial, p_saldo_final,
          v_n, 0, 0, case when p_saldo_inicial is null then null else true end, case when p_saldo_inicial is null then trim(p_sin_comprobar) end,
          v_cont, v_hueco, auth.uid(), public.conta_nombre_actor())
  returning id into v_ext;

  for v_m in select * from jsonb_array_elements(coalesce(p_movs, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_estado := case when exists (select 1 from public.bank_movement b where b.treasury_account_id = p_treasury
                                    and b.soft_fingerprint = v_m->>'huella_suave' and b.fingerprint <> v_m->>'huella')
                     then 'posible_repetido' else 'pendiente' end;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept,
                                      common_code, own_code, document_no, reference_1, reference_2, fx, fingerprint, soft_fingerprint,
                                      before_cutover, status, reason)
    values (v_cuenta, v_t.company_id, p_treasury, v_ext, (v_m->>'fecha')::date, coalesce((v_m->>'fecha_valor')::date, (v_m->>'fecha')::date),
            (v_m->>'importe')::numeric, coalesce(v_m->>'concepto_banco', ''), coalesce(v_m->>'concepto_limpio', ''),
            nullif(v_m->>'comun', ''), nullif(v_m->>'propio', ''), nullif(v_m->>'documento', ''), nullif(v_m->>'ref1', ''), nullif(v_m->>'ref2', ''),
            case when v_m ? 'divisa_origen' then jsonb_build_object('divisa', v_m->>'divisa_origen', 'importe', (v_m->>'importe_origen')::numeric) end,
            v_m->>'huella', v_m->>'huella_suave',
            v_aj.cutover_date is not null and (v_m->>'fecha')::date < v_aj.cutover_date, v_estado,
            case when v_estado = 'posible_repetido' then 'Mismo día, importe y orden que uno traído por otro camino: ¿es el mismo?' end)
    on conflict (treasury_account_id, fingerprint) do nothing
    returning id into v_id;
    if v_id is null then v_rep := v_rep + 1; else v_nuevos := v_nuevos + 1; end if;
    v_id := null;
  end loop;
  update public.bank_statement set new_count = v_nuevos, repeated_count = v_rep,
         possible_repeated_count = (select count(*) from public.bank_movement where statement_id = v_ext and status = 'posible_repetido')
   where id = v_ext;

  -- P1: el IBAN del fichero no es el de la cuenta → se propone la corrección, no se hace.
  if p_iban_fichero is not null and v_t.iban is distinct from upper(replace(p_iban_fichero, ' ', '')) then
    update public.treasury_account set iban_review = jsonb_build_object('iban_propuesto', upper(replace(p_iban_fichero, ' ', '')),
           'motivo', 'El extracto de esta cuenta trae otro IBAN: el que tiene Folvy no es el de tu empresa.', 'extracto_id', v_ext, 'fecha', now())
     where id = p_treasury;
  end if;

  perform public._bank_log(v_cuenta, v_t.company_id, null, null, v_ext, 'importado', 'persona',
    format('%s: %s movimientos nuevos y %s que ya estaban, del %s al %s', v_t.name, v_nuevos, v_rep, to_char(p_desde, 'DD/MM'), to_char(p_hasta, 'DD/MM')),
    jsonb_build_object('continuidad', v_cont, 'hueco', v_hueco));
  return jsonb_build_object('repetido', false, 'extracto', v_ext, 'nuevos', v_nuevos, 'repetidos', v_rep,
    'posibles_repetidos', (select possible_repeated_count from public.bank_statement where id = v_ext),
    'continuidad', v_cont, 'hueco', v_hueco);
end $$;
grant execute on function public.bank_importar(uuid, text, text, text, text, date, date, numeric, numeric, text, text, jsonb) to authenticated;

-- ── Lo que el motor cree ───────────────────────────────────────────────────
create or replace function public.bank_proponer(p_movement uuid, p_estado text, p_confianza text, p_porque text, p_propuesta jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status in ('casado', 'ignorado') then raise exception 'Ese movimiento ya está casado o ignorado.' using errcode = '23514'; end if;
  if p_estado not in ('pendiente', 'propuesto', 'por_aclarar', 'antes_corte_sin_pareja') then
    raise exception 'Estado de propuesta no válido: %.', p_estado using errcode = '23514';
  end if;
  if p_estado = 'antes_corte_sin_pareja' and not v_m.before_cutover then
    raise exception 'Solo lo anterior a la fecha de corte puede quedar «antes del corte».' using errcode = '23514';
  end if;
  update public.bank_movement set status = p_estado, confidence = case when p_estado = 'pendiente' then null else p_confianza end,
         reason = case when p_estado = 'pendiente' then null else p_porque end,
         proposal = case when p_estado = 'pendiente' then null else p_propuesta end, updated_at = now()
   where id = p_movement;
  if p_estado in ('propuesto', 'por_aclarar') then
    perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, p_estado, 'folvy', p_porque, coalesce(p_propuesta, '{}'::jsonb));
  end if;
end $$;
grant execute on function public.bank_proponer(uuid, text, text, text, jsonb) to authenticated;

-- ── Casar ──────────────────────────────────────────────────────────────────
-- p_destino: {tipo, concepto?, tercero_id?, …} según el tipo:
--   asiento          {entry_id}                       enlaza uno que ya existe (lo único posible antes del corte)
--   factura_recibida {facturas:[{id, importe}], cuenta_tercero, metodo? (transfer | direct_debit)}
--   liquidacion      {liquidacion_id, cuenta_cliente}
--   traspaso         {otro_movimiento_id}
--   cuenta | anticipo | contrato | factura_emitida   {lineas:[{cuenta, importe, tercero_id?, concepto?}], contrato_id?}
-- Cualquiera puede llevar local_id (el de la tarjeta que pagó): va a las líneas.
-- Las líneas van al lado contrario del banco y suman el importe del movimiento.
create or replace function public.bank_casar(p_movement uuid, p_destino jsonb, p_confianza text, p_porque text, p_razones jsonb,
                                             p_por text, p_regla uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.bank_movement; v_t public.treasury_account; v_aj public.bank_settings; v_cuenta uuid; v_tipo text := p_destino->>'tipo';
  v_572 text; v_entry uuid; v_creado boolean := false; v_match uuid; v_lineas jsonb := '[]'::jsonb; v_l jsonb; v_suma numeric := 0;
  v_abs numeric; v_entra boolean; v_local uuid; v_comun boolean; v_concepto text; v_res jsonb; v_validado boolean := false;
  v_f jsonb; v_inv public.supplier_invoice; v_pagado numeric; v_cs public.channel_settlement; v_o public.bank_movement; v_o572 text;
  v_ot public.treasury_account; v_aviso text; v_tercero uuid := nullif(p_destino->>'tercero_id', '')::uuid; v_marcada boolean;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._bank_cuenta_de_empresa(v_m.company_id);
  if p_por not in ('folvy', 'persona') then raise exception 'Quién casa: folvy o persona.' using errcode = '23514'; end if;
  if p_confianza not in ('seguro', 'probable', 'duda') or coalesce(trim(p_porque), '') = '' then
    raise exception 'Todo casado lleva su confianza y su porqué.' using errcode = '23514';
  end if;
  if exists (select 1 from public.bank_match where movement_id = p_movement and status = 'vivo') then
    raise exception 'Este movimiento ya está casado: cada movimiento se casa una sola vez.' using errcode = '23505';
  end if;
  if v_m.status = 'ignorado' then raise exception 'Ese movimiento está ignorado.' using errcode = '23514'; end if;
  if v_m.status = 'posible_repetido' then raise exception 'Primero di si es el mismo que el ya traído.' using errcode = '23514'; end if;
  -- P4: antes del corte el libro ya tiene el banco (traído): solo se enlaza.
  if v_m.before_cutover and v_tipo <> 'asiento' then
    raise exception 'Este movimiento es de antes de la fecha de corte: solo se enlaza con un asiento que ya esté en el libro.' using errcode = '23514';
  end if;
  select * into v_t from public.treasury_account where id = v_m.treasury_account_id;
  v_572 := public._bank_cuenta_572(v_t.id);
  v_aj := public._bank_ajustes(v_m.company_id);
  v_abs := abs(v_m.amount); v_entra := v_m.amount > 0;
  -- El local: el de la tarjeta que pagó, si el destino lo trae; si no, el de la cuenta.
  v_local := coalesce(nullif(p_destino->>'local_id', '')::uuid, v_t.location_id); v_comun := v_local is null;
  v_concepto := coalesce(nullif(trim(p_destino->>'concepto'), ''), nullif(v_m.clean_concept, ''), 'Movimiento del banco');

  if v_tipo = 'asiento' then
    v_entry := (p_destino->>'entry_id')::uuid;
  elsif v_tipo = 'factura_recibida' then
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta for update;
      if v_inv.id is null then raise exception 'Esa factura no es de la cuenta.' using errcode = '23514'; end if;
      select coalesce(sum(i.amount), 0) into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      if v_pagado + (v_f->>'importe')::numeric > coalesce(v_inv.grand_total, 0) + 0.005 then
        raise exception 'La factura % ya tiene casados % de %: este pago la pasaría.', coalesce(v_inv.invoice_number, ''),
          public.conta_euros_exactos(v_pagado), public.conta_euros_exactos(coalesce(v_inv.grand_total, 0)) using errcode = '23514';
      end if;
      v_suma := v_suma + (v_f->>'importe')::numeric;
      -- P2: si su pago ya está apuntado (propuesto o validado), se enlaza ese asiento y no se crea otro.
      if jsonb_array_length(p_destino->'facturas') = 1 and v_entry is null then
        select e.id into v_entry from public.journal_entry e
         where e.company_id = v_m.company_id and e.status in ('propuesto', 'borrador', 'validado')
           and (e.id = v_inv.payment_entry_id or (e.source_type = 'supplier_payment' and e.source_id = v_inv.id))
           and not exists (select 1 from public.bank_match b where b.journal_entry_id = e.id and b.status = 'vivo')
         limit 1;
      end if;
    end loop;
    if v_suma <> v_abs then raise exception 'Las facturas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
    if v_entry is null then
      v_lineas := jsonb_build_array(jsonb_build_object('cuenta', p_destino->>'cuenta_tercero', 'debe', v_abs, 'haber', 0, 'tercero_id', v_tercero,
                                                       'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
    end if;
  elsif v_tipo = 'liquidacion' then
    select * into v_cs from public.channel_settlement where id = (p_destino->>'liquidacion_id')::uuid and account_id = v_cuenta for update;
    if v_cs.id is null then raise exception 'Esa liquidación no es de la cuenta.' using errcode = '23514'; end if;
    if exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id where i.channel_settlement_id = v_cs.id and b.status = 'vivo') then
      raise exception 'Esa liquidación ya está casada con otro movimiento.' using errcode = '23505';
    end if;
    -- P2: «cobrada» a mano y su asiento con el cobro dentro → se enlaza.
    if v_cs.collected_on is not null and v_cs.journal_entry_id is not null then v_entry := v_cs.journal_entry_id; end if;
    if v_entry is null then
      v_lineas := jsonb_build_array(jsonb_build_object('cuenta', p_destino->>'cuenta_cliente', 'debe', 0, 'haber', v_abs, 'tercero_id', v_tercero,
                                                       'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
    end if;
  elsif v_tipo = 'traspaso' then
    select * into v_o from public.bank_movement where id = (p_destino->>'otro_movimiento_id')::uuid for update;
    if v_o.id is null or v_o.company_id <> v_m.company_id or v_o.treasury_account_id = v_m.treasury_account_id then
      raise exception 'El otro lado del traspaso tiene que ser un movimiento de otra cuenta de la misma empresa.' using errcode = '23514';
    end if;
    if v_o.amount <> -v_m.amount then raise exception 'Un traspaso sale de una cuenta y entra en otra por el mismo importe.' using errcode = '23514'; end if;
    if exists (select 1 from public.bank_match where movement_id = v_o.id and status = 'vivo') then
      raise exception 'El otro lado del traspaso ya está casado.' using errcode = '23505';
    end if;
    select * into v_ot from public.treasury_account where id = v_o.treasury_account_id;
    v_o572 := public._bank_cuenta_572(v_ot.id);
    if v_o572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572).', v_ot.name using errcode = '23514'; end if;
    v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_o572, 'debe', case when v_entra then 0 else v_abs end,
                                                     'haber', case when v_entra then v_abs else 0 end, 'concepto', v_concepto,
                                                     'local_id', v_ot.location_id, 'comun', v_ot.location_id is null));
  elsif v_tipo in ('cuenta', 'anticipo', 'contrato', 'factura_emitida') then
    for v_l in select * from jsonb_array_elements(p_destino->'lineas') loop
      v_suma := v_suma + (v_l->>'importe')::numeric;
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_l->>'cuenta',
        'debe', case when v_entra then 0 else (v_l->>'importe')::numeric end, 'haber', case when v_entra then (v_l->>'importe')::numeric else 0 end,
        'tercero_id', coalesce(nullif(v_l->>'tercero_id', '')::uuid, v_tercero), 'concepto', coalesce(v_l->>'concepto', v_concepto),
        'local_id', v_local, 'comun', v_comun));
    end loop;
    if v_suma <> v_abs then raise exception 'Las líneas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
  else
    raise exception 'Tipo de casado no válido: %.', v_tipo using errcode = '23514';
  end if;

  if v_entry is not null then
    -- Enlazar: el asiento es de la empresa, está vivo y lleva este banco por este importe en su lado.
    if not exists (select 1 from public.journal_entry e where e.id = v_entry and e.company_id = v_m.company_id and e.status in ('propuesto', 'borrador', 'validado')) then
      raise exception 'Ese asiento no es de la empresa o no está vivo.' using errcode = '23514';
    end if;
    if v_572 is not null and not exists (select 1 from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                       where jl.entry_id = v_entry and ca.code = v_572 and (case when v_entra then jl.debit else jl.credit end) = v_abs) then
      raise exception 'Ese asiento no lleva % en %, en su lado.', public.conta_euros_exactos(v_abs), v_572 using errcode = '23514';
    end if;
    if exists (select 1 from public.bank_match where journal_entry_id = v_entry and status = 'vivo' and kind <> 'traspaso') then
      raise exception 'Ese asiento ya está casado con otro movimiento.' using errcode = '23505';
    end if;
  else
    if v_572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572): dila en Cuentas y extractos.', v_t.name using errcode = '23514'; end if;
    v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_572, 'debe', case when v_entra then v_abs else 0 end,
                                                     'haber', case when v_entra then 0 else v_abs end, 'concepto', v_concepto,
                                                     'local_id', v_local, 'comun', v_comun)) || v_lineas;
    v_res := public._journal_entry_proponer(v_m.company_id,
      jsonb_build_object('fecha', v_m.op_date, 'series', v_aj.treasury_series, 'concepto', v_concepto, 'source_type', 'bank', 'source_id', v_m.id,
                         'confianza', p_confianza, 'porque', p_porque, 'razones', coalesce(p_razones, '[]'::jsonb), 'party_id', v_tercero,
                         'documento', coalesce(v_m.document_no, v_m.reference_1)),
      v_lineas, '{}'::jsonb, case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end, auth.uid());
    if coalesce((v_res->>'descartada')::boolean, false) then raise exception 'Ese movimiento tenía la propuesta descartada.' using errcode = '23514'; end if;
    v_entry := (v_res->>'id')::uuid;
    v_creado := not coalesce((v_res->>'existente')::boolean, false);
  end if;

  insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who, rule_id,
                                 created_by, created_by_name)
  values (v_cuenta, v_m.company_id, v_m.id, v_tipo, v_entry, v_creado, v_m.amount, p_confianza, p_porque, p_por, p_regla, auth.uid(),
          case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end)
  returning id into v_match;

  -- A qué y por cuánto, y lo que cambia fuera del banco.
  if v_tipo = 'factura_recibida' then
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid;
      select coalesce(sum(i.amount), 0) + (v_f->>'importe')::numeric into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      -- Pagada entera: por el camino de siempre (mark_supplier_invoice_paid), con su freno del IBAN y su registro.
      v_marcada := v_pagado >= coalesce(v_inv.grand_total, 0) - 0.005 and v_inv.paid_at is null;
      insert into public.bank_match_item (account_id, match_id, supplier_invoice_id, amount, marked_by_bank)
      values (v_cuenta, v_match, v_inv.id, (v_f->>'importe')::numeric, v_marcada);
      if v_marcada then
        perform public.mark_supplier_invoice_paid(v_inv.id, v_m.op_date, coalesce(p_destino->>'metodo', 'transfer'));
      end if;
      update public.supplier_invoice set payment_entry_id = coalesce(payment_entry_id, v_entry) where id = v_inv.id;
    end loop;
  elsif v_tipo = 'liquidacion' then
    -- Cobrada por el camino de siempre (channel_settlement_collect), si no lo estaba.
    insert into public.bank_match_item (account_id, match_id, channel_settlement_id, amount, marked_by_bank)
    values (v_cuenta, v_match, v_cs.id, v_m.amount, v_cs.collected_on is null);
    if v_cs.collected_on is null then
      perform public.channel_settlement_collect(v_cs.id, v_m.op_date, v_m.amount,
        'Casado con el movimiento del banco del ' || to_char(v_m.op_date, 'DD/MM/YYYY'), 'Folvy · banco');
    end if;
  elsif v_tipo = 'traspaso' then
    insert into public.bank_match_item (account_id, match_id, other_movement_id, amount) values (v_cuenta, v_match, v_o.id, v_m.amount);
    insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who, rule_id,
                                   created_by, created_by_name)
    values (v_cuenta, v_m.company_id, v_o.id, 'traspaso', v_entry, false, v_o.amount, p_confianza, p_porque, p_por, p_regla, auth.uid(),
            case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end);
    update public.bank_movement set status = 'casado', confidence = p_confianza, reason = p_porque, updated_at = now() where id = v_o.id;
  elsif v_tercero is not null then
    insert into public.bank_match_item (account_id, match_id, party_id, amount) values (v_cuenta, v_match, v_tercero, v_m.amount);
  end if;

  update public.bank_movement set status = 'casado', confidence = p_confianza, reason = p_porque, updated_at = now() where id = v_m.id;

  -- Lo seguro se valida solo si la empresa lo ha activado (apagado por defecto).
  if v_creado and p_confianza = 'seguro' and p_por = 'folvy' and v_aj.validate_safe then
    begin
      perform public.journal_entry_validar(v_entry, 'Folvy');
      v_validado := true;
    exception when others then
      v_aviso := 'No se ha podido validar solo: ' || sqlerrm || '. Queda propuesto.';
    end;
  end if;

  perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, case when v_creado then 'casado' else 'enlazado' end, p_por,
    p_porque, jsonb_build_object('tipo', v_tipo, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso));
  if v_validado then
    perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, 'validado', 'folvy', 'Validado solo: es seguro y la empresa lo tiene activado', '{}'::jsonb);
  end if;
  if p_regla is not null then
    update public.bank_rule set last_used_at = now() where id = p_regla and company_id = v_m.company_id;
  end if;
  return jsonb_build_object('match', v_match, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso);
end $$;
grant execute on function public.bank_casar(uuid, jsonb, text, text, jsonb, text, uuid) to authenticated;

-- ── Deshacer ───────────────────────────────────────────────────────────────
create or replace function public.bank_deshacer(p_match uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.bank_match; v_e public.journal_entry; v_que text; v_otros uuid[]; i record;
begin
  select * into v_b from public.bank_match where id = p_match for update;
  if v_b.id is null then raise exception 'Ese casado no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_b.company_id);
  if v_b.status <> 'vivo' then raise exception 'Ese casado ya está deshecho.' using errcode = '23514'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Para deshacer hay que decir por qué.' using errcode = '23514'; end if;
  -- Un traspaso se deshace por los dos lados.
  select array_agg(id) into v_otros from public.bank_match where status = 'vivo' and kind = 'traspaso' and journal_entry_id = v_b.journal_entry_id and v_b.kind = 'traspaso';
  v_otros := coalesce(v_otros, array[v_b.id]);
  select * into v_e from public.journal_entry where id = v_b.journal_entry_id;
  if v_e.id is not null and (v_b.entry_created or v_b.kind = 'traspaso') and exists (select 1 from public.bank_match where id = any(v_otros) and entry_created) then
    if v_e.status in ('propuesto', 'borrador') then
      delete from public.journal_entry where id = v_e.id;  -- una propuesta no deja rastro en el libro; su rastro es este casado deshecho
      v_que := 'su asiento propuesto se quita';
    elsif v_e.status = 'validado' then
      perform public.journal_entry_anular(v_e.id, 'Deshecho en Bancos: ' || trim(p_motivo), current_date, public.conta_nombre_actor());
      v_que := format('su asiento %s/%s se anula con un contraasiento', v_e.series, v_e.number);
    end if;
  else
    v_que := 'el asiento enlazado se queda como estaba';
  end if;
  update public.bank_match set status = 'deshecho', undone_at = now(), undone_by = auth.uid(), undone_by_name = public.conta_nombre_actor(),
         undo_reason = trim(p_motivo) where id = any(v_otros);
  update public.bank_movement set status = 'pendiente', confidence = null, reason = null, proposal = null, updated_at = now()
   where id in (select movement_id from public.bank_match where id = any(v_otros));
  -- Lo que se puso fuera del banco por este casado, se quita.
  for i in select it.* from public.bank_match_item it where it.match_id = any(v_otros) loop
    if i.supplier_invoice_id is not null then
      if i.marked_by_bank and exists (select 1 from public.supplier_invoice where id = i.supplier_invoice_id and status = 'pagada') then
        perform public.unmark_supplier_invoice_paid(i.supplier_invoice_id);
      end if;
      update public.supplier_invoice set payment_entry_id = null where id = i.supplier_invoice_id and payment_entry_id = v_b.journal_entry_id;
    elsif i.channel_settlement_id is not null and i.marked_by_bank then
      perform public.channel_settlement_uncollect(i.channel_settlement_id);
    end if;
  end loop;
  perform public._bank_log(v_b.account_id, v_b.company_id, v_b.movement_id, v_b.id, null, 'deshecho', 'persona',
    'Deshecho: ' || trim(p_motivo) || ' (' || v_que || ')', jsonb_build_object('asiento', v_b.journal_entry_id));
  return jsonb_build_object('deshechos', to_jsonb(v_otros), 'asiento', v_que);
end $$;
grant execute on function public.bank_deshacer(uuid, text) to authenticated;

-- ── Ignorar y posibles repetidos ───────────────────────────────────────────
create or replace function public.bank_ignorar(p_movement uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status = 'casado' then raise exception 'Está casado: deshaz antes el casado.' using errcode = '23514'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Para ignorar un movimiento hay que decir por qué.' using errcode = '23514'; end if;
  update public.bank_movement set status = 'ignorado', ignored_reason = trim(p_motivo), updated_at = now() where id = p_movement;
  perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, 'ignorado', 'persona', 'Ignorado: ' || trim(p_motivo), '{}'::jsonb);
end $$;
grant execute on function public.bank_ignorar(uuid, text) to authenticated;

create or replace function public.bank_repetido_resolver(p_movement uuid, p_es_el_mismo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status <> 'posible_repetido' then raise exception 'Ese movimiento no está como posible repetido.' using errcode = '23514'; end if;
  if p_es_el_mismo then
    update public.bank_movement set status = 'ignorado', ignored_reason = 'Es el mismo que ya se trajo por otro camino', reason = null, updated_at = now() where id = p_movement;
  else
    update public.bank_movement set status = 'pendiente', reason = null, updated_at = now() where id = p_movement;
  end if;
  perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, case when p_es_el_mismo then 'ignorado' else 'propuesto' end, 'persona',
    case when p_es_el_mismo then 'Era el mismo movimiento traído por otro camino' else 'No era el mismo: queda para casar' end, '{}'::jsonb);
end $$;
grant execute on function public.bank_repetido_resolver(uuid, boolean) to authenticated;

-- ── Reglas ─────────────────────────────────────────────────────────────────
create or replace function public.bank_regla_guardar(p_company uuid, p_id uuid, p_palabras text, p_condicion jsonb, p_destino jsonb, p_origen text, p_estado text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company); v_id uuid := p_id; v_antes public.bank_rule;
begin
  if p_origen not in ('persona', 'folvy') or p_estado not in ('propuesta', 'activa', 'apagada') then
    raise exception 'Origen o estado de la regla no válidos.' using errcode = '23514';
  end if;
  if p_origen = 'folvy' and p_estado = 'activa' and v_id is null then
    raise exception 'Una regla que propone Folvy nace «propuesta»: la guarda la persona.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.company_account where company_id = p_company and code = p_destino->>'cuenta') then
    raise exception 'La cuenta % no está en el plan de la empresa.', p_destino->>'cuenta' using errcode = '23514';
  end if;
  if v_id is null then
    insert into public.bank_rule (account_id, company_id, words, condition, target, origin, status, created_by, created_by_name)
    values (v_cuenta, p_company, trim(p_palabras), p_condicion, p_destino, p_origen, p_estado, auth.uid(),
            case when p_origen = 'folvy' then 'Folvy' else public.conta_nombre_actor() end)
    returning id into v_id;
    insert into public.bank_rule_log (account_id, rule_id, action, after, created_by, created_by_name)
    values (v_cuenta, v_id, case when p_estado = 'propuesta' then 'propuesta' else 'creada' end,
            jsonb_build_object('palabras', trim(p_palabras), 'condicion', p_condicion, 'destino', p_destino, 'estado', p_estado), auth.uid(),
            case when p_origen = 'folvy' then 'Folvy' else public.conta_nombre_actor() end);
  else
    select * into v_antes from public.bank_rule where id = v_id and company_id = p_company for update;
    if v_antes.id is null then raise exception 'Esa regla no es de la empresa.' using errcode = 'P0002'; end if;
    update public.bank_rule set words = trim(p_palabras), condition = p_condicion, target = p_destino, status = p_estado, updated_at = now() where id = v_id;
    insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
    values (v_cuenta, v_id, 'cambiada',
            jsonb_build_object('palabras', v_antes.words, 'condicion', v_antes.condition, 'destino', v_antes.target, 'estado', v_antes.status),
            jsonb_build_object('palabras', trim(p_palabras), 'condicion', p_condicion, 'destino', p_destino, 'estado', p_estado), auth.uid(), public.conta_nombre_actor());
  end if;
  return v_id;
end $$;
grant execute on function public.bank_regla_guardar(uuid, uuid, text, jsonb, jsonb, text, text) to authenticated;

create or replace function public.bank_regla_estado(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bank_rule; v_accion text;
begin
  select * into v from public.bank_rule where id = p_id for update;
  if v.id is null then raise exception 'Esa regla no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v.company_id);
  v_accion := case
    when v.status = 'propuesta' and p_estado = 'activa' then 'aceptada'
    when v.status = 'propuesta' and p_estado = 'rechazada' then 'rechazada'
    when v.status = 'activa' and p_estado = 'apagada' then 'apagada'
    when v.status = 'apagada' and p_estado = 'activa' then 'encendida' end;
  if v_accion is null then raise exception 'Una regla «%» no pasa a «%».', v.status, p_estado using errcode = '23514'; end if;
  update public.bank_rule set status = p_estado, updated_at = now() where id = p_id;
  insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
  values (v.account_id, p_id, v_accion, jsonb_build_object('estado', v.status), jsonb_build_object('estado', p_estado), auth.uid(), public.conta_nombre_actor());
end $$;
grant execute on function public.bank_regla_estado(uuid, text) to authenticated;

/** Una confirmación más de una regla (la persona dijo «Sí» a lo que propuso): 2 o 3 la hacen automática. */
create or replace function public.bank_regla_confirmada(p_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v public.bank_rule;
begin
  select * into v from public.bank_rule where id = p_id for update;
  if v.id is null then raise exception 'Esa regla no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v.company_id);
  update public.bank_rule set confirmations = confirmations + 1, last_used_at = now(), updated_at = now() where id = p_id;
  insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
  values (v.account_id, p_id, 'usada', jsonb_build_object('confirmaciones', v.confirmations), jsonb_build_object('confirmaciones', v.confirmations + 1),
          auth.uid(), public.conta_nombre_actor());
  return v.confirmations + 1;
end $$;
grant execute on function public.bank_regla_confirmada(uuid) to authenticated;
