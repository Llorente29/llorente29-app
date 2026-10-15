-- ============================================================================
-- B02 · LO QUE ENTRA Y EL MOTOR (tanda T1): estructura, nada de datos.
-- ----------------------------------------------------------------------------
-- 1. bank_movement.counterparty y .movement_type, que admiten vacío: a quién
--    pagas o quién te paga (limpio, sin tarjeta ni códigos) y el tipo de
--    movimiento, aparte del concepto. El texto del banco sigue en bank_concept.
-- 2. _bank_contraparte_limpia(texto): la MISMA regla que limpiarContraparte
--    (src/modules/conta/lib/extractoBanco.ts); los ejemplos de la prueba de
--    staging los pasa también una prueba unitaria contra el front.
-- 3. bank_importar (misma firma): guarda la contraparte limpia y el tipo.
-- 4. bank_facturas_para_casar(empresa), NUEVA: las pendientes aprobadas y las
--    «en revisión», con su estado (el motor propone contra estas en ámbar).
-- 5. bank_casar (misma firma): (a) la diferencia pequeña (comisión o
--    redondeo) en un pago de facturas, con su cuenta, hasta 3 € y el 3 %, y
--    solo la confirma la persona; (b) una factura «en revisión» pagada entera
--    no se marca pagada (confirmar el pago no la aprueba).
-- Lo de antes no cambia: un casado sin diferencia ni facturas en revisión hace
-- lo mismo que con la 0110.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0200_b02_entrada.down.sql
-- cambia: public.bank_importar · prueba: supabase/staging/sql/20261101_b02_entrada_prueba.sql
-- cambia: public.bank_casar · prueba: supabase/staging/sql/20261101_b02_entrada_prueba.sql
-- ============================================================================

alter table public.bank_movement add column if not exists counterparty text;
alter table public.bank_movement add column if not exists movement_type text;
comment on column public.bank_movement.counterparty is 'B02. A quién pagas o quién te paga, limpio (sin tarjeta, asteriscos ni códigos). El texto del banco, en bank_concept.';
comment on column public.bank_movement.movement_type is 'B02. El tipo de movimiento del banco (Norma 43: descripción del concepto común o etiqueta del propio; BBVA Excel: CONCEPTO), aparte del concepto.';

create or replace function public._bank_contraparte_limpia(p text)
returns text language plpgsql immutable set search_path = public as $$
declare s text; w text;
begin
  if p is null then return null; end if;
  s := upper(p);
  s := regexp_replace(s, '[*X•·]{3,} ?[0-9]{4}', ' ', 'g');
  s := regexp_replace(s, '[A-Z]{2}[0-9]{2}[A-Z0-9]{10,}', ' ', 'g');
  s := regexp_replace(s, '[0-9]{5,}', ' ', 'g');
  s := regexp_replace(s, '[^[:alpha:][:digit:] &.-]', ' ', 'g');
  s := trim(regexp_replace(s, '\s+', ' ', 'g'));
  s := regexp_replace(s, '^[ -]+|[ -]+$', '', 'g');
  if s = '' then return null; end if;
  s := initcap(s);
  foreach w in array array['De', 'Del', 'La', 'Las', 'Los', 'El', 'Y', 'En'] loop
    s := regexp_replace(s, ' ' || w || '(?= )', ' ' || lower(w), 'g');
  end loop;
  foreach w in array array['Sl', 'Sa', 'Slu', 'Sc', 'Cb'] loop
    s := regexp_replace(s, '(?<![[:alpha:][:digit:]])' || w || '(?![[:alpha:][:digit:]])', upper(w), 'g');
  end loop;
  return s;
end $$;
revoke all on function public._bank_contraparte_limpia(text) from public, anon, authenticated;

