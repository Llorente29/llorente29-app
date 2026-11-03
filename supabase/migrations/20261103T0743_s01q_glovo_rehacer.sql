-- supabase/migrations/20261103T0743_s01q_glovo_rehacer.sql
--
-- S01q·10 · Foodint: se REHACEN las 27 propuestas de liquidación de Glovo
-- (Julio, 03/11). Mueve filas: va con autorizo. Ninguna está validada: no
-- tienen número, ni cadena, ni libro de IVA (156 líneas en total).
--   · 13 del 01/10 (16–30/09): de referencia, y su factura y su cobro ya están
--     en Diez (2/2296–2/2308 y 4/1619–4/1631) → se quedan SIN propuesta.
--   · 13 del 16/10 (01–15/10): su factura de comisión ya tiene asiento
--     (2/3300–2/3313) → solo compensan con su factura.
--   · La del I170326000551592: su factura sigue en revisión (difiere 170,61 €)
--     → sin propuesta hasta que se aclare, y lo dice con esas palabras.
--   Se rehacen con _conta_proponer_plataforma (la 0742): la misma regla que
--   corre al leerse una liquidación.
--   · Después, el borrador del 303 del 4T se vuelve a calcular: las dos de
--     Anthropic Ireland (IVA no deducible) dejan de dar error (la 0741). Si el
--     303 ya no está en borrador, para sin hacer nada.
-- Lo de antes (las 27 con sus líneas, y el 303 entero) queda en
-- conta_s01q10_antes, para la vuelta atrás exacta. Para si algo no es lo
-- medido. Sin Foodint (staging), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';
  v_espera constant text := 'I170326000551592';
  v_props uuid[]; v_liqs uuid[]; v_n int; v_l int; v_ref int; v_con int; c uuid; r jsonb; v_mal text;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01q·10: sin la cuenta de Foodint, no hay nada que rehacer.';
    return;
  end if;

  -- Las 27, como se midieron el 03/11.
  select array_agg(e.id order by e.id), array_agg(e.source_id order by e.id) into v_props, v_liqs
    from public.journal_entry e join public.channel_settlement cs on cs.id = e.source_id
   where e.account_id = v_acc and e.company_id = v_e and e.source_type = 'channel_settlement' and e.status = 'propuesto' and cs.source = 'excel_glovo';
  select count(*) into v_l from public.journal_line l where l.entry_id = any(v_props);
  select count(*) filter (where cs.is_reference), count(*) filter (where exists (
           select 1 from public.journal_entry s where s.source_type = 'supplier_invoice' and s.source_id = cs.commission_invoice_id and s.status = 'validado'))
    into v_ref, v_con from public.channel_settlement cs where cs.id = any(v_liqs);
  if coalesce(array_length(v_props, 1), 0) <> 27 or v_l <> 156 or v_ref <> 13 or v_con <> 13
     or (select count(*) from public.channel_settlement cs join public.supplier_invoice si on si.id = cs.commission_invoice_id
          where cs.id = any(v_liqs) and si.invoice_number = v_espera) <> 1
     or exists (select 1 from public.journal_entry e where e.id = any(v_props) and (e.number is not null or e.chain_seq is not null))
     or exists (select 1 from public.vat_book_entry v where v.entry_id = any(v_props))
     or exists (select 1 from public.journal_entry_document d where d.entry_id = any(v_props)) then
    raise exception 'S01q·10: las propuestas de Glovo no son las medidas (27, 156 líneas, 13 de referencia, 13 con su factura contabilizada y la del %): ahora % y % líneas, % y %. No se toca nada.',
      v_espera, coalesce(array_length(v_props, 1), 0), v_l, v_ref, v_con;
  end if;
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.company_id = v_e and t.status = 'draft' and t.filed_at is null) then
    raise exception 'S01q·10: el 303 del 4T de 2026 ya no está en borrador: no se toca nada.';
  end if;

  -- Lo de antes, para la vuelta atrás exacta.
  create table if not exists public.conta_s01q10_antes as
    select 'propuesta'::text as que, to_jsonb(e) as fila from public.journal_entry e where e.id = any(v_props)
    union all select 'linea', to_jsonb(l) from public.journal_line l where l.entry_id = any(v_props)
    union all select 'pendiente', to_jsonb(q) from public.conta_propuesta_pendiente q
               where q.company_id = v_e and q.origen = 'channel_settlement' and q.origen_id = any(select x::text from unnest(v_liqs) x)
    union all select 'liquidacion', to_jsonb(x) from unnest(v_liqs) x
    union all select 'declaracion', to_jsonb(t) from public.tax_return t where t.id = v_303
    union all select 'linea303', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = v_303
    union all select 'caja', to_jsonb(b) from public.tax_return_box b where b.tax_return_id = v_303
    union all select 'comprobacion', to_jsonb(k) from public.tax_return_check k where k.tax_return_id = v_303;
  alter table public.conta_s01q10_antes enable row level security;
  revoke all on table public.conta_s01q10_antes from public, anon, authenticated;

  -- Rehacer cada una con la regla de siempre (la 0742 quita la que ya no vale).
  foreach c in array v_liqs loop
    r := public._conta_proponer_plataforma(v_e, c, 'Sumied · S01q·10, rehecha con el visto bueno de Julio');
  end loop;

  -- Lo que tiene que quedar.
  select string_agg(m, ' ') into v_mal from (
    select 'Quedan propuestas de antes.' m where exists (select 1 from public.journal_entry e where e.id = any(v_props))
    union all
    select format('%s de las 13 de referencia tienen asiento.', count(*)) from public.channel_settlement cs
     where cs.id = any(v_liqs) and cs.is_reference
       and exists (select 1 from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = cs.id and e.status <> 'anulado')
    having count(*) > 0
    union all
    select format('Solo %s de las 13 de octubre tienen su propuesta.', count(*)) from public.channel_settlement cs
     where cs.id = any(v_liqs) and not coalesce(cs.is_reference, false)
       and exists (select 1 from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = cs.id and e.status = 'propuesto')
    having count(*) <> 13
    union all
    select 'Alguna propuesta nueva lleva gasto o IVA soportado.' where exists (
      select 1 from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account ca on ca.id = l.company_account_id
       where e.source_type = 'channel_settlement' and e.source_id = any(v_liqs) and e.status <> 'anulado' and (ca.code like '6%' or l.vat_book = 'received'))
    union all
    select format('La del %s no dice que espera a su factura.', v_espera) where not exists (
      select 1 from public.conta_propuesta_pendiente q join public.channel_settlement cs on cs.id::text = q.origen_id
        join public.supplier_invoice si on si.id = cs.commission_invoice_id
       where q.company_id = v_e and q.origen = 'channel_settlement' and si.invoice_number = v_espera
         and q.porque like 'Sin propuesta hasta que se aclare su factura de comisión ' || v_espera || ': la factura y su liquidación difieren en 170,61 €%')
  ) z;
  if v_mal is not null then raise exception 'S01q·10: no queda como tiene que quedar: % No se toca nada.', v_mal; end if;
  raise notice 'S01q·10: 27 propuestas rehechas: 13 de referencia sin propuesta, 13 de octubre solo compensan y la del % espera a su factura.', v_espera;

  -- El borrador del 303 del 4T, otra vez calculado.
  r := public.conta_impuesto_303_calcular(v_e, 2026, '4T');
  if exists (select 1 from public.tax_return_line l where l.tax_return_id = v_303 and l.frozen->>'no_sabe' = 'extranjera_sin_isp') then
    raise exception 'S01q·10: el 303 recalculado sigue marcando compras de fuera sin autoliquidar: no se toca nada.';
  end if;
  raise notice 'S01q·10: el borrador del 303 del 4T, recalculado: %', (select format('%s · %s €', t.result_kind, t.amount) from public.tax_return t where t.id = v_303);
end $$;
