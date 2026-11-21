-- supabase/migrations/20261113T0955_b01r24_noviembre_fuera.sql
--
-- B01r·24 · Los 6 movimientos de noviembre de Llorente29 (Foodint) que la 0155
-- dejó fuera, ya decididos por Julio (13/11), y la recarga de Catcher de hoy.
-- Como la 0155 y la 1842: cada movimiento por bank_casar como Julio
-- (_dl1_casar), su asiento validado como si lo validara él (_dl1_validar), y lo
-- que se aparta, por bank_ignorar (_b01r23_ignorar, de la 0155).
--
--   · Los tres «RECOBRO DEUDA VENCIDA PRESTAMO» de la línea Click & Pay del
--     BBVA, como los de agosto (4/2512, 4/2513, 4/2514, 4/2575 y 4/2586 a la
--     52010000; el de 30,00 del 21/08, 4/2574, a la 62600000):
--       03/11 −457,49 (…15989) y 11/11 −159,94 (…15826): Debe 52010000.
--       03/11 −30,00 (…15989): Debe 62600000 (comisión).
--   · 08/11 −18,00 (Revolut): una botella de butano. Suministros (62800000),
--     sin justificante y sin IVA; local común (Revolut no tiene local).
--   · 12/11 −537,60 (Revolut): pago a QBO Integrity de una factura de asesoría
--     y gestión laboral que aún no ha llegado. Contra su cuenta (41000008), sin
--     factura enlazada; cuando llegue, se enlaza. No es gasto.
--   · 13/11 −200,00 (Revolut): recarga del saldo prepago de Catcher (40700001).
--   · 02/11 −1.210,00 (principal): el traspaso a Revolut ya está en el libro por
--     su entrada del 02/11 (Debe 57200004 / Haber 57200001, validado): se
--     aparta, después de comprobar que ese asiento sigue así.
--
-- SIN VUELTA ATRÁS, a propósito, como la 0155: un asiento validado se anula con
-- un contraasiento, un casado se deshace en Bancos y un apartado, con «Deshacer».

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_porque constant text := 'B01r24 (Julio, 13/11): los de noviembre que quedaron fuera, ya decididos.';
  v_sin constant text := 'B01r24 (Julio, 13/11): gasto sin justificante y sin IVA; cuando llegue el documento se corrige en el 4T.';
  -- La entrada de Revolut del 02/11 (+1.210,00), con su asiento: el otro lado del −1.210,00 de la principal.
  v_entrada constant uuid := 'a5fe6fbd-3920-4eea-9270-69206e417423';
  r record; v_res jsonb; v_st text; v_ids jsonb := '[]'::jsonb; v_n int; v_ap int; v_quedan int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'B01r24: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;

  -- A · Los 6 que se casan. destino: el de bank_casar, como en Bancos.
  for r in select x.mov, x.importe, x.destino::jsonb destino from (values
    ('7b9b5132-2861-4d6d-852f-53739dafe320'::uuid, -457.49, '{"tipo":"cuenta","concepto":"Recobro Click & Pay BBVA, referencia …15989","lineas":[{"cuenta":"52010000","importe":457.49}]}'),
    ('8fb0c82f-f1ac-49bd-8338-b1df5b6dcb08', -159.94, '{"tipo":"cuenta","concepto":"Recobro Click & Pay BBVA, referencia …15826","lineas":[{"cuenta":"52010000","importe":159.94}]}'),
    ('63c89636-a53b-4003-bc50-dc86e0e2d00b', -30.00, '{"tipo":"cuenta","concepto":"Recobro Click & Pay BBVA, referencia …15989 · comisión","lineas":[{"cuenta":"62600000","importe":30}]}'),
    ('322d4cc1-9a0d-4866-867a-7e75e6225ad9', -18.00, '{"tipo":"cuenta","concepto":"Sin justificante · botella de butano","lineas":[{"cuenta":"62800000","importe":18}]}'),
    ('df68f127-8f5f-405b-b54a-14d7f6eac6de', -537.60, '{"tipo":"cuenta","concepto":"Pago a QBO Integrity · asesoría y gestión laboral, pendiente de su factura","tercero_id":"48a9fba8-a3f0-4222-9876-90c9d213c7ef","lineas":[{"cuenta":"41000008","importe":537.6}]}'),
    ('9c9866da-a641-4689-9445-6ec8abcd490c', -200.00, '{"tipo":"cuenta","concepto":"Catcher · recarga del saldo prepago","lineas":[{"cuenta":"40700001","importe":200}]}')
  ) x(mov, importe, destino) loop
    if not exists (select 1 from public.bank_movement where id = r.mov and company_id = v_e and amount = r.importe
                    and op_date between date '2026-11-01' and date '2026-11-13' and status in ('por_aclarar', 'propuesto', 'pendiente')) then
      raise exception 'B01r24: el movimiento % ya no está sin casar por % en noviembre: no se casa nada.', r.mov, r.importe;
    end if;
    v_res := public._dl1_casar(v_e, v_julio, 'Julio', r.mov, r.destino,
      case when r.destino->>'concepto' like 'Sin justificante%' then v_sin else v_porque end);
    select status into v_st from public.journal_entry where id = (v_res->>'asiento')::uuid;
    if v_st = 'propuesto' then
      v_ids := v_ids || jsonb_build_object('id', v_res->>'asiento', 'importe', abs(r.importe));
    elsif v_st is distinct from 'validado' then
      raise exception 'B01r24: el asiento del movimiento % está % y no se puede validar.', r.mov, coalesce(v_st, 'sin asiento');
    end if;
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);

  -- B · El −1.210,00 del 02/11: solo si la entrada de Revolut sigue apuntando el traspaso contra la principal.
  if not exists (
       select 1 from public.journal_entry e
        where e.id = v_entrada and e.company_id = v_e and e.status = 'validado'
          and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                       where l.entry_id = e.id and a.code = '57200001' and l.credit = 1210.00)
          and exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                       where l.entry_id = e.id and a.code = '57200004' and l.debit = 1210.00)
          and exists (select 1 from public.bank_match b where b.journal_entry_id = e.id and b.status = 'vivo')) then
    raise exception 'B01r24: la entrada de Revolut del 02/11 ya no apunta el traspaso contra la 57200001: no se aparta el −1.210,00.';
  end if;
  v_ap := public._b01r23_ignorar(v_e, v_julio, 'Traspaso a Revolut ya apuntado en su entrada del 02/11',
    '[{"id":"5d80d05f-8d27-49b9-abf0-99d9cb9ca7cd","importe":-1210.00,"fecha":"2026-11-02"}]'::jsonb);

  -- C · Noviembre, del 01 al 13/11, sin nada por casar.
  select count(*) into v_quedan from public.bank_movement
   where company_id = v_e and op_date between date '2026-11-01' and date '2026-11-13' and status in ('por_aclarar', 'propuesto', 'pendiente');
  if v_quedan <> 0 then
    raise exception 'B01r24: después de casar quedan % movimientos de noviembre sin casar.', v_quedan;
  end if;
  raise notice 'B01r24: 6 casados, % asientos validados como Julio y % apartado; noviembre sin nada por casar.', v_n, v_ap;
end $$;
