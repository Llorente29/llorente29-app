-- supabase/migrations/20261122T0922_k11f1_iva_lee_la_fecha_fiscal.sql
--
-- K11f1 · El IVA lee la fecha FISCAL de la recibida y el asiento lleva la CONTABLE (Julio, 22/11: «las dos fechas,
-- como ERP10»). La fecha fiscal es supplier_invoice.deduct_from y la contable, accounting_date (la 0921). Vacías, lo de
-- siempre (Julio, 22/11): ninguna recibida que ya existe cambia de periodo, y ningún 303 presentado cambia un céntimo
-- (regla 31, k11f1-fecha-fiscal.sql).
--
-- cambia: public.conta_vat_book_desde_asiento · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--   La fecha de recepción de una recibida en el libro de IVA es su fecha fiscal, si la tiene; si no, la de siempre (el
--   día que entró o, si es después, el del asiento: D07). El 303 reparte por esa fecha (conta_impuesto_303_desde_libro
--   no cambia) y el candado del libro la lee (tampoco cambia).
-- cambia: public._conta_iva_candado_apunte · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
-- cambia: public._conta_iva_candado_asiento · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
-- cambia: public._tg_s01p_trimestre_presentado · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
-- cambia: public._conta_periodo_admite · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--   El candado del IVA presentado de un apunte y de un asiento, el del trimestre presentado (S01p) y el periodo al validar, miran la fecha fiscal
--   (_conta_fecha_fiscal, de la 0921) y no la del asiento: una recibida con su fecha contable en un trimestre presentado
--   y la fiscal en uno abierto se apunta y se valida; sin fecha fiscal, como hasta hoy.
-- cambia: public._conta_iva_ajustar_propuesta · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--   Al proponer, una recibida va al primer día con el IVA abierto si su fecha FISCAL (no la del asiento) cae en un
--   periodo presentado: con fecha fiscal elegida, su asiento se queda en la contable.
-- cambia: public._conta_recibida_no_antes_de_entrar · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--   Al proponer el asiento de una recibida CON fecha fiscal, su fecha contable solo se mueve si su día no está abierto
--   en el libro (el corte, un ejercicio cerrado), ya no porque el IVA esté presentado: eso lo decide la fiscal. Sin
--   fecha fiscal, como hasta hoy (al primer día con el IVA abierto).
-- cambia: public.conta_recibida_otros_datos · prueba: supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--   «Otros datos» guarda también la fecha contable (un día abierto) y la fiscal (nunca en un periodo presentado ni
--   antes de la factura).
--
-- Ocho funciones; cada una, con la MISMA firma y su cuerpo vigente con sus trozos cambiados; respaldo antes, para la vuelta atrás.
-- sin hueco: el fichero no retira nada.
-- Nada en el camino del pedido: ningún pedido escribe recibidas, asientos ni el libro de IVA.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0922_k11f1_iva_lee_la_fecha_fiscal.down.sql

select public._respaldar_funcion('public.conta_vat_book_desde_asiento(uuid)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._conta_iva_candado_apunte()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._conta_iva_candado_asiento()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._conta_periodo_admite(uuid)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._tg_s01p_trimestre_presentado()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public._conta_iva_ajustar_propuesta(uuid,jsonb,jsonb)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._respaldar_funcion('public.conta_recibida_otros_datos(uuid,jsonb,text)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');

-- Cambia en una función los trozos dados (cada uno tiene que estar una sola vez), salvo si ya lleva su marca.
create or replace function pg_temp.k11f1_trozos(p_firma text, p_marca text, p_trozos text[][]) returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_firma::regprocedure); i int;
begin
  if strpos(v_def, p_marca) > 0 then return; end if;   -- ya pasada
  for i in 1 .. array_length(p_trozos, 1) loop
    if (length(v_def) - length(replace(v_def, p_trozos[i][1], ''))) / length(p_trozos[i][1]) <> 1 then
      raise exception 'K11f1: % no es la medida (el trozo % no está una sola vez): no se toca.', p_firma, i;
    end if;
    v_def := replace(v_def, p_trozos[i][1], p_trozos[i][2]);
  end loop;
  execute v_def;
