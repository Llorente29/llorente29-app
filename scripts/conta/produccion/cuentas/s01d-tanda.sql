-- scripts/conta/produccion/cuentas/s01d-tanda.sql
--
-- S01d · LO QUE CUENTA LA TANDA (0160–0170), antes y después. SOLO LEE.
-- Recuentos de Foodint (regla 9), el CHECK que se amplía y si existen las dos
-- funciones; ningún nombre ni importe.
select clave, valor from (
  select 1 o, 'CHECK de journal_entry_document.kind' clave,
    coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'journal_entry_document_kind_check'), 'no existe') valor union all
  select 2, 'documentos de asientos de Foodint por tipo',
    (select coalesce(string_agg(kind || ' ' || n, ' · ' order by kind), 'ninguno') from (select kind, count(*) n from public.journal_entry_document
       where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by kind) x) union all
  select 3, 'conta_documento_expedida_guardar', case when to_regprocedure('public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text)') is null then 'no existe' else 'existe' end union all
  select 4, 'bank_cuenta_nueva', case when to_regprocedure('public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text)') is null then 'no existe' else 'existe' end union all
  select 5, 'bancos y tarjetas de Foodint', (select count(*) from public.treasury_account where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 6, 'subcuentas 572 de Foodint', (select count(*) from public.company_account where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and code like '572%')::text union all
  select 7, 'asientos de Foodint (todos)', (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
