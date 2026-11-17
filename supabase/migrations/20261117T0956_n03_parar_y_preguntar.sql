-- supabase/migrations/20261117T0956_n03_parar_y_preguntar.sql
-- cambia: public._conta_recibida_no_antes_de_entrar · prueba: supabase/staging/sql/20261117_n03_antes_del_inicio_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261117_n03_antes_del_inicio_prueba.sql
-- cambia: public.conta_pagos_lista · prueba: supabase/staging/sql/20261117_n03_antes_del_inicio_prueba.sql
--
-- N03 · Una factura de antes del día de inicio: Sumied para y pregunta (17/11). 2 de 2: LO QUE
-- CAMBIA (va después de la 20261117T0955, que añade la respuesta y las funciones).
--
--   1. _conta_recibida_no_antes_de_entrar deja de decidir sola: una recibida con fecha
--      anterior al día de inicio de su empresa (conta_dia_de_inicio) no se contabiliza sin
--      la respuesta del usuario; con «ya estaba», nunca; con «es nueva», el asiento y el libro
--      al primer día abierto DESDE el día de inicio (conta_primer_dia_abierto no mira el corte
--      del banco: sin esto, una empresa con el corte solo en Bancos dejaba la fecha y el
--      disparador del corte la rechazaba). La fecha de la factura no se toca: esta función
--      solo ha cambiado siempre la fecha de la PROPUESTA. Lo para
--      _conta_recibida_antes_del_inicio_para, al proponer: vale para cualquier puerta que
--      contabilice (la ficha, la tanda, la pasada automática). La firma no cambia.
--   2. conta_documentos_recibidos: la marcada «ya estaba» sale en la lista (regla 7), con el
--      estado «ya_contabilizada», su porqué y el programa de antes; no cuenta en «Por
--      revisar» ni en ningún otro total de pendientes.
--   3. conta_pagos_lista: la marcada «ya estaba» no sale en Pagos (ni pago pendiente).
--
-- Las tres, con la MISMA firma y el cuerpo vigente con un trozo cambiado (reemplazo exacto:
-- si el trozo no está una sola vez, no se toca nada). Respaldo antes, para la vuelta atrás.
-- No toca ningún dato. Nada en el camino del pedido.

select public._respaldar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261117T0956_n03_parar_y_preguntar');
select public._respaldar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261117T0956_n03_parar_y_preguntar');
select public._respaldar_funcion('public.conta_pagos_lista(uuid,date)', '20261117T0956_n03_parar_y_preguntar');

do $do$
declare
  v_def text; r record;
