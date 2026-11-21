-- scripts/conta/produccion/cuentas/r14-proveedor-solo.sql
--
-- R14 · El proveedor que se da de alta solo · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id, sin anclar por nombre;
-- los ids van cortados a 8, sin nombres ni NIF):
--   1. las recibidas leídas (con lectura de factura) SIN proveedor que la 1130 mira (no
--      validadas, pagadas, descartadas ni anuladas), por lo que trae su NIF: ninguno, el de
--      la propia empresa, el de una plataforma de la cuenta, el de un proveedor que ya está,
--      uno nuevo que valida o uno que no valida;
--   2. las que la 1130 no mira: sin proveedor con su asiento validado, o pagadas,
--      descartadas o anuladas (lo validado no se toca: tiene que dar lo mismo después);
--   3. los proveedores dados de alta desde una factura (created_from = 'factura') y las
--      subcuentas 4000/4100 de cada empresa.
--   5. CON LA TANDA PUESTA (dentro del ensayo): las completadas al aplicar, por cuenta,
--      empresa y lo que hizo Sumied (o por qué no). Sin la tanda, «no está».
--   7. CON LA TANDA PUESTA: las fichas de proveedor sueltas que eran una plataforma y se unieron
--      a ella al aplicar (Julio, 21/11), por cuenta y por empresa en la que tienen facturas.
--   6. CON LA TANDA PUESTA: la regla 31 de la tabla de lo que vende, por cuenta. Las
--      recibidas leídas con líneas; a cuántas propone algo; de las que tienen su asiento
--      validado, a cuántas propone y en cuántas acierta la hoja de su gasto (la cuenta del
--      6 al debe). Sin la tanda, «no está».
-- Las 5 y 6 se leen con query_to_xml: así la cuenta no falla sin la tanda (antes y después
-- de deshacerla dicen lo mismo, «no está») y, con ella, lee lo que crea la 1110.
-- Corte fijo: lo creado antes del 21/11/2026 a las 00:00 de Madrid (lo que entre durante el
-- ensayo no cuenta: W06). Después de deshacer la tanda, todo tiene que dar como antes.
with r as (
  select i.account_id, i.company_id, i.id, i.status,
         public._conta_nif_clave(i.reading->'factura'->'proveedor'->>'nif') nif,
         public._conta_nif_clave(c.tax_id) nif_empresa,
         exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado') validada
    from public.supplier_invoice i
    join public.company c on c.id = i.company_id and c.account_id = i.account_id
   where i.supplier_id is null and coalesce(i.reading, '{}'::jsonb) ? 'factura'
     and i.created_at < timestamptz '2026-11-21 00:00:00+01'
), m as (
  select r.*, case
    when r.validada or r.status in ('pagada', 'descartada', 'anulada') then 'no la mira (validada, pagada, descartada o anulada)'
    when r.nif is null then 'sin NIF'
    when r.nif = r.nif_empresa then 'NIF de la propia empresa'
    when exists (select 1 from public.party p join public.party_role pr on pr.party_id = p.id and pr.role = 'platform'
                  where p.account_id = r.account_id and public._conta_nif_clave(p.tax_id) = r.nif) then 'NIF de una plataforma'
    when exists (select 1 from public.supplier s where s.account_id = r.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) = r.nif) then 'NIF de un proveedor que ya está'
    when public._verifactu_nif_es_valido(r.nif) or (r.nif ~ '^[A-Z]{2}' and public._verifactu_nif_iva_ue_valido(left(r.nif, 2), substr(r.nif, 3))) then 'NIF nuevo que valida'
    else 'NIF que no valida' end clase
    from r
)
select clave, valor from (
select o, clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · leídas sin proveedor · ' || clase clave,
         count(*)::text || ' facturas · ' || count(distinct nif) || ' NIF distintos' valor
    from m group by account_id, company_id, clase
  union all
  select 2, 'tabla entera · leídas sin proveedor', count(*)::text from m
  union all
  select 3, 'cuenta ' || left(s.account_id::text, 8) || ' · proveedores dados de alta desde una factura', count(*)::text
    from public.supplier s where s.created_from = 'factura' and s.created_at < timestamptz '2026-11-21 00:00:00+01' group by s.account_id
  union all
  select 4, 'cuenta ' || left(a.account_id::text, 8) || ' · empresa ' || left(a.company_id::text, 8) || ' · subcuentas de la ' || a.template_code, count(*)::text
    from public.company_account a where a.template_code in ('4000', '4100') and a.kind = 'own'
     and a.created_at < timestamptz '2026-11-21 00:00:00+01' group by a.account_id, a.company_id, a.template_code
) t
union all
-- quieta: solo existe con la tanda puesta (la crea la 1110) y solo cuenta lo hecho al aplicar.
select 5, coalesce((xpath('/row/k/text()', r))[1]::text, 'con la tanda'), coalesce((xpath('/row/v/text()', r))[1]::text, 'no está')
  from (select case when to_regclass('public.conta_proveedor_solo') is null then null else query_to_xml('
          select ''cuenta '' || left(account_id::text, 8) || '' · empresa '' || left(coalesce(company_id::text, ''-''), 8) || '' · al aplicar · ''
                 || case que when ''alta'' then ''proveedor nuevo'' when ''existente'' then ''uno que ya estaba'' when ''plataforma'' then ''plataforma''
                    else ''sin completar · '' || case when motivo like ''La factura no trae%'' then ''sin NIF'' when motivo like ''El NIF leído%'' then ''NIF que no valida''
                                                    when motivo like ''El NIF del proveedor%'' then ''NIF de la propia empresa'' when motivo like ''No leí el nombre%'' then ''sin nombre'' when motivo like ''No he podido%'' then motivo else ''otro'' end end as k,
                 count(*)::text as v
            from public.conta_proveedor_solo where cuando = ''al_aplicar'' group by 1 order by 1', false, false, '') end as x) q
  left join lateral unnest(coalesce(xpath('/table/row', q.x), array[null::xml])) r on true
union all
-- quieta: solo existe con la tanda puesta (la función la crea la 1110); el corte de fecha va dentro.
select 6, coalesce((xpath('/row/k/text()', r))[1]::text, 'regla 31'), coalesce((xpath('/row/v/text()', r))[1]::text, 'no está')
  from (select case when to_regprocedure('public._conta_gasto_por_venta(text[])') is null then null else query_to_xml('
          with f as (
            select i.account_id, public._conta_gasto_por_venta(array(select l.raw_text from public.supplier_invoice_line l where l.supplier_invoice_id = i.id order by l.position))->>''hoja'' hoja,
                   (select a.template_code from public.journal_entry e join public.journal_line jl on jl.entry_id = e.id and jl.debit > 0
                      join public.company_account a on a.id = jl.company_account_id and a.code like ''6%''
                     where e.source_type = ''supplier_invoice'' and e.source_id = i.id and e.status = ''validado'' order by jl.debit desc limit 1) verdad
              from public.supplier_invoice i
             where coalesce(i.reading, ''{}''::jsonb) ? ''factura'' and i.created_at < timestamptz ''2026-11-21 00:00:00+01''
               and exists (select 1 from public.supplier_invoice_line l where l.supplier_invoice_id = i.id))
          select ''cuenta '' || left(account_id::text, 8) || '' · regla 31 de la tabla'' as k,
                 count(*) || '' leídas con líneas · propone en '' || count(hoja) || '' · de '' || count(verdad) || '' validadas, propone en ''
                 || count(*) filter (where verdad is not null and hoja is not null) || '' y acierta la hoja en ''
                 || count(*) filter (where verdad is not null and hoja = left(verdad, 3)) as v
            from f group by account_id order by 1', false, false, '') end as x) q
  left join lateral unnest(coalesce(xpath('/table/row', q.x), array[null::xml])) r on true
union all
-- quieta: solo existe con la tanda puesta (la crea la 1110) y solo cuenta lo unido al aplicar.
select 7, coalesce((xpath('/row/k/text()', r))[1]::text, 'unidas a su plataforma'), coalesce((xpath('/row/v/text()', r))[1]::text, 'no está')
  from (select case when to_regclass('public.conta_proveedor_unido') is null then null else query_to_xml('
          select ''cuenta '' || left(u.account_id::text, 8) || '' · empresa '' || coalesce(left(e.company_id::text, 8), ''sin facturas'')
                 || '' · fichas sueltas unidas a su plataforma, por su '' || u.como as k, count(distinct u.supplier_id)::text as v
            from public.conta_proveedor_unido u
            left join lateral (select distinct i.company_id from public.supplier_invoice i where i.supplier_id = u.supplier_id and i.account_id = u.account_id) e on true
           where u.cuando = ''al_aplicar'' group by 1 order by 1', false, false, '') end as x) q
  left join lateral unnest(coalesce(xpath('/table/row', q.x), array[null::xml])) r on true
) u order by o, clave;
