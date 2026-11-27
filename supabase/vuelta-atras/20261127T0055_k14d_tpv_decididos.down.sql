-- K14d · vuelta atrás de 20261127T0055: los cuatro pagos como los dejó la K14c, y sin la columna «falta».
do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
begin
  update public.conta_banco_cobro_tarjeta set estado = 'por_confirmar',
         porque = 'la única negociación de 1.000 €, pero creada el 30/10: otro día. No está en Cegid'
   where company_id = emp and crm_id = '25347';
  update public.conta_banco_cobro_tarjeta set estado = 'por_confirmar', party_id = null,
         porque = 'la única negociación de 121 €, pero creada el 19/11: otro día. Su nombre no es el de ninguna ficha ni está en Cegid'
   where company_id = emp and crm_id = '26804';
  update public.conta_banco_cobro_tarjeta set party_id = null,
         porque = 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su nombre no es el de ninguna ficha ni está en Cegid'
   where company_id = emp and crm_id = '26805';
end $$;
alter table public.conta_banco_cobro_tarjeta drop column if exists falta;
comment on table public.conta_banco_cobro_tarjeta is
  'K14c · Cada pago con tarjeta (TPV), con su abono del día (conta_banco_cobro, «tarjeta») y su negociación del CRM (crm_id, etapa). Q factura los casados en «enlace_pago» (estado = casado y etapa = enlace_pago): cliente party_id, código en Cegid cegid_codigo (null: no existe). Lo demás, para Julio, con su porqué.';
