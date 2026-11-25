-- supabase/migrations/20261125T1533_x14f_sumas_de_erp10.sql
-- cambia: public._conta_traer_comparar · prueba: supabase/staging/sql/20261125_x14f_sumas_de_erp10_prueba.sql
-- cambia: public.conta_traer_antes_de_dar_por_bueno · prueba: supabase/staging/sql/20261125_x14f_sumas_de_erp10_prueba.sql
-- cambia: public.conta_traer_dar_por_bueno · prueba: supabase/staging/sql/20261125_x14f_sumas_de_erp10_prueba.sql
--
-- X14 · 2 (Julio, 25/11, urgente): el 2024 de QBO Integrity entró en prueba y «Sumas y saldos» decía «Cuadra · las 0
-- cuentas con saldo, igual»: un falso verde. Con la conexión, el sumas y saldos «de ERP10» se calculaba sumando los
-- mismos asientos leídos, y la base comparaba lo traído consigo mismo: cuadraba siempre. Lo que se compara, ahora, es un
-- sumas y saldos que viene de ERP10: su fichero, soltado en la carga en prueba (el de la API, en un encargo aparte).
--   1. conta_traer_poner_sumas (NUEVA): guarda en la carga en prueba el sumas y saldos del fichero (cuenta, nombre, debe y
--      haber en céntimos; detail.sumas_de = 'fichero') y devuelve la comparación cuenta a cuenta, con su frase.
--   2. _conta_traer_comparar (misma firma; guardada): «comparado» solo con un sumas y saldos de fichero, y cuántas cuentas
--      ha comparado. El calculado de los asientos ya no cuenta como comparado.
--   3. conta_traer_antes_de_dar_por_bueno (misma firma; guardada): sin comparar, no se puede dar por bueno, y lo dice.
--   4. conta_traer_dar_por_bueno (misma firma; guardada): la misma guarda en el servidor, si la carga trae asientos.
-- Nada en el camino del pedido. No cambia ninguna fila al aplicarse. El real lo lanza Julio. Vuelta atrás: quita la nueva
-- y devuelve las tres de sus respaldos.

-- 1 · conta_traer_poner_sumas: el sumas y saldos de ERP10, de su fichero ---------------------------------------------------
create or replace function public.conta_traer_poner_sumas(p_carga uuid, p_sumas jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.import_run; v_quien text; v_c jsonb; v_prog text; v_n int;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' then raise exception 'Esa carga no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_r.account_id) then
    raise exception 'Solo un administrador de la cuenta compara lo traído con el sumas y saldos.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || v_r.company_id::text, 0));
  select * into v_r from public.import_run where id = p_carga for update;
  if v_r.status <> 'en_prueba' then raise exception 'Esta carga no está en prueba: ya no se compara.' using errcode = '23514'; end if;
  v_prog := case v_r.program when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;
  if jsonb_typeof(p_sumas) <> 'array' or jsonb_array_length(p_sumas) = 0 then
    raise exception 'El fichero no trae ninguna cuenta: no es el sumas y saldos de %.', v_prog using errcode = '22023', hint = 'sumas_vacias';
  end if;
  select count(*) into v_n from jsonb_array_elements(p_sumas) s
   where coalesce(s->>'cuenta', '') !~ '^[0-9]+$' or (s->>'debe') !~ '^-?[0-9]+$' or (s->>'haber') !~ '^-?[0-9]+$';
  if v_n > 0 then
    raise exception 'El sumas y saldos trae % sin cuenta o sin importe en céntimos: no se ha comparado.', public._conta_traer_cuantos(v_n, 'fila', 'filas')
      using errcode = '22023', hint = 'sumas_mal';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  update public.import_run set detail = coalesce(detail, '{}') || jsonb_build_object('sumas', p_sumas, 'sumas_de', 'fichero',
           'sumas_puestas', jsonb_build_object('por', v_quien, 'el', now(), 'cuentas', jsonb_array_length(p_sumas)))
   where id = p_carga;
  v_c := public._conta_traer_comparar(p_carga);
  return v_c || jsonb_build_object('texto', case when jsonb_array_length(v_c->'diferencias') = 0
    then format('Comparado con el sumas y saldos de %s: las %s cuentas, iguales al céntimo en el debe y en el haber.', v_prog, (v_c->>'cuentas'))
    else format('Comparado con el sumas y saldos de %s: %s de %s %s.', v_prog,
                public._conta_traer_cuantos(jsonb_array_length(v_c->'diferencias'), 'cuenta', 'cuentas'), (v_c->>'cuentas'),
                case when jsonb_array_length(v_c->'diferencias') = 1 then 'no queda igual' else 'no quedan iguales' end) end);
