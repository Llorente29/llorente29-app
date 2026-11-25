-- supabase/migrations/20261125T1132_x14d_negativos.sql
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public._conta_traer_seguir · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public.conta_asiento_modificar · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public.conta_cierre_validar · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public._s01p_nomina_retencion_poner · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
-- cambia: public.conta_apunte_pago_modelo · prueba: supabase/staging/sql/20261125_x14d_negativos_prueba.sql
--
-- X14 · 2 (Julio, 25/11): Sumied admite asientos en negativo, como ERP10. El 2024 de QBO trae 87 líneas negativas (37 al
-- debe y 50 al haber, en 37 asientos) y journal_line no las admitía (journal_line_debe_o_haber: (debit > 0) <> (credit > 0)).
-- Entran tal cual, y se usarán también al contabilizar. Terminado: las sumas y saldos del 2024 de QBO iguales a ERP10 al
-- céntimo, debe y haber, sin diferencias que explicar.
--   1. journal_line: un solo lado distinto de 0, con cualquier signo. Quita journal_line_debit_check (debit >= 0) y
--      journal_line_credit_check (credit >= 0) —AUTORIZO de Julio, con el nombre de este fichero— y vuelve a poner
--      journal_line_debe_o_haber como (debit <> 0) <> (credit <> 0). Toda fila de hoy cumple la nueva.
--   2. _conta_traer_seguir: una línea a 0 en el debe y en el haber (2 en el 2024 de QBO) no entra y va a «lo que no ha
--      entrado» (lo que la carga enseña para mirar) con su porqué; se cuentan en la carga (lineas_a_cero).
--   3. conta_asiento_modificar: el asiento a mano admite un importe negativo.
--   4. conta_motivos_para_validar: la base y la cuota se comparan en valor absoluto con el importe (con un negativo daba un
--      falso «la cuota no es la base × tipo» y el asiento no se validaba).
--   5. conta_cierre_validar: el signo de la base del IVA sale de credit − debit, no de «credit > 0».
--   6. _s01p_nomina_retencion_poner: la línea de la retención, también en negativo (credit <> 0).
--   7. conta_apunte_pago_modelo: «el pago» o «la devolución» por el signo de debit − credit.
-- Lo que lee el diario y ya admite negativos (sumas y saldos, mayor, libros de IVA, 303, 347, resultado) no se toca: lo
-- prueba la misma prueba de staging. Las seis funciones, enteras (las de producción con los trozos «X14 · 2»), con respaldo.
-- Nada en el camino del pedido. No cambia ninguna fila. El real lo lanza Julio. Vuelta atrás: las restricciones de antes
-- (solo si no hay ninguna línea en negativo) y las seis funciones de sus respaldos.

-- 1 · journal_line: un solo lado distinto de 0, con cualquier signo -------------------------------------------------------
alter table public.journal_line drop constraint journal_line_debit_check;
alter table public.journal_line drop constraint journal_line_credit_check;
alter table public.journal_line drop constraint journal_line_debe_o_haber;
alter table public.journal_line add constraint journal_line_debe_o_haber check ((debit <> 0) <> (credit <> 0));
comment on constraint journal_line_debe_o_haber on public.journal_line is
  'X14 · 2: un importe en un solo lado, distinto de 0 y con cualquier signo (como ERP10). Antes, (debit > 0) <> (credit > 0) y los dos >= 0.';

