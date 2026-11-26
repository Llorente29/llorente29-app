-- supabase/migrations/20261126T0710_x14h_repetida_en_erp10.sql
-- cambia: public.customer_invoice · prueba: supabase/staging/sql/20261126_x14h_repetida_en_erp10_prueba.sql
-- cambia: public.tg_customer_invoice_repetida · prueba: supabase/staging/sql/20261126_x14h_repetida_en_erp10_prueba.sql
-- cambia: public.customer_invoice_repetida_solo_traida · prueba: supabase/staging/sql/20261126_x14h_repetida_en_erp10_prueba.sql
-- cambia: public.conta_traer_dar_por_bueno · prueba: supabase/staging/sql/20261126_x14h_repetida_en_erp10_prueba.sql
--
-- X14 · 2 (Julio, 26/11): «Darlo por bueno» del 2024 de QBO Integrity para porque el libro de facturas expedidas de ERP10
-- trae 9 facturas dos veces, iguales (serie, número, ejercicio, fecha, cliente e importes), y Sumied no admitía dos emitidas
-- con el mismo número. Regla de Julio: lo traído de ERP10 anterior al día de inicio de la empresa es historia de ERP10, y
-- Sumied es copia exacta, errores incluidos (también en 2026). Desde el día de inicio manda Sumied: una repetida para, como hoy.
-- Las facturas nuevas siguen sin poder repetir número.
--   1. customer_invoice.import_repeated (NUEVA, «repetida en ERP10»): no, salvo en una emitida traída de una carga de ERP10.
--   2. Una guarda (CHECK y disparador): solo traída de una carga de ERP10, anterior al día de inicio (o sin día de inicio
--      todavía); y ninguna emitida sin la marca puede llevar el número de otra, marcada o no.
--   3. La regla de un solo número pasa a mirar solo las no marcadas: primero el índice único nuevo y después se quita la
--      restricción de antes (customer_invoice_company_id_series_code_fiscal_year_number_key), en la misma transacción.
--   4. conta_traer_dar_por_bueno (misma firma; guardada): las emitidas que la carga trae repetidas entran todas, cada una con
--      su asiento si lo tiene, marcadas; desde el día de inicio, una repetida para. Si choca con una que ya estaba en Sumied
--      fuera de la carga, para, como antes.
-- No cambia ninguna fila al aplicarse (la columna nueva sale en «no»). Nada en el camino del pedido. El real lo lanza Julio.
-- Vuelta atrás: devuelve la función de su respaldo, la restricción de antes (si no hay ninguna marcada) y quita lo nuevo.

-- 1 · La marca ------------------------------------------------------------------------------------------------------------------
alter table public.customer_invoice add column if not exists import_repeated boolean not null default false;
comment on column public.customer_invoice.import_repeated is
  'X14h · «Repetida en ERP10»: el libro de expedidas de ERP10 la trae más de una vez con el mismo número. Solo en lo traído de ERP10 anterior al día de inicio.';

-- 2 · La guarda -----------------------------------------------------------------------------------------------------------------
alter table public.customer_invoice add constraint customer_invoice_repetida_solo_traida
  check (not import_repeated or (origin = 'traida' and import_run_id is not null));

