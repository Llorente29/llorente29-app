-- supabase/migrations/20261130T0440_inventario_anula_auditorias_viejas.sql
-- cambia: public.inventario_anulacion_20261021 · prueba: supabase/staging/sql/20261130_inventario_anula_auditorias_prueba.sql
--
-- INVENTARIO · ANULA TRES INVENTARIOS DE SEGURIDAD VIEJOS (decisión de Julio,
-- 21/10/2026, después de la tanda del autoconteo).
--
-- El número lo dio Julio el 21/10: la 0410 es de riders y la 0420–0430 del
-- #216; esta es la siguiente libre.
--
-- QUÉ HAY Y POR QUÉ SE ANULA (medido en producción, solo lectura, 21/10):
--   Tres inventarios de seguridad (kind = 'audit') de Foodint, en «en_revision»
--   desde hace semanas, con todo contado y sin ningún movimiento de stock:
--
--   · INV-00258 (25/09):  88 de 88 contados, 52 piden motivo.
--   · INV-00259 (25/09):  92 de 92 contados, 45 piden motivo.
--   · INV-00283 (04/10): 120 de 120 contados, 56 piden motivo.
--
--   No estaban entre los 23 de la 0390 porque no son autoconteos: un
--   inventario de seguridad pide motivo y lo aprueba la oficina, y la noche no
--   los toca. 299 de sus 300 artículos se han vuelto a contar y aprobar
--   después: aplicarlos ahora metería cifras de hace semanas por debajo de
--   recuentos más nuevos y movería el stock de hoy. El único sin recuento
--   posterior (INV-00259, «Caja Hamburguesa Chivuos», Carabanchel, inactivo)
--   lo decide Julio aparte.
--
-- ANULAR NO TOCA EL STOCK: ninguno tiene movimientos, y el fichero comprueba
-- que siguen sin tenerlos después de anularlos (que ningún disparador del
-- cambio de estado los escriba). No mira el libro entero de la cuenta: las
-- ventas escriben en él mientras corre el fichero.
--
-- GUARDA: cada fila tiene que estar EXACTAMENTE como se midió (cuenta, tipo,
-- estado, líneas contadas y cero movimientos). Si una no lo está —alguien la
-- ha tocado desde el 21/10— el fichero entero se para y no anula nada: lo
-- vuelve a decidir Julio.
--
-- EN STAGING no hay Foodint: no hace nada y lo dice. La prueba de staging
-- (20261130_inventario_anula_auditorias_prueba.sql) lo ejecuta de verdad sobre
-- la cuenta A diciéndole qué filas esperar con inventario_0440.esperado; con
-- ese ajuste puesto, en una base con cuentas de producción, para.
--
-- Lo de antes queda en public.inventario_anulacion_20261021 (estado, notas y
-- fecha de cada fila) para la vuelta atrás. Sin RLS abierta y sin permisos para
-- la API: nadie la lee desde fuera.
--
-- Nada del camino del pedido: inventory_count no lo lee ninguna venta.
-- Vuelta atrás: supabase/vuelta-atras/20261130T0440_inventario_anula_auditorias_viejas.down.sql

create table public.inventario_anulacion_20261021 (
  inventory_count_id uuid primary key,
  account_id uuid not null,
  code text,
  status_antes text not null,
  notes_antes text,
  updated_at_antes timestamptz not null,
  anulado_at timestamptz not null default now()
);
alter table public.inventario_anulacion_20261021 enable row level security;
revoke all on public.inventario_anulacion_20261021 from public, anon, authenticated;

do $$
declare
  c_foodint constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_prueba text := nullif(current_setting('inventario_0440.esperado', true), '');
  v_mal text := '';
  v_n int;
  v_esperados int;
  v_movs int;
  r record;
