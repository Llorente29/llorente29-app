-- supabase/migrations/20261117T1807_n06a_carga_embudo.sql
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
-- cambia: public._conta_facturas_apuntar · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
-- cambia: public.tg_s01o2_iva_no_deducible · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
-- cambia: public.customer_invoice_inalterable · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
-- cambia: public.import_run · prueba: supabase/staging/sql/20261117_n06a_carga_prueba.sql
--
-- N06a · Traer de otro programa: la carga en prueba y deshacerla (17/11). 2 de 3: LO QUE CAMBIA.
-- Va después de la 1806 (las columnas) y antes de la 1808 (las funciones, que usan esto).
--
--   1. import_run.kind admite «carga» (la fila madre de una carga, 3.1 del N06). El CHECK solo
--      AMPLÍA: todas las filas de hoy siguen valiendo.
--   2. _journal_entry_proponer (EL EMBUDO: por aquí pasan todos los asientos de Sumied). Dos trozos:
--      a) el INSERT escribe además external_program/_year/_series/_number y import_run_id, que salen
--         de p_entry->'externo' y p_entry->>'carga'; y el estado es «borrador» si source_type es
--         «migrated» y «propuesto» si no. Para todo lo que no es traído, esas cinco columnas salen
--         nulas (ninguna llamada de hoy lleva «externo» ni «carga»: medido en el repositorio) y el
--         estado, «propuesto»: la fila es la misma, campo a campo (medido en la prueba con una
--         propuesta de cada clase, regla 31).
--      b) dos paradas antes del candado del IVA: lo traído solo entra con su carga en prueba de esa
--         empresa; y a una factura traída no se le propone asiento (ya trae el suyo).
--   3. conta_motivos_para_validar: un asiento de una carga en prueba no se valida a mano (decisión
--      5 de la respuesta N05c · 1). HOY SÍ SE PODRÍA: a lo traído («migrated») se le saltan casi
--      todas las reglas y el libro diario lo valida como cualquier borrador. Se valida al darla por
--      buena (N06b).
--   4. _conta_facturas_apuntar (la pasada que propone el asiento de las recibidas): no mira las
--      traídas. Hoy las cogería: busca «en_revision» y «aprobada» sin asiento de factura.
--   5. tg_s01o2_iva_no_deducible: no decide por su cuenta que el IVA de una traída no es deducible
--      (lo dice su libro de allí).
--   6. customer_invoice_inalterable: una emitida TRAÍDA de una carga EN PRUEBA se puede borrar (al
--      deshacer). Cualquier otra emitida, como hoy: no se borra nunca.
--
-- Cada función: misma firma, su respaldo antes (para la vuelta atrás) y el cuerpo vigente con su
-- trozo cambiado por reemplazo exacto (si el trozo no está una sola vez, para y no toca nada).
-- No cambia ni una fila. Nada en el camino del pedido (ninguna es de pedidos, cocina ni reparto).

-- 1 · import_run.kind admite «carga».
alter table public.import_run drop constraint if exists import_run_kind_check;
alter table public.import_run add constraint import_run_kind_check check (kind = any (array[
  'historico', 'al_dia', 'documentos', 'sumas_saldos', 'plan_cuentas', 'terceros', 'inmovilizado', 'diario', 'recibidas',
  'emitidas', 'declaraciones', 'carga']));

select public._respaldar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261117T1807_n06a_carga_embudo');
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261117T1807_n06a_carga_embudo');
select public._respaldar_funcion('public._conta_facturas_apuntar(uuid)', '20261117T1807_n06a_carga_embudo');
select public._respaldar_funcion('public.tg_s01o2_iva_no_deducible()', '20261117T1807_n06a_carga_embudo');
select public._respaldar_funcion('public.customer_invoice_inalterable()', '20261117T1807_n06a_carga_embudo');

-- 2 · El embudo.
do $do$
declare
  v_def text := pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure);
  v_viejo1 text := $viejo$  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;
$viejo$;
  v_nuevo1 text := $nuevo$  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name,
                                    external_program, external_year, external_series, external_number, import_run_id)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen,
          -- N06a · lo traído de otro programa entra en borrador, con su número de allí y su carga.
          case when v_tipo = 'migrated' then 'borrador' else 'propuesto' end,
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'),
          p_entry->'externo'->>'programa', p_entry->'externo'->>'ejercicio', p_entry->'externo'->>'serie', p_entry->'externo'->>'numero',
          nullif(p_entry->>'carga', '')::uuid)
  returning id into v_id;
$nuevo$;
  v_viejo2 text := $viejo$  -- V04 · candado del IVA (1233): una recibida que llega a un periodo cuyo IVA
