-- supabase/migrations/20261127T0731_q10i_decisiones_julio.sql
--
-- Q10 · respuesta 7 (27/11) · LO QUE YA DECIDIÓ JULIO DE DOS COBROS DEL BANCO DE QBO, por su movimiento:
--   · 09/11 · 734,60 € (el servicio de notificaciones): «No es un cobro».
--   · 17/11 · 1.089,00 € («PGO. FRA-2026/1/274…»): «Paga una factura que ya existe», la 1/2745 del cliente 1262 de
--     Cegid (en lo leído de Cegid el 25/11: 1/2745, 17/11, 1.089,00 €).
-- Para si alguno no está como se midió el 27/11 (sin cliente, con ese importe y esa fecha). Sin la empresa de QBO
-- (staging), no hace nada. Sin nombres (T11). No manda nada a Cegid. Vuelta atrás:
-- supabase/vuelta-atras/20261127T0731_q10i_decisiones_julio.down.sql (solo las suyas).

do $decididas$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; v_acc constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655';
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'Q10 · 0731: sin la empresa de QBO, nada que decidir.';
    return;
  end if;
  if (select count(*) from public.conta_banco_cobro where company_id = v_e and account_id = v_acc and estado = 'sin_cliente' and (
        (movement_id = 'a7434fbc-03f9-40b6-88a9-441ec18aa64f' and fecha = date '2026-11-09' and importe = 734.60)
     or (movement_id = '310e448a-57e8-445e-87e3-f89cb5084486' and fecha = date '2026-11-17' and importe = 1089.00))) <> 2 then
    raise exception 'Q10 · 0731: los dos cobros no están como se midieron el 27/11 (sin cliente, con su fecha y su importe).';
  end if;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, factura, quien)
  values (v_e, v_acc, 'mov:a7434fbc-03f9-40b6-88a9-441ec18aa64f', 'no_es_cobro', null, 'Julio (27/11, Q10 · 0731)'),
         (v_e, v_acc, 'mov:310e448a-57e8-445e-87e3-f89cb5084486', 'paga_factura', '1/2745', 'Julio (27/11, Q10 · 0731)')
  on conflict (company_id, clave) do nothing;
end $decididas$;
