-- supabase/migrations/20261127T1126_q10k_decisiones_qbo.sql
--
-- Q10 · respuesta 9 (27/11) · LAS RESPUESTAS DE QBO, como decisiones de Julio (quien «QBO vía Julio (27/11)»), por el
-- movimiento del banco, como la 0731 y la 0905:
--   · 11/11 · 244,38 €: el cliente 718 de Cegid (no el 1014 que propuso el banco); paga la factura 4/12, que ya existe
--     (en lo leído de Cegid el 25/11 la última de la serie 4 de ese cliente es la 4/11: la 4/12 es de después).
--   · 10/11 · 60,00 €: el cliente 1008 (la compañía 1484 de Bitrix, la misma ficha y NIF que el 1008 de Cegid); paga la
--     factura 1/2524, que ya existe (07/10, 60,00 €, una cita online; Julio: no hay ningún pago suyo de 60 € en octubre).
--   · 11/11 · 18,22 €: paga la factura 1/994 del cliente 700, que ya existe (26/04, 18,22 €, «diferencia de pago renta»).
--     Lo pagó una persona de la misma familia (Julio, 27/11).
-- Para si alguno no está como se midió el 27/11 (con su fecha, su importe y su estado) o ya tiene una decisión. Sin la
-- empresa de QBO (staging), no hace nada. Sin nombres (T11). No manda nada a Cegid: lo manda Julio. Vuelta atrás:
-- supabase/vuelta-atras/20261127T1126_q10k_decisiones_qbo.down.sql (solo las suyas).

do $decididas$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; v_acc constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; v_n int;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'Q10 · 1126: sin la empresa de QBO, nada que decidir.';
    return;
  end if;
  create temp table _q10k (mov uuid, fecha date, importe numeric, estado text, decision text, concepto text, cliente int, factura text) on commit drop;
  insert into _q10k values
    ('507a9bad-9961-47ac-aa49-658ec2fe14a0', date '2026-11-11', 244.38, 'por_confirmar', 'paga_factura', null, 718, '4/12'),
    ('e99b91f6-a5cf-4e6f-8e8e-b0242187eaa9', date '2026-11-10', 60.00, 'por_confirmar', 'paga_factura', null, 1008, '1/2524'),
    ('b346eefb-b9ed-436c-a235-4b9d28bc7792', date '2026-11-11', 18.22, 'sin_cliente', 'paga_factura', null, 700, '1/994');
  select count(*) into v_n from _q10k x join public.conta_banco_cobro c on c.company_id = v_e and c.account_id = v_acc and c.movement_id = x.mov
    and c.fecha = x.fecha and c.importe = x.importe and c.estado = x.estado;
  if v_n <> 3 then raise exception 'Q10 · 1126: de los 3 cobros, % están como se midieron el 27/11 (con su fecha, su importe y su estado).', v_n; end if;
  if exists (select 1 from public.conta_banco_decision d join _q10k x on d.clave = 'mov:' || x.mov where d.company_id = v_e) then
    raise exception 'Q10 · 1126: alguno de los 3 cobros ya tiene una decisión: no se pisa.';
  end if;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, concepto, cliente, factura, quien)
  select v_e, v_acc, 'mov:' || x.mov, x.decision, x.concepto, x.cliente, x.factura, 'QBO vía Julio (27/11)' from _q10k x;
end $decididas$;