create or replace function public.bank_facturas_para_casar(p_company uuid)
returns table (id uuid, numero text, fecha date, total numeric, pagado numeric, proveedor text, alias text[], tercero_id uuid, cuenta_tercero text, estado text)
language sql stable security invoker set search_path = public as $$
  select si.id, si.invoice_number, si.invoice_date, si.grand_total,
         coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0),
         s.name, array_remove(array[s.name, s.legal_name], null), pr.party_id,
         (select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
           where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal' limit 1),
         si.status
    from public.supplier_invoice si
    join public.company c on c.id = p_company and c.account_id = si.account_id
    left join public.supplier s on s.id = si.supplier_id
    left join public.party_role pr on pr.supplier_id = s.id and pr.role = 'supplier'
   where si.status in ('aprobada', 'en_revision') and si.paid_at is null and coalesce(si.grand_total, 0) > 0
     and (si.company_id is null or si.company_id = p_company)
$$;
grant execute on function public.bank_facturas_para_casar(uuid) to authenticated;

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
    -- Respuesta 4: el mismo movimiento por el agregador y por Norma 43 es EL MISMO.
    -- Las dos fuentes no traen las mismas referencias (la huella entera difiere),
    -- pero sí el día, el importe y el orden en el día (la huella suave): entre
    -- una fuente y otra, eso basta. Entre dos ficheros, sigue siendo «¿es el mismo?».
    if exists (select 1 from public.bank_movement b join public.bank_statement s on s.id = b.statement_id
                where b.treasury_account_id = p_treasury and b.soft_fingerprint = v_m->>'huella_suave' and b.fingerprint <> v_m->>'huella'
                  and s.source <> p_fuente and (s.source like 'agregador:%' or p_fuente like 'agregador:%')) then
      v_rep := v_rep + 1;
      continue;
    end if;
    v_estado := case when exists (select 1 from public.bank_movement b where b.treasury_account_id = p_treasury
                                    and b.soft_fingerprint = v_m->>'huella_suave' and b.fingerprint <> v_m->>'huella')
                     then 'posible_repetido' else 'pendiente' end;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept,
                                      common_code, own_code, document_no, reference_1, reference_2, fx, fingerprint, soft_fingerprint,
                                      before_cutover, status, reason, counterparty, movement_type)
    values (v_cuenta, v_t.company_id, p_treasury, v_ext, (v_m->>'fecha')::date, coalesce((v_m->>'fecha_valor')::date, (v_m->>'fecha')::date),
            (v_m->>'importe')::numeric, coalesce(v_m->>'concepto_banco', ''), coalesce(v_m->>'concepto_limpio', ''),
            nullif(v_m->>'comun', ''), nullif(v_m->>'propio', ''), nullif(v_m->>'documento', ''), nullif(v_m->>'ref1', ''), nullif(v_m->>'ref2', ''),
            case when v_m ? 'divisa_origen' then jsonb_build_object('divisa', v_m->>'divisa_origen', 'importe', (v_m->>'importe_origen')::numeric) end,
            v_m->>'huella', v_m->>'huella_suave',
            v_aj.cutover_date is not null and (v_m->>'fecha')::date < v_aj.cutover_date, v_estado,
            case when v_estado = 'posible_repetido' then 'Mismo día, importe y orden que uno traído por otro camino: ¿es el mismo?' end,
            -- B02: a quién pagas o quién te paga (limpia, sin tarjeta) y el tipo de movimiento, aparte.
            public._bank_contraparte_limpia(nullif(v_m->>'contraparte', '')), nullif(trim(v_m->>'tipo'), ''))
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

