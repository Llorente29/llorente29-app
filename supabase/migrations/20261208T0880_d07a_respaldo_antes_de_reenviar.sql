-- supabase/migrations/20261208T0880_d07a_respaldo_antes_de_reenviar.sql
--
-- D07a · EL RESPALDO DE LOS ENVÍOS QUE LA 0820 VUELVE A PONER A LA COLA, para
-- que su vuelta atrás los deje EXACTAMENTE como estaban (Julio, 23/10).
--
-- Por qué: el ensayo de la tanda 0820–0830 desde main (run 190, 14:48 UTC)
-- paró en «ENSAYO · la vuelta atrás automática funcionaría»: la vuelta atrás
-- de la 0820 ponía attempts = 3 pero dejaba en last_error el texto de la 0820
-- («Se vuelve a mandar con la descripción en 40 caracteres (D07a). Antes: …»)
-- y next_try_at en el momento de la tanda. Lo que cuenta la tanda
-- (cuentas/d07ac-diez-y-prepago.sql) salía distinto: «pendientes por la
-- descripción» 65 → 0 y «con el motivo de la 0820» 0 → 65. No era la cola:
-- medido a las 14:55 UTC (solo lectura), los 65 envíos de RIDERS tienen
-- attempts = 3 desde las 13:52 y la cola ya no los coge; y dentro de la
-- transacción del ensayo la cola no ve el cambio.
--
-- Qué hace: guarda, de cada envío que la 0820 va a reponer (la MISMA selección
-- que la 0820), su estado de antes —attempts, next_try_at, last_error y
-- updated_at— en una tabla nueva, public.conta_respaldo_d07a_envios. La
-- vuelta atrás de la 0820 lo devuelve de ahí, byte a byte, a los que sigan
-- «pendiente» con el motivo de la 0820 (los que ya llegaron a Diez se quedan:
-- están allí). Va ANTES que la 0820 en la tanda (supabase/produccion/aplicar.txt).
--
-- Solo añade: una tabla nueva, con RLS y sin políticas (solo la lee quien
-- aplica). Anclado por cuenta y proveedor (regla 9): Foodint y RIDERS. En
-- staging, la tabla vacía. No toca el camino del pedido, ni coste ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0880_d07a_respaldo_antes_de_reenviar.down.sql
create table if not exists public.conta_respaldo_d07a_envios (
  id uuid primary key,
  attempts smallint not null,
  next_try_at timestamptz,
  last_error text,
  updated_at timestamptz not null,
  guardado_at timestamptz not null default now()
);
comment on table public.conta_respaldo_d07a_envios is
  'D07a (0880). El estado de antes de los envíos que la 0820 vuelve a poner a la cola, para que su vuelta atrás los deje como estaban.';
alter table public.conta_respaldo_d07a_envios enable row level security;
revoke all on table public.conta_respaldo_d07a_envios from anon, authenticated;

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_prov constant uuid := 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D07a 0880: esta base no tiene la cuenta de Foodint (staging): el respaldo queda vacío.';
    return;
  end if;
  -- La misma selección que la 0820.
  insert into public.conta_respaldo_d07a_envios (id, attempts, next_try_at, last_error, updated_at)
  select x.id, x.attempts, x.next_try_at, x.last_error, x.updated_at
    from public.external_send x
    join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id and e.source_type = 'supplier_invoice'
    join public.supplier_invoice i on i.id = e.source_id and i.account_id = x.account_id
   where x.account_id = v_acc and i.supplier_id = v_prov and x.kind = 'factura' and x.status = 'pendiente'
     and x.last_error not like 'Se vuelve a mandar%'
     and (x.last_error ilike '%factura.Descripcion%' or x.last_error ilike '%intento anterior: Diez no ha aceptado la factura%')
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'D07a 0880: % envíos de RIDERS respaldados antes de volver a la cola.', v_n;
end $$;
