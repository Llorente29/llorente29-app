-- supabase/vuelta-atras/20261103T1525_dm1_casa_lola_gastos.down.sql
-- Vuelta atrás de la 1525 (DM1·6 · Casa Lola con los gastos): Casa Lola como la dejó el real de la 1350.
-- Borra su contabilidad (solo si es de demo), devuelve demo_contabilidad_sembrar a su versión de la 1350 (del respaldo,
-- con su huella) y la siembra con ella. Los acreedores nuevos de Folvy (arrendador, luz, agua, gas y seguro) se quedan
-- sin factura, como proveedores de Cocina sin uso; la 1350 no los toca.
-- Solo Casa Lola (o el doble de la prueba, con demo.cuenta): cada borrado lleva su account_id (regla 9).
set local lock_timeout = '10s';
set constraints all immediate;

do $$
declare
  -- Casa Lola. La prueba de staging la apunta a su doble con demo.cuenta; en producción no la pone nadie.
  v_acc constant uuid := coalesce(nullif(current_setting('demo.cuenta', true), ''), '623d946a-a0ce-4f34-8c00-9761dfed8331')::uuid;
  v_emp uuid; r record; v_n bigint; v_pasada int := 0; v_hecho boolean; v_quedan text[]; v_partes uuid[];
begin
  -- Solo una cuenta de demo: nunca la contabilidad de una cuenta de verdad.
  if not exists (select 1 from public.accounts where id = v_acc and is_demo) then
    raise notice 'DEMO · borrar: la cuenta % no está o no es de demo: no se borra nada.', v_acc;
    return;
  end if;
  select id into v_emp from public.company where account_id = v_acc;
  if v_emp is not null then
    -- Los terceros que creó la semilla para cobrar cada canal (su 430).
    select coalesce(array_agg(distinct k.entity_id::uuid), '{}') into v_partes from public.company_account_link k
     where k.account_id = v_acc and k.company_id = v_emp and k.entity = 'customer';

    alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
    alter table public.journal_line disable trigger trg_journal_line_inalterable;

    -- Lo que cuelga sin company_id.
    delete from public.bank_match_item i where i.account_id = v_acc
       and i.match_id in (select m.id from public.bank_match m where m.account_id = v_acc and m.company_id = v_emp);
    delete from public.supplier_invoice_tax x where x.account_id = v_acc
       and x.supplier_invoice_id in (select s.id from public.supplier_invoice s where s.account_id = v_acc and s.company_id = v_emp);
    delete from public.supplier_invoice_payment_log x where x.account_id = v_acc
       and x.invoice_id in (select s.id from public.supplier_invoice s where s.account_id = v_acc and s.company_id = v_emp);

    -- Cada tabla con company_id, por pasadas, hasta que no quede nada de la empresa.
    loop
      v_pasada := v_pasada + 1; v_hecho := false; v_quedan := '{}';
      for r in select c.table_name from information_schema.columns c
                 join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.column_name = 'company_id' and c.table_name <> 'company'
                  and exists (select 1 from information_schema.columns a where a.table_schema = 'public' and a.table_name = c.table_name and a.column_name = 'account_id')
                order by c.table_name loop
        execute format('select count(*) from public.%I where account_id = $1 and company_id = $2', r.table_name) into v_n using v_acc, v_emp;
        continue when v_n = 0;
        begin
          execute format('delete from public.%I where account_id = $1 and company_id = $2', r.table_name) using v_acc, v_emp;
          v_hecho := true;
        exception when foreign_key_violation then
          v_quedan := v_quedan || r.table_name;
        end;
      end loop;
      exit when cardinality(v_quedan) = 0;
      if not v_hecho or v_pasada > 20 then
        raise exception 'DEMO · borrar: quedan filas de la empresa de Casa Lola que otra tabla sujeta: %', v_quedan;
      end if;
    end loop;

    alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
    alter table public.journal_line enable trigger trg_journal_line_inalterable;

    delete from public.customer_fiscal f where f.account_id = v_acc and f.party_id = any (v_partes);
    delete from public.party_role pr where pr.account_id = v_acc and pr.party_id = any (v_partes);
    delete from public.party p where p.account_id = v_acc and p.id = any (v_partes);
    delete from public.company where account_id = v_acc and id = v_emp;
  end if;

  if exists (select 1 from public.company where account_id = v_acc) then
    raise exception 'DEMO · borrar: la cuenta % sigue con empresa.', v_acc;
  end if;
end $$;

-- La función de la 1350, tal cual estaba (la respaldó la 1525; se comprueba su huella).
select public._restaurar_funcion('public.demo_contabilidad_sembrar(uuid)', '20261103T1525_dm1_casa_lola_gastos');

do $$
declare v_acc constant uuid := coalesce(nullif(current_setting('demo.cuenta', true), ''), '623d946a-a0ce-4f34-8c00-9761dfed8331')::uuid; v jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc and is_demo) then
    raise notice 'DEMO: la cuenta % no está o no es de demo (esto no es producción): no se siembra nada.', v_acc;
    return;
  end if;
  -- Las de trabajo de la siembra de la 1525, si van en la misma transacción (la prueba de staging).
  drop table if exists _demo_canal, _demo_prov, _demo_gasto, _demo_mov;
  v := public.demo_contabilidad_sembrar(v_acc);
  -- WARNING y no NOTICE: el ensayo de producción calla los NOTICE, y así su informe dice lo que sale.
  raise warning 'DEMO · %: %', v_acc, v - 'iva_4t';
end $$;
set local lock_timeout to default;
