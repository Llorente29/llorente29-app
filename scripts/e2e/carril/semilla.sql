-- ============================================================================
-- scripts/e2e/carril/semilla.sql — las semillas que se repiten en CADA e2e,
-- pasadas al carril. Va detrás de clonar.sql, en la misma transacción.
-- ----------------------------------------------------------------------------
-- Hoy, una: el escenario del R02 (supabase/seeds/reparto/seed_r02_e2e.sql),
-- que deja dos pedidos vivos «de hoy» (el feed solo enseña el día de negocio).
-- Antes se sembraba en la cuenta A de todos; ahora, en la A del carril: cada
-- uuid de la plantilla (los de las semillas, «xxxxxxxx-0000-4000-8000-…») pasa
-- al del carril aunque todavía no exista, para que dos carriles no compartan
-- ni un id. Con disparadores, como se sembraba antes.
-- ============================================================================

create function pg_temp.mt_semilla(t text) returns text language plpgsql stable as $f$
declare r text := t; m text; n int := current_setting('e2e.carril')::int;
begin
  for m in select distinct (regexp_matches(t, '[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}', 'g'))[1] loop
    r := replace(r, m, pg_temp.en_carril(m::uuid, n)::text);
  end loop;
  -- Y lo demás que es de la plantilla (los ids al azar, los correos), como en el clon.
  return pg_temp.mt(r);
end $f$;

-- Con disparadores y claves ajenas otra vez (el clon ya está entero y
-- comprobado). Tiene que ser un SET: supautils no deja cambiarlo desde plpgsql.
set local session_replication_role = origin;

do $$
begin
  if coalesce(current_setting('e2e.semilla', true), '') = '' then return; end if;
  execute pg_temp.mt_semilla(current_setting('e2e.semilla'));
end $$;
