-- ============================================================================
-- C04b · Respuesta 6 · El Libro diario, como usuario, también pregunta la unidad
-- ----------------------------------------------------------------------------
-- cambia: public.conta_unidad_ventas · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
--
-- El fallo (e2e 180 de staging, 13/10): el Libro diario, al abrir, llama a
-- conta_dias_por_asentar como el usuario (authenticated). Desde la 0100 esa
-- función pregunta conta_unidad_ventas, y a conta_unidad_ventas se le había
-- quitado el permiso a authenticated: «permission denied» y la página sin
-- pintar. El cierre del día no lo notaba (corre como postgres); el ensayo
-- local tampoco (corría como superusuario, sin roles).
--
-- Arreglo: conta_unidad_ventas pasa a ser de quien llama (security invoker:
-- lee conta_ventas_canal con su RLS, la de su cuenta) y authenticated la
-- puede ejecutar. Mismo texto y misma firma; solo cambia quién la ejecuta.
-- La prueba de staging tiene ahora la parte 6: conta_dias_por_asentar llamada
-- COMO USUARIO de la cuenta A, con la regla puesta.
--
-- Vuelta atrás: supabase/vuelta-atras/20261020T0105_ventas_por_plataforma_permiso.down.sql
-- ============================================================================

create or replace function public.conta_unidad_ventas(p_company uuid, p_canal uuid, p_marca uuid)
returns text language sql stable security invoker set search_path = public as $$
  select coalesce(p_canal::text, 'sin-canal')
      || case when p_marca is not null and exists (select 1 from public.conta_ventas_canal v
                                                    where v.company_id = p_company and v.channel_id = p_canal and v.por_marca)
              then ':' || p_marca::text else '' end
$$;
revoke all on function public.conta_unidad_ventas(uuid, uuid, uuid) from public, anon;
grant execute on function public.conta_unidad_ventas(uuid, uuid, uuid) to authenticated;
