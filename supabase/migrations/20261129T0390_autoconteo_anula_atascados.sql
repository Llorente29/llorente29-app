-- supabase/migrations/20261129T0390_autoconteo_anula_atascados.sql
-- cambia: public.autoconteo_anulacion_20261021 · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
--
-- AUTOCONTEO · 1 de 2 · ANULA LOS 23 AUTOCONTEOS ATASCADOS (decisión de Julio,
-- 21/10/2026, respuestas 1 y 2 del encargo del autoconteo).
--
-- El número lo dio Julio el 21/10: P ocupa de la 0350 a la 0380, y esta tanda
-- va DESPUÉS de la 0380 de P.
--
-- QUÉ HAY Y POR QUÉ SE ANULA (medido en producción, solo lectura, 21/10):
--   El cron de las 03:10 UTC (cron_autoclose_daily_counts) no ha aplicado un
--   solo conteo en su vida: a esa hora no hay usuario y la guarda de cuenta de
--   close_inventory_count y apply_inventory_count dice que no. Se quedaron:
--
--   · 16 en «en_revision» con algo contado (y uno en «contando», INV-00316).
--     En 15 de ellos TODAS las líneas pendientes son de artículos que se
--     volvieron a contar y se aprobaron después: aplicarlas ahora con su fecha
--     metería un ajuste viejo por debajo de un recuento más nuevo y movería el
--     stock de hoy esa misma cantidad. INV-00286 tiene una sin recontar (100
--     de 100, sin diferencia). INV-00001 e INV-00004 son de la plantilla
--     (Folvy Interno, 15/06). INV-00316 (bolsas, de 271,5 a 0, 18/10): Julio
--     lo anula y se vuelven a contar.
--   · 6 viejos sin nada contado: INV-00026 e INV-00027 (plantilla, 23/06),
--     INV-00299, INV-00305, INV-00324 e INV-00326 (Foodint).
--
-- ANULAR NO TOCA EL STOCK. Nueve de estos conteos ya tienen ajustes escritos
-- (45 movimientos, del cierre de rezagados del 21/09 y del 27/09); los
-- recuentos posteriores los tienen dentro. Se dejan como están: borrarlos
-- descuadraría el stock igual que aplicar lo pendiente.
--
-- GUARDA: cada fila tiene que estar EXACTAMENTE como se midió (cuenta, estado
-- y líneas contadas). Si una no lo está —alguien la ha tocado desde el 21/10—
-- el fichero entero se para y no anula nada: lo vuelve a decidir Julio.
--
-- Lo de antes queda en public.autoconteo_anulacion_20261021 (estado, notas y
-- fecha de cada fila) para la vuelta atrás. Sin RLS abierta y sin permisos para
-- la API: nadie la lee desde fuera.
--
-- Nada del camino del pedido: inventory_count no lo lee ninguna venta.
-- Vuelta atrás: supabase/vuelta-atras/20261129T0390_autoconteo_anula_atascados.down.sql

create table public.autoconteo_anulacion_20261021 (
  inventory_count_id uuid primary key,
  account_id uuid not null,
  code text,
  status_antes text not null,
  notes_antes text,
  updated_at_antes timestamptz not null,
  anulado_at timestamptz not null default now()
);
alter table public.autoconteo_anulacion_20261021 enable row level security;
revoke all on public.autoconteo_anulacion_20261021 from public, anon, authenticated;

do $$
declare
  c_foodint constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  c_plantilla constant uuid := '00000000-0000-0000-0000-000000000001';
  v_mal text := '';
  v_n int;
  r record;