-- 2 · _conta_traer_seguir -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public._conta_traer_seguir(uuid,timestamp with time zone)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public._conta_traer_seguir(p_carga uuid, p_hasta timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st jsonb; tz record; n_hechos int := 0;
  v_carga uuid := p_carga; v_company uuid; v_cuenta uuid; v_prog text; v_nombre_prog text; v_quien text; v_inicio date; v_hasta date;
  v_fuera_a int; v_fuera_f int; v_apuntes int; v_tot_debe numeric; v_tot_haber numeric; n_asientos int; n_facturas int;
  n_cuentas int; n_cuentas_estaban int; n_prov int; n_cli int; n_enlazados int; v_sin_tipo int; n_rec int; n_emi int; n_casadas int; n_sin_casar int;
  v_tercero jsonb; v_mirar jsonb; v_emitidas jsonb; v_provs jsonb; v_fichas jsonb; v_deshacer jsonb; v_corte jsonb;
  a jsonb; l jsonb; f jsonb; x jsonb;
  v_lineas jsonb; v_r jsonb; v_entry uuid; v_tipo_id uuid; v_ret_id uuid; v_ret_modelo text;
  v_sup uuid; v_party uuid; v_nif text; v_fac uuid; v_num int; v_serie text;
  v_aprendidas int := 0; v_valor text; v_etiqueta text; v_texto text; v_counts jsonb;
begin
  st := (select detail->'estado' from public.import_run where id = p_carga and kind = 'carga' and status = 'cargando' for update);
  if st is null then raise exception 'Esa carga no está a medias.' using errcode = '23514'; end if;
  v_company := (st->>'company')::uuid; v_cuenta := (st->>'cuenta')::uuid; v_prog := st->>'prog'; v_nombre_prog := st->>'nombre_prog'; v_quien := st->>'quien';
  v_inicio := (st->>'inicio')::date; v_hasta := (st->>'hasta')::date; v_fuera_a := (st->>'fuera_a')::int; v_fuera_f := (st->>'fuera_f')::int;
  v_apuntes := (st->>'apuntes')::int; v_tot_debe := (st->>'tot_debe')::numeric; v_tot_haber := (st->>'tot_haber')::numeric;
  n_asientos := (st->>'n_asientos')::int; n_facturas := (st->>'n_facturas')::int;
  n_cuentas := (st->>'n_cuentas')::int; n_cuentas_estaban := (st->>'n_cuentas_estaban')::int; n_prov := (st->>'n_prov')::int; n_cli := (st->>'n_cli')::int;
  n_enlazados := (st->>'n_enlazados')::int; v_sin_tipo := (st->>'sin_tipo')::int; n_rec := (st->>'n_rec')::int; n_emi := (st->>'n_emi')::int;
  n_casadas := (st->>'n_casadas')::int; n_sin_casar := (st->>'n_sin_casar')::int;
  v_tercero := st->'tercero'; v_mirar := st->'mirar'; v_emitidas := st->'emitidas'; v_provs := st->'provs'; v_fichas := st->'fichas';
  v_deshacer := st->'deshacer'; v_corte := st->'corte';

  -- La cola, en orden (los asientos antes que las facturas, que se atan a ellos), hasta la hora. Siempre avanza al menos uno.
  for tz in select q.orden, q.tipo, q.dato from public.conta_traer_trozo q where q.carga = p_carga and not q.hecho order by q.orden loop
    exit when n_hechos > 0 and clock_timestamp() > p_hasta;
    update public.conta_traer_trozo q set hecho = true where q.carga = p_carga and q.orden = tz.orden;
    n_hechos := n_hechos + 1;
    if tz.tipo = 'asiento' then
      a := tz.dato;
      st := jsonb_set(st, '{hechos_a}', to_jsonb((st->>'hechos_a')::int + 1));
      v_lineas := '[]';
      for l in select * from jsonb_array_elements(a->'apuntes') loop
        -- X14 · 2 · Una línea a 0 en el debe y en el haber no suma nada y journal_line no la admite: no entra, y queda en
        -- «lo que no ha entrado» con su porqué. Las negativas entran tal cual, como en el programa de antes.
        if coalesce(nullif(l->>'debe', '')::numeric, 0) = 0 and coalesce(nullif(l->>'haber', '')::numeric, 0) = 0 then
          v_mirar := v_mirar || jsonb_build_object('que', 'no_ha_entrado', 'frase',
            format('No ha entrado una línea del asiento %s del %s (cuenta %s): está a 0 en el debe y en el haber, no suma nada.',
                   coalesce(nullif(a->>'documento', ''), a->>'clave'), to_char((a->>'fecha')::date, 'DD/MM/YYYY'), l->>'cuenta'));
          st := jsonb_set(st, '{lineas_a_cero}', to_jsonb(coalesce((st->>'lineas_a_cero')::int, 0) + 1));
          continue;
        end if;
        x := jsonb_build_object('cuenta', l->>'cuenta', 'debe', (l->>'debe')::numeric / 100, 'haber', (l->>'haber')::numeric / 100,
                                'concepto', nullif(l->>'concepto', ''), 'comun', true, 'tercero_id', v_tercero->(l->>'cuenta')->>'party');
        if l ? 'iva' then
          select r.id into v_tipo_id from public.tax_rate r
           where r.rate = (l->'iva'->>'tipo')::numeric and r.treatment = 'taxed' and r.valid_to is null and r.name like 'IVA%' limit 1;
          if v_tipo_id is not null then
            x := x || jsonb_build_object('iva', jsonb_build_object('tipo_id', v_tipo_id, 'base', (l->'iva'->>'base')::numeric / 100,
                       'libro', l->'iva'->>'libro', 'deducible', case when l->'iva'->>'libro' = 'received' then 'yes' end, 'facturas', 1));
          else
            v_sin_tipo := v_sin_tipo + 1;
          end if;
        elsif l ? 'retencion' then
          -- 19 %: alquiler si el asiento lleva un 621; si no, no se sabe (también es el de capital).
          select r.id, r.filed_in into v_ret_id, v_ret_modelo from public.withholding_rate r
           where r.is_system and r.valid_to is null and r.rate = (l->'retencion'->>'tipo')::numeric
             and (r.rate <> 19 or (r.code = 'alquiler' and exists (select 1 from jsonb_array_elements(a->'apuntes') z where z->>'cuenta' like '621%')))
             and r.code <> 'trabajo'
           order by r.sort_order limit 1;
          if v_ret_id is not null then
            x := x || jsonb_build_object('retencion', jsonb_build_object('tipo_id', v_ret_id, 'base', (l->'retencion'->>'base')::numeric / 100, 'modelo', v_ret_modelo));
          else
            v_sin_tipo := v_sin_tipo + 1;
          end if;
        elsif l ? 'sinTipo' then
          v_sin_tipo := v_sin_tipo + 1;
        end if;
        v_lineas := v_lineas || x;
      end loop;
      v_r := public._journal_entry_proponer(v_company,
        jsonb_build_object('source_type', 'migrated', 'fecha', a->>'fecha',
          'series', 8,   -- N06b · la serie de lo traído: se numera al darlo por bueno (#715)
          'concepto', coalesce(nullif(trim(a->>'concepto'), ''), 'Asiento ' || coalesce(nullif(a->>'documento', ''), a->>'clave') || ' de ' || v_nombre_prog),
          'documento', nullif(a->>'documento', ''),
          'externo', jsonb_build_object('programa', v_nombre_prog, 'ejercicio', left(a->>'fecha', 4), 'serie', a->>'serie',
                                        'numero', coalesce(nullif(a->>'documento', ''), a->>'clave')),
          'carga', v_carga),
        v_lineas, '{}'::jsonb, v_nombre_prog || ' (traído)', auth.uid());
      update public.conta_traer_trozo q set entrada = (v_r->>'id')::uuid where q.carga = p_carga and q.orden = tz.orden;   -- X14 · para sus facturas
    else
      f := tz.dato;
      st := jsonb_set(st, '{hechos_f}', to_jsonb((st->>'hechos_f')::int + 1));
      v_entry := null;   -- X14 · el asiento de Sumied de su asiento de allí, apuntado en la cola
      select q.entrada into v_entry from public.conta_traer_trozo q where q.carga = p_carga and q.clave = f->>'asiento';
      v_nif := nullif(public.party_nif(f->>'nif'), '');
      if f->>'libro' = 'recibidas' then
        v_sup := null;
        select (v->>'supplier')::uuid into v_sup from jsonb_each(v_tercero) e(k, v)
         where v->>'supplier' is not null and v->>'nif' = v_nif limit 1;
        if v_sup is null and v_nif is not null then
          select s.id into v_sup from public.supplier s where s.account_id = v_cuenta and public.party_nif(s.tax_id) = v_nif and s.archived_at is null
           order by s.created_at limit 1;
        end if;
        if v_sup is null then
          insert into public.supplier (account_id, name, legal_name, tax_id, created_by_name, import_run_id)
          values (v_cuenta, f->>'nombre', f->>'nombre', f->>'nif', v_nombre_prog || ' (traído)', v_carga) returning id into v_sup;
          n_prov := n_prov + 1;
          v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'frase',
            format('El proveedor %s de la factura %s no estaba en el listado de proveedores: se ha creado sin cuenta.', f->>'nombre', f->>'numero'));
        end if;
        if exists (select 1 from public.supplier_invoice i where i.account_id = v_cuenta and i.supplier_id = v_sup
                     and public.conta_clave_numero(i.invoice_number) = public.conta_clave_numero(f->>'numero')
                     and round(i.grand_total * 100) = (f->>'total')::numeric and i.status not in ('anulada', 'descartada')) then
          v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase',
            format('La factura %s de %s ya estaba en Sumied: no se ha traído otra vez.', f->>'numero', f->>'nombre'));
          continue;
        end if;
        -- La retención, con su tipo (19 %: alquiler si su asiento va a un 621; si no, no se sabe y se dice).
        v_ret_id := null;
        if coalesce((f->'retencion'->>'importe')::numeric, 0) <> 0 then
          select r.id into v_ret_id from public.withholding_rate r
           where r.is_system and r.valid_to is null and r.code <> 'trabajo' and r.rate = (f->'retencion'->>'tipo')::numeric
             and (r.rate <> 19 or (r.code = 'alquiler' and coalesce((f->>'asiento621')::boolean, false)))   -- X14 · mirado al encolar
           order by r.sort_order limit 1;
          if v_ret_id is null then
            v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase',
              format('La factura %s de %s lleva una retención de %s que no sé de qué tipo es: se ha traído sin ella. Pónsela al repasarla.',
                     f->>'numero', f->>'nombre', public._conta_traer_euros((f->'retencion'->>'importe')::numeric)));
          end if;
        end if;
        insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, status, source,
                                             tax_base_total, tax_total, grand_total, withholding_rate_id, withholding_amount, withholding_base, journal_entry_id,
                                             needs_review, created_by, created_by_name, approved_at, approved_by, approved_by_name,
                                             issuer_name, issuer_tax_id, import_run_id, import_mark, import_pending)
        values (v_cuenta, v_company, v_sup, f->>'numero', (f->>'fecha')::date,
                case when (f->>'pendiente')::numeric = 0 then 'pagada' else 'aprobada' end, 'traida',
                (f->>'base')::numeric / 100, (f->>'cuota')::numeric / 100, (f->>'total')::numeric / 100,
                v_ret_id, case when v_ret_id is not null then (f->'retencion'->>'importe')::numeric / 100 end,
                case when v_ret_id is not null then (f->>'base')::numeric / 100 end,
                v_entry, false, auth.uid(), v_nombre_prog || ' (traída)', now(), auth.uid(), v_nombre_prog || ' (traída)',
                f->>'nombre', f->>'nif', v_carga, case when v_entry is null then 'sin_casar' end, (f->>'pendiente')::numeric / 100)
        returning id into v_fac;
        insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
        select v_cuenta, v_fac, coalesce((z->>'tipo')::numeric, 0), (z->>'base')::numeric / 100, (z->>'cuota')::numeric / 100
          from jsonb_array_elements(coalesce(f->'tramos', '[]')) z;
        n_rec := n_rec + 1;
      else
        v_party := null;
        select (v->>'party')::uuid into v_party from jsonb_each(v_tercero) e(k, v)
         where v->>'supplier' is null and v->>'nif' = v_nif limit 1;
        if v_party is null and v_nif is not null then
          select p.id into v_party from public.party p where p.account_id = v_cuenta and p.tax_id = v_nif;
        end if;
        v_serie := upper(regexp_replace(coalesce(nullif(f->>'serie', ''), v_prog), '[^A-Za-z0-9-]', '', 'g'));
        if v_serie !~ '^[A-Z0-9][A-Z0-9-]{0,9}$' then v_serie := 'ERP10'; end if;
        v_num := case when coalesce(f->>'numeroSolo', '') ~ '^[0-9]{1,9}$' then (f->>'numeroSolo')::int
                      when f->>'numero' ~ '[0-9]{1,9}$' then substring(f->>'numero' from '([0-9]{1,9})$')::int end;
        if v_num is null or v_num = 0 or exists (select 1 from public.customer_invoice c where c.company_id = v_company and c.series_code = v_serie
                                                    and c.fiscal_year = left(f->>'fecha', 4)::int and c.number = v_num) then
          v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase', case when v_num is null or v_num = 0
            then format('La factura emitida %s no tiene un número que Sumied pueda guardar: no se ha traído.', f->>'numero')
            else format('Ya hay en Sumied una factura emitida %s del %s: la %s de %s no se ha traído.', v_serie || '-' || v_num, left(f->>'fecha', 4), f->>'numero', v_nombre_prog) end);
          continue;
        end if;
        -- N06b · Una emitida traída no existe en Sumied hasta darla por buena: mientras, no cuenta en las
        -- emitidas, ni en Cobros, ni en el IVA (respuesta N06a · 1, «no sé» 2). Se guarda con la carga.
        v_emitidas := v_emitidas || jsonb_build_object('id', gen_random_uuid(), 'serie', v_serie, 'ejercicio', left(f->>'fecha', 4)::int, 'numero', v_num,
          'numero_texto', f->>'numero', 'fecha', f->>'fecha', 'party_id', v_party, 'cliente', jsonb_build_object('nombre', f->>'nombre', 'nif', f->>'nif'),
          'base', (f->>'base')::numeric / 100, 'cuota', (f->>'cuota')::numeric / 100, 'retencion', coalesce((f->'retencion'->>'importe')::numeric, 0) / 100,
          'total', (f->>'total')::numeric / 100, 'asiento', v_entry, 'marca', case when v_entry is null then 'sin_casar' end,
          'pendiente', (f->>'pendiente')::numeric / 100);
        n_emi := n_emi + 1;
      end if;
      if v_entry is null then n_sin_casar := n_sin_casar + 1; else n_casadas := n_casadas + 1; end if;
    end if;
  end loop;

  -- Queda cola: se guarda por dónde va y se dice cuánto lleva.
  if exists (select 1 from public.conta_traer_trozo q where q.carga = p_carga and not q.hecho) then
    st := st || jsonb_build_object('sin_tipo', v_sin_tipo, 'n_rec', n_rec, 'n_emi', n_emi, 'n_casadas', n_casadas, 'n_sin_casar', n_sin_casar, 'n_prov', n_prov,
                                   'mirar', v_mirar, 'emitidas', v_emitidas);
    update public.import_run set detail = jsonb_build_object('estado', st) where id = p_carga;
    return jsonb_build_object('carga', p_carga, 'acabado', false,
      'asientos', jsonb_build_object('hechos', (st->>'hechos_a')::int, 'de', n_asientos), 'facturas', jsonb_build_object('hechos', (st->>'hechos_f')::int, 'de', n_facturas));
  end if;

  delete from public.conta_traer_trozo q where q.carga = p_carga;   -- X14 · la cola, vacía: se va

  -- ── Lo aprendido: como propuesta en la ficha, sin pisar ──
  for x in select * from jsonb_array_elements(coalesce(st->'aprendido', '[]')) loop
    v_sup := (v_tercero->(x->>'codigo')->>'supplier')::uuid;
    continue when v_sup is null or jsonb_array_length(coalesce(x->'tiposIva', '[]')) = 0;
    continue when exists (select 1 from public.supplier_learning s where s.supplier_id = v_sup and s.campo = 'tax_rates');
    select string_agg(trim(to_char(v::numeric, 'FM990D99'), ',.'), ',' order by v::numeric),
           'IVA al ' || string_agg(trim(to_char(v::numeric, 'FM990D99'), ',.') || ' %', ' y al ' order by v::numeric)
      into v_valor, v_etiqueta from jsonb_array_elements_text(x->'tiposIva') v;
    insert into public.supplier_learning (account_id, supplier_id, campo, valor, etiqueta, porque, veces, a_mano)
    values (v_cuenta, v_sup, 'tax_rates', v_valor, v_etiqueta, x->>'porque', 1, false)
    returning to_jsonb(id) into x;
    v_deshacer := jsonb_set(v_deshacer, '{aprendido}', (v_deshacer->'aprendido') || x);
    v_aprendidas := v_aprendidas + 1;
  end loop;

  -- ── Lo que se guarda con la carga y lo que se cuenta ──
  v_counts := jsonb_build_object('asientos', n_asientos, 'apuntes', v_apuntes, 'debe', v_tot_debe / 100, 'haber', v_tot_haber / 100,
    'facturas_recibidas', n_rec, 'facturas_emitidas', n_emi, 'casadas', n_casadas, 'sin_casar', n_sin_casar,
    'cuentas_nuevas', n_cuentas, 'cuentas_estaban', n_cuentas_estaban, 'proveedores_nuevos', n_prov, 'clientes_nuevos', n_cli,
    'enlazados', n_enlazados, 'sin_tipo', v_sin_tipo, 'aprendido', v_aprendidas,
    'fuera_asientos', v_fuera_a, 'fuera_facturas', v_fuera_f, 'mirar', jsonb_array_length(v_mirar),
    'lineas_a_cero', coalesce((st->>'lineas_a_cero')::int, 0));   -- X14 · 2
  v_texto := format('Traído en prueba: %s (%s apuntes, %s al debe y al haber) y %s, %s con su asiento.',
    case when n_asientos = 1 then '1 asiento' else n_asientos || ' asientos' end, v_apuntes,
    public._conta_traer_euros(v_tot_debe), case when n_rec + n_emi = 1 then '1 factura' else (n_rec + n_emi) || ' facturas' end, n_casadas)
    || case when n_cuentas + n_prov + n_cli > 0 then format(' Nuevos en Sumied: %s, %s y %s.', public._conta_traer_cuantos(n_cuentas, 'cuenta', 'cuentas'),
              public._conta_traer_cuantos(n_prov, 'proveedor', 'proveedores'), public._conta_traer_cuantos(n_cli, 'cliente', 'clientes')) else '' end
    || case when v_inicio is not null and v_fuera_a + v_fuera_f > 0
         then format(' Del %s en adelante lo lleva ya Sumied: se han dejado fuera %s y %s.', to_char(v_inicio, 'DD/MM/YYYY'),
                     public._conta_traer_cuantos(v_fuera_a, 'asiento', 'asientos'), public._conta_traer_cuantos(v_fuera_f, 'factura', 'facturas')) else '' end   -- X14 · 2: lo traído no fija el día de inicio; no se dice que empieza
    || ' Nada está validado: repásalo y dalo por bueno, o deshazlo.';
  -- N06b · Solo cuentas y terceros: lo que se ha traído y que lo de antes sigue sin traer.
  if n_asientos = 0 and n_facturas = 0 then
    v_texto := format('He traído %s, %s y %s.', public._conta_traer_cuantos(n_cuentas + n_cuentas_estaban, 'cuenta', 'cuentas'),
                      public._conta_traer_cuantos((st->>'terceros_prov')::int, 'proveedor', 'proveedores'),
                      public._conta_traer_cuantos((st->>'terceros_cli')::int, 'cliente', 'clientes'))
      || case when v_inicio is not null then format(' Lo anterior al %s sigue sin traer.', to_char(v_inicio, 'DD/MM/YYYY')) else ' Lo de antes sigue sin traer.' end;
  end if;
  update public.import_run set status = 'en_prueba', finished_at = now(), counts = v_counts,
         detail = jsonb_build_object('mirar', v_mirar, 'aprendido', coalesce(st->'aprendido', '[]'),
                                     'pendientesNoExactos', coalesce(st->'pendientesNoExactos', '[]'), 'inmovilizado', st->'inmovilizado',
                                     'frases', coalesce(st->'frases', '[]'), 'dia_de_inicio', v_inicio,
                                     'sumas', st->'sumas', 'emitidas', v_emitidas, 'proveedores', v_provs, 'solo_plan', n_asientos = 0,
                                     'texto', v_texto,
                                     'deshacer', v_deshacer || jsonb_build_object('corte', v_corte, 'fichas', v_fichas))
   where id = v_carga;
  return jsonb_build_object('carga', v_carga, 'cuentas', v_counts, 'mirar', v_mirar, 'texto', v_texto,
                            'dia_de_inicio', v_inicio, 'acabado', true,
                            'asientos', jsonb_build_object('hechos', n_asientos, 'de', n_asientos), 'facturas', jsonb_build_object('hechos', n_facturas, 'de', n_facturas));
