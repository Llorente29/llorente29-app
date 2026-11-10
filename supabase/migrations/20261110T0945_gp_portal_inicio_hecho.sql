-- supabase/migrations/20261110T0945_gp_portal_inicio_hecho.sql
-- cambia: public.conta_portal_inicio · prueba: supabase/staging/sql/20261110_gp_portal_inicio_hecho_prueba.sql
--
-- GP · nº 24, puntos 1 y 4 (Code 3) · INICIO COMO LA MAQUETA. Cambia en
-- caliente una función propia del portal (la misma firma, con respaldo):
--   1. «Lo que te pide tu gestoría» sigue enseñando lo hecho en los últimos 14
--      días (la maqueta lo tacha: «✓ Firmada · Firmada hoy», «✓ Hecho ·
--      Recibidas: 12 facturas»): cada petición trae su estado, cuándo se hizo y
--      cuántos documentos se recibieron. Lo pendiente, como antes y primero.
--   4. «Lo último de tu gestoría» trae las nóminas del último mes que dejó la
--      gestoría («Nóminas de octubre listas · 4 nóminas»). Solo a quien tiene
--      «Todo», como las nóminas de Documentos.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0945_gp_portal_inicio_hecho.down.sql

select public._respaldar_funcion('public.conta_portal_inicio(uuid)', '20261110T0945_gp_portal_inicio_hecho');

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
        (select jsonb_build_object('tipo', 'factura', 'id', f.id, 'titulo', 'Factura ' || f.number_text, 'total', f.total, 'cuando', f.issue_date::timestamptz)
           from public.customer_invoice f where f.account_id = a and f.party_id = c and f.status = 'emitida' order by f.issue_date desc limit 3)
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
