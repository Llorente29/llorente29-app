-- scripts/video/reconocer.sql — V01 · qué tiene la empresa A del carril, en solo lectura.
--
--   psql "$DB_URL" -v cuenta=<uuid> -v empresa=<uuid> -f scripts/video/reconocer.sql
--
-- Solo SELECT, y solo de la cuenta del carril (regla 9: todo con account_id o
-- company_id). Sirve para decidir qué hay que sembrar para el vídeo.

\pset pager off
\echo '== empresa'
select to_jsonb(c) - 'created_at' - 'updated_at' from public.company c where c.id = :'empresa';
\echo '== proveedores (30)'
select s.id, s.name, s.legal_name, s.tax_id, right(coalesce(s.iban, ''), 8) as iban8, s.payment_method, s.payment_terms_days
  from public.supplier s where s.account_id = :'cuenta' order by s.name limit 30;
\echo '== recibidas por estado'
select si.status, count(*), count(*) filter (where si.paid_at is null) as sin_pagar
  from public.supplier_invoice si where si.account_id = :'cuenta' group by 1 order by 1;
\echo '== recibidas (20 últimas), una fila entera de ejemplo'
select to_jsonb(si) from public.supplier_invoice si where si.account_id = :'cuenta' order by si.created_at desc limit 1;
select si.id, si.status, si.invoice_number, si.invoice_date, si.grand_total, s.name as proveedor, si.payment_method
  from public.supplier_invoice si left join public.supplier s on s.id = si.supplier_id
 where si.account_id = :'cuenta' order by si.created_at desc limit 20;
\echo '== bancos de la empresa'
select t.id, t.name, t.kind, right(coalesce(t.iban, ''), 4) as iban4, t.is_active
  from public.treasury_account t where t.company_id = :'empresa' order by t.name;
\echo '== movimientos por estado'
select m.status, count(*) from public.bank_movement m where m.company_id = :'empresa' group by 1 order by 1;
\echo '== un movimiento casado de ejemplo, con su casado'
select to_jsonb(m) from public.bank_movement m where m.company_id = :'empresa' and m.status = 'casado' limit 1;
select to_jsonb(b) from public.bank_match b
 where b.id in (select i.match_id from public.bank_match_item i join public.bank_movement m on m.id = i.movement_id
                 where m.company_id = :'empresa' limit 1);
select to_jsonb(i) from public.bank_match_item i join public.bank_movement m on m.id = i.movement_id
 where m.company_id = :'empresa' limit 2;
\echo '== enlace con el agregador (Revolut)'
select l.provider, l.treasury_account_id from public.bank_aggregator_link l where l.company_id = :'empresa';
\echo '== personas de la cuenta (nombre que sale en la app)'
select to_jsonb(p) - 'avatar_url' from public.profiles p where p.account_id = :'cuenta' limit 5;
