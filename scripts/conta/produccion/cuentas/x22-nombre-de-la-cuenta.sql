-- scripts/conta/produccion/cuentas/x22-nombre-de-la-cuenta.sql
--
-- X22 · Cada cuenta, con su nombre guardado (1600 y 1610) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1600 cambia el texto de ocho funciones (su huella md5, una a una); la 1610 cambia el texto de las reglas del banco
-- que dicen la explicación de su cuenta en lugar de su nombre. Tabla entera, de todas las cuentas a propósito (regla 9,
-- excepción: es la huella de «esto no se ha movido» y lo que se cambia, en cualquier empresa).
-- Corte fijo: lo creado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'función · ' || p.oid::regprocedure::text clave, md5(p.prosrc) valor
    from pg_proc p
   where p.oid in ('public.bank_saldos_cuentas(uuid,date,text[])'::regprocedure, 'public.conta_banco_a_mano(uuid,date,text,text,numeric,text)'::regprocedure,
                   'public.conta_impuesto_retenciones_diario(uuid,integer,text)'::regprocedure, 'public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)'::regprocedure,
                   'public.conta_saldos_terceros(uuid,date)'::regprocedure, 'public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)'::regprocedure,
                   'public.conta_tpv_factura_de(uuid,date)'::regprocedure, 'public.conta_tpv_factura_guardar(uuid,text,text)'::regprocedure)
  union all
  select 2, 'tabla entera · bank_rule', count(*)::text
    from public.bank_rule where created_at < timestamptz '2026-11-22 00:00:00+01'
  union all
  select 3, 'todas las cuentas · reglas con la explicación de su cuenta', count(*)::text
    from public.bank_rule r
    join public.company_account ca on ca.company_id = r.company_id and ca.account_id = r.account_id and ca.code = r.target ->> 'cuenta'
   where r.created_at < timestamptz '2026-11-22 00:00:00+01'
     and ca.plain_name is not null and btrim(ca.plain_name) <> '' and ca.plain_name <> ca.name
     and position(' → ' || ca.plain_name || ' · ' || ca.code in r.words) > 0
  union all
  select 4, 'todas las cuentas · huella del texto de las reglas', coalesce(md5(string_agg(r.id::text || '=' || r.words, '|' order by r.id)), '-')
    from public.bank_rule r where r.created_at < timestamptz '2026-11-22 00:00:00+01'
  union all
  select 5, 'tabla entera · bank_rule_log de la tanda X22', count(*)::text
    from public.bank_rule_log where created_by_name = 'Tanda X22 · 1610' and created_at < timestamptz '2026-11-22 00:00:00+01'
  union all
  select 6, 'tabla entera · company_account', count(*)::text
    from public.company_account where created_at < timestamptz '2026-11-22 00:00:00+01'
) t order by o, clave;
