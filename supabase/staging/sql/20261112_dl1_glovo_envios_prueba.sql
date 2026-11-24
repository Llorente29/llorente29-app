-- supabase/staging/sql/20261112_dl1_glovo_envios_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · envíos de Glovo (2342). Todo en una
-- transacción con ROLLBACK, en la cuenta A. Recorre el camino de producción
-- (la función), no solo el «sin Foodint». Nombra lo que añade: _dl1_envio_aclarar.
--   1. Sin Foodint, la migración no aclara nada.
--   2. Un pedido de la cuenta A se aclara como la persona («lo_paga»): queda su
--      decisión, a nombre de la persona, con su motivo.
--   3. Al acabar no se queda puesto el usuario de la persona.
--   4. Una decisión que no existe: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 envíos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al aclarar.
set constraints all immediate;

create temp table prueba_antes on commit drop as select count(*) n from public.conta_envio_aclarado;
\i supabase/migrations/20261112T2342_dl1_glovo_envios.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_admin uuid; v_s uuid; v_err text; v_a public.conta_envio_aclarado;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.conta_envio_aclarado) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 envíos 1: sin Foodint la migración ha aclarado algo.';
  end if;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  select s.id into v_s from public.sale s where s.account_id = v_acc
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id where s.id = any(d.sale_ids) and e.status = 'validado')
   order by s.sold_at, s.id limit 1;
  if v_admin is null or v_s is null then raise exception 'PRUEBA DL1 envíos: a la cuenta A le falta un administrador o un pedido sin asiento validado.'; end if;

  -- 2. Aclarar como la persona.
  perform public._dl1_envio_aclarar(v_admin, 'Persona de prueba', v_s, 'lo_paga', 'PRUEBA: lo dice la liquidación');
  select * into v_a from public.conta_envio_aclarado where sale_id = v_s;
  if v_a.decision is distinct from 'lo_paga' or v_a.created_by is distinct from v_admin or v_a.created_by_name <> 'Persona de prueba' or v_a.motivo not like 'PRUEBA%' then
    raise exception 'PRUEBA DL1 envíos 2: la decisión no ha quedado como «lo_paga» a nombre de la persona (%).', to_jsonb(v_a);
  end if;

  -- 3. No se queda puesto el usuario.
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA DL1 envíos 3: al acabar se ha quedado puesto el usuario de la persona.';
  end if;

  -- 4. Una decisión que no existe.
  begin
    perform public._dl1_envio_aclarar(v_admin, 'Persona de prueba', v_s, 'lo_paga_el_cliente', 'PRUEBA');
    raise exception 'PRUEBA DL1 envíos 4: ha aceptado una decisión que no existe.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'lo_paga' then raise; end if;
  end;
end $$;

select 'PRUEBA DL1 envíos: en verde' as resultado;
rollback;