end $function$

;

-- 3 · conta_asiento_modificar -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_asiento_modificar(uuid,jsonb,jsonb,text)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public.conta_asiento_modificar(p_entry uuid, p_cabecera jsonb, p_lineas jsonb, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.journal_entry; d public.journal_entry; y public.fiscal_year; v_se jsonb; v_quien text; x jsonb;
  v_cta public.company_account; v_debe numeric; v_haber numeric; v_sd numeric := 0; v_sh numeric := 0; v_pos int := 0;
  v_fecha date; v_concepto text; v_local uuid; v_comun boolean; v_marca uuid; v_canal uuid; v_p jsonb; v_mal text;
  v_antes jsonb; v_despues jsonb; v_cab_antes jsonb; v_cab_despues jsonb; v_cadena jsonb; v_prev text; r record;
  v_canon_antes text; v_canon_despues text; v_nota_antes text; v_reg uuid;
  c_cab constant text[] := array['entry_date', 'concept', 'notes', 'party_id', 'document_ref', 'document_date'];
begin
  select * into e from public.journal_entry where id = p_entry for update;
  v_se := public.conta_asiento_se_puede_modificar(p_entry);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));

  -- La cabecera, comprobada antes de tocar nada.
  p_cabecera := coalesce(p_cabecera, '{}');
  v_fecha := coalesce(nullif(p_cabecera->>'fecha', '')::date, e.entry_date);
  v_concepto := coalesce(nullif(btrim(p_cabecera->>'concepto'), ''), case when p_cabecera ? 'concepto' then null else e.concept end);
  if v_concepto is null then raise exception 'El asiento lleva su concepto.' using errcode = '22023'; end if;
  select * into y from public.fiscal_year where id = e.fiscal_year_id;
  if v_fecha not between y.starts_on and y.ends_on then
    raise exception 'El % no es del ejercicio %: el asiento no cambia de ejercicio.', to_char(v_fecha, 'DD/MM/YYYY'), y.code using errcode = '22023';
  end if;
  if v_fecha <> e.entry_date then
    v_p := public.conta_iva_presentado(e.company_id, v_fecha);
    if v_p is not null then raise exception 'El IVA del % ya está presentado: el asiento no va a esa fecha.', v_p->>'periodo' using errcode = '23514'; end if;
    if public.conta_mes_cerrado(e.company_id, v_fecha) then
      raise exception 'El mes de % está cerrado: el asiento no va a esa fecha.', to_char(v_fecha, 'MM/YYYY') using errcode = '23514';
    end if;
  end if;

  -- Las líneas, comprobadas antes de tocar nada: dos o más, cada una a un lado, cuentas de la empresa, y cuadra.
  if jsonb_typeof(coalesce(p_lineas, 'null')) <> 'array' or jsonb_array_length(p_lineas) < 2 then
    raise exception 'Un asiento lleva al menos dos apuntes.' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_pos := v_pos + 1;
    select * into v_cta from public.company_account
     where company_id = e.company_id and account_id = e.account_id and code = btrim(coalesce(x->>'cuenta', ''));
    if v_cta.id is null then raise exception 'Línea %: la cuenta % no está en el plan de la empresa.', v_pos, coalesce(nullif(btrim(x->>'cuenta'), ''), '(vacía)') using errcode = '22023'; end if;
    if v_cta.status = 'cerrada' then raise exception 'Línea %: la % está cerrada.', v_pos, v_cta.code using errcode = '22023'; end if;
    if exists (select 1 from public.company_account h where h.company_id = e.company_id and h.account_id = e.account_id
                 and length(h.code) > length(v_cta.code) and left(h.code, length(v_cta.code)) = v_cta.code) then
      raise exception 'Línea %: la % tiene subcuentas; se apunta en una de ellas.', v_pos, v_cta.code using errcode = '22023';
    end if;
    v_debe := round(coalesce(nullif(x->>'debe', '')::numeric, 0), 2);
    v_haber := round(coalesce(nullif(x->>'haber', '')::numeric, 0), 2);
    if (v_debe = 0) = (v_haber = 0) then   -- X14 · 2 · un importe, al debe o al haber, también en negativo
      raise exception 'Línea %: un importe, al debe o al haber.', v_pos using errcode = '22023';
    end if;
    v_sd := v_sd + v_debe; v_sh := v_sh + v_haber;
  end loop;
  if v_sd <> v_sh then raise exception 'No cuadra: debe % y haber %, descuadre %.', v_sd, v_sh, v_sd - v_sh using errcode = '23514'; end if;

  -- Lo de antes: la cabecera, las líneas, la huella y la cadena de este asiento y de todos los de detrás.
  v_cab_antes := jsonb_build_object('fecha', e.entry_date, 'concepto', e.concept, 'notas', e.notes, 'tercero', e.party_id,
                                    'documento', e.document_ref, 'fecha_documento', e.document_date);
  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_antes from public.journal_line j where j.entry_id = e.id;
  select coalesce(jsonb_agg(jsonb_build_object('entry_id', o.id, 'chain_seq', o.chain_seq, 'prev_hash', o.prev_hash, 'hash', o.hash) order by o.chain_seq), '[]')
    into v_cadena from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq;
  v_canon_antes := public.journal_entry_canonico(e.id);
  v_nota_antes := e.notes;

  -- Solo en esta transacción: sin los dos candados de «inalterable» (como el X26 y el «Borrar» del S01q).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;

  update public.journal_entry set
    entry_date = v_fecha, concept = v_concepto,
    notes = case when p_cabecera ? 'notas' then nullif(btrim(p_cabecera->>'notas'), '') else notes end,
    party_id = case when p_cabecera ? 'tercero' then nullif(p_cabecera->>'tercero', '')::uuid else party_id end,
    document_ref = case when p_cabecera ? 'documento' then nullif(btrim(p_cabecera->>'documento'), '') else document_ref end,
    document_date = case when p_cabecera ? 'fecha_documento' then nullif(p_cabecera->>'fecha_documento', '')::date else document_date end,
    updated_at = now()
   where id = e.id;

  delete from public.journal_line where entry_id = e.id;
  v_pos := 0;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_pos := v_pos + 1;
    select * into v_cta from public.company_account where company_id = e.company_id and account_id = e.account_id and code = btrim(x->>'cuenta');
    v_comun := coalesce(x->>'local', '') = 'comun';
    v_local := case when coalesce(x->>'local', '') ~ '^[0-9a-f-]{36}$' then (x->>'local')::uuid end;
    v_marca := case when coalesce(x->>'marca', '') ~ '^[0-9a-f-]{36}$' then (x->>'marca')::uuid end;
    v_canal := case when coalesce(x->>'plataforma', '') ~ '^[0-9a-f-]{36}$' then (x->>'plataforma')::uuid end;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                     location_id, is_common, brand_id, channel_id)
    values (e.account_id, e.company_id, e.id, v_pos, v_cta.id,
            round(coalesce(nullif(x->>'debe', '')::numeric, 0), 2), round(coalesce(nullif(x->>'haber', '')::numeric, 0), 2),
            nullif(btrim(coalesce(x->>'concepto', '')), ''), v_local, v_comun, v_marca, v_canal);
  end loop;

  -- Las reglas de validar, sobre el asiento cambiado (el local con el eje encendido, la fecha abierta…).
  select m.motivo into v_mal from public.conta_motivos_para_validar(e.id) m order by m.orden limit 1;
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;

  select * into d from public.journal_entry where id = e.id;
  v_canon_despues := public.journal_entry_canonico(e.id);
  if v_canon_despues is distinct from v_canon_antes then
    -- La cadena: desde este asiento, cada huella con la función de siempre (los eslabones y su orden no cambian).
    select hash into v_prev from public.journal_entry where company_id = e.company_id and chain_seq is not null and chain_seq < e.chain_seq order by chain_seq desc limit 1;
    for r in select o.id from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq order by o.chain_seq loop
      update public.journal_entry set prev_hash = v_prev where id = r.id;
      update public.journal_entry set hash = public.journal_huella(v_prev, public.journal_entry_canonico(r.id)) where id = r.id returning hash into v_prev;
    end loop;
  end if;

  alter table public.journal_line enable trigger trg_journal_line_inalterable;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_despues from public.journal_line j where j.entry_id = e.id;
  v_cab_despues := jsonb_build_object('fecha', d.entry_date, 'concepto', d.concept, 'notas', d.notes, 'tercero', d.party_id,
                                      'documento', d.document_ref, 'fecha_documento', d.document_date);
  if v_canon_despues is not distinct from v_canon_antes and d.notes is not distinct from v_nota_antes
     and (select coalesce(jsonb_agg(jsonb_build_object('c', j->'concept', 'p', j->'channel_id') order by (j->>'position')::int), '[]') from jsonb_array_elements(v_antes) j)
       = (select coalesce(jsonb_agg(jsonb_build_object('c', j->'concept', 'p', j->'channel_id') order by (j->>'position')::int), '[]') from jsonb_array_elements(v_despues) j) then
    -- Nada distinto: se deshace lo escrito (las mismas líneas con otros id) para no dejar historial de un no-cambio.
    raise exception using errcode = 'P0001', message = 'k12:sin-cambios';
  end if;
  if public._conta_cadena_rota(e.company_id) <> 0 then
    raise exception 'No se cambia nada: después de cambiarlo, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;

  insert into public.conta_asiento_modificado (account_id, company_id, entry_id, numero, cabecera_antes, cabecera_despues, lineas_antes, lineas_despues, cadena_antes, quien)
  values (e.account_id, e.company_id, e.id, e.number, v_cab_antes, v_cab_despues, v_antes, v_despues, v_cadena, v_quien) returning id into v_reg;
  return jsonb_build_object('texto', format('Cambiado: el asiento %s sigue siendo el %s, con %s apuntes y %s al debe y al haber.',
                                            e.number, e.number, v_pos, translate(to_char(v_sd, 'FM999,999,990.00'), ',.', '.,')),
                            'numero', e.number, 'serie', e.series, 'apuntes', v_pos, 'registro', v_reg);