create or replace function public.bank_casar(p_movement uuid, p_destino jsonb, p_confianza text, p_porque text, p_razones jsonb,
                                             p_por text, p_regla uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.bank_movement; v_t public.treasury_account; v_aj public.bank_settings; v_cuenta uuid; v_tipo text := p_destino->>'tipo';
  v_572 text; v_entry uuid; v_creado boolean := false; v_match uuid; v_lineas jsonb := '[]'::jsonb; v_l jsonb; v_suma numeric := 0;
  v_abs numeric; v_entra boolean; v_local uuid; v_comun boolean; v_concepto text; v_res jsonb; v_validado boolean := false;
  v_f jsonb; v_inv public.supplier_invoice; v_pagado numeric; v_cs public.channel_settlement; v_o public.bank_movement; v_o572 text;
  v_ot public.treasury_account; v_aviso text; v_tercero uuid := nullif(p_destino->>'tercero_id', '')::uuid; v_marcada boolean;
  v_dif numeric := 0; v_dif_cuenta text;
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
      -- (B02: no si lleva diferencia: ese asiento no la tiene.)
      if jsonb_array_length(p_destino->'facturas') = 1 and v_entry is null and not (p_destino ? 'diferencia') then
        select e.id into v_entry from public.journal_entry e
         where e.company_id = v_m.company_id and e.status in ('propuesto', 'borrador', 'validado')
           and (e.id = v_inv.payment_entry_id or (e.source_type = 'supplier_payment' and e.source_id = v_inv.id))
           and not exists (select 1 from public.bank_match b where b.journal_entry_id = e.id and b.status = 'vivo')
         limit 1;
      end if;
    end loop;
    -- B02 · La diferencia pequeña (comisión o redondeo), con su cuenta: + pagado de más (gasto, al debe),
    -- − pagado de menos (ingreso, al haber). Hasta 3 € y el 3 % del pago; la propone el motor y la confirma la persona.
    if p_destino ? 'diferencia' then
      v_dif := (p_destino->'diferencia'->>'importe')::numeric;
      v_dif_cuenta := nullif(trim(p_destino->'diferencia'->>'cuenta'), '');
      if v_dif_cuenta is null or v_dif = 0 then raise exception 'La diferencia lleva su cuenta y su importe.' using errcode = '23514'; end if;
      if abs(v_dif) > least(3, round(v_abs * 0.03, 2)) + 0.005 then
        raise exception 'Una diferencia de % no es pequeña (hasta 3 € y el 3 %% del pago): casa la factura en parte o apunta la diferencia aparte.', public.conta_euros_exactos(abs(v_dif)) using errcode = '23514';
      end if;
      if p_por <> 'persona' then raise exception 'Una diferencia no se apunta sola: la confirma la persona.' using errcode = '23514'; end if;
    end if;
    if v_suma + v_dif <> v_abs then raise exception 'Las facturas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma + v_dif), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
    if v_entry is null then
      v_lineas := jsonb_build_array(jsonb_build_object('cuenta', p_destino->>'cuenta_tercero', 'debe', v_suma, 'haber', 0, 'tercero_id', v_tercero,
                                                       'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
      if v_dif <> 0 then
        v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_dif_cuenta, 'debe', greatest(v_dif, 0), 'haber', greatest(-v_dif, 0),
          'concepto', coalesce(nullif(trim(p_destino->'diferencia'->>'concepto'), ''), v_concepto), 'local_id', v_local, 'comun', v_comun));
      end if;
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

  -- Respuesta 4: la persona casa con otra cosa lo que proponía una regla → una
  -- corrección para esa regla; a la segunda se apaga sola y lo dice (0150).
  if p_por = 'persona' and nullif(v_m.proposal->>'reglaId', '') is not null
     and (p_regla is null or p_regla::text <> v_m.proposal->>'reglaId') then
    perform public._bank_regla_corregida((v_m.proposal->>'reglaId')::uuid, v_m.id);
  end if;

  -- A qué y por cuánto, y lo que cambia fuera del banco.
  if v_tipo = 'factura_recibida' then
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid;
      select coalesce(sum(i.amount), 0) + (v_f->>'importe')::numeric into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      -- Pagada entera: por el camino de siempre (mark_supplier_invoice_paid), con su freno del IBAN y su registro.
      -- B02: solo si está aprobada. Confirmar el pago de una factura «en revisión» no la aprueba ni la marca:
      -- el casado queda (bank_match_item) y se marcará cuando se apruebe.
      v_marcada := v_pagado >= coalesce(v_inv.grand_total, 0) - 0.005 and v_inv.paid_at is null and v_inv.status = 'aprobada';
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
