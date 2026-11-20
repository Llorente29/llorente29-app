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

-- N11 (20/11) · Las tres recibidas de la D01 (supabase/seeds/conta/seed_d01_staging.sql) se
-- sembraron sin el destinatario en su lectura. Desde el E03 (#727), una recibida sin destinatario
-- leído pregunta «¿De quién es?» y se va a «Por aclarar», y la e2e de la D01 las busca en «Por
-- revisar» (noche del 19/11, 44501328392). Van a nombre de su empresa, como dice ya la semilla:
-- aquí, en el carril, con el nombre y el NIF de SU empresa (la del carril, regla 9).
do $$
declare n int := current_setting('e2e.carril')::int;
begin
  update public.supplier_invoice si
     set reading = jsonb_set(si.reading, '{factura,destinatario}', jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id))
    from public.company c
   where c.id = si.company_id and c.account_id = si.account_id
     and si.id in (select pg_temp.en_carril(x, n) from unnest(array['d0100000-0000-4000-8000-0000000000f1', 'd0100000-0000-4000-8000-0000000000f2',
                                                                   'd0100000-0000-4000-8000-0000000000f3']::uuid[]) x)
     and si.reading ? 'factura' and not (si.reading->'factura' ? 'destinatario');
end $$;

-- N11 (20/11) · Los certificados de la asesoría P01 dependen de «hoy» (supabase/seeds/conta/
-- seed_p01_despacho_staging.sql, «se recalcula cada vez que se pasa la semilla»), y la plantilla
-- se sembró hace semanas: el que tenía que caducar «en 6 días» ya había caducado, y p01/despacho
-- no encontraba «Certificado caduca en» (noche del 19/11). Aquí, en el carril, las mismas cuatro
-- caducidades que pone la semilla, contadas desde hoy.
do $$
declare n int := current_setting('e2e.carril')::int; r record;
begin
  for r in select * from (values ('ce1', interval '300 days', 'active'), ('ce2', interval '6 days', 'active'),
                                 ('ce3', interval '-10 days', 'expired'), ('ce4', interval '-3 days', 'expired')) v(sufijo, cuanto, estado) loop
    update public.tax_certificate set valid_to = now() + r.cuanto, status = r.estado
     where id = pg_temp.en_carril(('d5ac0000-0000-4000-8000-' || lpad(r.sufijo, 12, '0'))::uuid, n);
  end loop;
end $$;
