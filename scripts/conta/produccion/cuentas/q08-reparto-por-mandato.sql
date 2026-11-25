-- scripts/conta/produccion/cuentas/q08-reparto-por-mandato.sql
--
-- Q08 · El reparto por la cuenta del mandato (1207) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: los tres clientes de GoCardless de la 1207, cada uno con la ficha de Bitrix24 que dijo
-- Julio (1486, 1485, 1487) en su enlace, en conta_gc_cliente y en conta_cobro_cliente; sus decisiones (0 → 1 cada uno);
-- sus mandatos de Sumied. Lo demás, igual: los demás enlaces de la empresa de esos tres (su huella: a qué ficha, por
-- qué y en qué estado; no la hora, que la lectura de cada noche reescribe aunque no cambie nada). De la empresa de esos
-- tres clientes (regla 9).
with tres(gc, bitrix) as (values ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', '1486'), ('CU01MJ0GXMMY41SNZT9GRAV1BRA0', '1485'), ('CU01MJ0H0ND1DSWM043Q99FTV1VK', '1487')),
cuenta as (select distinct account_id, company_id from public.conta_gc_cliente where gc_id in (select gc from tres))
select clave, valor from (
  select 1 o, 'enlace · ' || t.gc clave,
         coalesce((select coalesce(g.bitrix_id, '?') || ' · ' || e.por || ' · ' || e.estado from public.conta_gc_enlace e join cuenta c on c.company_id = e.company_id
                    left join public.conta_gestoria_cliente g on g.account_id = c.account_id and g.party_id = e.party_id where e.gc_cliente_id = t.gc), '-') valor
    from tres t
  union all
  select 2, 'gc_cliente · ' || t.gc,
         coalesce((select coalesce(g.bitrix_id, '?') || ' · ' || coalesce(x.casado_por, '-') from public.conta_gc_cliente x join cuenta c on c.company_id = x.company_id
                    left join public.conta_gestoria_cliente g on g.account_id = c.account_id and g.party_id = x.party_id where x.gc_id = t.gc), '-')
    from tres t
  union all
  select 3, 'cobro_cliente de la ficha ' || t.bitrix,
         coalesce((select cc.gc_cliente_id || ' · ' || coalesce(cc.gc_casado_por, '-') from public.conta_cobro_cliente cc join cuenta c on c.company_id = cc.company_id
                    join public.conta_gestoria_cliente g on g.account_id = c.account_id and g.party_id = cc.party_id and g.bitrix_id = t.bitrix), '-')
    from tres t
  union all
  select 4, 'decisiones de enlace · ' || t.gc, (select count(*) from public.conta_gestoria_decision d join cuenta c on c.company_id = d.company_id
                                                  where d.gc_cliente_id = t.gc and d.tipo = 'enlace')::text
    from tres t
  union all
  select 5, 'mandatos de Sumied · ' || t.gc,
         coalesce((select string_agg(coalesce(g.bitrix_id, '?'), ',' order by cm.gc_mandato_id) from public.conta_mandato cm join cuenta c on c.company_id = cm.company_id
                    join public.conta_gc_mandato gm on gm.company_id = cm.company_id and gm.gc_id = cm.gc_mandato_id
                    left join public.conta_gestoria_cliente g on g.account_id = c.account_id and g.party_id = cm.party_id where gm.gc_cliente_id = t.gc), '-')
    from tres t
  union all
  select 6, 'quietos · huella de los demás enlaces de la empresa',
         coalesce(md5(string_agg(e.gc_cliente_id || '=' || coalesce(e.party_id::text, '') || e.por || e.estado, '|' order by e.gc_cliente_id)), '-')
    from public.conta_gc_enlace e join cuenta c on c.company_id = e.company_id
   where e.gc_cliente_id not in (select gc from tres)
) t order by o, clave;
