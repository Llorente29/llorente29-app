-- supabase/staging/sql/20261104_s01p_recibido_prueba.sql
--
-- SOLO STAGING. Prueba del S01p · lo recibido sin factura se retira cuando
-- llega la factura (1640 y 1641). Todo en una transacción con ROLLBACK, en la
-- cuenta A, con sus periodificaciones de octubre de 2026 (las de la semilla de
-- compras). Nombra lo que toca, para el analizador: _compras_fin_de_mes,
-- goods_receipt_path, purchase_accrual, journal_entry, conta_proponer_recibidos.
--   1. Un albarán solo en su periodificación recibe su factura del mes: su
--      pareja propuesta se va y la periodificación también, en el momento.
--   2. Un albarán de una periodificación con varios recibe la suya: la pareja
--      propuesta (con el importe de antes) se va y la periodificación se rehace
--      sin él.
--   3. Una periodificación sin cambios conserva sus propuestas.
--   4. Otra vez las dos: nada cambia.
--   5. La vuelta atrás deja _compras_fin_de_mes con su huella de producción y
--      quita el disparador; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p recibido: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: el disparador propone como Sumied (desde un disparador, conta_proponer_recibidos no pide persona); la tanda la aplica el dueño de las funciones.

\i supabase/migrations/20261104T1640_s01p_recibido_con_factura.sql
\i supabase/migrations/20261104T1641_s01p_recibido_foodint.sql

create temp table _p (clave text primary key, v uuid) on commit drop;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c uuid; f uuid; una uuid; varias uuid; quieta uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  -- Una factura de A del mes, cualquiera viva: _compras_fin_de_mes solo mira su fecha y su estado.
  select id into f from public.supplier_invoice where account_id = v_acc and status <> 'anulada'
     and invoice_date between '2026-10-01' and '2026-10-31' order by invoice_date, id limit 1;
  select a.id into una from public.purchase_accrual a where a.account_id = v_acc and a.company_id = c and a.month = '2026-10-01'
     and jsonb_array_length(a.receipts) = 1 order by a.base desc, a.id limit 1;
  select a.id into varias from public.purchase_accrual a where a.account_id = v_acc and a.company_id = c and a.month = '2026-10-01'
     and jsonb_array_length(a.receipts) > 1 order by a.base desc, a.id limit 1;
  select a.id into quieta from public.purchase_accrual a where a.account_id = v_acc and a.company_id = c and a.month = '2026-10-01'
     and a.id not in (una, varias) order by a.base desc, a.id limit 1;
  if c is null or f is null or una is null or varias is null or quieta is null then
    raise exception 'PRUEBA S01p recibido: faltan las periodificaciones de octubre de A (una %, varias %, otra %) o una factura del mes (%).', una, varias, quieta, f;
  end if;
  insert into _p values ('empresa', c), ('factura', f), ('una', una), ('varias', varias), ('quieta', quieta);
end $$;

-- La pareja propuesta de cada una (como la deja la pasada de la noche): 31/10 y su contrario el 01/11.
create function pg_temp.pareja(p_acc uuid) returns void language sql as $$
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status)
  select a.account_id, a.company_id, y.id, 2, x.d, 'PRUEBA S01p recibido sin factura', x.t, a.id, 'propuesto'
    from public.purchase_accrual a
    cross join (values (date '2026-10-31', 'purchase_accrual'), (date '2026-11-01', 'purchase_accrual_reversal')) x(d, t)
    join public.fiscal_year y on y.company_id = a.company_id and x.d between y.starts_on and y.ends_on
   where a.id = p_acc
$$;
select pg_temp.pareja(v) from _p where clave in ('una', 'varias', 'quieta');
create temp table _antes (id uuid primary key, acc uuid) on commit drop;
insert into _antes select e.id, e.source_id from public.journal_entry e where e.source_id in (select v from _p where clave in ('una', 'varias', 'quieta'))
  and e.source_type in ('purchase_accrual', 'purchase_accrual_reversal');

-- 1 · El albarán que estaba solo.
do $$
declare una uuid := (select v from _p where clave = 'una'); r uuid; n int;
begin
  select (receipts->0->>'id')::uuid into r from public.purchase_accrual where id = una;
  update public.goods_receipt_path set supplier_invoice_id = (select v from _p where clave = 'factura') where goods_receipt_id = r;
  select count(*) into n from public.journal_entry where id in (select id from _antes where acc = una);
  if n <> 0 then raise exception 'PRUEBA S01p recibido · 1: con su factura, la pareja propuesta sigue (% asientos).', n; end if;
  if exists (select 1 from public.purchase_accrual where id = una) then raise exception 'PRUEBA S01p recibido · 1: la periodificación sigue.'; end if;
  if exists (select 1 from public.purchase_accrual a where a.month = '2026-10-01' and a.receipts @> jsonb_build_array(jsonb_build_object('id', r))) then
    raise exception 'PRUEBA S01p recibido · 1: el albarán facturado sigue en una periodificación de octubre.';
  end if;
  raise notice 'PRUEBA S01p recibido · 1 en verde: el albarán recibe su factura y su pareja propuesta y su periodificación se van en el momento.';
