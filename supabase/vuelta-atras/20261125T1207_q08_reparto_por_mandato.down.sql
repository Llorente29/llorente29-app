-- supabase/vuelta-atras/20261125T1207_q08_reparto_por_mandato.down.sql
--
-- Vuelta atrás de la 1207 (Q08 · el reparto por la cuenta del mandato). Deja los tres clientes de GoCardless como
-- estaban, de lo que la 1207 guardó en conta_gc_enlace.antes: el enlace, los dos enlaces de antes y los mandatos de
-- Sumied; y quita sus tres decisiones. Solo toca los que siguen como los dejó la 1207 (quien_name suyo): si alguien
-- los cambió después, no se pisa y lo dice. En una base sin ellos, no hace nada.

do $vuelta$
declare
  v_quien constant text := 'Julio · por la cuenta del mandato (25/11)';
  r record; a jsonb; e jsonb; c jsonb; v_n int := 0;
begin
  for r in select en.company_id, en.gc_cliente_id, en.party_id, en.antes from public.conta_gc_enlace en
            where en.gc_cliente_id in ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', 'CU01MJ0GXMMY41SNZT9GRAV1BRA0', 'CU01MJ0H0ND1DSWM043Q99FTV1VK') loop
    a := r.antes;
    if a is null or a->>'tanda' is distinct from '20261125T1207_q08_reparto_por_mandato'
       or (select quien_name from public.conta_gc_enlace where company_id = r.company_id and gc_cliente_id = r.gc_cliente_id) is distinct from v_quien then
      raise notice 'Q08 · 1207 vuelta atrás: % ya no es como lo dejó la 1207: no se toca.', r.gc_cliente_id;
      continue;
    end if;

    -- Los mandatos de Sumied, a la ficha que tenían.
    update public.conta_mandato cm set party_id = (m->>'party_id')::uuid
      from jsonb_array_elements(a->'mandatos') m where cm.id = (m->>'id')::uuid;

    -- conta_cobro_cliente de la ficha de ahora: como estaba, o fuera si no estaba.
    c := a->'cobro_cliente';
    if c is null or c = 'null'::jsonb then
      delete from public.conta_cobro_cliente where company_id = r.company_id and party_id = r.party_id and gc_cliente_id = r.gc_cliente_id and updated_by_name = v_quien;
    else
      update public.conta_cobro_cliente set gc_cliente_id = c->>'gc_cliente_id', gc_casado_por = c->>'gc_casado_por', forma_cobro = c->>'forma_cobro',
             updated_at = (c->>'updated_at')::timestamptz, updated_by_name = c->>'updated_by_name'
       where company_id = r.company_id and party_id = r.party_id;
    end if;

    -- conta_gc_cliente.
    update public.conta_gc_cliente set party_id = (a->'gc_cliente'->>'party_id')::uuid, casado_por = a->'gc_cliente'->>'casado_por'
     where company_id = r.company_id and gc_id = r.gc_cliente_id;

    -- Las decisiones de la 1207.
    delete from public.conta_gestoria_decision where company_id = r.company_id and gc_cliente_id = r.gc_cliente_id and tipo = 'enlace' and quien_name = v_quien;

    -- El enlace, como estaba (o fuera, si no había).
    e := a->'enlace';
    if e is null or e = 'null'::jsonb then
      delete from public.conta_gc_enlace where company_id = r.company_id and gc_cliente_id = r.gc_cliente_id;
    else
      update public.conta_gc_enlace set party_id = (e->>'party_id')::uuid, por = e->>'por', estado = e->>'estado',
             candidatas = coalesce(array(select jsonb_array_elements_text(e->'candidatas'))::uuid[], '{}'), porque = e->>'porque',
             quien = (e->>'quien')::uuid, quien_name = e->>'quien_name', decidido_at = (e->>'decidido_at')::timestamptz,
             updated_at = (e->>'updated_at')::timestamptz, antes = e->'antes'
       where company_id = r.company_id and gc_cliente_id = r.gc_cliente_id;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'Q08 · 1207 vuelta atrás: % de 3 como estaban.', v_n;
end $vuelta$;
