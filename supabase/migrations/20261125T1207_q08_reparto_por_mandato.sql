-- supabase/migrations/20261125T1207_q08_reparto_por_mandato.sql
--
-- Q08 · Tres clientes de GoCardless con el MISMO correo, uno por sociedad, estaban atados los tres por correo a la
-- misma ficha (Bitrix24 1487). Julio confirmó el reparto bueno el 25/11 por la cuenta del mandato de cada uno:
--
--   cliente de GoCardless           final de la cuenta   ficha de Bitrix24
--   CU01MJ0GT1D0GGKCZEYG04ZK8NGY    ··53                 1486
--   CU01MJ0GXMMY41SNZT9GRAV1BRA0    ··56                 1485
--   CU01MJ0H0ND1DSWM043Q99FTV1VK    ··49                 1487 (se queda)
--
-- Para cada uno escribe lo mismo que «Es esta» (conta_gc_enlace_confirmar), con «Julio · por la cuenta del mandato
-- (25/11)» como quien lo decidió:
--   · la decisión (conta_gestoria_decision, tipo enlace): es lo que lee la lectura de GoCardless de cada noche, que la
--     escribe siempre como «de una persona» y ya no lo vuelve a atar por correo (conta-gocardless-leer, plan.ts y
--     enlace.ts);
--   · el enlace (conta_gc_enlace): atado, por una persona, con su porqué y lo de antes en «antes»;
--   · los dos enlaces de antes (conta_gc_cliente.party_id y conta_cobro_cliente.gc_cliente_id);
--   · y los mandatos de Sumied de ese cliente (conta_mandato.party_id), que la lectura había puesto en la 1487.
--
-- Los busca por su id de GoCardless y la ficha por su nº de Bitrix24 en la misma cuenta (regla 9). LA GUARDA: si los
-- tres no están en una sola empresa, si la ficha no es una sola, o si el mandato no acaba en lo que dijo Julio, PARA
-- sin tocar nada. En una base sin esos tres (staging, la local), no hace nada.
--
-- Es un cambio de datos sobre lo que existe: SOLO con «autorizo». Vuelta atrás:
-- supabase/vuelta-atras/20261125T1207_q08_reparto_por_mandato.down.sql (de lo guardado en «antes»).
-- No toca recibos, cobros ni facturas. Nada en el camino del pedido. El real lo lanza Julio.

do $reparto$
declare
  v_quien constant text := 'Julio · por la cuenta del mandato (25/11)';
  v_hay int; v_empresas int; v_emp uuid; v_cuenta uuid; v_party uuid; v_n int; v_nombre text; v_gc text; v_antes jsonb; v_frase text;
  r record;
