-- ============================================================================
-- C04b · Respuesta 5 · conta_lectura lee el registro del cierre del día
-- ----------------------------------------------------------------------------
-- El agente «Libro diario» avisa de un día cerrado sin asiento («el cierre del
-- día no lo ha propuesto»), pero el porqué estaba solo en el Libro diario. Con
-- esto, el aviso lo lleva: lo que apuntó el cierre la última vez en
-- sales_day_proposal_log (propuesto, sin propuesta y por qué, fallo…).
-- (Lo pidió el rojo de la empresa B de staging del 12/10: un día de 186 h sin
-- asiento cuyo porqué el aviso no decía.)
-- Solo da permiso de lectura: sigue.
-- Vuelta atrás: supabase/vuelta-atras/20261020T0140_libro_lectura_registro.down.sql
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant select on table public.sales_day_proposal_log to conta_lectura;
  raise notice 'conta_lectura lee sales_day_proposal_log (agente «Libro diario», el porqué del día sin asiento).';
end $$;
