-- scripts/conta/g06/cuadre.sql
--
-- G06 · El cuadre de GoCardless frente a Bitrix24 en QBO, y la huella de los dos enlaces de ahora. SOLO LEE.
-- Lo usa la persona que prepara el real (antes y después del ensayo y del real, la misma consulta: regla 31). No va en
-- la cuenta de la tanda porque lee tablas que la lectura de GoCardless reescribe en cualquier momento.
-- La tabla del G06 (conta_gc_enlace) solo se nombra dentro de cadenas: vale antes y después de la tanda.
--
-- La regla de «cuadra» (encargo G06 y nº 140): por cliente, la suma de sus suscripciones activas de GoCardless (€/mes)
-- cuadra si es igual a Cuota mensual + Laboral + ContaSimple, o a la Tarifa recurrente × 1,21, o, en los clientes de
-- Anny (dc43e21d…), a la base × 1,06 (IVA menos el 15 %; base: la Tarifa recurrente o, si no, la suma / 1,21).
select clave, valor from (
  select 1 o, 'los dos enlaces de ahora, su huella (base entera)' clave,
    (select left(md5(coalesce(string_agg(g.company_id || g.gc_id || coalesce(g.party_id::text, '-') || coalesce(g.casado_por, '-'), ',' order by g.company_id, g.gc_id), '')), 12)
       from public.conta_gc_cliente g) || ' / ' ||
    (select left(md5(coalesce(string_agg(c.company_id || c.party_id::text || coalesce(c.gc_cliente_id, '-') || coalesce(c.gc_casado_por, '-'), ',' order by c.company_id, c.party_id), '')), 12)
       from public.conta_cobro_cliente c) valor union all
  select 2, 'cuadre de QBO con los dos enlaces de ahora: cuadran · importe distinto · se cobra y no está activo · sin ficha · activo sin cobro',
    (with gc as (select s.company_id, s.gc_cliente_id, round(sum(s.al_mes) * 100) cent from public.conta_gc_suscripcion s
                  where s.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' and s.estado = 'active' and s.gc_cliente_id is not null group by 1, 2 having sum(s.al_mes) > 0),
          enl as (select gc.*, coalesce(g.party_id, (select cc.party_id from public.conta_cobro_cliente cc where cc.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655'
                    and cc.company_id = gc.company_id and cc.gc_cliente_id = gc.gc_cliente_id order by cc.updated_at desc limit 1)) party
                    from gc left join public.conta_gc_cliente g on g.company_id = gc.company_id and g.gc_id = gc.gc_cliente_id),
          fic as (select f.party_id, bool_or(f.situacion = 'activo') activo,
                    sum(case when e->>'etiqueta' in ('Cuota mensual', 'Laboral', 'ContaSimple') then coalesce((e->>'importeCent')::numeric, 0) else 0 end) b,
                    max(case when e->>'etiqueta' = 'Tarifa recurrente' then (e->>'importeCent')::numeric end) tr
                    from public.conta_gestoria_cliente f left join lateral jsonb_array_elements(coalesce(f.ficha->'cuotasReferencia', '[]')) e on true
                   where f.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' group by 1),
          pp as (select party, bool_or(company_id = 'dc43e21d-2992-4eb3-a378-c867f86d6644') anny, sum(cent) cent from enl where party is not null group by 1),
          cli as (select 'sin' g from enl where party is null
            union all select case when not coalesce(f.activo, false) then 'noact'
              when abs(p.cent - coalesce(f.b, 0)) <= 1 or (f.tr is not null and abs(p.cent - round(f.tr * 1.21)) <= 1)
                or (p.anny and abs(p.cent - round(coalesce(f.tr, round(f.b / 1.21)) * 1.06)) <= 1) then 'cuadra' else 'dist' end
              from pp p left join fic f on f.party_id = p.party
            union all select 'sincobro' from fic f where f.activo and (f.b > 0 or f.tr > 0) and not exists (select 1 from pp p where p.party = f.party_id))
     select count(*) filter (where g = 'cuadra') || ' · ' || count(*) filter (where g = 'dist') || ' · ' || count(*) filter (where g = 'noact') || ' · '
            || count(*) filter (where g = 'sin') || ' · ' || count(*) filter (where g = 'sincobro') from cli) union all
  select 3, 'cuadre de QBO con el enlace único: cuadran · importe distinto · se cobra y no está activo · sin ficha · en conflicto · activo sin cobro',
    case when to_regclass('public.conta_gc_enlace') is null then 'no existe' else
      (xpath('/row/v/text()', query_to_xml('
       with gc as (select s.company_id, s.gc_cliente_id, round(sum(s.al_mes) * 100) cent from public.conta_gc_suscripcion s
                    where s.account_id = ''f4e8032d-510a-4e57-914c-4b67732d8655'' and s.estado = ''active'' and s.gc_cliente_id is not null group by 1, 2 having sum(s.al_mes) > 0),
            enl as (select gc.*, e.party_id party, e.estado from gc left join public.conta_gc_enlace e on e.company_id = gc.company_id and e.gc_cliente_id = gc.gc_cliente_id),
            fic as (select f.party_id, bool_or(f.situacion = ''activo'') activo,
                      sum(case when x->>''etiqueta'' in (''Cuota mensual'', ''Laboral'', ''ContaSimple'') then coalesce((x->>''importeCent'')::numeric, 0) else 0 end) b,
                      max(case when x->>''etiqueta'' = ''Tarifa recurrente'' then (x->>''importeCent'')::numeric end) tr
                      from public.conta_gestoria_cliente f left join lateral jsonb_array_elements(coalesce(f.ficha->''cuotasReferencia'', ''[]'')) x on true
                     where f.account_id = ''f4e8032d-510a-4e57-914c-4b67732d8655'' group by 1),
            pp as (select party, bool_or(company_id = ''dc43e21d-2992-4eb3-a378-c867f86d6644'') anny, sum(cent) cent from enl where estado = ''atado'' group by 1),
            cli as (select case when estado = ''conflicto'' then ''conf'' else ''sin'' end g from enl where estado is distinct from ''atado''
              union all select case when not coalesce(f.activo, false) then ''noact''
                when abs(p.cent - coalesce(f.b, 0)) <= 1 or (f.tr is not null and abs(p.cent - round(f.tr * 1.21)) <= 1)
                  or (p.anny and abs(p.cent - round(coalesce(f.tr, round(f.b / 1.21)) * 1.06)) <= 1) then ''cuadra'' else ''dist'' end
                from pp p left join fic f on f.party_id = p.party
              union all select ''sincobro'' from fic f where f.activo and (f.b > 0 or f.tr > 0) and not exists (select 1 from pp p where p.party = f.party_id))
       select count(*) filter (where g = ''cuadra'') || '' · '' || count(*) filter (where g = ''dist'') || '' · '' || count(*) filter (where g = ''noact'') || '' · ''
              || count(*) filter (where g = ''sin'') || '' · '' || count(*) filter (where g = ''conf'') || '' · '' || count(*) filter (where g = ''sincobro'') v from cli
      ', false, true, '')))[1]::text end
) t order by o;
