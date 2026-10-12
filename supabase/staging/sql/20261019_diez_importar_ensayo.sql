-- supabase/staging/sql/20261019_diez_importar_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261019T0150 antes del real: el fichero entero y
-- su prueba (20261019_diez_importar_prueba.sql) dentro de UNA transacción que
-- acaba en ROLLBACK. Va primero en el manifiesto: si falla, el real no se
-- aplica. Generado copiando los dos ficheros tal cual.

begin;

-- C04b · T3 · El escritor del histórico de Diez (12/10).
--
-- Fichero NUEVO: tres funciones nuevas, solo para service_role. No cambia
-- ninguna tabla, ninguna función existente ni ningún dato.
--
-- Lo que deciden las respuestas de Julio y lo medido en T1/T2:
--   · Lo traído entra como `migrated`, VALIDADO, con la clave entera de Diez
--     (programa, ejercicio, serie, documento) y su huella (respuesta 1). El
--     número de Folvy ES el documento de Diez: las cinco series de Diez son las
--     de Folvy (1, 2, 3, 4 y 9, T1 §3) y la clave de Diez cabe exacta en
--     ux_journal_entry_numero (empresa, ejercicio, serie, número).
--   · 2023, 2024 y 2025 se crean como ejercicios TRAÍDOS y se cierran después
--     de traerlos, con la apertura, la regularización y el cierre de Diez
--     (respuesta 3). 2026 es mixto: se trae hasta imported_until (30/09).
--   · Se encadena en la huella como cualquier asiento validado: el agente de
--     la cadena (journal_cadena_comprobar) lo comprueba igual.
--   · Idempotente: traer dos veces lo mismo no duplica nada. Si en Diez cambió
--     un asiento ya traído, NO se pisa: se devuelve como «distinto en Diez»
--     (Folvy no reescribe un asiento validado; lo arregla una persona).
--   · Cada asiento va en su propia subtransacción: el que no entra devuelve su
--     motivo y los demás siguen. Nada se pierde en silencio (regla 8).
--
-- Los importes llegan en CÉNTIMOS enteros, como los deja convertirAsiento
-- (diezMapeo.ts): ya cuadrados, sin negativos y con el lado de Diez de cada
-- negativo en negativoEnDiez (0140).

-- 1. El ejercicio traído ---------------------------------------------------------------
create or replace function public.conta_diez_ejercicio(p_company uuid, p_code text, p_starts date, p_ends date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_y public.fiscal_year; v_cuenta uuid; v_prev uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  select * into v_y from public.fiscal_year where company_id = p_company and code = p_code;
  if v_y.id is not null then
    if v_y.origin = 'folvy' then
      raise exception 'El ejercicio % ya existe y es de Folvy: no se le trae nada de Diez encima.', p_code using errcode = '23514';
    end if;
    if v_y.starts_on <> p_starts or v_y.ends_on <> p_ends then
      raise exception 'El ejercicio % ya existe con otras fechas (% – %).', p_code, v_y.starts_on, v_y.ends_on using errcode = '23514';
    end if;
    return v_y.id;
  end if;
  select id into v_prev from public.fiscal_year where company_id = p_company and ends_on = p_starts - 1;
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id, status, origin, origin_program, imported_until)
  values (v_cuenta, p_company, p_code, p_starts, p_ends, v_prev, 'open', 'migrated', 'diez', p_ends)
  returning id into v_prev;
  -- El siguiente, si ya existía, cuelga de este.
  update public.fiscal_year set previous_year_id = v_prev
   where company_id = p_company and starts_on = p_ends + 1 and previous_year_id is null;
  return v_prev;
end $$;

comment on function public.conta_diez_ejercicio(uuid, text, date, date) is
  'C04b: crea (o devuelve) un ejercicio TRAÍDO de Diez, abierto hasta terminar la traída. Uno de Folvy no se toca.';

