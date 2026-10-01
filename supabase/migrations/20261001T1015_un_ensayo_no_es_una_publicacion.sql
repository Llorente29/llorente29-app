-- ============================================================================
-- Un ensayo no es una publicación: `catalog_publish` admite 'dry_run' y las
-- 13 pruebas de Foodint dejan de contar como publicadas
-- ----------------------------------------------------------------------------
-- 01/10/2026. Deuda del parte «Pantalla de precios por canal».
--
-- APLICADA el 01/10/2026 a las 10:2x (Madrid) por Julio, a mano en el SQL
-- Editor, Run 1 y Run 2 tal cual. Comprobado por Julio y repetido por Claude
-- Code a las 10:29: C1 CHECK con dry_run, C2 = 13, C3 = 0, C4 = 97.
--
-- PARA APLICAR A MANO EN EL SQL EDITOR. Sin begin/commit: el editor los
-- descarta sin avisar (folvy_reglas §3). La atomicidad la da que cada Run es
-- UN solo bloque `do $$ … $$`: si la guarda o el recuento fallan, el bloque
-- lanza una excepción y no queda nada a medias.
--
-- Dos Run, EN ESTE ORDEN, y después cuatro comprobaciones, una por Run.
--
-- ── LO QUE PASA ─────────────────────────────────────────────────────────────
-- `hubrise-catalog-publish` con dry_run=true apuntaba su fila como 'pending'
-- y la cerraba como 'done', igual que una publicación real, con `note` vacía.
-- La única diferencia: no escribe `catalog_publish_target`. Y
-- `getBrandPublishStatus` lee la ÚLTIMA fila de la marca, así que un ensayo
-- podía hacer decir «publicado» a la carta sin que hubiera salido nada.
--
-- ── LO QUE SE MIDIÓ (01/10 ~10:00 Madrid) ───────────────────────────────────
-- 'done' SIN ningún target: 13, todas de Foodint (51ad1792…); Folvy Interno, 0.
-- El único camino que deja 'done' sin targets es el del dry_run. 10 de las 13
-- van seguidas a <30 s de una publicación real de la misma marca (el ensayo
-- del panel). Las otras 3: Scandal Burgers 19/08 10:01 y 11:14, y Meraki Pita
-- 01/10 09:58 (la prueba pedida por Julio). Foodint antes: done 110 (= 97
-- reales + 13 ensayos), failed 4, partial 1.
--
-- Quién más toca la tabla, contado: 0 funciones, 0 vistas, 0 crons y 0
-- disparadores. La escribe sólo `hubrise-catalog-publish`; la lee sólo
-- `publishStatusService.ts`.
--
-- ── BANDA ───────────────────────────────────────────────────────────────────
-- El CHECK toma ACCESS EXCLUSIVE sobre `catalog_publish`. No está en el camino
-- del pedido (las cuatro cuentas de arriba), pero va fuera de 12:15–00:30
-- porque bloquea publicar durante el instante del cambio.
--
-- ── ORDEN DE SALIDA ─────────────────────────────────────────────────────────
-- 1. Run 1 y Run 2.  2. Las comprobaciones.  3. Fusionar la rama.
-- Al revés, la función nueva insertaría 'dry_run' contra el CHECK viejo, el
-- ensayo devolvería 500 y el panel —que ensaya antes de publicar— no dejaría
-- publicar ninguna carta.
--
-- ENSAYADA el 01/10 contra la base viva, entera y revertida: guarda 13,
-- actualizadas 13, un insert 'dry_run' pasa el CHECK, done sin targets 0,
-- Foodint done 97 / dry_run 13 / failed 4 / partial 1. Después del ensayo:
-- CHECK viejo y recuentos intactos.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- RUN 1 · El CHECK admite 'dry_run'
-- Antes de tocar nada, comprueba que las 13 siguen siendo las medidas. Si no
-- casan, aborta y el CHECK se queda como estaba.
-- ════════════════════════════════════════════════════════════════════════════
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
    raise exception 'RUN 1 ABORTADO: se esperaban 13 ensayos de Foodint (done, sin targets) y hay %. No se ha tocado nada.', v_ok;
  end if;

  alter table public.catalog_publish drop constraint catalog_publish_status_check;
  alter table public.catalog_publish add constraint catalog_publish_status_check
    check (status = any (array['pending', 'done', 'partial', 'failed', 'dry_run']));

  comment on column public.catalog_publish.status is
    'pending | done | partial | failed = publicación real. dry_run = ensayo: no se envió nada a las plataformas y NO cuenta como publicación (01/10).';

  raise notice 'RUN 1 OK: guarda 13/13, CHECK con dry_run.';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN 2 · Las 13 pasan a decir lo que fueron
