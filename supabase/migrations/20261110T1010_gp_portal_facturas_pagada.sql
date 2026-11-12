-- supabase/migrations/20261110T1010_gp_portal_facturas_pagada.sql
-- cambia: public.conta_portal_facturas · prueba: supabase/staging/sql/20261110_gp_portal_facturas_pagada_prueba.sql
-- cambia: public.conta_portal_inicio · prueba: supabase/staging/sql/20261110_gp_portal_facturas_pagada_prueba.sql
--
-- GP · nº 24, punto 2 (Code 3) · LAS FACTURAS COMO LA MAQUETA. Cambia en
-- caliente dos funciones propias del portal (la misma firma, con respaldo):
--   · conta_portal_facturas trae lo que lleva cada factura (los conceptos de
--     sus líneas: el portal los dice en la calle, «Gestoría y laboral (4
--     trabajadores)») y el día en que se pagó.
--   · conta_portal_inicio: la factura de «Lo último» dice «Pagada el 4 de
--     diciembre» cuando está pagada. Va ENCIMA de la 0945 (lo hecho y las
--     nóminas en Inicio): si la 0945 no está aplicada, para.
-- Pagada el: el día del cargo del recibo cobrado; si no, el último cobro
-- apuntado en la factura; si no, el día que se pagó con el enlace. Un devuelto
-- sin pagar no está pagado.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1010_gp_portal_facturas_pagada.down.sql

do $$ begin
  if position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) = 0 then
    raise exception 'GP-1010: falta la 0945 (Inicio con lo hecho). Qué hacer: aplica antes la tanda de conta/gp-portal-inicio-hecho.';
  end if;
end $$;

select public._respaldar_funcion('public.conta_portal_facturas(uuid)', '20261110T1010_gp_portal_facturas_pagada');
select public._respaldar_funcion('public.conta_portal_inicio(uuid)', '20261110T1010_gp_portal_facturas_pagada');

create or replace function public.conta_portal_facturas(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party);
begin
  return jsonb_build_object('facturas', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'numero', f.number_text, 'fecha', f.issue_date, 'anio', extract(year from f.issue_date)::int,
      'tipo', f.doc_type, 'base', f.base, 'iva', f.tax, 'retencion', f.withholding_amount, 'total', f.total,
      'concepto', coalesce(r.mes, f.notes), 'recibo_mes', r.mes, 'tiene_pdf', f.pdf_path is not null,
      -- nº 24 · 2 · Lo que lleva cada factura («Gestoría y laboral (4 trabajadores)», «… · Cuentas anuales») y cuándo se pagó.
      'lineas', coalesce((select jsonb_agg(l.concept order by l.position) from public.customer_invoice_line l where l.invoice_id = f.id and l.concept is not null), '[]'::jsonb),
      'pagada', case when r.estado in ('devuelto', 'retrocedido') and not public._conta_portal_devuelto_pagado(r.id) then null
        else coalesce(case when r.estado in ('cobrado', 'facturado') then r.confirmado_el end,
                      (select max(p.paid_on) from public.customer_invoice_payment p where p.invoice_id = f.id),
                      (select max((e.pagado_at at time zone 'Europe/Madrid')::date) from public.conta_enlace_pago e
                        where e.invoice_id = f.id and e.pagado_at is not null)) end,
      'estado', case
        when r.estado in ('devuelto', 'retrocedido') and not public._conta_portal_devuelto_pagado(r.id) then 'Devuelta'
        when r.estado in ('cobrado', 'facturado', 'devuelto', 'retrocedido') then 'Pagada'
        when exists (select 1 from public.conta_enlace_pago e where e.invoice_id = f.id and e.pagado_at is not null) then 'Pagada'
        else 'Pendiente' end)
      order by f.issue_date desc, f.number desc)
    from public.customer_invoice f
    left join public.conta_recibo r on r.invoice_id = f.id
   where f.account_id = y.account_id and f.party_id = y.party_id and f.status = 'emitida'), '[]'::jsonb));
end $$;