-- 2. Las subcuentas que Diez usa y el plan no tiene --------------------------------------
create or replace function public.conta_diez_subcuentas(p_company uuid, p_run uuid, p_cuentas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid; v_plan text; v_d int; x jsonb; v_code text; v_hoja text; v_nombre text;
  n_nuevas int := 0; n_estaban int := 0; rechazos jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.import_run r where r.id = p_run and r.company_id = p_company and r.status = 'en_curso') then
    raise exception 'Esa lectura no es de esta empresa o ya terminó.' using errcode = '23514';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits into v_plan, v_d
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene plan contable elegido.' using errcode = '23514'; end if;
  if jsonb_typeof(p_cuentas) <> 'array' then raise exception 'Falta la lista de subcuentas.' using errcode = '22023'; end if;

  for x in select * from jsonb_array_elements(p_cuentas) loop
    v_code := trim(x ->> 'code'); v_nombre := nullif(trim(x ->> 'nombre'), '');
    if exists (select 1 from public.company_account where company_id = p_company and code = v_code) then
      n_estaban := n_estaban + 1; continue;
    end if;
    if v_code !~ ('^[0-9]{' || v_d || '}$') then
      rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', format('no tiene %s dígitos', v_d)); continue;
    end if;
    -- La hoja: la cuenta sin hijas del plan más larga que empieza el código.
    select a.code into v_hoja from public.pgc_account a
     where a.plan = v_plan and a.is_leaf and a.valid_to is null and v_code like a.code || '%'
     order by length(a.code) desc limit 1;
    if v_hoja is null then
      rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', 'no cuelga de ninguna cuenta del plan'); continue;
    end if;
    if v_code = rpad(v_hoja, v_d, '0') then
      -- Es la de serie de su hoja y no está activada: se activa como de serie.
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name, name_source, import_id)
      select v_cuenta, p_company, v_plan, v_code, a.code, a.name, a.plain_name, 'template', 'serie', 'Diez (traída)', v_nombre, null
        from public.pgc_account a where a.plan = v_plan and a.code = v_hoja and a.valid_to is null;
    else
      if v_nombre is null then
        rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', 'Diez no le da nombre'); continue;
      end if;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id)
      values (v_cuenta, p_company, v_plan, v_code, v_hoja, v_nombre, 'own', 'migrated', 'Diez (traída)', v_nombre, null);
    end if;
    n_nuevas := n_nuevas + 1;
  end loop;
  return jsonb_build_object('nuevas', n_nuevas, 'estaban', n_estaban, 'rechazadas', rechazos);
end $$;

comment on function public.conta_diez_subcuentas(uuid, uuid, jsonb) is
  'C04b: da de alta las subcuentas que usa Diez y el plan no tiene, colgando de su hoja del PGC. Las que ya están no se tocan.';

