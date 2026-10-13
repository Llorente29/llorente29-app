-- Vuelta atrás de 20261020T0105: conta_unidad_ventas, como la dejó la 0100
-- (security definer, sin permiso para authenticated). OJO: con eso el Libro
-- diario vuelve a fallar al abrir mientras la 0100 esté puesta; esta vuelta
-- atrás solo tiene sentido seguida de la de la 0100.
create or replace function public.conta_unidad_ventas(p_company uuid, p_canal uuid, p_marca uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p_canal::text, 'sin-canal')
      || case when p_marca is not null and exists (select 1 from public.conta_ventas_canal v
                                                    where v.company_id = p_company and v.channel_id = p_canal and v.por_marca)
              then ':' || p_marca::text else '' end
$$;
revoke all on function public.conta_unidad_ventas(uuid, uuid, uuid) from public, anon, authenticated;