-- Repite la guarda (por id Y cuenta) y exige que el UPDATE toque exactamente
-- 13 filas. Si no, aborta y no queda ninguna cambiada. Lanzado dos veces, la
-- segunda aborta (ya no están en 'done'): es inofensivo.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_ids uuid[] := array[
    '9890d5dc-5f5b-4307-a800-f0a71455c4db', '9630b4ce-eade-4c9e-a2c2-6ab816b6b7b6',
    'a61481f1-fd75-4ef7-ae43-74b5eb63a5eb', 'f9050a28-8774-42fd-8b9e-3af05e52ff7c',
    '5f2512a1-9f80-46e0-a41c-b55daf424b98', '708d5e56-bb83-433b-aa06-f2c4c1b5ab55',
    '85386a7e-0181-4b77-8ff1-dbc914beed48', '3199d741-32b7-4401-ba95-e1fe2bc15a98',
    'a5d684cc-5701-4d53-868a-6f43b03ccc21', '584c9e08-e99e-41da-970d-66cf46185e2d',
    '43b8755f-d9d7-423d-aeb3-2c9031e274cb', '6823efdb-2ee1-4aa8-9dec-94f253e14869',
    '2aef3195-8c33-4a76-a6f7-1e75d481b578'
  ]::uuid[];
  v_ok int;
  v_upd int;
begin
  select count(*) into v_ok
  from public.catalog_publish p
  where p.id = any (v_ids)
    and p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'   -- Foodint
    and p.status = 'done'
    and not exists (select 1 from public.catalog_publish_target t where t.publish_id = p.id);
  if v_ok <> 13 then
    raise exception 'RUN 2 ABORTADO: se esperaban 13 ensayos de Foodint (done, sin targets) y hay %. No se ha tocado nada.', v_ok;
  end if;

  update public.catalog_publish p
  set status = 'dry_run',
      note = 'ensayo sin publicar (reclasificado el 01/10: estaba como done sin ningún target)'
  where p.id = any (v_ids)
    and p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and p.status = 'done'
    and not exists (select 1 from public.catalog_publish_target t where t.publish_id = p.id);
  get diagnostics v_upd = row_count;
  if v_upd <> 13 then
    raise exception 'RUN 2 ABORTADO: el UPDATE tocó % filas y tenían que ser 13. Deshecho.', v_upd;
  end if;

  raise notice 'RUN 2 OK: 13 filas pasan a dry_run.';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIONES · una por Run, en cualquier orden
-- ════════════════════════════════════════════════════════════════════════════

-- C1 · El CHECK nuevo.
-- Tiene que salir EXACTAMENTE:
--   CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'partial'::text, 'failed'::text, 'dry_run'::text])))
select pg_get_constraintdef(oid) as check_status
from pg_constraint
where conrelid = 'public.catalog_publish'::regclass
  and conname = 'catalog_publish_status_check';

-- C2 · Ensayos de Foodint.  Tiene que salir: 13
select count(*) as ensayos_foodint
from public.catalog_publish
where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and status = 'dry_run';

-- C3 · 'done' sin ningún catálogo publicado.  Tiene que salir: 0
-- TABLA ENTERA, a propósito (todas las cuentas): no puede quedar ninguno.
select count(*) as done_sin_catalogo_publicado
from public.catalog_publish p
where p.status = 'done'
  and not exists (select 1 from public.catalog_publish_target t where t.publish_id = p.id);

-- C4 · Publicaciones reales de Foodint en 'done'.  Tiene que salir: 97
select count(*) as done_foodint
from public.catalog_publish
where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and status = 'done';