begin
  select count(*), count(distinct company_id) into v_hay, v_empresas from public.conta_gc_cliente
   where gc_id in ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', 'CU01MJ0GXMMY41SNZT9GRAV1BRA0', 'CU01MJ0H0ND1DSWM043Q99FTV1VK');
  if v_hay = 0 then
    raise notice 'Q08 · 1207: los tres clientes de GoCardless no están en esta base: nada que hacer.';
    return;
  end if;
  if v_hay <> 3 or v_empresas <> 1 then
    raise exception 'Q08 · 1207: están % de los 3 clientes de GoCardless, en % empresas (tienen que ser los 3 en una): PARA.', v_hay, v_empresas;
  end if;
  select company_id, account_id into v_emp, v_cuenta from public.conta_gc_cliente where gc_id = 'CU01MJ0H0ND1DSWM043Q99FTV1VK';

  -- La guarda entera ANTES de escribir nada.
  for r in select * from (values ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', '1486', '53'), ('CU01MJ0GXMMY41SNZT9GRAV1BRA0', '1485', '56'),
                                  ('CU01MJ0H0ND1DSWM043Q99FTV1VK', '1487', '49')) x(gc, bitrix, final) loop
    select count(*) into v_n from public.conta_gestoria_cliente where account_id = v_cuenta and bitrix_id = r.bitrix;
    if v_n <> 1 then raise exception 'Q08 · 1207: la ficha % de Bitrix24 sale % veces en la cuenta (tiene que ser 1): PARA.', r.bitrix, v_n; end if;
    if not exists (select 1 from public.conta_gc_mandato where company_id = v_emp and gc_cliente_id = r.gc and cuenta_final = r.final) then
      raise exception 'Q08 · 1207: el cliente % de GoCardless no tiene un mandato con la cuenta acabada en %: PARA.', r.gc, r.final;
    end if;
  end loop;

  for r in select * from (values ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', '1486', '53'), ('CU01MJ0GXMMY41SNZT9GRAV1BRA0', '1485', '56'),
                                  ('CU01MJ0H0ND1DSWM043Q99FTV1VK', '1487', '49')) x(gc, bitrix, final) loop
    select gcl.party_id, p.name into v_party, v_nombre from public.conta_gestoria_cliente gcl join public.party p on p.id = gcl.party_id
     where gcl.account_id = v_cuenta and gcl.bitrix_id = r.bitrix;
    select coalesce(nombre, gc_id) into v_gc from public.conta_gc_cliente where company_id = v_emp and gc_id = r.gc;
    v_frase := format('Enlazado: %s de GoCardless es %s (la cuenta del mandato acaba en %s).', v_gc, v_nombre, r.final);

    -- Lo de antes, para la vuelta atrás.
    v_antes := jsonb_build_object(
      'enlace', (select to_jsonb(e) - 'antes' from public.conta_gc_enlace e where e.company_id = v_emp and e.gc_cliente_id = r.gc),
      'gc_cliente', (select jsonb_build_object('party_id', g.party_id, 'casado_por', g.casado_por) from public.conta_gc_cliente g where g.company_id = v_emp and g.gc_id = r.gc),
      'cobro_cliente', (select to_jsonb(c) from public.conta_cobro_cliente c where c.company_id = v_emp and c.party_id = v_party),
      'mandatos', coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'party_id', cm.party_id))
                              from public.conta_mandato cm join public.conta_gc_mandato gm on gm.company_id = cm.company_id and gm.gc_id = cm.gc_mandato_id
                             where cm.company_id = v_emp and gm.gc_cliente_id = r.gc), '[]'::jsonb),
      'tanda', '20261125T1207_q08_reparto_por_mandato');

    -- 1 · La decisión: la lee la lectura de cada noche y la escribe como «de una persona».
    insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, porque, frase, quien, quien_name)
    values (v_cuenta, v_emp, 'enlace', v_party, r.gc, format('Por la cuenta del mandato (··%s), confirmado por Julio el 25/11.', r.final), v_frase, null, v_quien);

    -- 2 · El enlace.
    insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at, updated_at, antes)
    values (v_emp, r.gc, v_cuenta, v_party, 'persona', 'atado', '{}',
            format('%s dijo que es «%s»: la cuenta del mandato acaba en %s.', v_quien, v_nombre, r.final), null, v_quien, now(), now(), v_antes)
    on conflict (company_id, gc_cliente_id) do update set
      party_id = excluded.party_id, por = 'persona', estado = 'atado', candidatas = '{}', porque = excluded.porque,
      quien = null, quien_name = excluded.quien_name, decidido_at = excluded.decidido_at, updated_at = excluded.updated_at, antes = excluded.antes;

    -- 3 · Los dos enlaces de antes.
    update public.conta_gc_cliente set party_id = v_party, casado_por = 'persona' where company_id = v_emp and gc_id = r.gc;
    insert into public.conta_cobro_cliente (company_id, party_id, account_id, forma_cobro, gc_cliente_id, gc_casado_por, updated_by_name)
    values (v_emp, v_party, v_cuenta, 'gocardless', r.gc, 'persona', v_quien)
    on conflict (company_id, party_id) do update set gc_cliente_id = excluded.gc_cliente_id, gc_casado_por = 'persona',
      forma_cobro = coalesce(public.conta_cobro_cliente.forma_cobro, 'gocardless'), updated_at = now(), updated_by_name = excluded.updated_by_name;

    -- 4 · Los mandatos de Sumied de este cliente, a su ficha.
    update public.conta_mandato cm set party_id = v_party
      from public.conta_gc_mandato gm
     where gm.company_id = v_emp and gm.gc_cliente_id = r.gc and cm.company_id = v_emp and cm.gc_mandato_id = gm.gc_id and cm.party_id is distinct from v_party;

    raise notice 'Q08 · 1207: %', v_frase;
  end loop;
end $reparto$;
