-- supabase/migrations/20261118T1835_e03_no_decide_solo.sql
-- cambia: public._conta_iva_no_deducible_auto · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
-- cambia: public.tg_s01o2_iva_no_deducible · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
-- cambia: public.conta_recibida_iva_no_deducible · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
-- cambia: public._conta_factura_segura · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
--
-- E03 · Sumied pregunta, no decide. 2 de 3: lo que CAMBIA EN CALIENTE. Va detrás
-- de la 1833 (usa _conta_de_quien y recipient_answer).
--   6. _conta_iva_no_deducible_auto ya no da «no_a_nombre» (el ROI, sin_roi, sigue igual).
--   7. tg_s01o2_iva_no_deducible: con respuesta de una persona, no hace nada.
--   8. conta_recibida_iva_no_deducible (la ficha de hoy): marcar o desmarcar
--      también es una respuesta (deduce / no_deduce).
--   9. _conta_factura_segura (apunta sola): con la pregunta sin contestar, no es segura.
--  10. conta_motivos_para_validar: con la pregunta sin contestar, no se valida (orden 12, de_quien_es).
--  11. conta_documentos_recibidos: la fila con pregunta sale en «Por aclarar»,
--      con su frase de porqué y «de_quien» (la etiqueta «¿De quién es?»).
-- Como siempre: un trozo de la definición VIVA, con su respaldo, y para si el
-- trozo no está una sola vez. Se puede pasar dos veces.
-- Vuelta atrás: supabase/vuelta-atras/20261118T1835_e03_no_decide_solo.down.sql

-- 6 a 11 · Sobre la definición viva ---------------------------------------
select public._respaldar_funcion('public._conta_iva_no_deducible_auto(uuid)', '20261118T1835_e03_no_decide_solo');
select public._respaldar_funcion('public.tg_s01o2_iva_no_deducible()', '20261118T1835_e03_no_decide_solo');
select public._respaldar_funcion('public.conta_recibida_iva_no_deducible(uuid,boolean,text,text,text)', '20261118T1835_e03_no_decide_solo');
select public._respaldar_funcion('public._conta_factura_segura(uuid)', '20261118T1835_e03_no_decide_solo');
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261118T1835_e03_no_decide_solo');
select public._respaldar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261118T1835_e03_no_decide_solo');

