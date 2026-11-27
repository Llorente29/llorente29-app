-- supabase/migrations/20261127T0055_k14d_tpv_decididos.sql
--
-- K14d · Lo que decide Julio (27/11) sobre los pagos con tarjeta de noviembre de QBO (conta_banco_cobro_tarjeta, K14c):
--   · el pago de 1.000 € del 05/11 es de la negociación 25347 y el de 121 € del 20/11, de la 26804: casados, con
--     «decidido por Julio, 27/11». El de 121 €, con su ficha (la del CRM 1498, que el nombre de la negociación no
--     encontró: va escrito de otra forma).
--   · el de 48,40 € del 19/11 (negociación 26805), ya casado, con su ficha (la del CRM 1491; tampoco la encontró el nombre).
--   · el de 60 € del 09/11 (negociación 26792) sigue atado, pero no se factura hasta tener su NIE: columna nueva
--     «falta» (lo que falta para facturar un casado; null: nada).
--   · los tres de 96,80 € y los dos de 60 € del 03/11 no cambian: siguen en la lista hasta que conteste QBO.
-- Q factura lo casado en «enlace_pago» sin nada que falte: estado = casado, etapa = enlace_pago y falta is null.
-- Aquí NO va ningún nombre (T11): el número de la negociación y la ficha.
--
-- Añade una columna y cambia 4 filas que solo escribió la K14c (nadie más escribe en la tabla). No manda nada a Cegid.
-- Nada en el camino del pedido.

alter table public.conta_banco_cobro_tarjeta add column if not exists falta text;
comment on column public.conta_banco_cobro_tarjeta.falta is
  'K14d · Lo que falta para facturar un pago ya casado (p. ej. «falta su NIE»). Null: nada; Q lo factura si está en enlace_pago.';
comment on table public.conta_banco_cobro_tarjeta is
  'K14c · Cada pago con tarjeta (TPV), con su abono del día (conta_banco_cobro, «tarjeta») y su negociación del CRM (crm_id, etapa). Q factura los casados en «enlace_pago» sin nada que falte (estado = casado, etapa = enlace_pago y falta is null): cliente party_id, código en Cegid cegid_codigo (null: no existe). Lo demás, para Julio, con su porqué.';

do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; cta constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; v_n int;
begin
  if not exists (select 1 from public.conta_banco_cobro_tarjeta where company_id = emp) then
    raise notice 'K14d: esta base no tiene los pagos con tarjeta de QBO Integrity: nada que decidir.';
    return;
  end if;
  -- Como los dejó la K14c, y las dos fichas son de QBO.
  if (select count(*) from public.conta_banco_cobro_tarjeta where company_id = emp and (
        (crm_id = '25347' and estado = 'por_confirmar' and importe = 1000.00 and pagado_en = timestamptz '2026-11-05 09:37:18+01')
     or (crm_id = '26804' and estado = 'por_confirmar' and importe = 121.00 and pagado_en = timestamptz '2026-11-20 11:09:39+01' and party_id is null)
     or (crm_id = '26805' and estado = 'casado' and importe = 48.40 and pagado_en = timestamptz '2026-11-19 13:41:55+01' and party_id is null)
     or (crm_id = '26792' and estado = 'casado' and importe = 60.00 and pagado_en = timestamptz '2026-11-09 15:43:54+01' and falta is null))) <> 4
     or (select count(*) from public.party where account_id = cta and archived_at is null
          and id in ('f7ffc4c8-0152-428e-97b0-adc84ddded75', '2af272da-8092-4673-9013-dec95c119145')) <> 2 then
    raise exception 'K14d · 0: los cuatro pagos no están como los dejó la K14c (o una de las dos fichas no es de QBO).';
  end if;
  update public.conta_banco_cobro_tarjeta set estado = 'casado',
         porque = 'decidido por Julio, 27/11: la única negociación de 1.000 €, creada el 30/10. No está en Cegid'
   where company_id = emp and crm_id = '25347';
  update public.conta_banco_cobro_tarjeta set estado = 'casado', party_id = 'f7ffc4c8-0152-428e-97b0-adc84ddded75',
         porque = 'decidido por Julio, 27/11: la única negociación de 121 €, creada el 19/11. No está en Cegid'
   where company_id = emp and crm_id = '26804';
  update public.conta_banco_cobro_tarjeta set party_id = '2af272da-8092-4673-9013-dec95c119145',
         porque = 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su ficha, la que nombró Julio el 27/11. No está en Cegid'
   where company_id = emp and crm_id = '26805';
  update public.conta_banco_cobro_tarjeta set falta = 'falta su NIE (Julio, 27/11): se factura cuando lo tenga'
   where company_id = emp and crm_id = '26792';
  select count(*) into v_n from public.conta_banco_cobro_tarjeta where company_id = emp and estado = 'casado' and etapa = 'enlace_pago' and falta is null;
  raise notice 'K14d: decidido lo de Julio; % pagos para facturar.', v_n;
end $$;
