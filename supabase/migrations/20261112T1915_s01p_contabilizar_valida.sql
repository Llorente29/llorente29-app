-- supabase/migrations/20261112T1915_s01p_contabilizar_valida.sql
--
-- S01p·18 · punto 2 (Julio, 12/11). «Contabilizar» en la liquidación del socio
-- dejaba sus asientos (la que le haces, su factura, la compensación y, desde la
-- 1755, el género pendiente) en «propuesto», y no salían en ninguna lista: Julio
-- validó los de septiembre y octubre abriéndolos uno a uno por su dirección.
--
-- Quien pulsa «Contabilizar» ya ha revisado la liquidación entera: los asientos
-- que propone quedan VALIDADOS a su nombre, por el mismo camino que «Validar»
-- (_journal_entry_validar: conta_motivos_para_validar y el candado del #484).
-- Cada uno en su propio bloque: si uno no se puede validar, los demás sí, y la
-- respuesta dice cuál y por qué (regla 8); el que no, queda propuesto, y sale en
-- «Para revisar».
--
--   · _compras_liquidacion_confirmar: dos reemplazos exactos (las variables y el
--     final), con respaldo. Devuelve, además de lo de antes, «validados» (serie y
--     número de cada uno), «sinValidar» (con su porqué) y «sinPropuesta» (si el
--     libro no ha podido proponer, el porqué), y una frase con contenido.
--
-- cambia: public._compras_liquidacion_confirmar · prueba: supabase/staging/sql/20261112_s01p_contabilizar_valida_prueba.sql
--
-- Nada en el camino del pedido.

select public._respaldar_funcion('public._compras_liquidacion_confirmar(uuid,text)', '20261112T1915_s01p_contabilizar_valida');

do $do$
declare
  v_def text := pg_get_functiondef('public._compras_liquidacion_confirmar(uuid,text)'::regprocedure);
  v_viejo1 constant text := 'declare l licensed_settlement; v_fv uuid; v_n int; r jsonb;';
  v_nuevo1 constant text := 'declare l licensed_settlement; v_fv uuid; v_n int; r jsonb;
  e record; v_quien text; v_val jsonb; v_ok jsonb := ''[]''::jsonb; v_mal jsonb := ''[]''::jsonb; v_sin text; v_frase text;';
  v_viejo2 constant text := '  return jsonb_build_object(''liquidacion'', p_liq, ''factura'', v_fv, ''recepciones'', v_n,
    ''frase'', format(''Confirmada. Su factura %s queda registrada y %s recepción(es) del mes, cubiertas. Los tres asientos los propone el libro.'', r->>''numero'', v_n));';
  v_nuevo2 constant text := '  -- S01p·18 · 2 · Quien contabiliza ha revisado la liquidación entera: lo que el libro acaba de
  -- proponer (al pasar a confirmada) queda validado a su nombre, por el camino de «Validar».
  -- Cada uno en su bloque: el que no se puede, queda propuesto y se dice por qué.
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  for e in
    select je.id, je.concept, je.source_type from public.journal_entry je
     where je.company_id = l.company_id and je.status = ''propuesto''
       and ((je.source_type in (''licensed_settlement'', ''purchase_accrual'', ''purchase_accrual_reversal'') and je.source_id = l.id)
         or (je.source_type in (''supplier_invoice'', ''supplier_payment'') and je.source_id = v_fv))
     order by case je.source_type when ''licensed_settlement'' then 1 when ''supplier_invoice'' then 2 when ''supplier_payment'' then 3 else 4 end, je.created_at
  loop
    begin
      v_val := public._journal_entry_validar(e.id, v_quien);
      v_ok := v_ok || jsonb_build_array(jsonb_build_object(''id'', e.id, ''concepto'', e.concept, ''serie'', v_val->''serie'', ''numero'', v_val->''numero''));
    exception when others then
      v_mal := v_mal || jsonb_build_array(jsonb_build_object(''id'', e.id, ''concepto'', e.concept, ''porque'', sqlerrm));
    end;
  end loop;
  select p.porque into v_sin from public.conta_propuesta_pendiente p
   where p.company_id = l.company_id and p.origen = ''licensed_settlement'' and p.origen_id = p_liq::text limit 1;
  v_frase := format(''Contabilizada. Su factura %s queda registrada y %s recepción(es) del mes, cubiertas.'', r->>''numero'', v_n)
    || case when jsonb_array_length(v_ok) > 0 then format('' Validados %s asientos a tu nombre.'', jsonb_array_length(v_ok)) else '''' end
    || case when jsonb_array_length(v_mal) > 0 then format('' %s no se ha podido validar: queda en «Para revisar».'', jsonb_array_length(v_mal)) else '''' end
    || case when v_sin is not null then '' El libro no ha podido proponer los asientos: '' || v_sin else '''' end;
  return jsonb_build_object(''liquidacion'', p_liq, ''factura'', v_fv, ''recepciones'', v_n,
    ''validados'', v_ok, ''sinValidar'', v_mal, ''sinPropuesta'', v_sin, ''frase'', v_frase);';
  v_v text[] := array[v_viejo1, v_viejo2];
  i int;
begin
  if strpos(v_def, 'S01p·18 · 2') > 0 then return; end if;   -- ya pasada
  for i in 1 .. 2 loop
    if (length(v_def) - length(replace(v_def, v_v[i], ''))) / length(v_v[i]) <> 1 then
      raise exception 'S01p·18 · 2: _compras_liquidacion_confirmar no es la medida (el trozo % no está una sola vez): no se toca.', i;
    end if;
  end loop;
  v_def := replace(v_def, v_viejo1, v_nuevo1);
  v_def := replace(v_def, v_viejo2, v_nuevo2);
  execute v_def;
end $do$;
