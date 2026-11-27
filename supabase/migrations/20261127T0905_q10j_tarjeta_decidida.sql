-- supabase/migrations/20261127T0905_q10j_tarjeta_decidida.sql
--
-- Q10 · respuesta 8 (27/11) · LO QUE DECIDE JULIO DE LOS 5 PAGOS CON TARJETA LISTOS PARA FACTURAR de QBO, como la 0731:
-- con qué concepto se factura cada uno y a qué cliente de Cegid (el de su ficha, K14e).
--   · 0022 (consulta y alta de autónomo), 48,40 € (base 40,00): los clientes 1267, 1268 y 1269.
--   · 0039 (otros trámites y gestiones): el 1266 por 1.000,00 € (base 826,45) y el 1270 por 121,00 € (base 100,00).
-- Cada pago, por su clave (cuándo y cuánto, en conta_banco_cobro_tarjeta). Para si alguno no está como se midió el 27/11
-- (casado, en «enlace_pago», sin nada que falte, con su código y su abono). Sin la empresa de QBO (staging), no hace
-- nada. Sin nombres (T11). No manda nada a Cegid: los manda Julio con «Mandar este». Vuelta atrás:
-- supabase/vuelta-atras/20261127T0905_q10j_tarjeta_decidida.down.sql (solo las suyas).

do $decididas$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; v_acc constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; v_n int;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) or to_regclass('public.conta_banco_cobro_tarjeta') is null then
    raise notice 'Q10 · 0905: sin la empresa de QBO, nada que decidir.';
    return;
  end if;
  create temp table _q10j (clave text, pagado_en timestamptz, importe numeric, cliente int, concepto text) on commit drop;
  insert into _q10j values
    ('tpv:2026-11-19T12:41:55Z|48.40', timestamptz '2026-11-19 12:41:55+00', 48.40, 1267, '0022'),
    ('tpv:2026-11-19T15:55:17Z|48.40', timestamptz '2026-11-19 15:55:17+00', 48.40, 1268, '0022'),
    ('tpv:2026-11-24T17:45:56Z|48.40', timestamptz '2026-11-24 17:45:56+00', 48.40, 1269, '0022'),
    ('tpv:2026-11-05T08:37:18Z|1000.00', timestamptz '2026-11-05 08:37:18+00', 1000.00, 1266, '0039'),
    ('tpv:2026-11-20T10:09:39Z|121.00', timestamptz '2026-11-20 10:09:39+00', 121.00, 1270, '0039');
  select count(*) into v_n from _q10j x join public.conta_banco_cobro_tarjeta t on t.company_id = v_e and t.account_id = v_acc and t.pagado_en = x.pagado_en
    and t.importe = x.importe and t.cegid_codigo = x.cliente and t.estado = 'casado' and t.etapa = 'enlace_pago' and t.falta is null and t.movement_id is not null;
  if v_n <> 5 then raise exception 'Q10 · 0905: de los 5 pagos con tarjeta, % están como se midieron el 27/11 (casados, en enlace_pago, con su código y su abono).', v_n; end if;
  if exists (select 1 from public.conta_banco_decision d join _q10j x on x.clave = d.clave where d.company_id = v_e) then
    raise exception 'Q10 · 0905: alguno de los 5 pagos ya tiene una decisión: no se pisa.';
  end if;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, concepto, cliente, quien)
  select v_e, v_acc, x.clave, 'facturar', x.concepto, x.cliente, 'Julio (27/11)' from _q10j x;
end $decididas$;
