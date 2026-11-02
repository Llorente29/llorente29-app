-- supabase/migrations/20261101T2212_s01o2_iva_no_deducible_solo.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
-- cambia: public.supplier_invoice_tax · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
--
-- S01o·2 · El IVA que no se puede deducir lo sabe Sumied solo (Julio, 01/11,
-- respuesta 6, decisiones 2 y 4). Dos reglas distintas que llevan a lo mismo
-- (la base y la cuota a la misma cuenta de gasto, nada a la 472):
--   · NO VIENE A NOMBRE DE LA EMPRESA: la factura se leyó de su documento y el
--     destinatario no trae el NIF de la empresa (no está, o es otro). Para
--     cualquier empresa de Sumied. No se aplica a lo que no sale de leer un papel
--     (un lote de riders, la liquidación de Just Eat), que no tiene destinatario
--     que leer: medido el 01/11, 116 de las 122 sin NIF de destinatario son de esas.
--   · SIN ROI: un proveedor de la UE (intracomunitario) que cobra IVA español a
--     una empresa que no está en el ROI. «¿Estás en el ROI?» vive en
--     company_tax_profile.en_roi; sin contestar, no se decide (sale la pregunta).
--
--   1. company_tax_profile.en_roi; el motivo «sin_roi» en supplier_invoice (el
--      CHECK solo amplía).
--   2. _conta_iva_no_deducible_auto(factura): si su IVA no se deduce, por qué, en una frase cada motivo.
--   3. Disparador: al leerla o al cambiar de proveedor, si una persona no lo ha
--      decidido ya (sin motivo), la marca no deducible con su motivo. Nunca con su asiento validado.
--   4. Validar acepta el IVA español de un proveedor de la UE apuntado como NO
--      deducible (regla 11), sobre la definición VIVA, con su respaldo.

alter table public.company_tax_profile add column if not exists en_roi boolean;
comment on column public.company_tax_profile.en_roi is 'S01o·2 · ¿Está la empresa en el ROI (registro de operadores intracomunitarios)? Vacío: no se sabe (se pregunta).';

alter table public.supplier_invoice drop constraint if exists supplier_invoice_vat_non_deductible_reason_check;
alter table public.supplier_invoice add constraint supplier_invoice_vat_non_deductible_reason_check
  check (vat_non_deductible_reason is null or vat_non_deductible_reason in ('no_a_nombre', 'ticket_sin_nif', 'otro', 'sin_roi'));

create or replace function public._conta_iva_no_deducible_auto(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v public.supplier_invoice; c public.company; v_dest text; v_empresa text; v_clase text; v_roi boolean; v_m jsonb := '[]'::jsonb; v_iva boolean;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return null; end if;
  select * into c from public.company where id = v.company_id and account_id = v.account_id;
  v_empresa := coalesce(nullif(btrim(c.legal_name), ''), 'la empresa');
  v_iva := exists (select 1 from public.supplier_invoice_tax t where t.supplier_invoice_id = v.id and coalesce(t.vat_pct, 0) > 0 and coalesce(t.vat_amount, 0) <> 0);
  if not v_iva then return jsonb_build_object('no_deducible', false, 'motivos', v_m); end if;
  -- No viene a nombre de la empresa: leída de su documento, y su destinatario sin el NIF de la empresa.
  if v.reading ? 'factura' and coalesce(v.source, '') not in ('lote', 'liquidacion') and public._conta_nif_clave(c.tax_id) is not null then
    v_dest := public._conta_nif_clave(v.reading->'factura'->'destinatario'->>'nif');
    if v_dest is distinct from public._conta_nif_clave(c.tax_id) then
      v_m := v_m || jsonb_build_object('motivo', 'no_a_nombre', 'texto', format('No viene a nombre de %s: el IVA no se puede deducir y va al gasto.', v_empresa));
    end if;
  end if;
  -- Sin ROI: proveedor de la UE que cobra IVA español.
  select public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime) into v_clase
    from public.supplier s where s.id = v.supplier_id and s.account_id = v.account_id;
  if v_clase = 'intracomunitaria' then
    select p.en_roi into v_roi from public.company_tax_profile p where p.company_id = v.company_id and p.account_id = v.account_id;
    if v_roi is false then
      v_m := v_m || jsonb_build_object('motivo', 'sin_roi', 'texto', format('Es de un proveedor de la UE que cobra IVA español y %s no está en el ROI: el IVA no se puede deducir y va al gasto.', v_empresa));
    elsif v_roi is null then
      return jsonb_build_object('no_deducible', jsonb_array_length(v_m) > 0, 'motivos', v_m, 'falta_roi', true);
    end if;
  end if;
  return jsonb_build_object('no_deducible', jsonb_array_length(v_m) > 0, 'motivos', v_m);
end $$;
revoke all on function public._conta_iva_no_deducible_auto(uuid) from public, anon;
grant execute on function public._conta_iva_no_deducible_auto(uuid) to authenticated;

-- Marcarla sola (después de guardarla: las líneas de IVA y el proveedor ya están). Lo que decidió una persona no se toca.
create or replace function public.tg_s01o2_iva_no_deducible()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if new.vat_non_deductible_reason is not null or new.status in ('anulada', 'descartada', 'repetida') then return null; end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = new.id and e.status = 'validado') then return null; end if;
  r := public._conta_iva_no_deducible_auto(new.id);
  if coalesce((r->>'no_deducible')::boolean, false) then
    update public.supplier_invoice set vat_non_deductible = true, vat_non_deductible_reason = r->'motivos'->0->>'motivo', updated_at = now()
     where id = new.id and vat_non_deductible_reason is null;
  end if;
  return null;
end $$;
drop trigger if exists s01o2_iva_no_deducible on public.supplier_invoice;
create trigger s01o2_iva_no_deducible after insert or update of reading, supplier_id on public.supplier_invoice
  for each row execute function public.tg_s01o2_iva_no_deducible();

-- Las líneas de IVA llegan después de la factura: al guardarlas, se vuelve a mirar (tocando su lectura, como al leerla).
create or replace function public.tg_s01o2_iva_no_deducible_linea()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.supplier_invoice set reading = reading where id = new.supplier_invoice_id and vat_non_deductible_reason is null;
  return null;
end $$;
drop trigger if exists s01o2_iva_no_deducible_linea on public.supplier_invoice_tax;
create trigger s01o2_iva_no_deducible_linea after insert on public.supplier_invoice_tax
  for each row execute function public.tg_s01o2_iva_no_deducible_linea();

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261101T2212_s01o2_iva_no_deducible_solo');

do $$
declare v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure); v_antes constant text := 'when ''intracomunitaria'' then t.treatment = ''intra_eu'''; v_n int;
begin
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: conta_motivos_para_validar no tiene una sola vez la regla 11 que se cambia (la tiene % veces): no se cambia nada.', v_n; end if;
  execute replace(v_def, v_antes, 'when ''intracomunitaria'' then t.treatment = ''intra_eu''
                   -- S01o·2: el IVA español de un proveedor de la UE, apuntado como NO deducible (al gasto): sin ROI o no a nombre de la empresa.
                   or (t.treatment = ''taxed'' and l.vat_deductible = ''no'')');
end $$;