begin
  for r in
    select * from (values
      -- 1. Sin respuesta, no se contabiliza.
      ('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)',
       $viejo$  if p_entry->>'source_type' is distinct from 'supplier_invoice' or v_fecha is null then return p_entry; end if;$viejo$,
       $nuevo$  if p_entry->>'source_type' is distinct from 'supplier_invoice' or v_fecha is null then return p_entry; end if;
  -- N03 · Una factura de antes del día de inicio: para y pregunta (sin respuesta, no se contabiliza;
  -- con «ya estaba», nunca). Con «es nueva», al primer día abierto DESDE el día de inicio: la fecha
  -- de la propuesta, nunca la de la factura.
  if p_entry->>'source_id' is not null then
    declare v_inicio date := public._conta_recibida_antes_del_inicio_para(p_company, (p_entry->>'source_id')::uuid);
    begin
      if v_inicio is not null and v_fecha < v_inicio then
        v_nueva := public.conta_primer_dia_iva_abierto(p_company, v_inicio);
        if v_nueva is null then
          raise exception 'No hay ningún día abierto desde el % para contabilizar esta factura.', to_char(v_inicio, 'DD/MM/YYYY') using errcode = '23514';
        end if;
        v_aviso := format('Es nueva: esta factura del %s, de antes de que la empresa empezara en Sumied (el %s), se contabiliza el %s, el primer día abierto. Su fecha de factura no cambia.',
                          to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_inicio, 'DD/MM/YYYY'), to_char(v_nueva, 'DD/MM/YYYY'));
        return p_entry || jsonb_build_object('fecha', v_nueva, 'aviso', v_aviso,
          'razones', coalesce(p_entry->'razones', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'decision', v_aviso,
            'porque', 'Una factura de antes de que la empresa empezara en Sumied se contabiliza solo si quien la mira dice que no estaba ya en el programa de antes; entonces, el primer día abierto. Su fecha de factura no cambia.')));
      end if;
    end;
  end if;$nuevo$,
       'N03 · Una factura de antes del día de inicio'),
      -- 2a. La marcada «ya estaba», con su estado.
      ('public.conta_documentos_recibidos(uuid,date,date)',
       $viejo$      'estado', case when f.status = 'descartada' then 'descartada'
                     when f.asiento is null and f.diez is not null then 'en_diez'$viejo$,
       $nuevo$      'estado', case when f.status = 'descartada' then 'descartada'
                     when f.asiento is null and f.before_start_answer = 'ya_estaba' then 'ya_contabilizada'  -- N03
                     when f.asiento is null and f.diez is not null then 'en_diez'$nuevo$,
       'then ''ya_contabilizada''  -- N03'),
      -- 2b. Su porqué.
      ('public.conta_documentos_recibidos(uuid,date,date)',
       $viejo$      'porque', case when f.asiento is null and f.diez is not null$viejo$,
       $nuevo$      'porque', case when f.asiento is null and f.before_start_answer = 'ya_estaba'  -- N03
                  then 'Ya estaba contabilizada ' || coalesce('en ' || public._conta_programa_de_antes(p_company), 'en el programa de antes')
                       || ': no se contabiliza en Sumied (' || coalesce(f.before_start_answered_by_name, 'una persona') || ', '
                       || to_char(f.before_start_answered_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ').'
                  when f.asiento is null and f.diez is not null$nuevo$,
       '''porque'', case when f.asiento is null and f.before_start_answer = ''ya_estaba''  -- N03'),
      -- 2c. El programa de antes, para la etiqueta.
      ('public.conta_documentos_recibidos(uuid,date,date)',
       $viejo$      'llegada_tipo', f.llegada_tipo,$viejo$,
       $nuevo$      'llegada_tipo', f.llegada_tipo,
      'programa_antes', case when f.asiento is null and f.before_start_answer = 'ya_estaba' then public._conta_programa_de_antes(p_company) end,  -- N03$nuevo$,
       '''programa_antes'''),
      -- 3. No sale en Pagos.
      ('public.conta_pagos_lista(uuid,date)',
       $viejo$       and si.status in ('aprobada', 'pagada')$viejo$,
       $nuevo$       and si.status in ('aprobada', 'pagada')
       and si.before_start_answer is distinct from 'ya_estaba'  -- N03 · ya estaba en el programa de antes: no se paga aquí$nuevo$,
       'N03 · ya estaba en el programa de antes')
    ) t(firma, viejo, nuevo, marca)
  loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    if strpos(v_def, r.marca) > 0 then continue; end if;   -- ya pasada
    if (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo) <> 1 then
      raise exception 'N03: % no es la medida (su trozo no está una sola vez): no se toca.', r.firma;
    end if;
    execute replace(v_def, r.viejo, r.nuevo);
  end loop;
end $do$;

comment on function public._conta_recibida_no_antes_de_entrar(uuid, jsonb) is
  'S01p·4 (2210; antes V04, 1350). La propuesta de una factura recibida va con su fecha de factura, salvo que su trimestre tenga el 303 presentado o su día no esté abierto: entonces, al primer día abierto (conta_primer_dia_iva_abierto), con su aviso y su razón. Un mes cerrado por una persona no frena. N03: una de antes del día de inicio no se contabiliza sin respuesta (_conta_recibida_antes_del_inicio_para). Solo cambia la fecha de la propuesta, nunca la de la factura. La usa _journal_entry_proponer.';
