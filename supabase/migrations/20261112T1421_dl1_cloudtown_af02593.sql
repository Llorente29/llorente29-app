-- supabase/migrations/20261112T1421_dl1_cloudtown_af02593.sql
--
-- DL1 · Cloudtown (43000004): la autofactura de febrero que falta, AF-02593
-- (Julio, DL1·15, 12/11). Carabanchel; su cobro (7.923,74 el 06/03) ya está en
-- los libros. Como con Adleta: con fecha del 01/10/2026 (el 1T está presentado y
-- cerrado en Diez; su IVA va al 4T), con el periodo real en el concepto y en la
-- lista de la gestoría.
--
-- Desglose del PDF (cierre de febrero de Cloudtown):
--   Servicio por Ventas Multimarcas ......... 3.782,42
--   Servicio por Ventas con Reparto Propio ..    29,40
--   Mercaderías Aportadas por el Partner .... 4.428,84
--   Base 8.240,66 + IVA 10 % 824,07 = 9.064,73
--
-- Como las del 1T que sí están (AF-02494, AF-02548, AF-02584): serie 1, 705 por
-- la base, 477 por el IVA y 43000004 por el total. Además, la 705 con el local
-- de Carabanchel y la 477 con su tipo, su base y el libro de emitidas, para que
-- se pueda validar. Se propone con _dl1_venta_proponer y se valida con
-- _dl1_validar (journal_entry_validar, como si lo pulsara Julio): las dos ya
-- están en producción (2052 y 1750).
--
-- Lo que tiene que dar: 43000004 de −13.275,35 a −4.210,62; IVA repercutido
-- con fecha 01/10 de Cloudtown: +824,07.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_car constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';   -- Foodint Carabanchel
  v_iva10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';  -- IVA reducido, 10 %
  v_base constant numeric := 3782.42 + 29.40 + 4428.84;
  v_iva constant numeric := 824.07;
  v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Cloudtown: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if v_base <> 8240.66 or v_base + v_iva <> 9064.73 or round(v_base * 0.10, 2) <> v_iva then
    raise exception 'DL1 Cloudtown: el desglose de la AF-02593 no cuadra (base %, IVA %).', v_base, v_iva;
  end if;
  v_id := public._dl1_venta_proponer(v_e, date '2026-10-01', 1,
    'Autofactura Cloudtown AF-02593 · febrero 2026 · Carabanchel · apuntada el 01/10',
    'DL1 (Julio, 12/11): autofactura de Cloudtown que no estaba en los libros; su cobro (7.923,74 el 06/03) sí. Con fecha del 01/10: el 1T está presentado y cerrado en Diez; su IVA va al 4T.',
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000004', 'debe', v_base + v_iva, 'documento', 'AF-02593'),
      jsonb_build_object('cuenta', '70500000', 'haber', v_base, 'local', v_car, 'documento', 'AF-02593'),
      jsonb_build_object('cuenta', '47700000', 'haber', v_iva, 'documento', 'AF-02593', 'iva', jsonb_build_object('tipo', v_iva10, 'base', v_base))));
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', v_base + v_iva)));
  raise notice 'DL1 Cloudtown: AF-02593 apuntada y validada (% asiento).', v_n;
end $$;
