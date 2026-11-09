-- supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
--
-- G05 · Tarea 4 · La ficha de una factura que sale de un recibo (la maqueta
-- aprobada, Factura.dc.html): «Lo que ha pasado» y «En la contabilidad», en UNA
-- sola lectura (regla de Julio: toda pantalla abre en menos de 1 s).
-- SOLO AÑADE una función de lectura:
--   conta_pantalla_factura_recibo(p_cuenta, p_factura) → null si la factura no
--   sale de un recibo; si sale, su recibo (estado, fechas del aviso, del cargo y
--   del cobro, quién lo envió), lo que le ha pasado (conta_recibo_evento), su
--   registro de Verifactu (estado, entorno, huella y con cuál se encadena), el
--   pago de GoCardless al banco que lo lleva (nº 43: su día de llegada y su neto,
--   de la 1426) y sus asientos con sus apuntes: el de la factura, el del cobro,
--   el del ingreso en el banco cuando Bancos lo casa y, si lo hay, el de la
--   devolución.
-- Va DESPUÉS de la 1426 en la tanda (lee conta_gc_payout).
-- Es SECURITY INVOKER: lee con las políticas de quien la llama (cada tabla
-- filtra por su cuenta). Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1403_g05_t4_ficha_factura.down.sql

create or replace function public.conta_pantalla_factura_recibo(p_cuenta uuid, p_factura uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with r as (
    select x.* from public.conta_recibo x where x.account_id = p_cuenta and x.invoice_id = p_factura limit 1
  ), pg as (
    select p.gc_id, p.llegada, p.importe, p.estado, b.journal_entry_id as asiento
      from r join public.conta_gc_cobro c on c.company_id = r.company_id and c.gc_id = r.gc_cobro_id
      join public.conta_gc_payout p on p.company_id = c.company_id and p.gc_id = c.payout_gc_id
      left join public.bank_match b on b.id = p.match_id and b.status = 'vivo'
     where c.account_id = p_cuenta
  ), f as (
    select ci.id, ci.entry_id from public.customer_invoice ci where ci.account_id = p_cuenta and ci.id = p_factura
  ), asientos as (
    select q.tipo, q.orden, e.id, e.entry_date, e.number, e.status
      from (select 'factura'::text as tipo, 1 as orden, f.entry_id as id from f
            union all select 'cobro', 2, r.asiento_cobro from r
            union all select 'ingreso', 3, pg.asiento from pg
            union all select 'devolucion', 4, r.asiento_devolucion from r) q
      join public.journal_entry e on e.id = q.id and e.account_id = p_cuenta
  )
  select case when not exists (select 1 from r) then null else jsonb_build_object(
    'recibo', (select jsonb_build_object('id', r.id, 'company_id', r.company_id, 'mes', r.mes, 'estado', r.estado, 'gc_estado', r.gc_estado,
        'cobrar_cent', coalesce(r.cobrar_cent, r.total_cent), 'cargo_el', r.cargo_el, 'confirmado_el', r.confirmado_el,
        'enviado_at', r.enviado_at, 'enviado_por_name', r.enviado_por_name,
        'aviso_el', (select m.aviso_el from public.conta_cobro_mes m where m.company_id = r.company_id and m.mes = r.mes))
       from r),
    'ingreso', (select jsonb_build_object('payout', pg.gc_id, 'llegada', pg.llegada, 'neto', pg.importe, 'estado', pg.estado, 'casado', pg.asiento is not null) from pg),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('tipo', v.tipo, 'texto', v.texto, 'cuando', v.cuando, 'quien', v.quien_name) order by v.cuando)
       from public.conta_recibo_evento v join r on v.recibo_id = r.id where v.account_id = p_cuenta), '[]'::jsonb),
    'verifactu', (select jsonb_build_object('estado', g.estado, 'entorno', g.entorno, 'huella', g.huella, 'anterior', g.anterior_num_serie,
        'generado_at', g.generado_at, 'respondido_at', g.respondido_at)
       from public.verifactu_registro g where g.account_id = p_cuenta and g.invoice_id = p_factura order by g.generado_at desc limit 1),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('tipo', a.tipo, 'id', a.id, 'fecha', a.entry_date, 'numero', a.number, 'estado', a.status,
        'apuntes', (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.code, 'nombre', c.name, 'debe', l.debit, 'haber', l.credit) order by l.position), '[]'::jsonb)
                      from public.journal_line l join public.company_account c on c.id = l.company_account_id
                     where l.entry_id = a.id and l.account_id = p_cuenta)) order by a.orden)
       from asientos a), '[]'::jsonb)
  ) end
$$;
revoke all on function public.conta_pantalla_factura_recibo(uuid, uuid) from public, anon;
grant execute on function public.conta_pantalla_factura_recibo(uuid, uuid) to authenticated;
comment on function public.conta_pantalla_factura_recibo(uuid, uuid) is
  'G05 · La ficha de una factura que sale de un recibo, en una sola lectura: el recibo, lo que le ha pasado, su Verifactu, el pago de GoCardless al banco y sus asientos (factura, cobro, ingreso y devolución) con sus apuntes. Null si no sale de un recibo. Con las políticas de quien llama.';
