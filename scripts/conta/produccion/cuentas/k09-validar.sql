-- scripts/conta/produccion/cuentas/k09-validar.sql
--
-- K09 · Lo que ya hay en producción contra las reglas nuevas (Julio, 21/11) · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La tanda no toca ninguna fila: estas cifras son las mismas antes y después,
-- y son la medida que se entrega para que Julio decida (no se arregla nada aquí).
-- Por cuenta (regla 9: account_id, sus 8 primeras cifras), las recibidas YA VALIDADAS (con su asiento
-- validado) que incumplen cada regla, y las parejas de validadas repetidas (mismo proveedor o NIF, misma
-- empresa, mismo número sin mayúsculas, espacios, guiones, barras, puntos ni ceros a la izquierda).
-- Escrito sin las funciones de la tanda, para que valga antes de aplicarla. Corte fijo: lo creado antes
-- del 22/11/2026 a las 00:00 de Madrid.
with v as (
  select i.*, e.id as entry_id
    from public.supplier_invoice i
    join public.journal_entry e on e.account_id = i.account_id and e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado'
   where i.status not in ('anulada', 'descartada') and i.created_at < timestamptz '2026-11-22 00:00:00+01'
), clave as (
  select v.id, v.account_id, v.company_id, v.supplier_id,
         nullif(regexp_replace(regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^(EUVAT|NIFIVA|VATNO|VAT|NIF|CIF|TVA)', ''), '^ES(?=[A-Z0-9]{9}$)', ''), '') as nif,
         (select nullif(string_agg(regexp_replace(t, '(^|[^0-9])0+([0-9])', '\1\2', 'g'), '' order by o), '')
            from regexp_split_to_table(upper(coalesce(v.invoice_number, '')), '[\s\-_./\\]+') with ordinality as x(t, o)) as numero
    from v left join public.supplier s on s.id = v.supplier_id and s.account_id = v.account_id
), faltas as (
  select v.account_id,
         count(*) as validadas,
         count(*) filter (where v.supplier_id is null) as sin_proveedor,
         count(*) filter (where v.supplier_id is not null and not exists (select 1 from public.company_account_link k where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v.supplier_id::text and k.role = 'principal')) as sin_subcuenta,
         count(*) filter (where nullif(trim(coalesce(v.invoice_number, '')), '') is null) as sin_numero,
         count(*) filter (where v.invoice_date is null) as sin_fecha,
         count(*) filter (where not exists (select 1 from public.supplier_invoice_tax t where t.supplier_invoice_id = v.id and t.base is not null and t.vat_pct is not null)
                            and not exists (select 1 from public.journal_line l where l.entry_id = v.entry_id and l.tax_rate_id is not null and l.tax_base is not null)) as sin_base,
         count(*) filter (where not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v.entry_id and a.code !~ '^4')) as sin_gasto,
         count(*) filter (where v.grand_total is not null and v.tax_base_total is not null
                            and abs(v.grand_total - (v.tax_base_total + coalesce(v.tax_total, 0) - coalesce(v.withholding_amount, 0))) > 0.01
                            and abs(v.grand_total - (v.tax_base_total + coalesce(v.tax_total, 0) + coalesce(v.surcharge_total, 0) - coalesce(v.withholding_amount, 0))) > 0.01) as no_suma
    from v group by v.account_id
), parejas as (
  select a.account_id, count(*) as repetidas
    from clave a join clave b on b.account_id = a.account_id and b.company_id is not distinct from a.company_id and b.id > a.id
     and a.numero is not null and b.numero = a.numero
     and ((a.supplier_id is not null and b.supplier_id = a.supplier_id) or (a.nif is not null and b.nif = a.nif))
   group by a.account_id
)
select clave, valor from (
  select f.account_id, 1 o, 'cuenta ' || left(f.account_id::text, 8) || ' · recibidas validadas' clave, f.validadas::text valor from faltas f
  union all select f.account_id, 2, 'cuenta ' || left(f.account_id::text, 8) || ' · sin proveedor · sin su subcuenta · sin número · sin fecha',
                   f.sin_proveedor || ' · ' || f.sin_subcuenta || ' · ' || f.sin_numero || ' · ' || f.sin_fecha from faltas f
  union all select f.account_id, 3, 'cuenta ' || left(f.account_id::text, 8) || ' · sin base con su tipo · sin cuenta de gasto · no suman el total',
                   f.sin_base || ' · ' || f.sin_gasto || ' · ' || f.no_suma from faltas f
  union all select f.account_id, 4, 'cuenta ' || left(f.account_id::text, 8) || ' · parejas de validadas repetidas',
                   coalesce((select p.repetidas from parejas p where p.account_id = f.account_id), 0)::text from faltas f
) t order by account_id, o;
