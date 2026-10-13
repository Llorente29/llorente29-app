-- supabase/staging/sql/20261021_d01_repetidas_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0230 (D01, repetidas con el total): el
-- fichero entero y su prueba en UNA transacción que acaba en ROLLBACK. Copiados tal cual.

begin;
-- ============================================================================
-- D01 · La regla única de repetidas, con el TOTAL (como el C01b).
--
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.tg_supplier_invoice_no_repetida · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.supplier_invoice_repetida · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.supplier_invoice_repetidas_que_hay · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
--
-- La 0210 bloqueaba por número solo. Medido contra los 179 albaranes reales de
-- Foodint (tests/unit/modules/conta/datos/albaranes-fecha-importe-…json): el
-- único número repetido entre los vivos es «01», de un proveedor que lo pone en
-- dos albaranes de fecha e importe distintos. Con la 0210, el segundo no habría
-- podido entrar. El C01b ya lo había decidido así (lib/repetidas.ts: «número E
-- importe»), y la regla única no puede ser más dura que lo que sustituye.
--
--   · repetida (bloquea): mismo proveedor, misma clave de número y mismo total;
--   · posible (pregunta, no bloquea): misma clave con otro total o sin total,
--     o misma fecha y mismo total con otro número.
--
-- La clave sale de UNA función, conta_clave_numero(), que también reconoce
-- «sin número» con tilde (la Ú se quitaba y quedaba SINNMERO). La columna
-- number_key de la 0200 se queda como está (cambiarla es quitar y poner la
-- columna); las comparaciones de aquí no la usan.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0230_d01_repetidas_con_total.down.sql
-- ============================================================================

create or replace function public.conta_clave_numero(p text)
returns text language sql immutable parallel safe as $$
  select nullif(case when k ~ '^(SN|SINNUMERO|SINNMERO|SINNUM|0+)$' then '' else k end, '')
    from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as k) x
$$;
comment on function public.conta_clave_numero(text) is
  'D01 · La clave de número de factura de la regla única de repetidas: mayúsculas, solo letras y cifras; «s/n», «sin número», «0…» no son número (null). La misma que claveNumero() en _shared/lecturaFactura.ts.';
grant execute on function public.conta_clave_numero(text) to authenticated, service_role;

create or replace function public.tg_supplier_invoice_no_repetida()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_otra public.supplier_invoice;
  v_k text := public.conta_clave_numero(new.invoice_number);
begin
  if new.status = 'anulada' or new.not_duplicate_confirmed_at is not null or new.supplier_id is null
     or v_k is null or new.grand_total is null then return new; end if;
  -- En un cambio, solo si cambia lo que decide (número, proveedor, total o que deje de estar anulada).
  if tg_op = 'UPDATE' and v_k is not distinct from public.conta_clave_numero(old.invoice_number)
     and new.supplier_id is not distinct from old.supplier_id
     and round(new.grand_total * 100) is not distinct from round(old.grand_total * 100)
     and not (old.status = 'anulada' and new.status <> 'anulada') then return new; end if;
  select * into v_otra from public.supplier_invoice i
   where i.account_id = new.account_id and i.supplier_id = new.supplier_id
     and public.conta_clave_numero(i.invoice_number) = v_k
     and round(i.grand_total * 100) = round(new.grand_total * 100)
     and i.id <> new.id and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   order by i.created_at limit 1;
  if v_otra.id is not null then
    raise exception 'Repetida: ya está la factura % de este proveedor (%), con el mismo total. No entra dos veces; si no es la misma, márcala «No es repetida».',
      v_otra.invoice_number, coalesce(v_otra.code, v_otra.id::text) using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_invoice_no_repetida on public.supplier_invoice;
create trigger trg_supplier_invoice_no_repetida
  before insert or update of invoice_number, supplier_id, status, not_duplicate_confirmed_at, grand_total on public.supplier_invoice
  for each row execute function public.tg_supplier_invoice_no_repetida();

create or replace function public.supplier_invoice_repetida(
  p_account uuid, p_supplier uuid, p_nif text, p_numero text, p_fecha date, p_total numeric, p_excluir uuid default null)
