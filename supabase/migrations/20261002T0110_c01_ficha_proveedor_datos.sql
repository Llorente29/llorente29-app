-- ============================================================================
-- C01 · Ficha de proveedor completa — DATOS EXISTENTES (sin cadáveres)
-- ----------------------------------------------------------------------------
-- Va DESPUÉS de 20261002T0100_c01_ficha_proveedor_estructura.sql.
--
-- 1. Email y teléfono: UNA sola fuente de verdad. Cada proveedor con email o
--    teléfono en las columnas antiguas recibe un supplier_contact PRINCIPAL
--    con esos datos. El papel queda en 'other': la persona lo asigna en la
--    ficha (no se inventa que sea «pedidos»).
-- 2. Dirección: el texto antiguo NO se reparte en silencio. Queda como
--    propuesta pendiente (supplier_proposal, source='legacy_address') y la
--    ficha la enseña repartida por el núcleo con «Confirmar».
-- 3. compliance_docs_due (aviso de ficha técnica caducada, único envío
--    automático que usaba supplier.email) pasa a leer el email del contacto
--    principal. Misma firma, mismas columnas de salida.
--
-- CUENTA EXCLUIDA: Folvy Interno (00000000-0000-0000-0000-000000000001). Es el
-- laboratorio de pruebas, con datos defectuosos; decisión de Julio (01/10):
-- no se migra, no se prueba, no se verifica nada suyo. Sus columnas nuevas
-- existen (son del esquema) pero no se rellena nada.
--
-- Guarda: cuenta ANTES lo que tiene que crear y comprueba DESPUÉS que lo ha
-- creado exactamente; si no cuadra, aborta y no queda nada a medias.
-- ============================================================================

do $$
declare
  c_excluida constant uuid := '00000000-0000-0000-0000-000000000001'; -- Folvy Interno
  v_esperados_contactos  int;
  v_esperadas_propuestas int;
  v_contactos  int;
  v_propuestas int;
begin
  select count(*) into v_esperados_contactos
  from supplier s
  where s.account_id <> c_excluida
    and (nullif(trim(s.email), '') is not null or nullif(trim(s.phone), '') is not null)
    and not exists (select 1 from supplier_contact c where c.supplier_id = s.id and c.is_primary);

  select count(*) into v_esperadas_propuestas
  from supplier s
  where s.account_id <> c_excluida
    and nullif(trim(s.address), '') is not null
    and nullif(trim(s.fiscal_street), '') is null
    and not exists (select 1 from supplier_proposal p where p.supplier_id = s.id and p.source = 'legacy_address');

  insert into supplier_contact (account_id, supplier_id, name, role, phone, email, is_primary, notes, created_by_name)
  select s.account_id, s.id, s.name, 'other',
         nullif(trim(s.phone), ''), nullif(trim(s.email), ''), true,
         'Pasado desde la ficha antigua (C01, 02/10/2026). Falta decir su papel.', 'Migración C01'
  from supplier s
  where s.account_id <> c_excluida
    and (nullif(trim(s.email), '') is not null or nullif(trim(s.phone), '') is not null)
    and not exists (select 1 from supplier_contact c where c.supplier_id = s.id and c.is_primary);
  get diagnostics v_contactos = row_count;

  insert into supplier_proposal (account_id, supplier_id, field, value, source, source_label)
  select s.account_id, s.id, 'fiscal_address', jsonb_build_object('line', trim(s.address)),
         'legacy_address', 'De la dirección que tenía la ficha'
  from supplier s
  where s.account_id <> c_excluida
    and nullif(trim(s.address), '') is not null
    and nullif(trim(s.fiscal_street), '') is null
    and not exists (select 1 from supplier_proposal p where p.supplier_id = s.id and p.source = 'legacy_address');
  get diagnostics v_propuestas = row_count;

  if v_contactos <> v_esperados_contactos or v_propuestas <> v_esperadas_propuestas then
    raise exception 'C01 datos ABORTADO: contactos %/% y propuestas de dirección %/% no cuadran. No se ha tocado nada.',
      v_contactos, v_esperados_contactos, v_propuestas, v_esperadas_propuestas;
  end if;

  -- Folvy Interno, intacto: ni un contacto ni una propuesta suya.
  if exists (select 1 from supplier_contact where account_id = c_excluida)
     or exists (select 1 from supplier_proposal where account_id = c_excluida) then
    raise exception 'C01 datos ABORTADO: hay filas de Folvy Interno y no debe haber ninguna.';
  end if;

  raise notice 'C01 datos OK: % contactos principales y % propuestas de dirección.', v_contactos, v_propuestas;
end $$;

-- El aviso de ficha técnica caducada lee el email del CONTACTO PRINCIPAL.
-- Misma firma y mismas columnas de salida (supplier_email): la edge
-- compliance-doc-notify no cambia.
create or replace function public.compliance_docs_due(p_days integer default 30)
returns table(id uuid, account_id uuid, title text, reference text, expires_at date, review_due_at date,
  last_reminder_at timestamp with time zone, supplier_id uuid, supplier_name text, supplier_email text, account_name text)
language sql stable security definer set search_path to 'public'
as $function$
  select cd.id, cd.account_id, cd.title, cd.reference,
         cd.expires_at, cd.review_due_at, cd.last_reminder_at,
         cd.supplier_id, s.name, sc.email, a.name
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  left join supplier_contact sc on sc.supplier_id = s.id and sc.is_primary
  left join accounts a on a.id = cd.account_id
  where cd.status <> 'superseded'
    and (
      (cd.expires_at    is not null and cd.expires_at    <= current_date + p_days) or
      (cd.review_due_at is not null and cd.review_due_at <= current_date + p_days)
    )
    and (cd.last_reminder_at is null or cd.last_reminder_at < now() - interval '25 days');
$function$;
