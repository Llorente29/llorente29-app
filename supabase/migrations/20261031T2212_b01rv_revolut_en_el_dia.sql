-- ============================================================================
-- B01 Revolut · PR 1 · 3 · LO TERMINADO DE REVOLUT ENTRA EN CUANTO LLEGA
-- ----------------------------------------------------------------------------
-- Respuesta 3 de Julio (31/10): con Revolut, un movimiento terminado entra en
-- cuanto llega, por el aviso o por la lectura de cada hora; no espera al día
-- siguiente. Cada movimiento terminado de Revolut tiene su id y no cambia, así
-- que leer el mismo día dos veces no duplica nada. La espera de un día es de
-- cómo lee BBVA y se queda solo para BBVA.
--
-- Un cambio, declarado: bank_importar (MISMA FIRMA). La continuidad con el
-- extracto anterior se mide hoy contra el último que acaba ANTES del día en
-- que empieza el nuevo. Para la fuente agregador:revolut vale también el que
-- acaba ESE MISMO día (el de la lectura de hace una hora). Para cualquier otra
-- fuente (BBVA, Norma 43, los ficheros), exactamente lo de antes: es el texto
-- de la B02 (20261101T0200, md5 09859e42… en producción el 31/10) con esa
-- condición y nada más.
--
-- Guarda: si lo que hay en la base no es ese texto (alguien lo cambió
-- después), PARA y no lo pisa.
-- No toca datos ni nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261031T2212_b01rv_revolut_en_el_dia.down.sql
-- cambia: public.bank_importar · prueba: supabase/staging/sql/20261031_b01rv_revolut_prueba.sql
-- ============================================================================

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure)
     is distinct from '09859e4297eb98e9ce75ea7efec8216f' then
    raise exception 'bank_importar no es la de la B02 (md5 09859e42…): alguien la ha cambiado después. No se pisa: mira qué cambió y rehaz esta migración sobre eso.' using errcode = '55000';
  end if;
end $$;

-- La de antes, guardada (la vuelta atrás la restaura de aquí, con su huella).
select public._respaldar_funcion('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261031T2212_b01rv_revolut_en_el_dia');

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
  -- B01 Revolut (2212): lo de Revolut se lee varias veces el mismo día (cada
  -- movimiento terminado entra en cuanto llega), así que su anterior puede
  -- acabar el mismo día en que empieza este. Solo para esa fuente; para BBVA y
  -- los ficheros, igual que antes.
  select * into v_prev from public.bank_statement where treasury_account_id = p_treasury and closing_balance is not null
     and (period_to < p_desde or (p_fuente = 'agregador:revolut' and source = p_fuente and period_to = p_desde))
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