begin
  create temp table _esperado (id uuid primary key, code text, account_id uuid, status text, contadas int) on commit drop;
  insert into _esperado values
    ('5d44e40b-df7c-46a6-a4fc-cf2244d39d7d', 'INV-00001', c_plantilla, 'en_revision', 2),
    ('f2142c14-57e1-4067-97d3-2dc4ebbb3a6e', 'INV-00004', c_plantilla, 'en_revision', 2),
    ('02f2e90c-6f15-4c41-b1c9-3e26be0094df', 'INV-00026', c_plantilla, 'contando',    0),
    ('b10fc456-3810-4565-8f85-128eccde572d', 'INV-00027', c_plantilla, 'contando',    0),
    ('1b63a315-90ce-48e1-a74f-fb0a1b3dcb24', 'INV-00178', c_foodint,   'en_revision', 2),
    ('ce600de1-8b77-4825-ad87-3014a13f09f3', 'INV-00201', c_foodint,   'en_revision', 5),
    ('5f3f5c46-5bab-4865-8a29-3fa310c90b72', 'INV-00204', c_foodint,   'en_revision', 9),
    ('db9130b3-e4c2-42cd-957a-cd9b569fe20f', 'INV-00206', c_foodint,   'en_revision', 11),
    ('771648e1-2a1a-4cfd-8c64-2299a4f7e426', 'INV-00214', c_foodint,   'en_revision', 1),
    ('30da7a7a-893d-4b32-b484-e7a7b5b005ca', 'INV-00231', c_foodint,   'en_revision', 13),
    ('1b9386cb-1fe1-4579-b2d2-ded3023c3e37', 'INV-00238', c_foodint,   'en_revision', 16),
    ('fbf5fa18-ad9d-4ef2-a413-15a47d156f3d', 'INV-00239', c_foodint,   'en_revision', 19),
    ('2fa2ff32-8acc-4a48-b5ef-15ff24025397', 'INV-00242', c_foodint,   'en_revision', 25),
    ('60baf78e-517a-402d-97ff-67a98f7deecf', 'INV-00252', c_foodint,   'en_revision', 8),
    ('93936208-57d6-4cd1-9c30-a4831a359cc8', 'INV-00254', c_foodint,   'en_revision', 9),
    ('66d74b67-f9eb-4d96-b002-10ae0f106be0', 'INV-00286', c_foodint,   'en_revision', 2),
    ('e2261ee2-0b45-415f-a34b-d24c23a975d3', 'INV-00289', c_foodint,   'en_revision', 1),
    ('f7c06b85-a295-4f66-9f71-1e25df9beda2', 'INV-00299', c_foodint,   'contando',    0),
    ('c4c4af0c-e3ac-4a5d-a27c-948257c3806f', 'INV-00305', c_foodint,   'contando',    0),
    ('5aad9a30-9fd4-48aa-ae75-08dea65164c4', 'INV-00306', c_foodint,   'en_revision', 1),
    ('781721e2-68f2-4826-a196-5f07545eca3e', 'INV-00316', c_foodint,   'contando',    1),
    ('26427604-11fc-40a6-8901-b49ec1e232c8', 'INV-00324', c_foodint,   'contando',    0),
    ('19ca0731-c4c8-430e-82b0-501341de8ec6', 'INV-00326', c_foodint,   'en_revision', 0);

  -- En staging no están estas filas (son de producción): no hay nada que
  -- anular y se dice. La prueba de staging comprueba la guarda aparte.
  if not exists (select 1 from public.accounts where id = c_foodint) then
    raise notice 'autoconteo 0390: aquí no está Foodint (staging): no se anula nada.';
    return;
  end if;

  for r in
    select e.*, ic.id is not null as existe, ic.kind, ic.status as status_hoy, ic.account_id as cuenta_hoy,
           (select count(*) from public.inventory_count_line l
             where l.inventory_count_id = e.id and l.counted_qty is not null)::int as contadas_hoy
      from _esperado e left join public.inventory_count ic on ic.id = e.id
     order by e.code
  loop
    if not r.existe then
      v_mal := v_mal || format(' %s no existe;', r.code);
    elsif r.cuenta_hoy <> r.account_id or r.kind <> 'cycle' or r.status_hoy <> r.status or r.contadas_hoy <> r.contadas then
      v_mal := v_mal || format(' %s está %s/%s con %s contadas (se midió %s con %s);',
                               r.code, r.kind, r.status_hoy, r.contadas_hoy, r.status, r.contadas);
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'autoconteo 0390: no se anula nada, hay filas que ya no están como se midieron el 21/10:%', v_mal;
  end if;

  insert into public.autoconteo_anulacion_20261021 (inventory_count_id, account_id, code, status_antes, notes_antes, updated_at_antes)
  select ic.id, ic.account_id, ic.code, ic.status, ic.notes, ic.updated_at
    from public.inventory_count ic join _esperado e on e.id = ic.id and e.account_id = ic.account_id;

  update public.inventory_count ic
     set status = 'anulado',
         notes = concat_ws(E'\n', ic.notes,
           'Anulado el 21/10/2026 por decisión de Julio: autoconteo atascado sin aplicar. '
           || case when e.contadas = 0 then 'No se llegó a contar nada.'
                   else 'Sus artículos se volvieron a contar después o se vuelven a contar; aplicarlo ahora movería el stock de hoy. Lo ya ajustado se queda.' end),
         updated_at = now()
    from _esperado e
   where e.id = ic.id and e.account_id = ic.account_id
     and ic.status = e.status;
  get diagnostics v_n = row_count;
  if v_n <> 23 then
    raise exception 'autoconteo 0390: se esperaban 23 conteos anulados y salen %.', v_n;
  end if;
  raise notice 'autoconteo 0390: 23 autoconteos anulados (4 de la plantilla, 19 de Foodint); ningún movimiento de stock tocado.';
end $$;
