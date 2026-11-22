-- scripts/conta/produccion/cuentas/k12-asiento-general.sql
--
-- K12 · El asiento general · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Regla 31: la tanda añade una columna fuera de la huella (journal_entry.notes), un ancho por persona, una clase de
-- documento y funciones que nadie llama hasta que se usan. Por empresa (con su cuenta, regla 9): cuántos asientos
-- validados tiene, la huella de todos ellos (journal_entry_canonico, la misma que encadena), los eslabones rotos de
-- su cadena y cuántos documentos tiene cada asiento por clase. Todo igual antes y después. Corte fijo: lo validado
-- antes del 23/11/2026.
with e as (
  select j.account_id, j.company_id, j.id, j.chain_seq
    from public.journal_entry j
   where j.status in ('validado', 'anulado') and j.validated_at < timestamptz '2026-11-23 00:00:00+01'
)
select clave, valor from (
  select e.account_id, e.company_id,
         'cuenta ' || left(e.account_id::text, 8) || ' · empresa ' || left(e.company_id::text, 8)
           || ' · regla 31: asientos validados · huella de todos · eslabones rotos · documentos por clase' clave,
         count(*)::text || ' · ' || left(md5(string_agg(public.journal_entry_canonico(e.id), '§' order by e.chain_seq, e.id)), 12)
           || ' · ' || public._conta_cadena_rota(e.company_id)::text
           || ' · ' || coalesce((select string_agg(d.kind || '=' || d.n, ',' order by d.kind)
                                   from (select x.kind, count(*) n from public.journal_entry_document x
                                          where x.company_id = e.company_id and x.account_id = e.account_id group by x.kind) d), 'ninguno') valor
    from e group by e.account_id, e.company_id
) t order by account_id, company_id;
