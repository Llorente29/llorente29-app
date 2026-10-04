-- Guarda de 20261005T0110_r02_filas_migradas.down.sql: sin las filas migradas,
-- una resolución que las lea daría la herencia (Smash y Lovers, «Nosotros»).
-- Solo se quitan si los lectores ya han vuelto a los de antes (vuelta atrás
-- de la 0120). SOLO LEE.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'resolve_dispatch'
                and p.prosrc not like '%marca_reparte_propio%') then
    raise exception 'VUELTA ATRÁS 0110 (R02): resolve_dispatch todavía es el del R02. Primero la vuelta atrás de 20261005T0120. No se toca nada.';
  end if;
end $$;
