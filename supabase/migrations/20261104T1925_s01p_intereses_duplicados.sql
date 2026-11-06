-- supabase/migrations/20261104T1925_s01p_intereses_duplicados.sql
--
-- S01p·6 · Foodint: se BORRA el asiento 4/3313 del 30/10, que repite los
-- intereses de la cuota de octubre del préstamo BBVA (Julio, 04/11, respuesta
-- S01p·6: los duplicados se borran, no se hace contraasiento). Mueve filas:
-- va con autorizo. El real lo lanza Julio.
--
-- Lo medido en producción (solo lectura, 04/11):
--   · La cuota del 03/10 (674,36 €: capital 558,68 e intereses 115,68) se pagó el
--     05/10 y se casó a mano, entera contra la 52000001 (asiento 4/3294).
--   · 4/3291, del 05/10 (creado el 29/10 a las 16:44, dos minutos antes que el
--     3294): 6623 al debe y 52000001 al haber, 115,68 €. «Intereses cuota oct-26
--     préstamo BBVA (cuadro BBVA)». SE QUEDA: es el día del cargo, cita el
--     cuadro y es el primero.
--   · 4/3313, del 30/10 (creado el 30/10 a las 22:05): lo mismo, 115,68 €.
--     «Corrige el asiento 3294: intereses … estaban en capital». Lo que corrige
--     ya lo había corregido el 3291. SE BORRA.
--   Con los dos, la 520 baja 115,68 € de más y la 6623 lleva 231,36 € de una
--   cuota de 115,68.
--   · Sin IVA, sin banco, sin documentos, sin corrección registrada; nadie nombra
--     su número ni los de detrás (3314 a 3321, que se renumeran a 3313–3320).
--
-- Cómo: con _conta_asientos_borrar (1837), como los de S01q·7: respaldo, la serie
-- 4 renumerada desde el 3313 y la cadena recalculada desde él. Esa función no
-- renumera ni reencadena lo que está en una declaración, y detrás del 3313 hay
-- 52 asientos en el BORRADOR del 303 del 4T de 2026 (sin presentar, 276 líneas,
-- «zero · 0,00», calculado el 03/11). Como en S01q·7 (Julio, S01q·8, «A»): en la
-- misma transacción se copia el 303 entero, se sacan sus líneas, se borra y se
-- vuelve a calcular el borrador con conta_impuesto_303_calcular. El 3313 no tiene
-- IVA: el IVA del 4T no cambia (se comprueba). Si el 303 no está en borrador,
-- para sin hacer nada. Sin Foodint (staging), no hace nada.
--
-- sin hueco: _conta_asientos_borrar renumera la serie 4 de 2026 desde el 3313 y recalcula la cadena desde él, en la misma transacción.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_borra constant uuid := 'c078b68f-2a34-45df-a506-d62e82022500';   -- 4/3313, 30/10
  v_queda constant uuid := '89253e0b-f8e8-4631-b7ef-487b70fb5f46';   -- 4/3291, 05/10
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';
  v_iva_antes numeric; v_iva_despues numeric; v_lineas_antes int; r jsonb; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p·6: sin la cuenta de Foodint, no hay nada que borrar.';
    return;
  end if;

  -- Los dos, los medidos: validados, serie 4, manuales, con sus dos líneas de 115,68 (6623 al debe, 52000001 al haber).
  select count(*) into v_n from public.journal_entry e
   where e.id in (v_borra, v_queda) and e.company_id = v_e and e.account_id = v_acc and e.status = 'validado' and e.series = 4 and e.source_type = 'manual'
     and ((e.id = v_borra and e.number = 3313 and e.entry_date = date '2026-10-30') or (e.id = v_queda and e.number = 3291 and e.entry_date = date '2026-10-05'))
     and (select count(*) from public.journal_line l where l.entry_id = e.id) = 2
     and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = e.id and a.code = '66230000' and l.debit = 115.68)
     and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = e.id and a.code = '52000001' and l.credit = 115.68);
  if v_n <> 2 then raise exception 'S01p·6: los asientos 4/3291 y 4/3313 no son los medidos (validados, manuales, 115,68 € de 6623 contra 52000001): no se borra nada.'; end if;
  if exists (select 1 from public.vat_book_entry v where v.entry_id = v_borra) or exists (select 1 from public.journal_entry_document d where d.entry_id = v_borra) then
    raise exception 'S01p·6: el 4/3313 ya no está como se midió (sin IVA y sin documentos): no se borra nada.';
  end if;

  -- El 303 del 4T: en borrador y sin presentar.
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.company_id = v_e and t.form_code = '303'
                    and t.fiscal_year = 2026 and t.period = '4T' and t.status = 'draft' and t.filed_at is null) then
    raise exception 'S01p·6: el 303 del 4T de 2026 ya no está en borrador (lo han revisado o presentado): no se borra nada.';
  end if;
  select count(*) into v_lineas_antes from public.tax_return_line where tax_return_id = v_303;

  -- El 303 entero, como está (para la vuelta atrás exacta, con su calculated_at).
  create table if not exists public.conta_s01p6_303_antes as
    select 'declaracion'::text as que, to_jsonb(t) as fila from public.tax_return t where t.id = v_303
    union all select 'linea', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = v_303
    union all select 'caja', to_jsonb(b) from public.tax_return_box b where b.tax_return_id = v_303
    union all select 'comprobacion', to_jsonb(c) from public.tax_return_check c where c.tax_return_id = v_303;
  alter table public.conta_s01p6_303_antes enable row level security;
  revoke all on table public.conta_s01p6_303_antes from public, anon, authenticated;

  -- El IVA del 4T (soportado y repercutido), antes; la misma vara después.
  select coalesce(sum(v.tax_amount), 0) into v_iva_antes from public.vat_book_entry v
   where v.company_id = v_e and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';

  -- 1 · Fuera del borrador sus líneas (la copia, arriba): si no, no se puede renumerar lo de detrás.
  delete from public.tax_return_line t where t.tax_return_id = v_303;

  -- 2 · Se borra el 4/3313.
  r := public._conta_asientos_borrar(v_e, array[v_borra],
         'S01p·6 · Duplicado: los intereses de la cuota de octubre del préstamo BBVA (115,68 €) ya estaban en el 4/3291 del 05/10. Julio, 04/11.',
         'Julio (tanda S01p·6)');
  raise notice 'S01p·6: %', r->>'texto';

  -- 3 · El borrador del 303 del 4T, otra vez calculado.
  r := public.conta_impuesto_303_calcular(v_e, 2026, '4T');
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.status = 'draft' and t.filed_at is null and t.calculated_at > now() - interval '1 minute') then
    raise exception 'S01p·6: el borrador del 303 no ha quedado recalculado: no se borra nada.';
  end if;
  select coalesce(sum(v.tax_amount), 0) into v_iva_despues from public.vat_book_entry v
   where v.company_id = v_e and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  if v_iva_antes <> v_iva_despues then
    raise exception 'S01p·6: el IVA del 4T no podía cambiar (el 3313 no tiene IVA) y pasa de % a %: no se borra nada.', v_iva_antes, v_iva_despues;
  end if;

  -- 4 · Lo que queda: los intereses de la cuota, una vez.
  select count(*) into v_n from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = v_e and e.account_id = v_acc and e.status = 'validado' and a.code = '66230000' and l.debit = 115.68
     and e.entry_date between date '2026-09-28' and date '2026-11-30';
  if v_n <> 1 then raise exception 'S01p·6: los intereses de la cuota de octubre tenían que quedar una vez y quedan %: no se borra nada.', v_n; end if;
  raise notice 'S01p·6: el borrador del 303 del 4T, recalculado: % (antes % líneas, ahora %). IVA del 4T sin cambios: %.',
    (select format('%s · %s €', t.result_kind, t.amount) from public.tax_return t where t.id = v_303),
    v_lineas_antes, (select count(*) from public.tax_return_line where tax_return_id = v_303), v_iva_despues;
end $$;
