-- supabase/vuelta-atras/20261103T1350_dm1_casa_lola_contabilidad.down.sql
-- Vuelta atrás de la 1350 (DM1 · la contabilidad de demo de Casa Lola): Casa
-- Lola vuelve a estar sin empresa, como el 03/11 antes del real.
--
--   1. Todo lo de su empresa: cada fila de Casa Lola (account_id) de cada tabla
--      con company_id de esa empresa, y lo que cuelga de ellas sin company_id
--      (el IVA de cada recibida, los pagos, lo casado, los terceros que creó la
--      semilla para cobrar cada canal). Por pasadas: una tabla que aún sujeta
--      otra se intenta en la siguiente; si al final queda algo, para y no deja
--      nada a medias (todo va en la transacción del run).
--   2. Los asientos validados no se dejan borrar (trg_journal_entry_inalterable):
--      se apaga ese candado solo durante el borrado, como _conta_asientos_borrar
--      (S01q, 1837), y se vuelve a encender.
--   3. Los NIF inventados de sus seis proveedores (y de sus terceros) vuelven a
--      vacío, accounts.is_demo vuelve a como estaba (sin marcar) y la función
--      se quita.
--
-- Solo Casa Lola (623d946a…): cada borrado lleva su account_id (regla 9).
set local lock_timeout = '10s';
-- Lo diferido, antes de tocar los candados (ALTER TABLE no se deja con disparadores pendientes).
set constraints all immediate;
do $$
declare
  -- Casa Lola. La prueba de staging la apunta a su doble con demo.vuelta_cuenta; en producción no la pone nadie.
  v_acc constant uuid := coalesce(nullif(current_setting('demo.vuelta_cuenta', true), ''), '623d946a-a0ce-4f34-8c00-9761dfed8331')::uuid;
  v_emp uuid; r record; v_n bigint; v_pasada int := 0; v_hecho boolean; v_quedan text[]; v_partes uuid[];
begin
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
        raise exception 'Vuelta atrás de la 1350: quedan filas de la empresa de Casa Lola que otra tabla sujeta: %', v_quedan;
      end if;
    end loop;

    alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
    alter table public.journal_line enable trigger trg_journal_line_inalterable;

    delete from public.customer_fiscal f where f.account_id = v_acc and f.party_id = any (v_partes);
    delete from public.party_role pr where pr.account_id = v_acc and pr.party_id = any (v_partes);
    delete from public.party p where p.account_id = v_acc and p.id = any (v_partes);
    delete from public.company where account_id = v_acc and id = v_emp;
  end if;

  -- Los NIF inventados de sus proveedores, otra vez vacíos.
  update public.party p set tax_id = null
   where p.account_id = v_acc and p.tax_id in ('B00000026', 'B00000034', 'B00000042', 'B00000059', 'B00000067', 'B00000075');
  update public.supplier s set tax_id = null, tax_id_type = null
   where s.account_id = v_acc and s.tax_id in ('B00000026', 'B00000034', 'B00000042', 'B00000059', 'B00000067', 'B00000075');
  update public.accounts set is_demo = null where id = v_acc and is_demo;

  if exists (select 1 from public.company where account_id = v_acc) then
    raise exception 'Vuelta atrás de la 1350: Casa Lola sigue con empresa.';
  end if;
end $$;
drop function if exists public.demo_contabilidad_sembrar(uuid);
set local lock_timeout to default;
