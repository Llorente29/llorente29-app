-- supabase/migrations/20261113T1035_dl1_qbo_apertura.sql
--
-- DL1 · QBO: la apertura de 145,20 que no existe (Julio, DL1·25, 13/11). La
-- 41000008 (QBO Integrity) abre 2026 con 145,20 al Haber (9/1, el traspaso del
-- cierre de 2025): en nuestros libros la factura 2025/1/2992 (16/12/2025,
-- 145,20) se quedó sin pagar. El mayor de QBO de 2025 termina a 0,00: la cobró
-- el 04/12/2025, en su banco, antes de emitirla el 16/12. Su mayor de 2026
-- empieza a 0,00. Como las correcciones de apertura del 12/11 (2.1 y 4.9):
-- a 01/01, Debe 41000008 / Haber 11300000, sin IVA, validado como Julio.
-- Queda en la 41000008 solo el pago a cuenta del 12/11 (537,60).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_qbo constant uuid := '48a9fba8-a3f0-4222-9876-90c9d213c7ef';   -- QBO INTEGRITY SL, en Contactos
  v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 QBO: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if (select count(*) from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
       where e.company_id = v_e and a.code = '41000008' and e.entry_date = date '2026-01-01' and e.status = 'validado') <> 1
     or not exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
                     where e.company_id = v_e and a.code = '41000008' and e.entry_date = date '2026-01-01' and e.series = 9 and e.number = 1
                       and e.status = 'validado' and l.credit = 145.20 and l.debit = 0) then
    raise exception 'DL1 QBO: la apertura de la 41000008 no es la medida (una sola línea a 01/01, 9/1, 145,20 al Haber): no se apunta nada.';
  end if;
  v_id := public._dl1_asiento_iva(v_e, date '2026-01-01', 4, 'QBO: saldo de apertura sin respaldo; su mayor empieza 2026 a 0,00',
    'DL1 (Julio, 13/11): el mayor de QBO de 2025 termina a 0,00; la 2025/1/2992 la cobró el 04/12/2025. A reservas, como las aperturas del 12/11.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000008', 'debe', 145.20, 'tercero', v_qbo),
                      jsonb_build_object('cuenta', '11300000', 'haber', 145.20)));
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 145.20)));
  raise notice 'DL1 QBO: apertura de 145,20 a reservas, validada como Julio (%).', v_n;
end $$;
