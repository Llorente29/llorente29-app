-- Vuelta atrás de «El día se cierra a las 6:00» · 7 · lectura: quita el execute
-- explícito. Sigue pudiendo por PUBLIC mientras la función exista.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí: nada que quitar.';
    return;
  end if;
  if to_regprocedure('public.conta_cerrado_hasta(uuid, timestamptz)') is not null then
    revoke execute on function public.conta_cerrado_hasta(uuid, timestamptz) from conta_lectura;
  end if;
end $$;
