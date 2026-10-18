-- scripts/conta/diez/libros-iva-sumied.sql
--
-- I01b · Libros de IVA de Diez · el lado de Sumied del cruce (solo lectura,
-- con conta_lectura y la sesión en solo lectura). Los asientos traídos de Diez
-- de enero a septiembre de 2026 de la cuenta de Foodint (regla 9: por
-- account_id), con su clave de Diez y su IVA en céntimos. Lo lee
-- libros-iva-lectura.ts; no sale a ningún registro.
--   psql "$DB_URL" -v foodint=<cuenta> -X -A -t -f libros-iva-sumied.sql > sumied.json
select coalesce(json_agg(json_build_object(
         'e', je.external_year, 's', je.external_series, 'n', je.external_number::bigint, 'f', to_char(je.entry_date, 'YYYYMMDD'),
         'c477', coalesce((select round(sum(jl.credit - jl.debit) * 100)::bigint from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                            where jl.entry_id = je.id and ca.template_code like '477%'), 0),
         'c472', coalesce((select round(sum(jl.debit - jl.credit) * 100)::bigint from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                            where jl.entry_id = je.id and ca.template_code like '472%'), 0))), '[]')
  from public.journal_entry je
 where je.account_id = :'foodint'
   and je.source_type = 'migrated' and je.external_program = 'diez'
   and je.entry_date between date '2026-01-01' and date '2026-09-30';
