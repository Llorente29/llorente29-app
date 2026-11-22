-- supabase/migrations/20261121T2151_k10b_regla_11_lee_la_factura.sql
--
-- K10b · La regla 11 de la base («el tipo contra el país») lee el tipo de operación de la FACTURA
-- (supplier_invoice.vat_operation, de la 2150) si lo tiene; si no, el de su ficha, como hasta hoy
-- (conta_proveedor_iva_clase). Conoce «exenta», y si el tipo es el de la factura lo dice así, sin hablar del
-- país del proveedor. Va aparte de la 2150 porque CAMBIA: desde la rama solo pasa en ROLLBACK.
--
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261121_k10b_cabecera_recibida_prueba.sql
--   La MISMA firma y el cuerpo vigente con cuatro trozos cambiados. Respaldo antes, para la vuelta atrás. Con
--   vat_operation vacío (todas las recibidas que existen: la 2150 no escribe en ninguna), da lo mismo que antes.
--
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261121T2151_k10b_regla_11_lee_la_factura.down.sql

-- La regla 11, con el tipo de operación de la factura: el trozo de conta_motivos_para_validar que cambia.
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261121T2151_k10b_regla_11_lee_la_factura');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo1 text := $v$select s.name, s.country_code, public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime) as clase$v$;
  v_nuevo1 text := $n$select s.name, s.country_code, si.vat_operation,   -- K10b: el tipo de operación de la factura, si lo tiene
             coalesce(public.conta_operacion_clase(si.vat_operation), public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime)) as clase$n$;
  v_viejo2 text := $v$when 'nacional' then t.treatment in ('taxed', 'exempt', 'not_subject')
                 else false end;$v$;
  v_nuevo2 text := $n$when 'nacional' then t.treatment in ('taxed', 'exempt', 'not_subject')
                 when 'exenta' then t.treatment in ('exempt', 'not_subject')
                 else false end;$n$;
  v_viejo3 text := $v$motivo := 'No se valida: ' || v_contra || '. ' || v_p.name || ' ' || case v_p.clase$v$;
  v_nuevo3 text := $n$motivo := 'No se valida: ' || v_contra || '. ' || case when v_p.vat_operation is not null
            then format('En esta factura el tipo de operación es «%s»: ', public.conta_operacion_nombre(v_p.vat_operation)) || case v_p.clase
              when 'intracomunitaria' then 'su compra va con «Compra en otro país de la UE» (el IVA lo declaras tú).'
              when 'isp_extranjero' then 'su compra va con «Inversión del sujeto pasivo» (el IVA lo declaras tú).'
              when 'isp_nacional' then 'su compra va con «Inversión del sujeto pasivo».'
              when 'exenta' then 'sus apuntes de IVA van con un tipo exento o no sujeto.'
              else 'su compra lleva el IVA de su factura.' end || ' Si no es esa, cambia el tipo de operación en la factura.'
            else v_p.name || ' ' || case v_p.clase$n$;
  v_viejo4 text := $v$(se comprueba en VIES).' end;$v$;
  v_nuevo4 text := $n$(se comprueba en VIES).' end end;$n$;
  v_n int;
begin
  if strpos(v_def, 'K10b: el tipo de operación') > 0 then return; end if;   -- ya pasada
  foreach v_n in array array[1, 2, 3, 4] loop
    if (length(v_def) - length(replace(v_def, case v_n when 1 then v_viejo1 when 2 then v_viejo2 when 3 then v_viejo3 else v_viejo4 end, '')))
       / length(case v_n when 1 then v_viejo1 when 2 then v_viejo2 when 3 then v_viejo3 else v_viejo4 end) <> 1 then
      raise exception 'K10b: conta_motivos_para_validar no es la medida (el trozo % de la regla 11 no está una sola vez): no se toca.', v_n;
    end if;
  end loop;
  execute replace(replace(replace(replace(v_def, v_viejo1, v_nuevo1), v_viejo2, v_nuevo2), v_viejo3, v_nuevo3), v_viejo4, v_nuevo4);
end $do$;
