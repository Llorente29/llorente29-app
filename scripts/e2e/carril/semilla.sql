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

-- F01 (28/10) · Las tiendas de Last del carril, enlazadas otra vez con su carta.
-- La carta de Last guarda su tienda como uuid (external_catalog_product.
-- external_location_id) y el mapa de locales como texto (external_location_map.
-- external_location_id, único en TODA la base). El clon le pone «-cN» al del
-- mapa y deja el de la carta como estaba: en el carril ninguna tienda casa con su
-- local, la marca sale «sin local» y el aviso de Inicio no aparece (e2e #1002,
-- alta-last.spec.ts). Aquí, a cada tienda de Last del carril que el clon marcó
-- con «-cN» y era un uuid, su uuid de carril (en_carril, como cualquier id de la
-- plantilla), el mismo en el mapa y en la carta. Una tienda de la carta sin mapa
-- (la «sin local» de la prueba) se queda como está.
do $$
declare
  n int := current_setting('e2e.carril')::int;
  r record;
begin
  for r in
    select m.id, m.account_id, left(m.external_location_id, 36)::uuid as viejo
      from public.external_location_map m
     where m.source = 'lastapp'
       and m.account_id in (select pg_temp.en_carril(c.id, n) from _plantilla_cuentas c)
       and m.external_location_id ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-c' || n || '$')
  loop
    update public.external_location_map set external_location_id = pg_temp.en_carril(r.viejo, n)::text where id = r.id;
    update public.external_catalog_product set external_location_id = pg_temp.en_carril(r.viejo, n)
     where account_id = r.account_id and source = 'lastapp' and external_location_id = r.viejo;
  end loop;
end $$;
