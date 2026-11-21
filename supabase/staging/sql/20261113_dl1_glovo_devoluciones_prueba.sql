-- supabase/staging/sql/20261113_dl1_glovo_devoluciones_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · devoluciones falsas de Glovo (0205). Todo en
-- una transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no
-- las tiene. Recorre el camino de producción (las funciones), no solo el «sin
-- Foodint». Nombra lo que añade: _dl1_anular y _dl1_descartar.
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Un asiento validado se anula como la persona con la fecha pedida: queda
--      anulado y su contraasiento, validado con esa fecha.
--   3. Una propuesta se descarta como la persona: deja de estar.
--   4. Al acabar no se queda puesto el usuario de la persona.
--   5. Un asiento de otra empresa: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 devoluciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones solo las llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al anular y descartar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
create temp table prueba_antes on commit drop as select count(*) n from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a';
\i supabase/migrations/20261113T0205_dl1_glovo_devoluciones.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; v_admin uuid; x record; v_id uuid; v_p uuid; v_a jsonb; v_err text; v_otro uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 devoluciones 1: sin Foodint la migración ha cambiado algo en la cuenta A.';
  end if;
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c is null or v_admin is null then raise exception 'PRUEBA DL1 devoluciones: a la cuenta A le falta empresa o administrador.'; end if;
  select id into y from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  for x in select * from (values ('43000098', '4300'), ('70500098', '705')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;

  -- 2. Anular con la fecha pedida.
  v_id := public._dl1_venta_proponer(c, v_hoy, 1, 'PRUEBA Devolución · pedido 0', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70500098', 'debe', 20.40), jsonb_build_object('cuenta', '43000098', 'haber', 20.40)));
  perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 20.40)));
  v_a := public._dl1_anular(c, v_admin, 'Persona de prueba', v_id, 'PRUEBA se cobró', v_hoy);
  if (select status from public.journal_entry where id = v_id) <> 'anulado'
     or (select status from public.journal_entry where id = (v_a->>'contraasiento')::uuid) <> 'validado'
     or (select entry_date from public.journal_entry where id = (v_a->>'contraasiento')::uuid) <> v_hoy then
    raise exception 'PRUEBA DL1 devoluciones 2: no está anulado o su contraasiento no está validado con la fecha pedida (%).', v_a;
  end if;

  -- 3. Descartar una propuesta.
  v_p := public._dl1_venta_proponer(c, v_hoy, 1, 'PRUEBA Devolución · pedido 1', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70500098', 'debe', 11.90), jsonb_build_object('cuenta', '43000098', 'haber', 11.90)));
  perform public._dl1_descartar(c, v_admin, 'Persona de prueba', v_p, 'PRUEBA se cobró por otro lado');
  if exists (select 1 from public.journal_entry where id = v_p) then
    raise exception 'PRUEBA DL1 devoluciones 3: la propuesta sigue ahí después de descartarla.';
  end if;

  -- 4. No se queda puesto el usuario.
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA DL1 devoluciones 4: al acabar se ha quedado puesto el usuario de la persona.';
  end if;

  -- 5. Un asiento de otra empresa.
  select id into v_otro from public.journal_entry where company_id <> c limit 1;
  begin
    perform public._dl1_descartar(c, v_admin, 'Persona de prueba', coalesce(v_otro, gen_random_uuid()), 'PRUEBA');
    raise exception 'PRUEBA DL1 devoluciones 5: ha aceptado un asiento de otra empresa.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no es de la empresa' then raise; end if;
  end;
end $$;

select 'PRUEBA DL1 devoluciones: en verde' as resultado;
rollback;
