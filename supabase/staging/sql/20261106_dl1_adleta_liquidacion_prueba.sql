-- supabase/staging/sql/20261106_dl1_adleta_liquidacion_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Adleta, lo no liquidado (2213). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con un cliente y cuentas de mentira
-- si no los tiene. Recorre el camino de producción (la función), no solo el
-- «sin Foodint». Nombra lo que añade: _dl1_factura_emitir.
--   1. Guarda y emite una factura de venta como la persona: serie F, fecha de
--      hoy, el cliente con su NIF, la línea con su concepto (la fecha de
--      operación) al 10 %; emitida, con número, total = base × 1,10 y su asiento
--      validado (430 por el total, 705 por la base, 477 con su tipo).
--   2. Al acabar no se queda puesto el usuario de la persona.
--   3. Otra con las mismas notas: no se emite.
--   4. El reparto de su 705 por local (_dl1_venta_proponer + _dl1_validar) cuadra
--      y se valida.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Adleta liquidación: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
\i supabase/migrations/20261106T2213_dl1_adleta_liquidacion.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; v_admin uuid; v_tipo uuid; v_705 uuid; v_cli uuid;
  l1 uuid; l2 uuid; v_f jsonb; v_inv public.customer_invoice; v_err text; v_id uuid; v_n int; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  select id into l1 from public.locations where account_id = v_acc order by id limit 1;
  select id into l2 from public.locations where account_id = v_acc and id <> l1 order by id limit 1;
  if c is null or v_admin is null or l1 is null or l2 is null then raise exception 'PRUEBA DL1 Adleta liquidación: a la cuenta A le falta empresa, administrador o dos locales.'; end if;
  select id into y from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  select id into v_tipo from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;
  -- La 705 y una 477 del 10 % (la emisión la busca por su enlace o por su nombre).
  select id into v_705 from public.company_account where company_id = c and code = '70500000';
  if v_705 is null then
    insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
    values (v_acc, c, '70500000', 'PRUEBA DL1 Prestaciones de servicios', 'own', 'pymes', 'manual', '705') returning id into v_705;
  end if;
  if not exists (select 1 from public.company_account_link k where k.company_id = c and k.entity = 'tax_rate' and k.entity_id = v_tipo::text and k.role = 'repercutido')
     and not exists (select 1 from public.company_account where company_id = c and code like '477%' and code <> '47700000' and name ilike '%10 %%') then
    insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
    values (v_acc, c, '47700099', 'PRUEBA DL1 IVA repercutido 10 %', 'own', 'pymes', 'manual', '477');
  end if;
  -- El cliente, con su NIF (como la persona: Contactos lo pide).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_cli := (public.party_save_customer(v_acc, null, 'Cliente de prueba DL1', '12345678Z', '{}'::jsonb, 'Prueba DL1')->>'party_id')::uuid;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('folvy.cuenta_activa', '', true);

  -- 1. Guarda y emite.
  v_f := public._dl1_factura_emitir(c, v_admin, 'Persona de prueba',
    jsonb_build_object('cliente_id', v_cli, 'fecha', v_hoy, 'serie', 'F', 'notas', 'PRUEBA DL1 · periodo de prueba'),
    jsonb_build_array(jsonb_build_object('concepto', 'Liquidación de prueba · fecha de operación 12/06/2026 – 10/07/2026', 'cantidad', 1, 'precio', 100.00,
                                         'tipo_id', v_tipo, 'cuenta_id', v_705)));
  select * into v_inv from public.customer_invoice where id = (v_f->>'id')::uuid;
  if v_inv.status <> 'emitida' or v_inv.number_text is null or v_inv.series_code <> 'F' or v_inv.issue_date <> v_hoy or v_inv.total <> 110.00 or v_inv.issued_by_name <> 'Persona de prueba' then
    raise exception 'PRUEBA DL1 Adleta liquidación 1: la factura no está emitida en la serie F, con fecha de hoy, por 110,00 y a nombre de la persona (%).', to_jsonb(v_inv) - 'customer';
  end if;
  if not exists (select 1 from public.customer_invoice_line where invoice_id = v_inv.id and concept like '%fecha de operación 12/06/2026%') then
    raise exception 'PRUEBA DL1 Adleta liquidación 1: la línea no lleva la fecha de operación en su concepto.';
  end if;
  if (select status from public.journal_entry where id = v_inv.entry_id) <> 'validado'
     or (select count(*) from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
          where jl.entry_id = v_inv.entry_id and ((a.code like '43%' and jl.debit = 110.00) or (a.code = '70500000' and jl.credit = 100.00)
                                                  or (a.code like '477%' and jl.credit = 10.00 and jl.tax_rate_id = v_tipo and jl.vat_book = 'issued'))) <> 3 then
    raise exception 'PRUEBA DL1 Adleta liquidación 1: el asiento de la factura no está validado o no es 430 110 / 705 100 / 477 10.';
  end if;

  -- 2. No se queda puesto el usuario.
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA DL1 Adleta liquidación 2: al acabar se ha quedado puesto el usuario de la persona.';
  end if;

  -- 3. Otra con las mismas notas.
  begin
    perform public._dl1_factura_emitir(c, v_admin, 'Persona de prueba',
      jsonb_build_object('cliente_id', v_cli, 'fecha', v_hoy, 'serie', 'F', 'notas', 'PRUEBA DL1 · periodo de prueba'),
      jsonb_build_array(jsonb_build_object('concepto', 'Otra', 'cantidad', 1, 'precio', 1.00, 'tipo_id', v_tipo, 'cuenta_id', v_705)));
    raise exception 'PRUEBA DL1 Adleta liquidación 3: se ha emitido otra con las mismas notas.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya hay una factura viva' then raise; end if;
  end;

  -- 4. El reparto de su 705 por local.
  v_id := public._dl1_venta_proponer(c, v_hoy, 4, 'PRUEBA Reparto por local de la factura ' || v_inv.number_text, 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70500000', 'debe', 100.00, 'documento', v_inv.number_text),
                      jsonb_build_object('cuenta', '70500000', 'haber', 70.00, 'local', l1, 'documento', v_inv.number_text),
                      jsonb_build_object('cuenta', '70500000', 'haber', 30.00, 'local', l2, 'documento', v_inv.number_text)));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 100.00)));
  if v_n <> 1 or (select status from public.journal_entry where id = v_id) <> 'validado' then
    raise exception 'PRUEBA DL1 Adleta liquidación 4: el reparto por local no se ha validado.';
  end if;
end $$;

select 'PRUEBA DL1 Adleta liquidación: en verde' as resultado;
rollback;
