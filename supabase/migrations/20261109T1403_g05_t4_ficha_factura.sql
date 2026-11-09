-- supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
--
-- G05 · Tarea 4 · La ficha de una factura que sale de un recibo (la maqueta
-- aprobada, Factura.dc.html): «Lo que ha pasado» y «En la contabilidad», en UNA
-- sola lectura (regla de Julio: toda pantalla abre en menos de 1 s).
-- SOLO AÑADE una función de lectura:
--   conta_pantalla_factura_recibo(p_cuenta, p_factura) → null si la factura no
--   sale de un recibo; si sale, su recibo (estado, fechas del aviso, del cargo y
--   del cobro, quién lo envió), lo que le ha pasado (conta_recibo_evento), su
--   registro de Verifactu (estado, entorno, huella y con cuál se encadena) y sus
--   asientos con sus apuntes: el de la factura, el del cobro y, si lo hay, el de
--   la devolución.
-- Es SECURITY INVOKER: lee con las políticas de quien la llama (cada tabla
-- filtra por su cuenta). Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1403_g05_t4_ficha_factura.down.sql

create or replace function public.conta_pantalla_factura_recibo(p_cuenta uuid, p_factura uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with r as (
    select x.* from public.conta_recibo x where x.account_id = p_cuenta and x.invoice_id = p_factura limit 1
  ), f as (
    select ci.id, ci.entry_id from public.customer_invoice ci where ci.account_id = p_cuenta and ci.id = p_factura
  ), asientos as (
    select q.tipo, q.orden, e.id, e.entry_date, e.number, e.status
      from (select 'factura'::text as tipo, 1 as orden, f.entry_id as id from f
            union all select 'cobro', 2, r.asiento_cobro from r
            union all select 'devolucion', 3, r.asiento_devolucion from r) q
      join public.journal_entry e on e.id = q.id and e.account_id = p_cuenta
  )
  select case when not exists (select 1 from r) then null else jsonb_build_object(
    'recibo', (select jsonb_build_object('id', r.id, 'company_id', r.company_id, 'mes', r.mes, 'estado', r.estado, 'gc_estado', r.gc_estado,
        'cobrar_cent', coalesce(r.cobrar_cent, r.total_cent), 'cargo_el', r.cargo_el, 'confirmado_el', r.confirmado_el,
        'enviado_at', r.enviado_at, 'enviado_por_name', r.enviado_por_name,
        'aviso_el', (select m.aviso_el from public.conta_cobro_mes m where m.company_id = r.company_id and m.mes = r.mes))
       from r),
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
  'G05 · La ficha de una factura que sale de un recibo, en una sola lectura: el recibo, lo que le ha pasado, su Verifactu y sus asientos (factura, cobro y devolución) con sus apuntes. Null si no sale de un recibo. Con las políticas de quien llama.';