exception when sqlstate 'P0001' then
  if sqlerrm = 'k12:sin-cambios' then
    return jsonb_build_object('texto', 'No había nada distinto: el asiento se queda como estaba.', 'numero', e.number, 'serie', e.series, 'apuntes', 0);
  end if;
  raise;
end $function$

;

-- 4 · conta_motivos_para_validar -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public.conta_motivos_para_validar(p_entry uuid)
 RETURNS TABLE(orden integer, codigo text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
  v_local boolean; v_liquidacion boolean;
  v_hay_isp boolean; v_isp_472 numeric; v_auto_477 numeric; v_p record; v_contra text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null then return; end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then
    orden := 1; codigo := 'pocos_apuntes'; motivo := 'Un asiento lleva al menos dos apuntes.'; return next;
  end if;
  if v_debe <> v_haber then
    orden := 2; codigo := 'no_cuadra';
    motivo := format('No cuadra: Debe %s y Haber %s, diferencia %s.', v_debe, v_haber, v_debe - v_haber); return next;
  end if;

  -- N06a · Lo de una carga en prueba no se valida a mano: se valida entero al darla por bueno.
  if v_e.import_run_id is not null and exists (select 1 from public.import_run r where r.id = v_e.import_run_id and r.kind = 'carga' and r.status = 'en_prueba') then
    orden := 3; codigo := 'carga_en_prueba';
    motivo := 'Este asiento es de lo traído que está en prueba: se valida todo junto al darlo por bueno.'; return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    orden := 3; codigo := 'fuera_del_ejercicio';
    motivo := format('La fecha %s no es del ejercicio %s.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code); return next;
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      orden := 4; codigo := 'ejercicio_cerrado'; motivo := format('El ejercicio %s está cerrado.', v_y.code); return next;
    end if;
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      -- N05c · Sin decidir, nada; con «empezar a trabajar ya», desde el día de inicio (salvo cierre y apertura).
      motivo := public._conta_falta_historico_motivo(v_e.id);
      if motivo is not null then
        orden := 5; codigo := 'falta_historico'; return next;
      end if;
    end if;
    -- S01p·13: un periodo cerrado (el corte con Diez, un mes cerrado por un
    -- impuesto, un trimestre con el 303 presentado) admite lo que no lleva IVA
    -- ni retención presentada. El porqué, en _conta_periodo_admite.
    motivo := public._conta_periodo_admite(v_e.id);
    if motivo is not null then
      orden := 6; codigo := 'periodo_cerrado'; return next;
    end if;

    -- C05 (respuesta 3), copiado de la vigente: un asiento de cierre o de
    -- apertura del generador de cierre (o su contraasiento) se libra de las
    -- reglas de IVA y retención.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- I01b (0180): el asiento de liquidación de un 303 (o su contraasiento)
    -- salda la 477 y la 472 del periodo: sus apuntes no llevan tipo ni libro
    -- registro. Solo si su origen es una declaración 303 de su misma empresa.
    v_liquidacion := exists (
      select 1 from public.journal_entry o
        join public.tax_return t on t.id = o.source_id and t.company_id = o.company_id and t.account_id = o.account_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.company_id = v_e.company_id
         and o.source_type = 'vat_settlement'
         and t.form_code = '303')
      -- S01p·21: o el contraasiento de una liquidación apuntada dos veces, registrada como repetida.
      or (v_e.source_type = 'reversal' and exists (
            select 1 from public.conta_liquidacion_repetida rr
             where rr.repetida_entry_id = v_e.reverses_entry_id and rr.company_id = v_e.company_id));

    -- S01 (0140): el local solo se pide si el eje «local» de la empresa está encendido
    -- (conta_eje_analitico; sin fila = apagado). Lo demás, como estaba.
    v_local := exists (select 1 from public.conta_eje_analitico x
                        where x.company_id = v_e.company_id and x.account_id = v_e.account_id and x.eje = 'local' and x.activo);

    -- I01d (0300): ¿lleva el asiento IVA autoliquidado? (una 472 con el tipo
    -- «Compra en otro país de la UE» o «Inversión del sujeto pasivo»). Su 477
    -- de autorrepercusión va SIN tipo ni libro registro, como la trae Diez:
    -- la regla 10 de abajo la casa con la 472 al céntimo.
    v_hay_isp := exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                           join public.tax_rate t on t.id = l.tax_rate_id
                          where l.entry_id = p_entry and a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge'));

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre and not v_liquidacion
             and not (a.template_code like '477%' and v_hay_isp)
          then 'un apunte de IVA lleva base, tipo y libro registro'
        -- V03 E2 (0146): un apunte con un tipo exento ES la base (la 70x de una
        -- venta sin IVA): su importe es su base, al céntimo.
        when l.tax_rate_id is not null and t.treatment = 'exempt'
             and abs(l.tax_base) <> abs(l.debit + l.credit)   -- X14 · 2 · también en negativo
          then format('un apunte sin IVA es su base: el importe %s no es la base %s', l.debit + l.credit, l.tax_base)
        when l.tax_rate_id is not null and t.treatment is distinct from 'exempt'
             and abs(round(abs(l.tax_base) * t.rate / 100, 2) - abs(l.debit + l.credit)) >   -- X14 · 2 · también en negativo
                greatest(greatest(1, floor(l.tax_documents / 2.0)) / 100, public._conta_iva_tolerancia(p_entry, t.rate))
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
             and not (l.withholding_model is not null and l.withholding_period is not null)
          then 'una retención lleva su tipo, su base y su modelo; el pago o la compensación de un modelo, su modelo y su periodo'
        when a.template_code like '4751%' and l.withholding_rate_id is not null and l.withholding_period is not null
          then 'o es una retención que nace (tipo, base y modelo) o el pago de un modelo (modelo y periodo), no las dos'
        when v_local and not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;

    -- I01d (0300), regla 10 · LA AUTOLIQUIDACIÓN. (a) La 477 de la
    -- autorrepercusión (sin tipo) suma lo mismo que la 472 autoliquidada, al
    -- céntimo. (b) En una factura de proveedor, el tipo de cada línea de IVA
    -- es el que dice su ficha (país, NIF-IVA y régimen de IVA): si lo
    -- contradice, no se valida y se dice por qué.
    select coalesce(sum(l.debit - l.credit) filter (where a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge')), 0),
           coalesce(sum(l.credit - l.debit) filter (where a.template_code like '477%' and l.tax_rate_id is null), 0)
      into v_isp_472, v_auto_477
      from public.journal_line l join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.entry_id = p_entry;
    if v_hay_isp and v_isp_472 <> v_auto_477 then
      orden := 10; codigo := 'autorrepercusion';
      motivo := format('No se valida: falta la autorrepercusión. El IVA autoliquidado de la 472 suma %s y la 477 sin tipo, %s: tienen que ser lo mismo (el IVA lo declaras y lo deduces tú).',
                       public.conta_impuesto_euros(v_isp_472), public.conta_impuesto_euros(v_auto_477)); return next;
    elsif not v_hay_isp and v_auto_477 <> 0 and not v_cierre and not v_liquidacion then
      orden := 10; codigo := 'autorrepercusion';
      motivo := 'No se valida: hay una 477 sin tipo y ninguna compra autoliquidada en el asiento. Un apunte de IVA lleva base, tipo y libro registro.'; return next;
    end if;
    if v_e.source_type = 'supplier_invoice' then
      select s.name, s.country_code, si.vat_operation,   -- K10b: el tipo de operación de la factura, si lo tiene
             coalesce(public.conta_operacion_clase(si.vat_operation), public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime)) as clase
        into v_p
        from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id and s.account_id = si.account_id
       where si.id = v_e.source_id and si.account_id = v_e.account_id;
      if found then
        select string_agg(format('el apunte %s lleva «%s»', l.position, t.name), ', ' order by l.position) into v_contra
          from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
         where l.entry_id = p_entry and l.vat_book in ('received', 'investment')
           and not case v_p.clase
                 when 'intracomunitaria' then t.treatment = 'intra_eu'
                   -- S01o·2: el IVA español de un proveedor de la UE, apuntado como NO deducible (al gasto): sin ROI o no a nombre de la empresa.
                   or (t.treatment = 'taxed' and l.vat_deductible = 'no')
                 when 'isp_extranjero' then t.treatment = 'reverse_charge'
                 when 'isp_nacional' then t.treatment = 'reverse_charge'
                 when 'nacional' then t.treatment in ('taxed', 'exempt', 'not_subject')
                 when 'exenta' then t.treatment in ('exempt', 'not_subject')
                 else false end;
        if v_contra is not null then
          orden := 11; codigo := 'tipo_contra_pais';
          motivo := 'No se valida: ' || v_contra || '. ' || case when v_p.vat_operation is not null
            then format('En esta factura el tipo de operación es «%s»: ', public.conta_operacion_nombre(v_p.vat_operation)) || case v_p.clase
              when 'intracomunitaria' then 'su compra va con «Compra en otro país de la UE» (el IVA lo declaras tú).'
              when 'isp_extranjero' then 'su compra va con «Inversión del sujeto pasivo» (el IVA lo declaras tú).'
              when 'isp_nacional' then 'su compra va con «Inversión del sujeto pasivo».'
              when 'exenta' then 'sus apuntes de IVA van con un tipo exento o no sujeto.'
              else 'su compra lleva el IVA de su factura.' end || ' Si no es esa, cambia el tipo de operación en la factura.'
            else v_p.name || ' ' || case v_p.clase
            when 'intracomunitaria' then 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y tiene NIF-IVA europeo: su compra es intracomunitaria y va con «Compra en otro país de la UE» (el IVA lo declaras tú).'
            when 'isp_extranjero' then 'es de fuera de la UE (' || public.conta_pais_nombre(v_p.country_code) || '): su compra va con «Inversión del sujeto pasivo» (el IVA lo declaras tú).'
            when 'isp_nacional' then 'está marcado con inversión del sujeto pasivo en su ficha: su compra va con «Inversión del sujeto pasivo».'
            when 'nacional' then 'es de España: su compra lleva el IVA de su factura. Si es una inversión del sujeto pasivo (obras, chatarra…), márcalo en su ficha, en «Régimen de IVA».'
            else 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y no tiene un NIF-IVA europeo válido: sin él su compra no es intracomunitaria. Pon su NIF-IVA en su ficha (se comprueba en VIES).' end end;
          return next;
        end if;
      end if;
    end if;
  end if;

  -- E03 · Una recibida que va a nombre de otro: no se valida hasta que una persona conteste.
  if v_e.source_type = 'supplier_invoice' and coalesce((public._conta_de_quien(v_e.source_id)->>'pregunta')::boolean, false) then
    orden := 12; codigo := 'de_quien_es';
    motivo := (public._conta_de_quien(v_e.source_id)->>'frase') || ' Contesta en su ficha antes de validar.'; return next;
  end if;

  -- K09: una recibida, completa y no repetida (conta_recibida_motivos).
  if v_e.source_type = 'supplier_invoice' and v_e.source_id is not null then
    return query select m.orden, m.codigo, m.motivo from public.conta_recibida_motivos(v_e.source_id, v_e.id) m;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar. Copiado
  -- de tg_journal_entry_envio_por_aclarar, que desde aquí lo lee de esta función.
  if v_e.source_type = 'sales_day' then
    select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
      into v_aclarar, v_lista
      from public.sales_day_summary d
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
      join public.sale s on s.id = c.id and s.account_id = d.account_id
     where d.entry_id = v_e.id and d.account_id = v_e.account_id and c.clase = 'por_aclarar';
    if v_aclarar > 0 then
      orden := 9; codigo := 'envio_por_aclarar';
      motivo := format('No se valida: %s con envío por aclarar: %s. Se resuelve con la liquidación de esa semana.',
        v_aclarar || case when v_aclarar = 1 then ' pedido' else ' pedidos' end, v_lista); return next;
    end if;
  end if;
end $function$

;

-- 5 · conta_cierre_validar -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_cierre_validar(uuid,integer,text,text,text,text,integer,text)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public.conta_cierre_validar(p_entry uuid, p_numero integer, p_factura text, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e public.journal_entry; v_d public.sales_day_summary; v_prev jsonb; v_val jsonb; v_code text; v_id uuid; v_num int; v_anio int; v_anual boolean;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_espera text; v_canal text; v_local text; v_cta uuid; v_l record; v_pos int := 0;
  v_base numeric := 0; v_iva numeric := 0; v_prev_hash text; v_hash text; v_emisor text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then raise exception 'Ese asiento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida cierres.' using errcode = '42501';
  end if;
  select * into v_d from public.sales_day_summary where entry_id = p_entry and company_id = v_e.company_id and unit_key is not null and channel_id is not null;
  if v_d.id is null then raise exception 'Ese asiento no es el de un cierre del día de un canal.' using errcode = '22023'; end if;
  select motivo into v_espera from public.conta_cierre_espera
   where company_id = v_d.company_id and location_id = v_d.location_id and sales_day = v_d.sales_day and unit_key = v_d.unit_key;
  if v_espera is not null then raise exception 'Está en espera: %. Quítalo de espera para validarlo.', rtrim(v_espera, '.') using errcode = '23514'; end if;
  if exists (select 1 from public.customer_invoice where entry_id = p_entry) then raise exception 'Este cierre ya tiene su factura.' using errcode = '23505'; end if;

  -- La serie del canal: la suya, o se crea ahora con el código que la pantalla ya enseñó.
  v_code := public._conta_cierre_serie(v_e.company_id, v_d.channel_id);
  select ch.name into v_canal from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id;
  select l.name into v_local from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id;
  insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active, channel_id)
  values (v_e.account_id, v_e.company_id, v_code, 'Cierres del día · ' || coalesce(v_canal, 'canal'), 'simplified', 5, true, 1, false, true, v_d.channel_id)
  on conflict do nothing;
  v_prev := public.conta_cierre_factura_prevista(p_entry);
  if p_factura is null or v_prev->>'texto' <> p_factura then
    raise exception 'El PDF se hizo con la factura % y ahora le toca la % (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.',
      coalesce(p_factura, '(ninguna)'), v_prev->>'texto' using errcode = '40001';
  end if;

  -- El asiento y su PDF (con todas sus reglas).
  v_val := public.journal_entry_validar_con_documento(p_entry, p_numero, p_ruta, p_nombre, p_sha256, p_bytes, v_quien);

  -- El número de la factura: el contador sin huecos de su serie y año.
  select reset_yearly into v_anual from public.invoice_series where company_id = v_e.company_id and code = v_code;
  v_anio := (v_prev->>'anio')::int;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  values (v_e.company_id, v_e.account_id, v_code, case when coalesce(v_anual, true) then v_anio else 0 end, (v_prev->>'numero')::int)
  on conflict (company_id, series_code, fiscal_year) do update set last_number = public.customer_invoice_counter.last_number + 1
  returning last_number into v_num;
  if v_num <> (v_prev->>'numero')::int then
    raise exception 'La factura del PDF es la % y le toca otro número (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.', p_factura using errcode = '40001';
  end if;

  -- La factura resumen: una línea por tipo de IVA, con la base y la cuota del
  -- asiento (lo que dice el libro), a la cuenta de ventas principal del asiento.
  select l.company_account_id into v_cta from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = p_entry and a.code like '70%' order by l.credit desc, l.position limit 1;
  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, issue_date, due_date, customer, location_id, notes,
                                       created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, 'borrador', 'factura', 'cierre_dia', v_code, v_d.sales_day, v_d.sales_day,
          jsonb_build_object('nombre', 'Ventas del día · ' || coalesce(v_canal, 'canal')), v_d.location_id,
          format('Factura resumen de las ventas del %s en %s (%s): %s tiques.', to_char(v_d.sales_day, 'DD/MM/YYYY'), coalesce(v_canal, 'el canal'), coalesce(v_local, 'el local'), v_d.tickets_count),
          auth.uid(), v_quien)
  returning id into v_id;
  for v_l in
    select l.tax_rate_id, t.rate, sum(case when l.credit - l.debit < 0 then -abs(l.tax_base) else abs(l.tax_base) end) as base   /* X14 · 2 · el signo, del importe */, sum(l.credit - l.debit) as cuota
      from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
     where l.entry_id = p_entry and l.vat_book = 'issued' and l.tax_rate_id is not null
     group by 1, 2 order by 2 desc
  loop
    v_pos := v_pos + 1;
    insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, revenue_account_id, amount)
    values (v_e.account_id, v_e.company_id, v_id, v_pos, format('Ventas del día al %s %%', to_char(v_l.rate, 'FM990D##')), 1, v_l.base, 0, v_l.tax_rate_id, v_l.rate, v_cta, v_l.base);
    v_base := v_base + v_l.base; v_iva := v_iva + v_l.cuota;
  end loop;
  if v_pos = 0 or v_cta is null then raise exception 'Este cierre no lleva IVA o cuenta de ventas: no se puede hacer su factura resumen.' using errcode = '23514'; end if;

  select hash into v_prev_hash from public.customer_invoice where company_id = v_e.company_id and status <> 'borrador' and hash is not null order by issued_at desc, id desc limit 1;
  select tax_id into v_emisor from public.company where id = v_e.company_id;
  v_hash := encode(sha256(convert_to(concat_ws('|', v_emisor, p_factura, v_d.sales_day::text, (v_base + v_iva)::text, coalesce(v_prev_hash, '')), 'UTF8')), 'hex');
  update public.customer_invoice set status = 'emitida', fiscal_year = v_anio, number = v_num, number_text = p_factura,
         base = v_base, tax = v_iva, total = v_base + v_iva, entry_id = p_entry, pdf_path = p_ruta, pdf_sha256 = p_sha256, pdf_bytes = p_bytes,
         prev_hash = v_prev_hash, hash = v_hash, issued_at = now(), issued_by_name = v_quien
   where id = v_id;
  -- El libro de expedidas lleva el número de la factura resumen.
  update public.vat_book_entry set number = p_factura, updated_at = now() where entry_id = p_entry and book = 'issued';
  perform public._conta_venta_evento(v_id, 'emitida',
    format('Factura resumen del cierre del %s (%s · %s), con el asiento nº %s y su PDF. Entra en el traspaso del mes.',
           to_char(v_d.sales_day, 'DD/MM/YYYY'), coalesce(v_canal, 'canal'), coalesce(v_local, 'local'), v_val->>'numero'),
    jsonb_build_object('asiento', p_entry, 'numero_asiento', v_val->'numero', 'cierre', v_d.id), v_quien);
  return jsonb_build_object('id', p_entry, 'serie', v_val->'serie', 'numero', v_val->'numero', 'factura', p_factura, 'factura_id', v_id, 'total', v_base + v_iva);
end $function$

;

-- 6 · _s01p_nomina_retencion_poner -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public._s01p_nomina_retencion_poner(uuid,text,numeric)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public._s01p_nomina_retencion_poner(p_entry uuid, p_cuenta text, p_base numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_trabajo uuid; v_n int;
begin
  select id into v_trabajo from public.withholding_rate where code = 'trabajo' and is_system and valid_to is null;
  if v_trabajo is null then raise exception 'S01p nómina: no está el tipo de retención de rendimientos del trabajo.'; end if;
  if not exists (select 1 from public.journal_entry where id = p_entry and status = 'propuesto' and source_type = 'payroll' and series = 9) then
    raise exception 'S01p nómina: ese asiento no es una nómina propuesta: no se toca.';
  end if;
  select count(*) into v_n from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
   where jl.entry_id = p_entry and a.code = p_cuenta and jl.credit <> 0 /* X14 · 2 */ and jl.withholding_rate_id is null and jl.withholding_base is null and jl.withholding_model is null;
  if v_n <> 1 then raise exception 'S01p nómina: tenía que haber una línea de la % sin retención y hay %: no se toca.', p_cuenta, v_n; end if;
  update public.journal_line jl set withholding_rate_id = v_trabajo, withholding_base = p_base, withholding_model = '111'
    from public.company_account a
   where a.id = jl.company_account_id and jl.entry_id = p_entry and a.code = p_cuenta and jl.credit <> 0 /* X14 · 2 */ and jl.withholding_rate_id is null;
end $function$

;

-- 7 · conta_apunte_pago_modelo -----------------------------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_apunte_pago_modelo(uuid,integer,text,text)', '20261125T1132_x14d_negativos');
CREATE OR REPLACE FUNCTION public.conta_apunte_pago_modelo(p_entry uuid, p_posicion integer, p_modelo text, p_periodo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e journal_entry; l journal_line; a company_account; v_txt text;
begin
  select * into e from journal_entry where id = p_entry;
  if e.id is null or not public.current_user_is_admin_or_manager_of(e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if e.status not in ('borrador', 'propuesto') then
    raise exception 'El asiento ya está %: un asiento validado no se cambia.', e.status using errcode = '22023';
  end if;
  select * into l from journal_line where entry_id = e.id and position = p_posicion;
  select * into a from company_account where id = l.company_account_id;
  if l.id is null or a.template_code not like '4751%' then
    raise exception 'Solo un apunte de la 4751 es el pago de un modelo.' using errcode = '22023';
  end if;
  if p_modelo is null or p_modelo not in ('111', '115', '123') then raise exception 'Di el modelo: 111, 115 o 123.' using errcode = '22023'; end if;
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-([1-4]T|0[1-9]|1[0-2]|0A)$' then
    raise exception 'Di el periodo: el año y el trimestre (3T), el mes o el año entero.' using errcode = '22023';
  end if;
  update journal_line set withholding_model = p_modelo, withholding_period = p_periodo, withholding_rate_id = null, withholding_base = null
   where id = l.id;
  v_txt := public.conta_modelo_periodo_texto(p_modelo, p_periodo);
  return jsonb_build_object('mensaje', format('Apuntado: el apunte %s (%s) es %s de %s.', p_posicion, a.code,
    case when l.debit - l.credit > 0 then 'el pago' else 'la devolución' end /* X14 · 2 */, v_txt), 'pagado', public.conta_modelo_pagado(e.company_id, p_modelo, p_periodo));
end $function$

;