begin
  create temp table _esperado (id uuid primary key, code text, account_id uuid, status text, contadas int) on commit drop;

  if v_prueba is not null then
    -- Solo la prueba de staging. En una base con cuentas de producción, NUNCA.
    if exists (select 1 from public.accounts where id in (c_foodint, '00000000-0000-0000-0000-000000000001')) then
      raise exception 'inventario 0440: inventario_0440.esperado solo vale en staging, y esta base tiene cuentas de producción.';
    end if;
    insert into _esperado
    select (x->>'id')::uuid, x->>'code', (x->>'account_id')::uuid, x->>'status', (x->>'contadas')::int
      from jsonb_array_elements(v_prueba::jsonb) x;
  else
    if not exists (select 1 from public.accounts where id = c_foodint) then
      raise notice 'inventario 0440: aquí no está Foodint (staging): no se anula nada.';
      return;
    end if;
    insert into _esperado values
      ('a9d1ba49-9d5e-47a3-b4e4-d451218d4d26', 'INV-00258', c_foodint, 'en_revision',  88),
      ('3959507e-184d-4a02-bb62-c4a00f7b69bf', 'INV-00259', c_foodint, 'en_revision',  92),
      ('b6b1a5de-2176-47fa-b378-60b2ed685744', 'INV-00283', c_foodint, 'en_revision', 120);
  end if;
  select count(*) into v_esperados from _esperado;

  for r in
    select e.*, ic.id is not null as existe, ic.kind, ic.status as status_hoy, ic.account_id as cuenta_hoy,
           (select count(*) from public.inventory_count_line l
             where l.inventory_count_id = e.id and l.counted_qty is not null)::int as contadas_hoy,
           (select count(*) from public.stock_movement m
             where m.source_type = 'inventory_count' and m.source_id = e.id)::int as movimientos
      from _esperado e left join public.inventory_count ic on ic.id = e.id
     order by e.code
  loop
    if not r.existe then
      v_mal := v_mal || format(' %s no existe;', r.code);
    elsif r.cuenta_hoy <> r.account_id or r.kind <> 'audit' or r.status_hoy <> r.status
          or r.contadas_hoy <> r.contadas or r.movimientos <> 0 then
      v_mal := v_mal || format(' %s está %s/%s con %s contadas y %s movimientos (se midió audit/%s con %s y 0);',
                               r.code, r.kind, r.status_hoy, r.contadas_hoy, r.movimientos, r.status, r.contadas);
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'inventario 0440: no se anula nada, hay filas que ya no están como se midieron el 21/10:%', v_mal;
  end if;

  insert into public.inventario_anulacion_20261021 (inventory_count_id, account_id, code, status_antes, notes_antes, updated_at_antes)
  select ic.id, ic.account_id, ic.code, ic.status, ic.notes, ic.updated_at
    from public.inventory_count ic join _esperado e on e.id = ic.id and e.account_id = ic.account_id;

  update public.inventory_count ic
     set status = 'anulado',
         notes = concat_ws(E'\n', ic.notes,
           'Anulado el 21/10/2026 por decisión de Julio: inventario de seguridad sin aprobar desde hace semanas. '
           || 'Sus artículos se volvieron a contar y aprobar después; aplicarlo ahora movería el stock de hoy.'),
         updated_at = now()
    from _esperado e
   where e.id = ic.id and e.account_id = ic.account_id
     and ic.status = e.status;
  get diagnostics v_n = row_count;
  if v_n <> v_esperados then
    raise exception 'inventario 0440: se esperaban % inventarios anulados y salen %.', v_esperados, v_n;
  end if;

  select count(*) into v_movs from public.stock_movement m
   where m.source_type = 'inventory_count' and m.source_id in (select id from _esperado);
  if v_movs <> 0 then
    raise exception 'inventario 0440: al anularlos han salido % movimientos de stock; no se anula nada.', v_movs;
  end if;
  raise notice 'inventario 0440: % inventarios de seguridad anulados; ningún movimiento de stock.', v_n;
end $$;
