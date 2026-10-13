-- Vuelta atrás de 20261020T0140: conta_lectura deja de leer el registro del cierre.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    revoke select on table public.sales_day_proposal_log from conta_lectura;
  end if;
end $$;
