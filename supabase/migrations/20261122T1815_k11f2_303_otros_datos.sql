-- supabase/migrations/20261122T1815_k11f2_303_otros_datos.sql
--
-- K11f2 · El 303 lee dos casillas de «Otros datos» de la recibida (K11a), y el contraasiento copia la plataforma (Julio,
-- 22/11: «el 303 y la plataforma del contraasiento»; el 347 entero va en el K11g). Vacías, lo de siempre: ningún 303
-- presentado cambia un céntimo (regla 31, k11f2-303-otros-datos.sql).
--
-- cambia: public.conta_impuesto_303_cajas · prueba: supabase/staging/sql/20261122_k11f2_303_otros_datos_prueba.sql
--   A qué casillas del 303 va cada apunte del libro de IVA. Si su recibida (supplier_invoice, por source_type y
--   source_id, con su cuenta) tiene marcada «No incluir en declaración de IVA», a ninguna (y tampoco es un «no sé»).
--   Si tiene marcada «Rectificación de deducciones», a la [40] (base) y la [41] (cuota deducible), como una
--   rectificativa recibida. Sin marcar, igual que antes.
-- cambia: public.journal_entry_anular · prueba: supabase/staging/sql/20261122_k11f2_303_otros_datos_prueba.sql
--   El contraasiento copia también la plataforma de cada línea (journal_line.channel_id, del K11a), como ya copiaba el
--   local y la marca. La huella (journal_entry_canonico) no lee la plataforma: no cambia ninguna.
--
-- Las dos con la MISMA firma y su cuerpo vigente con sus trozos cambiados; respaldo antes, para la vuelta atrás.
-- sin hueco: el fichero no retira nada.
-- Nada en el camino del pedido. El real lo lanza Julio.
-- Vuelta atrás: supabase/vuelta-atras/20261122T1815_k11f2_303_otros_datos.down.sql

select public._respaldar_funcion('public.conta_impuesto_303_cajas(vat_book_entry)', '20261122T1815_k11f2_303_otros_datos');
select public._respaldar_funcion('public.journal_entry_anular(uuid,text,date,text)', '20261122T1815_k11f2_303_otros_datos');

-- Cambia en una función los trozos dados (cada uno tiene que estar una sola vez), salvo si ya lleva su marca.
create or replace function pg_temp.k11f2_trozos(p_firma text, p_marca text, p_trozos text[][]) returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_firma::regprocedure); i int;
begin
  if strpos(v_def, p_marca) > 0 then return; end if;   -- ya pasada
  for i in 1 .. array_length(p_trozos, 1) loop
    if (length(v_def) - length(replace(v_def, p_trozos[i][1], ''))) / length(p_trozos[i][1]) <> 1 then
      raise exception 'K11f2: % no es la medida (el trozo % no está una sola vez): no se toca.', p_firma, i;
    end if;
    v_def := replace(v_def, p_trozos[i][1], p_trozos[i][2]);
  end loop;
  execute v_def;
end $$;

-- El 303: las dos casillas de «Otros datos» de su recibida.
select pg_temp.k11f2_trozos('public.conta_impuesto_303_cajas(vat_book_entry)', 'K11f2: otros datos', array[
  [$v$    from (select 1) uno
    cross join lateral (select
      case
        when coalesce(v.surcharge_amount, 0) <> 0 then 'recargo'$v$,
   $n$    from (select 1) uno
    -- K11f2: otros datos de su recibida («No incluir en declaración de IVA» y «Rectificación de deducciones»).
    cross join lateral (select coalesce(bool_or(si.exclude_from_vat_return), false) as fuera, coalesce(bool_or(si.deduction_rectification), false) as rectifica
                          from public.supplier_invoice si
                         where v.source_type = 'supplier_invoice' and si.id = v.source_id and si.account_id = v.account_id) f
    cross join lateral (select
      case
        when f.fuera then null
        when coalesce(v.surcharge_amount, 0) <> 0 then 'recargo'$n$],
  [$v$        when n.no_sabe is not null then '{}'::text[]$v$,
   $n$        when f.fuera then '{}'::text[]
        when n.no_sabe is not null then '{}'::text[]
        when f.rectifica and v.book in ('received', 'investment') then array['40', '41']$n$]]);

-- El contraasiento: también la plataforma.
select pg_temp.k11f2_trozos('public.journal_entry_anular(uuid,text,date,text)', 'K11f2: la plataforma', array[
  [$v$                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)$v$,
   $n$                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model,
                                   channel_id)   -- K11f2: la plataforma$n$],
  [$v$         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
    from public.journal_line where entry_id = v_e.id;$v$,
   $n$         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model,
         channel_id
    from public.journal_line where entry_id = v_e.id;$n$]]);
