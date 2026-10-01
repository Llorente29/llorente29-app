-- ============================================================================
-- Un ensayo no es una publicación: `catalog_publish` admite 'dry_run' y las
-- 13 pruebas de Foodint dejan de contar como publicadas
-- ----------------------------------------------------------------------------
-- 01/10/2026. Deuda del parte «Pantalla de precios por canal».
--
-- PROPUESTA, SIN APLICAR. Claude Code propone; Julio ejecuta y verifica.
-- Está escrita con begin y SIN commit: se ejecuta, se miran las tres
-- comprobaciones del final y se decide commit o rollback a mano.
--
-- ── LO QUE PASA ─────────────────────────────────────────────────────────────
-- `hubrise-catalog-publish` con dry_run=true apuntaba su fila como 'pending'
-- y la cerraba como 'done', igual que una publicación real, con `note` vacía.
-- La única diferencia era que no escribe `catalog_publish_target`.
--
-- Y no es sólo historial: `getBrandPublishStatus` lee la ÚLTIMA fila de la
-- marca. Un ensayo después de unos cambios hacía decir «publicado» a la carta
-- sin que hubiera salido nada.
--
-- ── LO QUE SE MIDIÓ (01/10 ~10:00 Madrid) ───────────────────────────────────
-- Filas 'done' SIN ningún target: 13, todas de Foodint (51ad1792…); en Folvy
-- Interno, 0. En el código, el único camino que deja 'done' sin targets es el
-- del dry_run (la publicación real inserta un target por catálogo antes de
-- cerrar el estado). 10 de las 13 van seguidas, a menos de 30 s, de una
-- publicación real de la misma marca: es el ensayo que hace el panel antes de
-- publicar. Las otras 3: Scandal Burgers 19/08 10:01 y 11:14, y la de Meraki
-- Pita de hoy a las 09:58 (la prueba pedida por Julio).
--
-- Quién más toca la tabla, contado: 0 funciones, 0 vistas, 0 crons y 0
-- disparadores la nombran. Sólo la escribe `hubrise-catalog-publish` y sólo
-- la leen `publishStatusService.ts` (estado + historial) y nada más.
--
-- ── BANDA ───────────────────────────────────────────────────────────────────
-- El CHECK toma ACCESS EXCLUSIVE sobre `catalog_publish`. No está en el camino
-- del pedido (las cuatro cuentas de arriba), pero va igualmente fuera de la
-- banda 12:15–00:30 porque bloquea publicar durante el instante del cambio.
--
-- ── ORDEN DE SALIDA (importa) ───────────────────────────────────────────────
-- 1. ESTA migración.  2. Fusionar la rama (despliega la función nueva).
-- Al revés, la función nueva insertaría 'dry_run' contra el CHECK viejo, el
-- ensayo devolvería 500 y el panel —que ensaya antes de publicar— no dejaría
-- publicar ninguna carta.
-- ============================================================================

begin;

-- ── 0 · Guarda: las 13 son las que se midieron, y siguen igual ──────────────
do $$
declare
  v_ids uuid[] := array[
    '9890d5dc-5f5b-4307-a800-f0a71455c4db',  -- 19/08 10:01 Scandal Burgers
    '9630b4ce-eade-4c9e-a2c2-6ab816b6b7b6',  -- 19/08 11:14 Scandal Burgers
    'a61481f1-fd75-4ef7-ae43-74b5eb63a5eb',  -- 21/08 09:44 Meraki Pita
    'f9050a28-8774-42fd-8b9e-3af05e52ff7c',  -- 21/08 10:50 Meraki Pita
    '5f2512a1-9f80-46e0-a41c-b55daf424b98',  -- 21/08 13:44 Meraki Pita
    '708d5e56-bb83-433b-aa06-f2c4c1b5ab55',  -- 27/08 17:45 Milanesa House
    '85386a7e-0181-4b77-8ff1-dbc914beed48',  -- 01/09 19:15 Bendito Burrito
    '3199d741-32b7-4401-ba95-e1fe2bc15a98',  -- 01/09 19:43 Scandal Burgers
    'a5d684cc-5701-4d53-868a-6f43b03ccc21',  -- 08/09 12:13 Lovers Burgers
    '584c9e08-e99e-41da-970d-66cf46185e2d',  -- 08/09 20:05 Smash Brothers Burgers
    '43b8755f-d9d7-423d-aeb3-2c9031e274cb',  -- 12/09 08:46 Mila's Sandwiches
    '6823efdb-2ee1-4aa8-9dec-94f253e14869',  -- 23/09 00:43 The Urban Kebab
    '2aef3195-8c33-4a76-a6f7-1e75d481b578'   -- 01/10 09:58 Meraki Pita (la prueba de hoy)
  ]::uuid[];
  v_ok int;
