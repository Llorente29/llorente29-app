-- supabase/staging/sql/20261025_v01b_cuotas_prueba.sql
--
-- SOLO STAGING. Prueba de 20261025T0840_v01b_cuota_por_linea (cambia:
-- public.customer_invoice, su disparador nuevo trg_customer_invoice_cuotas;
-- public.customer_invoice_line_inalterable; public._conta_venta_cifras) y de
-- 20261025T0841_v01b_cuotas_emitidas (toca datos: la cuota de las emitidas),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. En la empresa
-- A de pruebas (Taberna de Prueba Norte), con facturas inventadas dentro de la
-- transacción.
--
--   (Empieza con sus vueltas atrás, por si ya estuvieran.)
--   0. Antes de la 0840: una factura emitida a mano de 18,05 € al 10 %, y se
--      deja como una traída de Diez: el libro y la factura con 1,80 de IVA
--      (Diez trunca el medio céntimo; el cálculo da 1,81). Y un borrador.
--   1. La 0840: el borrador da las mismas cifras que antes, cifra a cifra;
--      la emitida de antes sigue sin cuota (eso es la 0841).
--   2. Emitir con la 0840 (conta_venta_emitir): cada línea con su cuota, la
--      suma por tipo = el IVA de la factura = el del libro (477) de su asiento.
--   3. La 0841: la «traída» con 1,80, la del libro, y sus cifras dan 1,80
--      (antes 1,81). Ninguna emitida sin cuota. Pasarla dos veces no cambia nada.
--   4. Una cuota puesta no se cambia ni se quita; las demás columnas de la
--      línea de una emitida, tampoco.
--   5. Anular la «traída» con su rectificativa: resta 1,80 (lo declarado), no
--      1,81; la rectificativa queda con su cuota.
--   6. La vuelta atrás (0841 y 0840): la cuota de antes (ninguna), sin la
--      columna ni el disparador, y las dos funciones byte a byte las de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261025T0841_v01b_cuotas_emitidas.down.sql
\i supabase/vuelta-atras/20261025T0840_v01b_cuota_por_linea.down.sql

create temp table _b (clave text primary key, v text) on commit drop;
grant select, insert, update on _b to authenticated;
-- El cuerpo, sus ajustes y si es security definer (pg_get_functiondef no: revienta con los agregados de PostGIS).
insert into _b select 'fn:' || p.proname, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('_conta_venta_cifras', 'customer_invoice_line_inalterable');

-- La empresa A y lo que usan las líneas.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc
     and exists (select 1 from public.company_account_link k where k.company_id = c.id and k.entity = 'tax_rate' and k.role = 'repercutido')
   order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA V01b: la cuenta A no tiene una empresa con sus 477 enlazadas.'; end if;
  insert into _b values ('empresa', v_e),
    ('t21', (select id::text from public.tax_rate where code = 'iva_general' and company_id is null)),
    ('t10', (select id::text from public.tax_rate where code = 'iva_reducido' and company_id is null)),
    ('c705', (select id::text from public.company_account where company_id = v_e and code = '70500000'));
  if exists (select 1 from _b where v is null) then
    raise exception 'PRUEBA V01b: falta algo de la empresa A (%).', (select string_agg(clave, ', ') from _b where v is null);
  end if;
end $$;

-- 0 · Antes de la 0840: la emitida que hará de traída, y un borrador.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := (select v::uuid from _b where clave = 'empresa');
  v_t21 uuid := (select v::uuid from _b where clave = 't21');
  v_t10 uuid := (select v::uuid from _b where clave = 't10');
  v_c705 uuid := (select v::uuid from _b where clave = 'c705');
  r jsonb; v_cli uuid; v_f uuid; v_b uuid;
begin
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba V01b', '12345678Z', '{}'::jsonb, 'Prueba V01b');
  v_cli := (r->>'party_id')::uuid;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-25'),
    jsonb_build_array(jsonb_build_object('concepto', 'Pedidos de la semana', 'cantidad', 1, 'precio', 18.05, 'descuento', 0, 'tipo_id', v_t10, 'cuenta_id', v_c705)), 'Prueba V01b');
  v_f := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_f, 'Prueba V01b');
  if (select tax from public.customer_invoice where id = v_f) <> 1.81 then raise exception 'PRUEBA V01b · 0: la emitida de 18,05 al 10 %% no lleva 1,81 de IVA.'; end if;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-25'),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Menú', 'cantidad', 3, 'precio', 10.35, 'descuento', 0, 'tipo_id', v_t10, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Vino', 'cantidad', 1, 'precio', 12.45, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01b');
  v_b := (r->>'id')::uuid;
  insert into _b values ('cliente', v_cli::text), ('traida', v_f::text), ('borrador', v_b::text);