end $$;
comment on function public.conta_traer_poner_sumas(uuid, jsonb, text) is
  'X14 · 2: guarda en una carga en prueba el sumas y saldos de ERP10 (su fichero: cuenta, nombre, debe y haber en céntimos) y la compara, cuenta a cuenta, debe y haber. Solo un administrador.';
revoke all on function public.conta_traer_poner_sumas(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_traer_poner_sumas(uuid, jsonb, text) to authenticated;

-- 2 · _conta_traer_comparar: solo con el de ERP10 ---------------------------------------------------------------------------
select public._respaldar_funcion('public._conta_traer_comparar(uuid)', '20261125T1533_x14f_sumas_de_erp10');
CREATE OR REPLACE FUNCTION public._conta_traer_comparar(p_carga uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as (select * from public.import_run where id = p_carga),
  alli as (
    select s->>'cuenta' cuenta, max(s->>'nombre') nombre, sum((s->>'debe')::numeric) / 100 debe, sum((s->>'haber')::numeric) / 100 haber
      from r, jsonb_array_elements(coalesce(r.detail->'sumas', '[]')) s group by 1),
  traido as (
    select a.code cuenta, max(a.name) nombre, sum(l.debit) debe, sum(l.credit) haber
      from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
     where e.import_run_id = p_carga and e.source_type = 'migrated' group by 1),
  todo as (
    select coalesce(t.cuenta, x.cuenta) cuenta, coalesce(x.nombre, t.nombre) nombre,
           coalesce(x.debe, 0) alli_debe, coalesce(x.haber, 0) alli_haber, coalesce(t.debe, 0) traido_debe, coalesce(t.haber, 0) traido_haber
      from traido t full join alli x on x.cuenta = t.cuenta)
  -- X14 · 2 · Solo se compara con un sumas y saldos de ERP10 (su fichero: detail.sumas_de = 'fichero'). El calculado de los
  -- mismos asientos (la conexión) no compara nada: daba «Cuadra» siempre.
  , vale as (select coalesce((select detail->>'sumas_de' from r) = 'fichero', false) and jsonb_array_length(coalesce((select detail->'sumas' from r), '[]')) > 0 ok)
  select jsonb_build_object(
    'comparado', (select ok from vale),
    'cuentas', case when (select ok from vale) then (select count(*) from todo) else 0 end,
    'diferencias', coalesce((select jsonb_agg(jsonb_build_object('cuenta', cuenta, 'nombre', nombre, 'alli_debe', alli_debe, 'alli_haber', alli_haber,
                                                                 'traido_debe', traido_debe, 'traido_haber', traido_haber) order by cuenta)
                               from todo where (select ok from vale)
                                and (round(alli_debe, 2) <> round(traido_debe, 2) or round(alli_haber, 2) <> round(traido_haber, 2))), '[]'))
$function$

;

-- 3 · conta_traer_antes_de_dar_por_bueno: sin comparar, no ----------------------------------------------------------------
select public._respaldar_funcion('public.conta_traer_antes_de_dar_por_bueno(uuid)', '20261125T1533_x14f_sumas_de_erp10');
CREATE OR REPLACE FUNCTION public.conta_traer_antes_de_dar_por_bueno(p_carga uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r public.import_run; v_c jsonb; n_a int; n_f int; v_prog text; v_texto text; v_puede boolean := true;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' or not public.belongs_to_account(v_r.account_id) then
    raise exception 'Esa carga no existe.' using errcode = 'P0002';
  end if;
  v_prog := case v_r.program when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;
  if v_r.status <> 'en_prueba' then
    return jsonb_build_object('puede', false, 'texto', case v_r.status when 'dada_por_buena' then 'Esta carga ya está dada por buena.'
                                                                       when 'deshecha' then 'Esta carga está deshecha: no hay nada que dar por bueno.'
                                                                       else 'Esta carga no está en prueba.' end);
  end if;
  select count(*) into n_a from public.journal_entry where import_run_id = p_carga and source_type = 'migrated';
  n_f := (select count(*) from public.supplier_invoice where import_run_id = p_carga and source = 'traida' and import_mark is distinct from 'fuera')
       + (select count(*) from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) e where e->>'marca' is distinct from 'fuera');
  v_c := public._conta_traer_comparar(p_carga);
  if n_a = 0 and n_f = 0 then
    v_texto := format('Vas a dar por bueno lo traído de %s: %s. Después ya no se podrá deshacer.', v_prog, coalesce(nullif(regexp_replace(
                 coalesce(v_r.detail->>'texto', ''), '^He traído (.*)\. Lo .*$', '\1'), coalesce(v_r.detail->>'texto', '')), 'las cuentas y los terceros'));
  elsif not coalesce((v_c->>'comparado')::boolean, false) then
    -- X14 · 2 · Sin comparar con el sumas y saldos de ERP10, cuenta a cuenta, no se da por bueno (Julio, 25/11).
    v_puede := false;
    v_texto := format('No se ha podido comparar con el sumas y saldos de %s: suelta su fichero (el sumas y saldos del ejercicio) en «Sumas y saldos». Sin compararlo no se da por bueno.', v_prog);
  elsif jsonb_array_length(v_c->'diferencias') > 0 then
    v_puede := false;
    v_texto := format('No cuadra con el sumas y saldos de %s en %s. Míralas antes de darlo por bueno.', v_prog,
                      public._conta_traer_cuantos(jsonb_array_length(v_c->'diferencias'), 'cuenta', 'cuentas'));
  else
    v_texto := format('Vas a dar por bueno lo traído de %s: %s y %s, hasta el %s. %s Después ya no se podrá deshacer.', v_prog,
                      public._conta_traer_cuantos(n_a, 'asiento', 'asientos'), public._conta_traer_cuantos(n_f, 'factura', 'facturas'),
                      to_char(v_r.period_to, 'DD/MM/YYYY'),
                      case when (v_c->>'comparado')::boolean then 'Cuadra con el sumas y saldos.'
                           else 'No se ha podido comparar con el sumas y saldos, porque no se trajo.' end);
  end if;
  return jsonb_build_object('puede', v_puede, 'texto', v_texto, 'comparado', (v_c->>'comparado')::boolean, 'cuentas', coalesce((v_c->>'cuentas')::int, 0), 'diferencias', v_c->'diferencias',
                            'asientos', n_a, 'facturas', n_f,
                            'si_hay_un_error', 'Si después ves un error en lo traído, corrígelo con un asiento a mano: lo traído ya no se deshace ni se anula.');
end $function$

;

-- 4 · conta_traer_dar_por_bueno: la misma guarda -------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_traer_dar_por_bueno(uuid,text)', '20261125T1533_x14f_sumas_de_erp10');
CREATE OR REPLACE FUNCTION public.conta_traer_dar_por_bueno(p_carga uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r public.import_run; v_quien text; v_c jsonb; e record; v_msg text; v_prog text; v_inicio date;
  n_a int := 0; n_emi int := 0; n_pagos int; n_cobros int; n_sin int := 0; v_num_desde int; v_num_hasta int;
  x jsonb; v_s record; v_i record; v_texto text; v_vale boolean;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' then raise exception 'Esa carga no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_r.account_id) then
    raise exception 'Solo un administrador de la cuenta da por bueno lo traído.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || v_r.company_id::text, 0));
  select * into v_r from public.import_run where id = p_carga for update;
  if v_r.status = 'dada_por_buena' then raise exception 'Esta carga ya está dada por buena.' using errcode = '23514', hint = 'dada_por_buena'; end if;
  if v_r.status <> 'en_prueba' then raise exception 'Esta carga no está en prueba: no se da por buena.' using errcode = '23514'; end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  v_prog := case v_r.program when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;

  -- Antes, el sumas y saldos: con diferencias, no.
  v_c := public._conta_traer_comparar(p_carga);
  -- X14 · 2 · Sin comparar con el sumas y saldos de ERP10 (su fichero), no: si trae asientos, primero se compara.
  if not coalesce((v_c->>'comparado')::boolean, false)
     and exists (select 1 from public.journal_entry where import_run_id = p_carga and source_type = 'migrated') then
    raise exception 'No se ha podido comparar con el sumas y saldos de %: suelta su fichero en «Sumas y saldos» antes de darlo por bueno.', v_prog
      using errcode = '23514', hint = 'sin_comparar';
  end if;
  if jsonb_array_length(v_c->'diferencias') > 0 then
    raise exception 'No cuadra con el sumas y saldos de % en %. Míralas antes de darlo por bueno.', v_prog,
      public._conta_traer_cuantos(jsonb_array_length(v_c->'diferencias'), 'cuenta', 'cuentas') using errcode = '23514', hint = 'no_cuadra';
  end if;

  -- La carga deja de estar en prueba (sus asientos ya se pueden validar), y se validan todos, en orden.
  update public.import_run set status = 'dada_por_buena' where id = p_carga;
  for e in select j.id, j.entry_date, j.external_series, j.external_number from public.journal_entry j
            where j.import_run_id = p_carga and j.source_type = 'migrated' and j.status = 'borrador'
            order by j.entry_date, j.external_series, nullif(regexp_replace(j.external_number, '[^0-9]', '', 'g'), '')::bigint, j.external_number, j.id loop
    begin
      x := public._journal_entry_validar(e.id, v_quien);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception 'No se ha dado por bueno nada: el asiento n.º % en % (serie %), del %, no se puede validar. %', e.external_number, v_prog,
        e.external_series, to_char(e.entry_date, 'DD/MM/YYYY'), v_msg using errcode = '23514', hint = 'asiento';
    end;
    n_a := n_a + 1;
    v_num_desde := coalesce(v_num_desde, (x->>'numero')::int); v_num_hasta := (x->>'numero')::int;
  end loop;

  -- Las emitidas, guardadas con la carga: ahora sí existen (las dejadas fuera, no).
  for x in select * from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) loop
    continue when x->>'marca' is not distinct from 'fuera';
    if exists (select 1 from public.customer_invoice c where c.company_id = v_r.company_id and c.series_code = x->>'serie'
                 and c.fiscal_year = (x->>'ejercicio')::int and c.number = (x->>'numero')::int) then
      raise exception 'No se ha dado por bueno nada: ya hay en Sumied una factura emitida %-% del %.', x->>'serie', x->>'numero', x->>'ejercicio'
        using errcode = '23514', hint = 'emitida';
    end if;
    insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                         party_id, customer, base, tax, withholding_amount, total, entry_id, created_by, created_by_name,
                                         issued_at, issued_by_name, import_run_id, import_mark, import_pending)
    values ((x->>'id')::uuid, v_r.account_id, v_r.company_id, 'emitida', 'factura', 'traida', x->>'serie', (x->>'ejercicio')::int, (x->>'numero')::int,
            x->>'numero_texto', (x->>'fecha')::date, nullif(x->>'party_id', '')::uuid, x->'cliente', (x->>'base')::numeric, (x->>'cuota')::numeric,
            (x->>'retencion')::numeric, (x->>'total')::numeric, nullif(x->>'asiento', '')::uuid, auth.uid(), v_prog || ' (traída)', now(),
            v_prog || ' (traída)', p_carga, x->>'marca', (x->>'pendiente')::numeric);
    n_emi := n_emi + 1;
  end loop;

  -- El historial, como traído (si la carga traía asientos). La decisión de trabajar sin lo anterior se
  -- queda escrita, pero ya no hace falta: lo anterior está traído.
  if n_a > 0 then
    update public.fiscal_year set history_imported_at = now()
     where company_id = v_r.company_id and origin in ('mixed', 'migrated') and history_imported_at is null and starts_on <= v_r.period_to;
  end if;

  -- Las recibidas que entraron sin proveedor y tienen el NIF de uno de la carga: lo encuentran.
  for v_s in select s.id, s.name, public._conta_nif_clave(s.tax_id) nif from public.supplier s
              where s.account_id = v_r.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) is not null
                and (s.import_run_id = p_carga or s.id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_r.detail->'proveedores', '[]')))) loop
    for v_i in select i.id, i.inbox_id, i.company_id from public.supplier_invoice i
                where i.account_id = v_r.account_id and i.supplier_id is null and i.status not in ('anulada', 'descartada')
                  and (i.company_id = v_r.company_id or i.company_id is null)
                  and public._conta_nif_clave(coalesce(i.reading->'factura'->'proveedor'->>'nif', i.issuer_tax_id)) = v_s.nif loop
      v_vale := true;
      begin
        update public.supplier_invoice set supplier_id = v_s.id where id = v_i.id;
      exception when others then v_vale := false;   -- p. ej. resulta repetida: se queda como estaba, sin proveedor
      end;
      continue when not v_vale;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
      values (v_r.account_id, coalesce(v_i.company_id, v_r.company_id), v_i.inbox_id, v_i.id, 'folvy', null, 'corregida',
              format('Sumied le ha puesto su proveedor, %s, al dar por bueno lo traído de %s: tienen el mismo NIF.', v_s.name, v_prog));
      n_sin := n_sin + 1;
    end loop;
  end loop;

  select count(*) into n_pagos from public.supplier_invoice
   where import_run_id = p_carga and source = 'traida' and status = 'aprobada' and import_mark is distinct from 'fuera';
  select count(*) into n_cobros from public.conta_factura_cobro c join public.customer_invoice ci on ci.id = c.invoice_id
   where ci.import_run_id = p_carga and ci.origin = 'traida' and c.pendiente >= 0.005;
  v_inicio := public.conta_dia_de_inicio(v_r.company_id);
  if n_a = 0 and n_emi = 0 and not exists (select 1 from public.supplier_invoice where import_run_id = p_carga) then
    v_texto := format('Hecho. Lo traído de %s ya es parte de tu contabilidad: %s.', v_prog,
                      coalesce(nullif(regexp_replace(coalesce(v_r.detail->>'texto', ''), '^He traído (.*)\. Lo .*$', '\1'), coalesce(v_r.detail->>'texto', '')), 'las cuentas y los terceros'));
  else
    v_texto := format('Hecho. %s de antes del %s ya %s en tu contabilidad', public._conta_traer_cuantos(n_a, 'asiento', 'asientos'),
                      to_char(coalesce(v_inicio, v_r.period_to + 1), 'DD/MM/YYYY'), case when n_a = 1 then 'está' else 'están' end)
      || case when n_pagos + n_cobros = 0 then '.'
              when n_cobros = 0 then format(', y %s %s a Pagos.', public._conta_traer_cuantos(n_pagos, 'factura pendiente', 'facturas pendientes'), case when n_pagos = 1 then 'ha pasado' else 'han pasado' end)
              when n_pagos = 0 then format(', y %s %s a Cobros.', public._conta_traer_cuantos(n_cobros, 'factura pendiente', 'facturas pendientes'), case when n_cobros = 1 then 'ha pasado' else 'han pasado' end)
              else format(', y %s han pasado: %s a Pagos y %s a Cobros.', public._conta_traer_cuantos(n_pagos + n_cobros, 'factura pendiente', 'facturas pendientes'), n_pagos, n_cobros) end;
  end if;
  if n_sin > 0 then
    v_texto := v_texto || format(' %s que %s entrado sin proveedor ya %s.', public._conta_traer_cuantos(n_sin, 'factura', 'facturas'),
                                 case when n_sin = 1 then 'había' else 'habían' end, case when n_sin = 1 then 'lo tiene' else 'lo tienen' end);
  end if;
  update public.import_run set detail = coalesce(detail, '{}') || jsonb_build_object('dada', jsonb_build_object('por', v_quien, 'el', now(),
           'asientos', n_a, 'numeros', case when n_a > 0 then jsonb_build_object('serie', 8, 'desde', v_num_desde, 'hasta', v_num_hasta) end,
           'emitidas', n_emi, 'pagos', n_pagos, 'cobros', n_cobros, 'con_proveedor', n_sin, 'texto', v_texto))
   where id = p_carga;
  return jsonb_build_object('carga', p_carga, 'asientos', n_a, 'emitidas', n_emi, 'pagos', n_pagos, 'cobros', n_cobros, 'con_proveedor', n_sin,
                            'numeros', case when n_a > 0 then jsonb_build_object('desde', v_num_desde, 'hasta', v_num_hasta) end, 'texto', v_texto);
end $function$

;
