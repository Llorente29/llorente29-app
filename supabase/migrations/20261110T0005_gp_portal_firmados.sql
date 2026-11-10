-- supabase/migrations/20261110T0005_gp_portal_firmados.sql
-- cambia: public.conta_portal_documentos · prueba: supabase/staging/sql/20261110_gp_portal_firmados_prueba.sql
--
-- GP · nº 19, punto 1 (Code 3) · LO FIRMADO, EN DOCUMENTOS. Al firmar, el
-- portal dice «tú tienes la copia en Documentos», y Documentos no la enseñaba.
-- Cambia en caliente una función propia del portal (la misma firma, con
-- respaldo): conta_portal_documentos devuelve además «firmados», las
-- peticiones de firma ya hechas, con cuándo se firmó. El PDF firmado se abre con
-- conta_portal_archivo (tipo «peticion»), que ya lo da. Solo a quien tiene
-- «Todo» (quien puede firmar). Lo de antes, igual.
--
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0005_gp_portal_firmados.down.sql

select public._respaldar_funcion('public.conta_portal_documentos(uuid)', '20261110T0005_gp_portal_firmados');

create or replace function public.conta_portal_documentos(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party); v_prop uuid;
begin
  v_prop := public._conta_portal_cuenta_propia(y.account_id, y.party_id);
  return jsonb_build_object(
    'puede_subir', v_prop is not null,
    'impuestos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'modelo', t.form_code, 'ejercicio', t.fiscal_year, 'periodo', t.period,
        'presentado', t.filed_at, 'resultado', t.result_kind, 'importe', t.amount, 'justificante', t.receipt_document_path is not null)
        order by t.filed_at desc)
      from public.tax_return t where v_prop is not null and t.account_id = v_prop and t.filed_at is not null), '[]'::jsonb),
    'nominas', case when y.permiso <> 'todo' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.name,
        'carpeta', d.carpeta, 'trabajador', e.name, 'fecha', d.created_at) order by d.created_at desc)
      from public.documents d join public.employees e on e.id = d.employee_id
     where v_prop is not null and e.account_id = v_prop and d.carpeta in ('nominas', 'ss_sepe') and d.archivado_at is null), '[]'::jsonb) end,
    'subidas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'estado', s.estado, 'subida', s.created_at,
        'contabilizada', exists (select 1 from public.document_inbox di where di.id = s.document_inbox_id and di.status = 'factura'))
        order by s.created_at desc)
      from public.conta_portal_subida s where s.party_id = y.party_id), '[]'::jsonb),
    -- nº 19.1 · Lo firmado: la petición, cuándo se firmó y si ya está el PDF firmado.
    'firmados', case when y.permiso <> 'todo' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'titulo', q.titulo,
        'firmada', f.firmada_at, 'pdf', f.pdf_ruta is not null) order by f.firmada_at desc)
      from public.conta_portal_peticion q
      join lateral (select fi.firmada_at, fi.pdf_ruta from public.conta_portal_firma fi
                     where fi.peticion_id = q.id and fi.firmada_at is not null order by fi.firmada_at desc limit 1) f on true
     where q.party_id = y.party_id and q.tipo = 'firmar' and q.estado = 'hecha'), '[]'::jsonb) end);
end $$;