$viejo$;
  v_nuevo2 text := $nuevo$  -- N06a · Lo traído de otro programa solo entra con su carga, en prueba y de esta empresa.
  if v_tipo = 'migrated' and not exists (select 1 from public.import_run r where r.id = nullif(p_entry->>'carga', '')::uuid
                                            and r.company_id = p_company and r.kind = 'carga' and r.status = 'en_prueba') then
    raise exception 'Lo traído de otro programa entra solo con su carga, en prueba.' using errcode = '23514', hint = 'sin_carga';
  end if;
  -- N06a · Una factura traída ya tiene su asiento traído (o se dejó sin casar a propósito): no se le propone otro.
  if (v_tipo = 'supplier_invoice' and exists (select 1 from public.supplier_invoice f where f.id = v_origen and f.source = 'traida'))
     or (v_tipo = 'customer_invoice' and exists (select 1 from public.customer_invoice f where f.id = v_origen and f.origin = 'traida')) then
    raise exception 'Esta factura es traída de otro programa y su asiento es el de allí: no se le propone otro.' using errcode = '23514', hint = 'factura_traida';
  end if;

  -- V04 · candado del IVA (1233): una recibida que llega a un periodo cuyo IVA
$nuevo$;
begin
  if strpos(v_def, 'N06a · lo traído de otro programa entra en borrador') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo1, ''))) / length(v_viejo1) <> 1
     or (length(v_def) - length(replace(v_def, v_viejo2, ''))) / length(v_viejo2) <> 1 then
    raise exception 'N06a: _journal_entry_proponer no es la medida (un trozo no está una sola vez): no se toca.';
  end if;
  execute replace(replace(v_def, v_viejo1, v_nuevo1), v_viejo2, v_nuevo2);
end $do$;

-- 3 · Lo de una carga en prueba no se valida a mano.
do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo text := $viejo$  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
$viejo$;
  v_nuevo text := $nuevo$  -- N06a · Lo de una carga en prueba no se valida a mano: se valida entero al darla por bueno.
  if v_e.import_run_id is not null and exists (select 1 from public.import_run r where r.id = v_e.import_run_id and r.kind = 'carga' and r.status = 'en_prueba') then
    orden := 3; codigo := 'carga_en_prueba';
    motivo := 'Este asiento es de lo traído que está en prueba: se valida todo junto al darlo por bueno.'; return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
$nuevo$;
begin
  if strpos(v_def, 'N06a · Lo de una carga en prueba no se valida a mano') > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N06a: conta_motivos_para_validar no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- 4 · La pasada de las recibidas no mira las traídas.
do $do$
declare
  v_def text := pg_get_functiondef('public._conta_facturas_apuntar(uuid)'::regprocedure);
  v_viejo text := $viejo$     where si.company_id = p_company and si.status in ('en_revision', 'aprobada')
$viejo$;
  v_nuevo text := $nuevo$     where si.company_id = p_company and si.status in ('en_revision', 'aprobada')
       and si.source is distinct from 'traida'   -- N06a · una traída ya trae su asiento
$nuevo$;
begin
  if strpos(v_def, 'N06a · una traída ya trae su asiento') > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N06a: _conta_facturas_apuntar no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- 5 · El IVA de una traída no se decide aquí.
do $do$
declare
  v_def text := pg_get_functiondef('public.tg_s01o2_iva_no_deducible()'::regprocedure);
  v_viejo text := $viejo$  if new.vat_non_deductible_reason is not null or new.status in ('anulada', 'descartada', 'repetida') then return null; end if;$viejo$;
  v_nuevo text := $nuevo$  if new.vat_non_deductible_reason is not null or new.status in ('anulada', 'descartada', 'repetida') then return null; end if;
  if new.source = 'traida' then return null; end if;   -- N06a · su IVA es el de su libro de allí$nuevo$;
begin
  if strpos(v_def, 'N06a · su IVA es el de su libro de allí') > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N06a: tg_s01o2_iva_no_deducible no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- 6 · Una emitida traída de una carga en prueba se borra al deshacerla.
do $do$
declare
  v_def text := pg_get_functiondef('public.customer_invoice_inalterable()'::regprocedure);
  v_viejo text := $viejo$    if old.status <> 'borrador' then
      raise exception 'Una factura emitida no se borra nunca: se corrige con su rectificativa.' using errcode = '23514';$viejo$;
  v_nuevo text := $nuevo$    if old.status <> 'borrador'
       -- N06a · salvo la traída de una carga en prueba, al deshacerla.
       and not (old.origin = 'traida' and exists (select 1 from public.import_run r where r.id = old.import_run_id and r.kind = 'carga' and r.status = 'en_prueba')) then
      raise exception 'Una factura emitida no se borra nunca: se corrige con su rectificativa.' using errcode = '23514';$nuevo$;
begin
  if strpos(v_def, 'N06a · salvo la traída de una carga en prueba') > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N06a: customer_invoice_inalterable no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