do $do$
declare r record; v_def text; v_n int;
begin
  for r in select * from (values
    -- 6 · Sumied ya no decide «no va a nombre» (el ROI, sí, como estaba).
    ('public._conta_iva_no_deducible_auto(uuid)',
     $v$  -- No viene a nombre de la empresa: leída de su documento, y su destinatario sin el NIF de la empresa.
  if v.reading ? 'factura' and coalesce(v.source, '') not in ('lote', 'liquidacion') and public._conta_nif_clave(c.tax_id) is not null then
    v_dest := public._conta_nif_clave(v.reading->'factura'->'destinatario'->>'nif');
    if v_dest is distinct from public._conta_nif_clave(c.tax_id) then
      v_m := v_m || jsonb_build_object('motivo', 'no_a_nombre', 'texto', format('No viene a nombre de %s: el IVA no se puede deducir y va al gasto.', v_empresa));
    end if;
  end if;
$v$,
     $n$  -- E03 · «No viene a nombre de la empresa» ya no lo decide Sumied: lo pregunta (_conta_de_quien) y lo contesta una persona.
$n$),
    -- 7 · Con la respuesta de una persona, el disparador no hace nada.
    ('public.tg_s01o2_iva_no_deducible()',
     $v$  if new.vat_non_deductible_reason is not null or new.status in ('anulada', 'descartada', 'repetida') then return null; end if;
$v$,
     $n$  if new.vat_non_deductible_reason is not null or new.status in ('anulada', 'descartada', 'repetida') then return null; end if;
  if new.recipient_answer is not null then return null; end if;   -- E03 · lo contestó una persona: manda
$n$),
    -- 8 · Marcar o desmarcar en la ficha de hoy también es una respuesta.
    ('public.conta_recibida_iva_no_deducible(uuid,boolean,text,text,text)',
     $v$         vat_non_deductible_note = case when v_motivo = 'otro' then v_texto end,
         updated_at = now()
   where id = v_f.id;
$v$,
     $n$         vat_non_deductible_note = case when v_motivo = 'otro' then v_texto end,
         recipient_answer = case when coalesce(p_no_deducible, false) then 'no_deduce' else 'deduce' end,  -- E03 · también es una respuesta
         recipient_answered_at = now(), recipient_answered_by_name = v_quien,
         updated_at = now()
   where id = v_f.id;
$n$),
    -- 9 · Con la pregunta sin contestar, «apunta sola» no la apunta.
    ('public._conta_factura_segura(uuid)',
     $v$  v_nd_r := public._conta_iva_no_deducible_auto(v.id);
$v$,
     $n$  -- E03 · Si va a nombre de otro y nadie lo ha contestado, la mira una persona.
  if coalesce((public._conta_de_quien(v.id)->>'pregunta')::boolean, false) then
    return jsonb_build_object('seguro', false, 'motivo', public._conta_de_quien(v.id)->>'frase');
  end if;
  v_nd_r := public._conta_iva_no_deducible_auto(v.id);
$n$),
    -- 10 · Con la pregunta sin contestar, no se valida.
    ('public.conta_motivos_para_validar(uuid)',
     $v$  -- C06b (#210): un asiento de ventas del día con un envío por aclarar.$v$,
     $n$  -- E03 · Una recibida que va a nombre de otro: no se valida hasta que una persona conteste.
  if v_e.source_type = 'supplier_invoice' and coalesce((public._conta_de_quien(v_e.source_id)->>'pregunta')::boolean, false) then
    orden := 12; codigo := 'de_quien_es';
    motivo := (public._conta_de_quien(v_e.source_id)->>'frase') || ' Contesta en su ficha antes de validar.'; return next;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar.$n$),
    -- 11 · La lista: la pregunta sale en «Por aclarar», con su frase y su etiqueta.
    ('public.conta_documentos_recibidos(uuid,date,date)',
     $v$      from facturas f join gasto g on g.id = f.id
$v$,
     $n$      from facturas f join gasto g on g.id = f.id
      cross join lateral (select public._conta_de_quien(f.id) as q) dq  -- E03
$n$),
    ('public.conta_documentos_recibidos(uuid,date,date)',
     $v$                     when f.supplier_id is null or f.reading_confidence = 'duda' or f.status = 'con_discrepancias' then 'por_aclarar'
$v$,
     $n$                     when f.supplier_id is null or f.reading_confidence = 'duda' or f.status = 'con_discrepancias' then 'por_aclarar'
                     when coalesce((dq.q->>'pregunta')::boolean, false) then 'por_aclarar'  -- E03 · ¿de quién es?
$n$),
    ('public.conta_documentos_recibidos(uuid,date,date)',
     $v$                  else coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end) end,
$v$,
     $n$                  when coalesce((dq.q->>'pregunta')::boolean, false) then dq.q->>'frase'  -- E03
                  else coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end) end,
$n$),
    ('public.conta_documentos_recibidos(uuid,date,date)',
     $v$      'confianza', f.reading_confidence,
$v$,
     $n$      'confianza', f.reading_confidence,
      'de_quien', case when coalesce((dq.q->>'pregunta')::boolean, false) then jsonb_build_object('caso', dq.q->>'caso', 'sociedad', dq.q->>'sociedad_corta') end,  -- E03
$n$)) t(firma, viejo, nuevo) loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    continue when strpos(v_def, r.nuevo) > 0;   -- ya pasada (se puede pasar dos veces)
    v_n := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
    if v_n <> 1 then
      raise exception 'E03: % no es la medida (su trozo está % veces): no se toca nada.', r.firma, v_n;
    end if;
    execute replace(v_def, r.viejo, r.nuevo);
  end loop;
end $do$;