end $$;

-- 2 · Un albarán de una periodificación con varios.
do $$
declare varias uuid := (select v from _p where clave = 'varias'); r uuid; n_antes int; base_antes numeric; a public.purchase_accrual; n int;
begin
  select (receipts->0->>'id')::uuid, jsonb_array_length(receipts), base into r, n_antes, base_antes from public.purchase_accrual where id = varias;
  update public.goods_receipt_path set supplier_invoice_id = (select v from _p where clave = 'factura') where goods_receipt_id = r;
  select count(*) into n from public.journal_entry where id in (select id from _antes where acc = varias);
  if n <> 0 then raise exception 'PRUEBA S01p recibido · 2: la pareja con el importe de antes sigue (% asientos).', n; end if;
  select * into a from public.purchase_accrual where id = varias;
  if a.id is null or jsonb_array_length(a.receipts) <> n_antes - 1 or a.receipts @> jsonb_build_array(jsonb_build_object('id', r)) then
    raise exception 'PRUEBA S01p recibido · 2: la periodificación no se rehace sin el albarán (% de % albaranes).', jsonb_array_length(a.receipts), n_antes;
  end if;
  raise notice 'PRUEBA S01p recibido · 2 en verde: la pareja de % € se va y la periodificación se rehace con % albaranes (% €).', base_antes, jsonb_array_length(a.receipts), a.base;
end $$;

-- 3 · La que no ha cambiado conserva sus propuestas.
do $$
declare quieta uuid := (select v from _p where clave = 'quieta'); n int;
begin
  select count(*) into n from public.journal_entry where id in (select id from _antes where acc = quieta);
  if n <> 2 then raise exception 'PRUEBA S01p recibido · 3: la periodificación sin cambios ha perdido sus propuestas (quedan %).', n; end if;
  raise notice 'PRUEBA S01p recibido · 3 en verde: la que no ha cambiado conserva su pareja.';
end $$;

-- 4 · Otra vez: nada.
create temp table _huella (h text) on commit drop;
insert into _huella values (md5(pg_get_functiondef('public._compras_fin_de_mes(uuid,date)'::regprocedure)));
\i supabase/migrations/20261104T1640_s01p_recibido_con_factura.sql
\i supabase/migrations/20261104T1641_s01p_recibido_foodint.sql
do $$ begin
  if (select h from _huella) <> md5(pg_get_functiondef('public._compras_fin_de_mes(uuid,date)'::regprocedure)) then
    raise exception 'PRUEBA S01p recibido · 4: pasarlas otra vez cambió la función.';
  end if;
  raise notice 'PRUEBA S01p recibido · 4 en verde: otra vez, nada cambia.';
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261104T1641_s01p_recibido_foodint.down.sql
\i supabase/vuelta-atras/20261104T1640_s01p_recibido_con_factura.down.sql
do $$ begin
  -- La huella de producción del 04/11 (igual en staging antes de la 1640).
  if md5(pg_get_functiondef('public._compras_fin_de_mes(uuid,date)'::regprocedure)) <> '8882936c41fee183b572b7f75f01805a' then
    raise exception 'PRUEBA S01p recibido · 5: la vuelta atrás no deja _compras_fin_de_mes como en producción.';
  end if;
  if exists (select 1 from pg_trigger where tgname = 's01p_albaran_facturado') or to_regclass('public.conta_s01p_recibido_antes') is not null then
    raise exception 'PRUEBA S01p recibido · 5: la vuelta atrás deja algo de lo añadido.';
  end if;
  raise notice 'PRUEBA S01p recibido · 5 en verde: la vuelta atrás, con la huella de producción y sin nada de lo añadido.';
end $$;
\i supabase/migrations/20261104T1640_s01p_recibido_con_factura.sql
\i supabase/migrations/20261104T1641_s01p_recibido_foodint.sql
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 's01p_albaran_facturado') then raise exception 'PRUEBA S01p recibido · 5: otra vez delante, no está.'; end if;
  raise notice 'PRUEBA S01p recibido · 5 en verde: y otra vez delante.';
end $$;

rollback;