returns table (nivel text, invoice_id uuid, invoice_number text, invoice_date date, grand_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_clave text := public.conta_clave_numero(p_numero);
  v_nif text := nullif(regexp_replace(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', ''), '');
begin
  if not (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa cuenta no es tuya.' using errcode = '42501';
  end if;
  return query
  with vivas as (
    select i.* from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = p_account and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
       and (p_excluir is null or i.id <> p_excluir)
       and ((p_supplier is not null and i.supplier_id = p_supplier)
            or (v_nif is not null and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif))
  ), mismo_numero as (
    select v.* from vivas v where v_clave is not null and public.conta_clave_numero(v.invoice_number) = v_clave
  ), repetida as (
    select v.* from mismo_numero v where p_total is not null and round(v.grand_total * 100) = round(p_total * 100)
     order by v.created_at limit 1
  )
  (select 'repetida'::text, r.id, r.invoice_number, r.invoice_date, r.grand_total from repetida r)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from mismo_numero v
    where not exists (select 1 from repetida) order by v.created_at limit 1)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where p_fecha is not null and p_total is not null and v.invoice_date = p_fecha and round(v.grand_total * 100) = round(p_total * 100)
      and v_clave is distinct from public.conta_clave_numero(v.invoice_number)
      and not exists (select 1 from mismo_numero)
    order by v.created_at limit 1);
end $$;
comment on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) is
  'D01 · La regla única de repetidas: repetida = mismo proveedor (o su NIF), misma clave de número y mismo total (bloquea); posible = misma clave con otro total o sin total, o misma fecha y mismo total con otro número (pregunta). Para Compras, Supply, la ficha y la bandeja.';

create or replace function public.supplier_invoice_repetidas_que_hay(p_account uuid)
returns table (supplier_id uuid, number_key text, facturas integer, ids uuid[])
language sql stable security definer set search_path = public as $$
  select i.supplier_id, public.conta_clave_numero(i.invoice_number), count(*)::int, array_agg(i.id order by i.created_at)
    from public.supplier_invoice i
   where i.account_id = p_account and (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role')
     and public.conta_clave_numero(i.invoice_number) is not null and i.supplier_id is not null and i.grand_total is not null
     and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   group by i.supplier_id, public.conta_clave_numero(i.invoice_number), round(i.grand_total * 100) having count(*) > 1
$$;

-- ── La prueba ──
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 repetidas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_prov constant uuid := 'c01a0000-0000-4000-8000-0000000000a3'; -- Hermanos Ruiz, de A (semilla)
  v_e uuid := (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1);
  v_a uuid; v_b uuid; v_c uuid; v_res text; v_n int;
begin
  -- 1 · la clave
  if public.conta_clave_numero('s/n') is not null or public.conta_clave_numero('Sin número') is not null or public.conta_clave_numero('SIN NUMERO') is not null
     or public.conta_clave_numero('000') is not null or public.conta_clave_numero(' - ') is not null or public.conta_clave_numero(null) is not null then
    raise exception 'PRUEBA D01 repetidas · 1: algo que no es número da clave.';
  end if;
  if public.conta_clave_numero('01') <> '01' or public.conta_clave_numero(' f-2026/ 1022 ') <> 'F20261022' then
    raise exception 'PRUEBA D01 repetidas · 1: la clave no es la de la regla (% / %).', public.conta_clave_numero('01'), public.conta_clave_numero(' f-2026/ 1022 ');
  end if;
  raise notice 'PRUEBA D01 repetidas · 1: «s/n», «sin número», «000» y «-» no son número; «01» sí; « f-2026/ 1022 » es F20261022.';

  -- 2 · el «01» de la población real
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-04', 'en_revision', 'manual', 210.40, 'Prueba D01') returning id into v_a;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-11', 'en_revision', 'manual', 87.15, 'Prueba D01') returning id into v_b;
  raise notice 'PRUEBA D01 repetidas · 2: dos «01» del mismo proveedor con otro importe y otra fecha entran los dos.';

  -- 3 · el mismo número y el mismo total, no
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
    values (v_acc, v_prov, v_e, '0-1', '2026-09-20', 'en_revision', 'manual', 210.40, 'Prueba D01');
    raise exception 'PRUEBA D01 repetidas · 3: ha entrado «0-1» por el mismo total que «01».';
  exception when unique_violation then null; end;
  begin
    update public.supplier_invoice set grand_total = 210.40 where id = v_b;
    raise exception 'PRUEBA D01 repetidas · 3: cambiarle el total para que coincida no lo ha parado.';
  exception when unique_violation then null; end;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, not_duplicate_confirmed_at, not_duplicate_confirmed_by_name)
  values (v_acc, v_prov, v_e, '0-1', '2026-09-20', 'en_revision', 'manual', 210.40, 'Prueba D01', now(), 'Prueba D01') returning id into v_c;
  -- Sin total todavía no se puede decir: entra, y la pregunta queda para cuando lo tenga.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-25', 'borrador', 'manual', 'Prueba D01');
  raise notice 'PRUEBA D01 repetidas · 3: el mismo número y total no entra, ni cambiando el total; con «No es repetida», sí; sin total, entra.';

  -- 4 · la función
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', '2026-10-01', 87.15);
  if v_res is distinct from 'repetida' then raise exception 'PRUEBA D01 repetidas · 4: el mismo número y total no es repetida (%).', v_res; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', '2026-10-01', 5);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 repetidas · 4: el mismo número con otro total no es posible (%).', v_res; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', null, null);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 repetidas · 4: el mismo número sin total no es posible (%).', v_res; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'X-77', '2026-09-11', 87.15);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 repetidas · 4: misma fecha y total con otro número no es posible (%).', v_res; end if;
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'X-78', '2026-12-11', 87.15);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 4: otro número, otra fecha, sale algo.'; end if;
  raise notice 'PRUEBA D01 repetidas · 4: repetida, posible por número (otro total / sin total), posible por fecha y total, y nada.';

  -- 5 · las que ya había
  select count(*) into v_n from public.supplier_invoice_repetidas_que_hay(v_acc) where v_a = any (ids) or v_b = any (ids);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 5: los dos «01» con otro total salen como repetidas que hay.'; end if;
  select count(*) into v_n from public.supplier_invoice_repetidas_que_hay(v_acc);
  raise notice 'PRUEBA D01 repetidas · 5: los dos «01» no se listan; repetidas que ya había en A (número y total): %.', v_n;
end $$;
reset role;

-- 6 · B no pregunta por A
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform * from public.supplier_invoice_repetida('c01a0000-0000-4000-8000-00000000000a', null, null, '01', null, null);
    raise exception 'PRUEBA D01 repetidas · 6: B ha preguntado por repetidas de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.supplier_invoice_repetidas_que_hay('c01a0000-0000-4000-8000-00000000000a')) then
    raise exception 'PRUEBA D01 repetidas · 6: B ve las repetidas de A.';
  end if;
  raise notice 'PRUEBA D01 repetidas · 6: B no pregunta ni ve las repetidas de A.';
end $$;
reset role;

rollback;