end $$;
reset role;
-- Como Diez: 1,80 en el libro y en la factura (los frenos de una emitida, apagados el tiempo justo).
alter table public.customer_invoice disable trigger trg_customer_invoice_inalterable;
update public.customer_invoice set tax = 1.80, total = 19.85 where id = (select v::uuid from _b where clave = 'traida');
alter table public.customer_invoice enable trigger trg_customer_invoice_inalterable;
update public.vat_book_entry set tax_amount = 1.80, total = 19.85
 where entry_id = (select entry_id from public.customer_invoice where id = (select v::uuid from _b where clave = 'traida')) and book = 'issued';
insert into _b select 'cifras_borrador', public._conta_venta_cifras((select v::uuid from _b where clave = 'borrador'))::text;
do $$ begin
  if (public._conta_venta_cifras((select v::uuid from _b where clave = 'traida'))->>'iva')::numeric <> 1.81 then
    raise exception 'PRUEBA V01b · 0: antes de la 0840 las cifras de la traída no recalculan 1,81.';
  end if;
  raise notice '0 · antes: la traída con 1,80 en el libro y 1,81 recalculado; y un borrador';
end $$;

-- 1 · La 0840.
\i supabase/migrations/20261025T0840_v01b_cuota_por_linea.sql
do $$ begin
  if public._conta_venta_cifras((select v::uuid from _b where clave = 'borrador'))::text <> (select v from _b where clave = 'cifras_borrador') then
    raise exception 'PRUEBA V01b · 1: las cifras del borrador cambian con la 0840 (antes %, ahora %).',
      (select v from _b where clave = 'cifras_borrador'), public._conta_venta_cifras((select v::uuid from _b where clave = 'borrador'));
  end if;
  if exists (select 1 from public.customer_invoice_line where invoice_id = (select v::uuid from _b where clave = 'traida') and tax_amount is not null) then
    raise exception 'PRUEBA V01b · 1: la 0840 ya rellena las emitidas de antes (eso es la 0841).';
  end if;
  raise notice '1 · la 0840: el borrador da lo mismo y lo emitido no se toca';
end $$;

-- 2 · Emitir con la 0840.
set local role authenticated;
do $$
declare v_b uuid := (select v::uuid from _b where clave = 'borrador'); r jsonb; v_entry uuid; v_mal int;
begin
  r := public.conta_venta_emitir(v_b, 'Prueba V01b');
  v_entry := (r->>'asiento')::uuid;
  if exists (select 1 from public.customer_invoice_line where invoice_id = v_b and tax_amount is null) then
    raise exception 'PRUEBA V01b · 2: al emitir, alguna línea se queda sin su cuota.';
  end if;
  select count(*) into v_mal from (
    select l.tax_pct, sum(l.tax_amount) c from public.customer_invoice_line l where l.invoice_id = v_b group by l.tax_pct) l
    full join (select tax_rate, sum(tax_amount) c from public.vat_book_entry where entry_id = v_entry and book = 'issued' group by tax_rate) v on v.tax_rate = l.tax_pct
   where l.c is distinct from v.c;
  if v_mal > 0 or (select sum(tax_amount) from public.customer_invoice_line where invoice_id = v_b) <> (select tax from public.customer_invoice where id = v_b) then
    raise exception 'PRUEBA V01b · 2: las cuotas guardadas no son las del libro de su asiento ni suman el IVA de la factura.';
  end if;
  raise notice '2 · emitir: cada línea con su cuota, igual que el libro, %', r->>'numero';
end $$;
reset role;

-- 3 · La 0841, dos veces.
\i supabase/migrations/20261025T0841_v01b_cuotas_emitidas.sql
\i supabase/migrations/20261025T0841_v01b_cuotas_emitidas.sql
do $$
declare v_f uuid := (select v::uuid from _b where clave = 'traida');
begin
  if (select sum(tax_amount) from public.customer_invoice_line where invoice_id = v_f) is distinct from 1.80 then
    raise exception 'PRUEBA V01b · 3: la traída no queda con 1,80, la del libro (%).', (select sum(tax_amount) from public.customer_invoice_line where invoice_id = v_f);
  end if;
  if (public._conta_venta_cifras(v_f)->>'iva')::numeric <> 1.80 then raise exception 'PRUEBA V01b · 3: las cifras de la traída siguen recalculando.'; end if;
  if exists (select 1 from public.customer_invoice_line l join public.customer_invoice ci on ci.id = l.invoice_id where ci.status <> 'borrador' and l.tax_amount is null) then
    raise exception 'PRUEBA V01b · 3: queda alguna emitida sin su cuota.';
  end if;
  raise notice '3 · la 0841: la traída con 1,80 (antes recalculaba 1,81), ninguna emitida sin cuota, y dos veces no cambia nada';