create or replace function public._customer_invoice_repetida_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dia date;
begin
  if new.number is null or new.fiscal_year is null then return new; end if;
  if new.import_repeated then
    if not exists (select 1 from public.import_run r where r.id = new.import_run_id and r.program = 'erp10') then
      raise exception 'Solo una factura traída de ERP10 puede ir marcada «repetida en ERP10».' using errcode = '23514';
    end if;
    v_dia := public.conta_dia_de_inicio(new.company_id);
    if v_dia is not null and new.issue_date >= v_dia then
      raise exception 'La factura %-% es del % o después del día de inicio (%): desde ahí manda Sumied y no puede repetir número.',
        new.series_code, new.number, to_char(new.issue_date, 'DD/MM/YYYY'), to_char(v_dia, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    -- Solo repite con otras repetidas de lo traído de ERP10, nunca con una de Sumied.
    if exists (select 1 from public.customer_invoice c where c.company_id = new.company_id and c.series_code = new.series_code
                 and c.fiscal_year = new.fiscal_year and c.number = new.number and c.id <> new.id and not c.import_repeated) then
      raise exception 'Ya hay en Sumied una factura emitida %-% del %.', new.series_code, new.number, new.fiscal_year using errcode = '23505';
    end if;
  elsif exists (select 1 from public.customer_invoice c where c.company_id = new.company_id and c.series_code = new.series_code
                  and c.fiscal_year = new.fiscal_year and c.number = new.number and c.id <> new.id and c.import_repeated) then
    raise exception 'Ya hay en Sumied una factura emitida %-% del % (repetida en ERP10).', new.series_code, new.number, new.fiscal_year using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public._customer_invoice_repetida_guarda() from public, anon, authenticated;
create trigger tg_customer_invoice_repetida before insert or update of import_repeated, company_id, series_code, fiscal_year, number, issue_date
  on public.customer_invoice for each row execute function public._customer_invoice_repetida_guarda();

-- 3 · Un solo número, en las no marcadas ------------------------------------------------------------------------------------
create unique index if not exists customer_invoice_numero_unico on public.customer_invoice (company_id, series_code, fiscal_year, number)
  where not import_repeated;
alter table public.customer_invoice drop constraint if exists customer_invoice_company_id_series_code_fiscal_year_number_key;

-- 4 · conta_traer_dar_por_bueno: las repetidas de ERP10 entran todas, marcadas ---------------------------------------------
select public._respaldar_funcion('public.conta_traer_dar_por_bueno(uuid,text)', '20261126T0710_x14h_repetida_en_erp10');
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
  v_rep boolean; v_dia date;
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
  v_dia := public.conta_dia_de_inicio(v_r.company_id);
  for x in select * from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) loop
    continue when x->>'marca' is not distinct from 'fuera';
    if exists (select 1 from public.customer_invoice c where c.company_id = v_r.company_id and c.series_code = x->>'serie'
                 and c.fiscal_year = (x->>'ejercicio')::int and c.number = (x->>'numero')::int
                 and c.import_run_id is distinct from p_carga) then
      raise exception 'No se ha dado por bueno nada: ya hay en Sumied una factura emitida %-% del %.', x->>'serie', x->>'numero', x->>'ejercicio'
        using errcode = '23514', hint = 'emitida';
    end if;
    -- X14h (Julio, 26/11) · Lo traído de ERP10 anterior al día de inicio es su historia, y Sumied es copia exacta, errores
    -- incluidos: si su libro de expedidas trae dos veces el mismo número, entran las dos, marcadas «repetida en ERP10». Desde
    -- el día de inicio manda Sumied, y una repetida para, como antes.
    v_rep := (select count(*) from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) y
               where y->>'marca' is distinct from 'fuera' and y->>'serie' = x->>'serie' and y->>'ejercicio' = x->>'ejercicio'
                 and y->>'numero' = x->>'numero') > 1;
    if v_rep and (v_r.program <> 'erp10' or (v_dia is not null and (x->>'fecha')::date >= v_dia)) then
      raise exception 'No se ha dado por bueno nada: lo traído trae dos veces la factura emitida %-% del %.', x->>'serie', x->>'numero', x->>'ejercicio'
        using errcode = '23514', hint = 'emitida';
    end if;
    insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                         party_id, customer, base, tax, withholding_amount, total, entry_id, created_by, created_by_name,
                                         issued_at, issued_by_name, import_run_id, import_mark, import_pending, import_repeated)
    values ((x->>'id')::uuid, v_r.account_id, v_r.company_id, 'emitida', 'factura', 'traida', x->>'serie', (x->>'ejercicio')::int, (x->>'numero')::int,
            x->>'numero_texto', (x->>'fecha')::date, nullif(x->>'party_id', '')::uuid, x->'cliente', (x->>'base')::numeric, (x->>'cuota')::numeric,
            (x->>'retencion')::numeric, (x->>'total')::numeric, nullif(x->>'asiento', '')::uuid, auth.uid(), v_prog || ' (traída)', now(),
            v_prog || ' (traída)', p_carga, x->>'marca', (x->>'pendiente')::numeric, v_rep);
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
end $function$;