end $$;

-- El libro de IVA: la fecha de recepción de la recibida es su fecha fiscal.
select pg_temp.k11f1_trozos('public.conta_vat_book_desde_asiento(uuid)', 'K11f1: la fecha fiscal', array[[
  $v$greatest(si.created_at::date, v_e.entry_date)$v$,
  $n$coalesce(si.deduct_from, greatest(si.created_at::date, v_e.entry_date))   -- K11f1: la fecha fiscal, si la tiene
$n$]]);

-- El candado del apunte, el del asiento y el periodo: la fecha fiscal.
select pg_temp.k11f1_trozos('public._conta_iva_candado_apunte()', 'K11f1: la fecha fiscal', array[[
  $v$v_p := public.conta_iva_presentado(v_e.company_id, v_e.entry_date);$v$,
  $n$v_p := public.conta_iva_presentado(v_e.company_id, public._conta_fecha_fiscal(v_e.source_type, v_e.source_id, v_e.entry_date));   -- K11f1: la fecha fiscal$n$]]);
select pg_temp.k11f1_trozos('public._conta_iva_candado_asiento()', 'K11f1: la fecha fiscal', array[[
  $v$v_dia := case when new.status = 'anulado' then old.entry_date else new.entry_date end;$v$,
  $n$v_dia := public._conta_fecha_fiscal(new.source_type, new.source_id, case when new.status = 'anulado' then old.entry_date else new.entry_date end);   -- K11f1: la fecha fiscal$n$]]);
select pg_temp.k11f1_trozos('public._conta_periodo_admite(uuid)', 'K11f1: la fecha fiscal', array[[
  $v$v_iva := public.conta_iva_presentado(v_e.company_id, v_e.entry_date);$v$,
  $n$v_iva := public.conta_iva_presentado(v_e.company_id, public._conta_fecha_fiscal(v_e.source_type, v_e.source_id, v_e.entry_date));   -- K11f1: la fecha fiscal$n$]]);

select pg_temp.k11f1_trozos('public._tg_s01p_trimestre_presentado()', 'K11f1: la fecha fiscal', array[[
  $v$v_p := public.conta_iva_presentado(new.company_id, new.entry_date);$v$,
  $n$v_p := public.conta_iva_presentado(new.company_id, public._conta_fecha_fiscal(new.source_type, new.source_id, new.entry_date));   -- K11f1: la fecha fiscal$n$]]);

-- Al proponer: con fecha fiscal, la contable solo se mueve si su día no está abierto en el libro.
select pg_temp.k11f1_trozos('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', 'K11f1: con fecha fiscal', array[[
  $v$v_nueva := public.conta_primer_dia_iva_abierto(p_company, v_fecha);$v$,
  $n$v_nueva := case when exists (select 1 from public.supplier_invoice si where si.id = nullif(p_entry->>'source_id', '')::uuid and si.deduct_from is not null)
                   then public._conta_primer_dia_contable(p_company, v_fecha)   -- K11f1: con fecha fiscal, el IVA lo decide ella
                   else public.conta_primer_dia_iva_abierto(p_company, v_fecha) end;$n$]]);

-- Al proponer, el IVA presentado se mira en la fecha fiscal.
select pg_temp.k11f1_trozos('public._conta_iva_ajustar_propuesta(uuid,jsonb,jsonb)', 'K11f1: la fecha fiscal', array[[
  $v$v_p := public.conta_iva_presentado(p_company, v_fecha);$v$,
  $n$v_p := public.conta_iva_presentado(p_company, public._conta_fecha_fiscal(p_entry->>'source_type', nullif(p_entry->>'source_id', '')::uuid, v_fecha));   -- K11f1: la fecha fiscal$n$]]);

