-- scripts/conta/produccion/cuentas/v04-recibida-entrada.sql
--
-- V04 · Respuesta 6, punto 2 (27/10) · LO QUE CUENTA LA TANDA DE LA FECHA DE
-- ENTRADA DE LAS RECIBIDAS, antes y después. SOLO LEE. Los asientos son de
-- Foodint (regla 9), con un corte fijo (W06). Lo que la tanda crea solo se
-- nombra dentro de cadenas.
-- Lo que tiene que cambiar: la función nueva (0 → 1) y la huella de
-- _journal_entry_proponer. Lo demás, igual: lo ya asentado no se toca.
select clave, valor from (
  select 1 o, 'recibidas de Foodint validadas hasta el corte (con el asiento antes de su entrada / todas)' clave,
    (select count(*) filter (where e.entry_date < (si.created_at at time zone 'Europe/Madrid')::date) || ' / ' || count(*)
       from public.journal_entry e join public.supplier_invoice si on si.id = e.source_id and si.account_id = e.account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'supplier_invoice' and e.status = 'validado'
        and e.created_at < timestamptz '2026-10-27 06:00:00+00') valor union all
  select 2, 'la función de la fecha de entrada (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = '_conta_recibida_no_antes_de_entrar')::text union all
  select 3, 'huella de _journal_entry_proponer',
    (select left(md5(pg_get_functiondef(p.oid)), 8) from pg_proc p where p.oid = 'public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)
) t order by o;
