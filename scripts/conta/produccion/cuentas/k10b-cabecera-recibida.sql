-- scripts/conta/produccion/cuentas/k10b-cabecera-recibida.sql
--
-- K10b · El tipo de operación por factura · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9: account_id, sus 8 primeras cifras):
--   · regla 31: las recibidas VALIDADAS (con su asiento validado), por el tipo de operación que les da su
--     ficha (conta_proveedor_iva_clase: país, NIF-IVA, VIES y régimen), que es el que la regla 11 lee hoy.
--     La tanda no escribe en ninguna recibida: las columnas nuevas nacen vacías y vacías son «el de su
--     ficha». Antes y después, las mismas cifras: el mismo IVA.
--   · la marca: las recibidas sin contabilizar con marca que no son de una liquidación. Hasta hoy su marca
--     no llegaba al asiento; con el K10b, sí (como el local). No cambia con la tanda: es lo que cambia la
--     propuesta para esas facturas al proponerlas.
-- Escrito sin las columnas ni las funciones de la tanda, para que valga antes de aplicarla. Corte fijo: lo
-- creado antes del 22/11/2026 a las 00:00 de Madrid.
with v as (
  select i.account_id,
         public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime) as clase
    from public.supplier_invoice i
    join public.journal_entry e on e.account_id = i.account_id and e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado'
    left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
   where i.status not in ('anulada', 'descartada') and i.created_at < timestamptz '2026-11-22 00:00:00+01'
), m as (
  select i.account_id, count(*) as con_marca
    from public.supplier_invoice i
   where i.brand_id is not null and i.source is distinct from 'liquidacion' and i.status not in ('anulada', 'descartada')
     and i.created_at < timestamptz '2026-11-22 00:00:00+01'
     and not exists (select 1 from public.journal_entry e where e.account_id = i.account_id and e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado')
   group by i.account_id
)
select clave, valor from (
  select v.account_id, 1 o, 'cuenta ' || left(v.account_id::text, 8) || ' · regla 31: recibidas validadas · ' || coalesce(v.clase, 'sin proveedor') clave, count(*)::text valor
    from v group by v.account_id, v.clase
  union all
  select m.account_id, 2, 'cuenta ' || left(m.account_id::text, 8) || ' · sin contabilizar, con marca y no de una liquidación', m.con_marca::text from m
) t order by account_id, o, clave;