-- «Otros datos»: la fecha contable y la fiscal.
select pg_temp.k11f1_trozos('public.conta_recibida_otros_datos(uuid,jsonb,text)', 'K11f1: las dos fechas', array[
  [$v$v_claves constant text[] := array['tipo_factura', 'clave_regimen', 'no_iva', 'rectificacion', 'no_347', 'iva_deducible', 'lineas'];$v$,
   $n$v_claves constant text[] := array['tipo_factura', 'clave_regimen', 'no_iva', 'rectificacion', 'no_347', 'iva_deducible', 'lineas', 'fecha_contable', 'fecha_fiscal'];   -- K11f1: las dos fechas$n$],
  [$v$v_tipo text; v_clave text; v_no_iva boolean; v_rect boolean; v_no_347 boolean; v_pct numeric;$v$,
   $n$v_tipo text; v_clave text; v_no_iva boolean; v_rect boolean; v_no_347 boolean; v_pct numeric; v_contable date; v_fiscal date; v_d date; v_p jsonb;$n$],
  [$v$v_rect := v_f.deduction_rectification; v_no_347 := v_f.exclude_from_347; v_pct := v_f.vat_deductible_pct;$v$,
   $n$v_rect := v_f.deduction_rectification; v_no_347 := v_f.exclude_from_347; v_pct := v_f.vat_deductible_pct;
  v_contable := v_f.accounting_date; v_fiscal := v_f.deduct_from;

  -- La fecha contable: el día del asiento, un día abierto en el libro («» o null: la de la factura).
  if v_c ? 'fecha_contable' then
    v_d := nullif(v_c ->> 'fecha_contable', '')::date;
    if v_d is not null and public._conta_primer_dia_contable(v_f.company_id, v_d) is distinct from v_d then
      raise exception 'El % no está abierto en el libro: la fecha contable va en un día abierto.', to_char(v_d, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if v_d is distinct from v_f.accounting_date then
      v_contable := v_d; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'fecha_contable', 'antes', v_f.accounting_date, 'ahora', v_d);
      v_textos := array_append(v_textos, format('Fecha contable: %s', coalesce(to_char(v_d, 'DD/MM/YYYY'), 'la de la factura')));
    end if;
  end if;
  -- La fecha fiscal: decide el periodo del IVA; nunca en uno presentado ni antes de la factura («» o null: la de siempre).
  if v_c ? 'fecha_fiscal' then
    v_d := nullif(v_c ->> 'fecha_fiscal', '')::date;
    if v_d is not null then
      v_p := public.conta_iva_presentado(v_f.company_id, v_d);
      if v_p is not null then
        raise exception 'El IVA % ya está presentado: la fecha fiscal no va ahí. El IVA presentado no se toca.',
          public.conta_iva_periodo_frase('de', v_p->>'periodo', (v_p->>'ejercicio')::int) using errcode = '23514';
      end if;
      if v_f.invoice_date is not null and v_d < v_f.invoice_date then
        raise exception 'La fecha fiscal no va antes de la de la factura (%).', to_char(v_f.invoice_date, 'DD/MM/YYYY') using errcode = '22023';
      end if;
    end if;
    if v_d is distinct from v_f.deduct_from then
      v_fiscal := v_d; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'fecha_fiscal', 'antes', v_f.deduct_from, 'ahora', v_d);
      v_textos := array_append(v_textos, format('Fecha fiscal: %s', coalesce(to_char(v_d, 'DD/MM/YYYY'), 'la de siempre')));
    end if;
  end if;$n$],
  [$v$exclude_from_347 = v_no_347, vat_deductible_pct = v_pct, updated_at = now()$v$,
   $n$exclude_from_347 = v_no_347, vat_deductible_pct = v_pct, accounting_date = v_contable, deduct_from = v_fiscal, updated_at = now()$n$]
]);