-- 3. Los asientos ----------------------------------------------------------------------
create or replace function public.conta_diez_importar(p_company uuid, p_run uuid, p_asientos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid; a jsonb; l jsonb; v_y public.fiscal_year; v_e public.journal_entry;
  v_clave text; v_serie int; v_numero int; v_fecha date; v_ej text; v_huella text;
  v_id uuid; v_ca uuid; v_faltan text[]; v_debe numeric; v_haber numeric; v_n int;
  v_seq bigint; v_prev text; v_hash text; v_concepto text;
  n_traidos int := 0; n_estaban int := 0; distintos jsonb := '[]'::jsonb; rechazos jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.import_run r where r.id = p_run and r.company_id = p_company and r.status = 'en_curso'
                 and r.kind in ('historico', 'al_dia')) then
    raise exception 'Esa lectura no es de esta empresa, no trae asientos o ya terminó.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_asientos) <> 'array' then raise exception 'Falta la lista de asientos.' using errcode = '22023'; end if;

  for a in select * from jsonb_array_elements(p_asientos) loop
    v_ej := a ->> 'ejercicio'; v_serie := (a ->> 'serie')::int; v_numero := (a ->> 'numero')::int;
    v_fecha := (a ->> 'fecha')::date; v_huella := a ->> 'huella';
    v_clave := format('%s/%s/%s', v_ej, v_serie, v_numero);
    begin
      -- Ya traído: igual o distinto, nunca dos veces.
      select * into v_e from public.journal_entry
       where company_id = p_company and external_program = 'diez' and external_year = v_ej
         and external_series = v_serie::text and external_number = v_numero::text;
      if v_e.id is not null then
        if v_e.external_hash = v_huella then n_estaban := n_estaban + 1;
        else distintos := distintos || jsonb_build_object('clave', v_clave, 'id', v_e.id); end if;
        continue;
      end if;

      if v_serie not in (1, 2, 3, 4, 9) then raise exception 'la serie % no es de Folvy', v_serie using errcode = '22023'; end if;
      select * into v_y from public.fiscal_year where company_id = p_company and code = v_ej;
      if v_y.id is null then raise exception 'el ejercicio % no existe en Folvy', v_ej using errcode = '22023'; end if;
      if v_y.origin = 'folvy' then raise exception 'el ejercicio % es de Folvy, no traído', v_ej using errcode = '22023'; end if;
      if v_fecha not between v_y.starts_on and v_y.ends_on then
        raise exception 'la fecha % no es del ejercicio %', v_fecha, v_ej using errcode = '22023';
      end if;
      if v_y.imported_until is not null and v_fecha > v_y.imported_until then
        raise exception 'el % es posterior al corte de lo traído (%)', v_fecha, v_y.imported_until using errcode = '22023';
      end if;
      if v_y.status <> 'open' then
        raise exception 'el ejercicio % está cerrado: se trae antes de cerrarlo', v_ej using errcode = '22023';
      end if;
      if exists (select 1 from public.journal_entry where company_id = p_company and fiscal_year_id = v_y.id
                  and series = v_serie and number = v_numero) then
        raise exception 'el número %/% de % ya lo tiene un asiento de Folvy', v_serie, v_numero, v_ej using errcode = '23505';
      end if;
      select array_agg(distinct x ->> 'cuenta') into v_faltan from jsonb_array_elements(a -> 'lineas') x
       where not exists (select 1 from public.company_account c where c.company_id = p_company and c.code = x ->> 'cuenta');
      if v_faltan is not null then
        raise exception 'faltan en el plan las subcuentas %', array_to_string(v_faltan, ', ') using errcode = '22023';
      end if;

      v_concepto := coalesce(nullif(trim(a ->> 'concepto'), ''), format('Asiento %s/%s traído de Diez', v_serie, v_numero));
      insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                        reasons, external_program, external_year, external_series, external_number, external_hash,
                                        import_run_id, created_by_name)
      values (v_cuenta, p_company, v_y.id, v_serie, v_fecha, v_concepto, 'migrated', 'borrador',
              jsonb_build_array(jsonb_build_object('decision', 'traido-de-diez',
                'porque', format('Asiento %s de Diez (tipo %s)', v_clave, coalesce(a ->> 'tipoAsiento', '—')))),
              'diez', v_ej, v_serie::text, v_numero::text, v_huella, p_run, 'Diez (traído)')
      returning id into v_id;

      for l in select * from jsonb_array_elements(a -> 'lineas') loop
        select id into v_ca from public.company_account where company_id = p_company and code = l ->> 'cuenta';
        insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                         external_counterpart, external_voucher, external_negative_side)
        values (v_cuenta, p_company, v_id, (l ->> 'posicion')::smallint, v_ca, (l ->> 'debe')::numeric / 100, (l ->> 'haber')::numeric / 100,
                nullif(l ->> 'concepto', ''), nullif(l ->> 'contrapartida', ''), nullif(l ->> 'justificante', ''), l ->> 'negativoEnDiez');
      end loop;

      -- Regla 1, otra vez en la base: dos líneas al menos, y cuadra al céntimo.
      select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber from public.journal_line where entry_id = v_id;
      if v_n < 2 then raise exception 'tiene % línea(s)', v_n using errcode = '23514'; end if;
      if v_debe <> v_haber then raise exception 'no cuadra: debe % y haber %', v_debe, v_haber using errcode = '23514'; end if;

      -- Validado con el número de Diez y encadenado, como journal_entry_validar.
      perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || p_company, 0));
      select chain_seq, hash into v_seq, v_prev from public.journal_entry
       where company_id = p_company and chain_seq is not null order by chain_seq desc limit 1;
      v_seq := coalesce(v_seq, 0) + 1;
      update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = null,
             validated_by_name = 'Diez (traído)', chain_seq = v_seq, prev_hash = v_prev, hash = 'pendiente'
       where id = v_id;
      v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(v_id));
      perform set_config('folvy.journal_huella', v_id::text, true);
      update public.journal_entry set hash = v_hash where id = v_id;
      perform set_config('folvy.journal_huella', '', true);

      -- Cómo estaba en Diez al leerlo: lo que compara el día a día.
      insert into public.external_entry_snapshot (account_id, company_id, program, ext_year, ext_series, ext_number, entry_date, lines,
                                                  total_debit, total_credit, hash, import_run_id)
      values (v_cuenta, p_company, 'diez', v_ej, v_serie::text, v_numero, v_fecha, a -> 'lineas', v_debe, v_haber, v_huella, p_run)
      on conflict (company_id, program, ext_year, ext_series, ext_number)
      do update set entry_date = excluded.entry_date, lines = excluded.lines, total_debit = excluded.total_debit,
                    total_credit = excluded.total_credit, hash = excluded.hash, import_run_id = excluded.import_run_id, read_at = now();
      n_traidos := n_traidos + 1;
    exception when others then
      rechazos := rechazos || jsonb_build_object('clave', v_clave, 'motivo', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('traidos', n_traidos, 'yaEstaban', n_estaban, 'distintos', distintos, 'rechazados', rechazos);
end $$;

comment on function public.conta_diez_importar(uuid, uuid, jsonb) is
  'C04b: escribe asientos de Diez ya convertidos (convertirAsiento) como migrated y validados, con el número de Diez y la huella encadenada. Idempotente; cada asiento en su subtransacción.';

-- 4. Cerrar un ejercicio traído (respuesta 3: 2023–2025 cerrados) ----------------------
-- La regularización y el cierre son los de Diez, traídos como asientos: aquí
-- solo se marca el ejercicio. Se exige que haya algo traído y que no quede
-- ningún asiento de Folvy sin validar dentro.
create or replace function public.conta_diez_cerrar_ejercicio(p_company uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_y public.fiscal_year; v_n int; v_abiertos int;
begin
  select * into v_y from public.fiscal_year where company_id = p_company and code = p_code for update;
  if v_y.id is null then raise exception 'El ejercicio % no existe.', p_code using errcode = 'P0002'; end if;
  if v_y.origin <> 'migrated' then
    raise exception 'El ejercicio % no es traído entero de Diez: se cierra con el cierre de Folvy.', p_code using errcode = '23514';
  end if;
  if v_y.status = 'closed' then return jsonb_build_object('ejercicio', p_code, 'yaCerrado', true); end if;
  select count(*) filter (where external_program = 'diez' and status = 'validado'),
         count(*) filter (where status in ('propuesto', 'borrador'))
    into v_n, v_abiertos from public.journal_entry where fiscal_year_id = v_y.id;
  if v_n = 0 then raise exception 'El ejercicio % no tiene nada traído: no se cierra vacío.', p_code using errcode = '23514'; end if;
  if v_abiertos > 0 then
    raise exception 'El ejercicio % tiene % asiento(s) sin validar.', p_code, v_abiertos using errcode = '23514';
  end if;
  update public.fiscal_year set status = 'closed', closed_at = now() where id = v_y.id;
  return jsonb_build_object('ejercicio', p_code, 'cerrado', true, 'asientos', v_n);
end $$;

comment on function public.conta_diez_cerrar_ejercicio(uuid, text) is
  'C04b: cierra un ejercicio traído entero de Diez, con lo traído validado y nada pendiente dentro.';

-- 5. Solo el servidor -----------------------------------------------------------------
revoke all on function public.conta_diez_cerrar_ejercicio(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_diez_cerrar_ejercicio(uuid, text) to service_role;
revoke all on function public.conta_diez_ejercicio(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.conta_diez_subcuentas(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conta_diez_importar(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_diez_ejercicio(uuid, text, date, date) to service_role;
grant execute on function public.conta_diez_subcuentas(uuid, uuid, jsonb) to service_role;
grant execute on function public.conta_diez_importar(uuid, uuid, jsonb) to service_role;

do $$
declare
  c constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';   -- empresa de la cuenta A de pruebas
  v_run uuid; v_y uuid; v_y2 uuid; r jsonb; v_ok boolean; v_n int; v_e public.journal_entry; v_txt text;
  f text;
  a_bien jsonb := jsonb_build_object('ejercicio', '2024', 'serie', 2, 'numero', 5, 'fecha', '2024-03-01', 'concepto', 'Factura inventada',
    'tipoAsiento', 2, 'huella', 'h-a', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '60000000', 'debe', 10000, 'haber', 0, 'negativoEnDiez', null),
      jsonb_build_object('posicion', 2, 'cuenta', '47200000', 'debe', 2100, 'haber', 0, 'negativoEnDiez', 'haber'),
      jsonb_build_object('posicion', 3, 'cuenta', '40000901', 'debe', 0, 'haber', 12100, 'negativoEnDiez', null)));
  b_bien jsonb := jsonb_build_object('ejercicio', '2024', 'serie', 4, 'numero', 1, 'fecha', '2024-01-01', 'concepto', '',
    'tipoAsiento', 3, 'huella', 'h-b', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '57000000', 'debe', 2800, 'haber', 0),
      jsonb_build_object('posicion', 2, 'cuenta', '55100000', 'debe', 0, 'haber', 2800)));
begin
  -- 1 · Permisos
  foreach f in array array['conta_diez_ejercicio(uuid,text,date,date)', 'conta_diez_subcuentas(uuid,uuid,jsonb)',
                           'conta_diez_importar(uuid,uuid,jsonb)', 'conta_diez_cerrar_ejercicio(uuid,text)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA importar · 1: % la puede ejecutar un usuario.', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception 'PRUEBA importar · 1: service_role no puede ejecutar %.', f;
    end if;
  end loop;

  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'diez', 'historico', '2024-01-01', '2024-12-31') returning id into v_run;

  -- 2 · Ejercicio traído
  v_y := public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  v_y2 := public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  if v_y is distinct from v_y2 then raise exception 'PRUEBA importar · 2: el ejercicio se creó dos veces.'; end if;
  if not exists (select 1 from public.fiscal_year where id = v_y and origin = 'migrated' and origin_program = 'diez'
                 and imported_until = '2024-12-31' and status = 'open') then
    raise exception 'PRUEBA importar · 2: el ejercicio traído no quedó migrated/diez/abierto hasta el 31/12.';
  end if;
  v_ok := false;
  begin perform public.conta_diez_ejercicio(c, '2026', '2026-01-01', '2026-12-31'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA importar · 2: dejó traer encima de un ejercicio de Folvy.'; end if;

  -- 3 · Subcuentas
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"40000901","nombre":"PROVEEDOR INVENTADO"},{"code":"40000001","nombre":"X"},{"code":"99999999","nombre":"NADA"}]');
  if (r ->> 'nuevas')::int <> 1 or (r ->> 'estaban')::int <> 1 or jsonb_array_length(r -> 'rechazadas') <> 1 then
    raise exception 'PRUEBA importar · 3: subcuentas %.', r;
  end if;
  if not exists (select 1 from public.company_account where company_id = c and code = '40000901' and template_code = '4000'
                 and kind = 'own' and source = 'migrated') then
    raise exception 'PRUEBA importar · 3: la 40000901 no cuelga de la 4000 como propia traída.';
  end if;

  -- 4 · Traer: 2 bien y 4 rechazados, cada uno con su motivo
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(
    a_bien, b_bien,
    jsonb_set(jsonb_set(a_bien, '{numero}', '6'), '{lineas,2,cuenta}', '"40000999"'),        -- subcuenta que falta
    jsonb_set(jsonb_set(b_bien, '{ejercicio}', '"2026"'), '{fecha}', '"2026-01-02"'),       -- ejercicio de Folvy
    jsonb_set(jsonb_set(b_bien, '{numero}', '2'), '{fecha}', '"2025-01-01"'),               -- fecha fuera del ejercicio
    jsonb_set(jsonb_set(b_bien, '{numero}', '3'), '{serie}', '7')));                        -- serie ajena
  if (r ->> 'traidos')::int <> 2 or jsonb_array_length(r -> 'rechazados') <> 4 then
    raise exception 'PRUEBA importar · 4: %.', r;
  end if;
  select string_agg(x ->> 'motivo', ' | ') into v_txt from jsonb_array_elements(r -> 'rechazados') x;
  if v_txt not like '%40000999%' or v_txt not like '%es de Folvy%' or v_txt not like '%no es del ejercicio%' or v_txt not like '%serie 7%' then
    raise exception 'PRUEBA importar · 4: los motivos no dicen lo que pasa: %.', v_txt;
  end if;

  -- 5 · Cómo queda
  select * into v_e from public.journal_entry where company_id = c and external_program = 'diez' and external_year = '2024'
     and external_series = '2' and external_number = '5';
  if v_e.status <> 'validado' or v_e.source_type <> 'migrated' or v_e.series <> 2 or v_e.number <> 5 or v_e.fiscal_year_id <> v_y
     or v_e.external_hash <> 'h-a' or v_e.import_run_id <> v_run or v_e.hash is null or v_e.hash = 'pendiente' then
    raise exception 'PRUEBA importar · 5: el asiento traído quedó %.', to_jsonb(v_e) - 'reasons';
  end if;
  if (select sum(debit) from public.journal_line where entry_id = v_e.id) <> 121.00 then
    raise exception 'PRUEBA importar · 5: los céntimos no se pasaron a euros.';
  end if;
  if (select external_negative_side from public.journal_line where entry_id = v_e.id and position = 2) is distinct from 'haber'
     or exists (select 1 from public.journal_line where entry_id = v_e.id and position <> 2 and external_negative_side is not null) then
    raise exception 'PRUEBA importar · 5: la marca de negativo no quedó solo en su línea.';
  end if;
  if (select concept from public.journal_entry where company_id = c and external_series = '4' and external_number = '1' and external_year = '2024')
     <> 'Asiento 4/1 traído de Diez' then
    raise exception 'PRUEBA importar · 5: un asiento sin descripción no tiene concepto de reserva.';
  end if;
  select count(*) into v_n from public.external_entry_snapshot where company_id = c and import_run_id = v_run;
  if v_n <> 2 then raise exception 'PRUEBA importar · 5: % fotos para comparar, y son 2.', v_n; end if;

  -- 6 · La cadena
  if exists (select 1 from public.journal_cadena_comprobar(c) k
              join public.journal_entry e on e.id = k.entry_id where e.import_run_id = v_run and not k.ok) then
    raise exception 'PRUEBA importar · 6: la cadena de huellas de lo traído no es buena.';
  end if;

  -- 7 · Idempotente
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(a_bien, jsonb_set(b_bien, '{huella}', '"h-b-cambiada"')));
  if (r ->> 'traidos')::int <> 0 or (r ->> 'yaEstaban')::int <> 1 or jsonb_array_length(r -> 'distintos') <> 1 then
    raise exception 'PRUEBA importar · 7: %.', r;
  end if;
  if (select count(*) from public.journal_entry where company_id = c and import_run_id = v_run) <> 2 then
    raise exception 'PRUEBA importar · 7: traerlo dos veces duplicó asientos.';
  end if;
  if (select external_hash from public.journal_entry where company_id = c and external_year = '2024' and external_series = '4' and external_number = '1') <> 'h-b' then
    raise exception 'PRUEBA importar · 7: un cambio en Diez pisó lo traído.';
  end if;

  -- 8 · Cerrar
  r := public.conta_diez_cerrar_ejercicio(c, '2024');
  if not (r ->> 'cerrado')::boolean or (select status from public.fiscal_year where id = v_y) <> 'closed' then
    raise exception 'PRUEBA importar · 8: no se cerró: %.', r;
  end if;
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(jsonb_set(b_bien, '{numero}', '9')));
  if (r ->> 'traidos')::int <> 0 or (r -> 'rechazados' -> 0 ->> 'motivo') not like '%está cerrado%' then
    raise exception 'PRUEBA importar · 8: entró algo en un ejercicio cerrado: %.', r;
  end if;
  v_ok := false;
  begin perform public.conta_diez_cerrar_ejercicio(c, '2026'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA importar · 8: cerró por aquí un ejercicio de Folvy.'; end if;

  raise notice 'PRUEBA importar: 8 de 8 bien.';
end $$;

rollback;