create or replace function public.conta_portal_inicio(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party); todo boolean; a uuid; c uuid; v_prop uuid;
begin
  todo := y.permiso = 'todo'; a := y.account_id; c := y.party_id; v_prop := public._conta_portal_cuenta_propia(a, c);
  return jsonb_build_object(
    'gestoria', public._conta_portal_marca(a, c),
    'cliente', (select jsonb_build_object('id', p.id, 'nombre', p.name, 'nif', p.tax_id) from public.party p where p.id = c),
    'yo', jsonb_build_object('nombre', coalesce(y.nombre, y.correo), 'correo', y.correo, 'permiso', y.permiso),
    -- nº 24 · Lo pendiente y, como en la maqueta, lo hecho en los últimos 14 días (tachado, «✓ Hecho»), con cuándo y lo recibido.
    'peticiones', case when todo then coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'tipo', q.tipo, 'titulo', q.titulo, 'detalle', q.detalle,
                     'fecha_limite', q.fecha_limite, 'creada', q.created_at, 'estado', q.estado, 'hecha', q.hecha_at,
                     'recibidas', (select count(*) from public.conta_portal_subida s where s.peticion_id = q.id))
                     order by (q.estado = 'hecha'), case when q.estado = 'pendiente' then q.fecha_limite end nulls last, q.hecha_at desc, q.created_at)
                     from public.conta_portal_peticion q where q.party_id = c
                      and (q.estado = 'pendiente' or (q.estado = 'hecha' and q.hecha_at > now() - interval '14 days'))), '[]'::jsonb) else '[]'::jsonb end,
    'proximo', case when todo then public._conta_portal_proximo(a, c) end,
    'devueltos', case when todo then public._conta_portal_devueltos(a, c) else '[]'::jsonb end,
    'pagar_devuelto', coalesce((select to_jsonb(j.pagar_devuelto) from public.conta_portal_ajustes j where j.account_id = a), '["banco"]'::jsonb),
    'mensajes_sin_leer', case when todo then (select count(*) from public.conta_portal_mensaje m where m.party_id = c and m.de = 'gestoria' and m.leido_at is null) else 0 end,
    'puede_subir', v_prop is not null,
    'novedades', coalesce((select jsonb_agg(z.n order by z.n ->> 'cuando' desc) from (select x.n from (
        -- nº 24 · 2 · «Factura 2026/1/141 · 157,30 € · Pagada el 4 de diciembre», como en la maqueta.
        (select jsonb_build_object('tipo', 'factura', 'id', f.id, 'titulo', 'Factura ' || f.number_text, 'total', f.total, 'cuando', f.issue_date::timestamptz,
                                   'pagada', case when r.estado in ('devuelto', 'retrocedido') and not public._conta_portal_devuelto_pagado(r.id) then null
                                     else coalesce(case when r.estado in ('cobrado', 'facturado') then r.confirmado_el end,
                                                   (select max(p.paid_on) from public.customer_invoice_payment p where p.invoice_id = f.id),
                                                   (select max((e.pagado_at at time zone 'Europe/Madrid')::date) from public.conta_enlace_pago e
                                                     where e.invoice_id = f.id and e.pagado_at is not null)) end)
           from public.customer_invoice f left join public.conta_recibo r on r.invoice_id = f.id
          where f.account_id = a and f.party_id = c and f.status = 'emitida' order by f.issue_date desc limit 3)
        union all
        (select jsonb_build_object('tipo', 'impuesto', 'id', t.id, 'titulo', t.form_code, 'periodo', t.period, 'ejercicio', t.fiscal_year,
                                   'importe', t.amount, 'resultado', t.result_kind, 'cuando', t.filed_at)
           from public.tax_return t where v_prop is not null and t.account_id = v_prop and t.filed_at is not null order by t.filed_at desc limit 2)
        union all
        (select jsonb_build_object('tipo', 'alta', 'id', s.id, 'titulo', s.empleado_nombre, 'alta', s.tipo, 'estado', s.estado,
                                   'desde', coalesce(s.fecha_efecto, s.mes), 'cuando', s.resuelta_at)
           from public.conta_solicitud s where todo and s.account_id = a and s.party_id = c and s.estado <> 'pedida' order by s.resuelta_at desc limit 2)
        union all
        -- nº 24 · Las nóminas del último mes que dejó la gestoría («Nóminas de octubre listas · 4 nóminas»).
        (select jsonb_build_object('tipo', 'nomina', 'id', to_char(g.mes, 'YYYY-MM'), 'titulo', to_char(g.mes, 'YYYY-MM'), 'n', g.n, 'cuando', g.ultima)
           from (select date_trunc('month', d.created_at at time zone 'Europe/Madrid') mes, count(*) n, max(d.created_at) ultima
                   from public.documents d join public.employees e on e.id = d.employee_id
                  where todo and v_prop is not null and e.account_id = v_prop and d.carpeta = 'nominas' and d.archivado_at is null
                  group by 1 order by 1 desc limit 1) g)
        union all
        (select jsonb_build_object('tipo', 'mensaje', 'id', m.id, 'titulo', left(m.texto, 120), 'cuando', m.created_at)
           from public.conta_portal_mensaje m where todo and m.party_id = c and m.de = 'gestoria' order by m.created_at desc limit 1)
      ) x(n) where x.n ->> 'cuando' is not null order by x.n ->> 'cuando' desc limit 6) z), '[]'::jsonb)
  );
end $$;