begin
  select count(*) into v_ok
  from public.catalog_publish p
  where p.id = any (v_ids)
    and p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'   -- Foodint
    and p.status = 'done'
    and not exists (select 1 from public.catalog_publish_target t where t.publish_id = p.id);
  if v_ok <> 13 then
    raise exception 'Se esperaban 13 ensayos de Foodint (done, sin targets) y hay %. Abortado.', v_ok;
  end if;
end $$;

-- ── 1 · El CHECK admite 'dry_run' ────────────────────────────────────────────
alter table public.catalog_publish drop constraint catalog_publish_status_check;
alter table public.catalog_publish add constraint catalog_publish_status_check
  check (status = any (array['pending', 'done', 'partial', 'failed', 'dry_run']));

comment on column public.catalog_publish.status is
  'pending | done | partial | failed = publicación real. dry_run = ensayo: no se envió nada a las plataformas y NO cuenta como publicación (01/10).';

-- ── 2 · Las 13 pasan a decir lo que fueron ───────────────────────────────────
update public.catalog_publish p
set status = 'dry_run',
    note = 'ensayo sin publicar (reclasificado el 01/10: estaba como done sin ningún target)'
where p.id = any (array[
    '9890d5dc-5f5b-4307-a800-f0a71455c4db', '9630b4ce-eade-4c9e-a2c2-6ab816b6b7b6',
    'a61481f1-fd75-4ef7-ae43-74b5eb63a5eb', 'f9050a28-8774-42fd-8b9e-3af05e52ff7c',
    '5f2512a1-9f80-46e0-a41c-b55daf424b98', '708d5e56-bb83-433b-aa06-f2c4c1b5ab55',
    '85386a7e-0181-4b77-8ff1-dbc914beed48', '3199d741-32b7-4401-ba95-e1fe2bc15a98',
    'a5d684cc-5701-4d53-868a-6f43b03ccc21', '584c9e08-e99e-41da-970d-66cf46185e2d',
    '43b8755f-d9d7-423d-aeb3-2c9031e274cb', '6823efdb-2ee1-4aa8-9dec-94f253e14869',
    '2aef3195-8c33-4a76-a6f7-1e75d481b578']::uuid[])
  and p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- ── 3 · Comprobaciones (pegar el resultado en el parte) ─────────────────────
-- (a) 13 ensayos, 0 'done' sin targets en toda la tabla (huella de tabla
--     entera, a propósito: no puede quedar ninguno en ninguna cuenta).
select
  (select count(*) from public.catalog_publish where status = 'dry_run')                    as ensayos,
  (select count(*) from public.catalog_publish p where p.status = 'done'
     and not exists (select 1 from public.catalog_publish_target t where t.publish_id = p.id)) as done_sin_targets;
-- esperado: ensayos = 13, done_sin_targets = 0

-- (b) Las publicaciones reales no se han movido: mismo recuento que antes.
select status, count(*) from public.catalog_publish
where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1 order by 1;
-- esperado (medido antes): done 97, dry_run 13, failed 4, partial 1

-- Si (a) y (b) cuadran:  commit;   si no:  rollback;