end $$;

-- 4 · La cuota puesta no se cambia, ni se quita; lo demás de la línea, tampoco.
do $$
declare v_f uuid := (select v::uuid from _b where clave = 'traida');
begin
  begin
    update public.customer_invoice_line set tax_amount = 1.81 where invoice_id = v_f;
    raise exception 'PRUEBA V01b · 4: se ha podido cambiar la cuota de una emitida.';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.customer_invoice_line set tax_amount = null where invoice_id = v_f;
    raise exception 'PRUEBA V01b · 4: se ha podido quitar la cuota de una emitida.';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.customer_invoice_line set concept = 'Otro' where invoice_id = v_f;
    raise exception 'PRUEBA V01b · 4: se ha podido cambiar el concepto de una línea emitida.';
  exception when sqlstate '23514' then null;
  end;
  raise notice '4 · la cuota puesta no se cambia ni se quita, y la línea emitida sigue sin cambiarse';
end $$;

-- 5 · Anular la traída: la rectificativa resta lo declarado.
set local role authenticated;
do $$
declare v_f uuid := (select v::uuid from _b where clave = 'traida'); r jsonb; v_r uuid;
begin
  r := public.conta_venta_corregir(v_f, 'anular', 'Prueba V01b: anular la traída', 'Prueba V01b');
  v_r := (r->>'id')::uuid;
  insert into _b values ('rectificativa', v_r::text);
end $$;
reset role;
-- _conta_venta_diferencia no es de la pantalla (sin permiso para authenticated): se mira desde fuera.
do $$
declare v_r uuid := (select v::uuid from _b where clave = 'rectificativa');
begin
  if (public._conta_venta_diferencia(v_r)->>'iva')::numeric <> -1.80 then
    raise exception 'PRUEBA V01b · 5: la rectificativa resta % de IVA y no 1,80, lo declarado.', public._conta_venta_diferencia(v_r)->>'iva';
  end if;
end $$;
set local role authenticated;
do $$
declare v_r uuid := (select v::uuid from _b where clave = 'rectificativa'); r jsonb;
begin
  r := public.conta_venta_emitir(v_r, 'Prueba V01b');
  if (select tax from public.customer_invoice where id = v_r) <> -1.80 then raise exception 'PRUEBA V01b · 5: la rectificativa no queda con −1,80.'; end if;
  if exists (select 1 from public.customer_invoice_line where invoice_id = v_r and tax_amount is null) then
    raise exception 'PRUEBA V01b · 5: la rectificativa se queda sin su cuota.';
  end if;
  raise notice '5 · anular la traída: −1,80, lo declarado, y la rectificativa con su cuota';
end $$;
reset role;

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261025T0841_v01b_cuotas_emitidas.down.sql
do $$ begin
  if exists (select 1 from public.customer_invoice_line where invoice_id = (select v::uuid from _b where clave = 'traida') and tax_amount is not null) then
    raise exception 'PRUEBA V01b · 6: después de la vuelta atrás de la 0841 la traída sigue con cuota.';
  end if;
  if to_regclass('public._copia_v01b_cuotas') is not null then raise exception 'PRUEBA V01b · 6: queda la copia.'; end if;
end $$;
\i supabase/vuelta-atras/20261025T0840_v01b_cuota_por_linea.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoice_line' and column_name = 'tax_amount')
     or exists (select 1 from pg_trigger where tgname = 'trg_customer_invoice_cuotas')
     or to_regprocedure('public._conta_venta_cuotas_de(uuid)') is not null or to_regprocedure('public._conta_venta_cuotas_guardar(uuid)') is not null then
    raise exception 'PRUEBA V01b · 6: la vuelta atrás de la 0840 se deja la columna, el disparador o sus funciones.';
  end if;
  if exists (select 1 from _b b join pg_proc p on 'fn:' || p.proname = b.clave join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) <> b.v) then
    raise exception 'PRUEBA V01b · 6: _conta_venta_cifras o customer_invoice_line_inalterable no vuelven byte a byte.';
  end if;
  raise notice '6 · la vuelta atrás: sin cuota, sin columna ni disparador, y las funciones byte a byte';
  raise notice 'PRUEBA V01b en verde: el borrador igual, emitir guarda la del libro, la traída con lo declarado, la cuota no se cambia, la rectificativa resta lo declarado y la vuelta atrás.';
end $$;

rollback;
