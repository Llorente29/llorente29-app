-- ============================================================================
-- C01b · 0110 · DATOS: de las columnas viejas de supplier a la fuente nueva
-- ----------------------------------------------------------------------------
-- Encargo C01b §3 y respuesta 1 (decisiones 4 y 8). Va después de la 0100.
-- TODAS las cuentas, la plantilla (Folvy Interno) incluida: se migra, no se
-- usa como dato de prueba.
--
--   1. email / phone  → un supplier_contact con esos datos por cada proveedor
--      cuyo email o teléfono viejo no esté ya en alguno de sus contactos.
--      Es el PRINCIPAL si el proveedor no tiene ninguno; si ya lo tiene (lo
--      puso alguien en la ficha del C01), entra como contacto más, para no
--      perder el dato. Papel 'other': no se inventa que sea «pedidos».
--   2. address        → supplier_proposal 'fiscal_address' PENDIENTE («por
--      confirmar»), con la línea entera Y el reparto propuesto: calle, CP,
--      población (de postal_code_place, C00) y provincia. Solo si la ficha no
--      tiene ya calle estructurada ni una propuesta legacy_address. Si ya
--      tiene calle, la línea vieja queda en el registro («ya_en_ficha»).
--   3. usual_vat_rates → usual_tax_rate_ids: cada porcentaje, al tax_rate
--      vigente de su territorio (IVA en península y Baleares; IGIC en
--      Canarias, según el perfil fiscal de la empresa de la cuenta). Tiene que
--      haber EXACTAMENTE uno; si no, aborta: no se adivina un impuesto.
--
-- Cada cosa movida queda en c01b_movimiento_registro (campo, valor, destino).
-- ANTES = DESPUÉS: al final, cada email, teléfono, dirección y porcentaje de
-- las columnas viejas tiene que estar en su sitio nuevo, proveedor a
-- proveedor. Si falta uno, aborta y no queda nada (una transacción).
-- Las columnas viejas NO se tocan aquí: se borran en su propio fichero.
-- Se puede volver a lanzar: lo que ya movió no lo repite.
-- ============================================================================

-- La territorialidad de cada cuenta: la de su empresa; sin empresa, península.
create temp table c01b_territorio on commit drop as
select a.id as account_id,
       coalesce((select p.tax_territory from public.company c
                   join public.company_tax_profile p on p.company_id = c.id
                  where c.account_id = a.id and c.is_active
                  order by c.created_at limit 1), 'peninsula_baleares') as territorio
  from public.accounts a;

do $$
declare
  v_esperados_contactos  int;
  v_esperadas_propuestas int;
  v_contactos  int;
  v_propuestas int;
  v_iva_malos  int;
  v_faltan     int;
begin
  -- ── 1. Contactos ───────────────────────────────────────────────────────────
  create temp table c01b_sin_contacto on commit drop as
  select s.id as supplier_id, s.account_id, s.name,
         nullif(btrim(s.email), '') as email, nullif(btrim(s.phone), '') as phone,
         not exists (select 1 from public.supplier_contact c where c.supplier_id = s.id and c.is_primary) as principal
    from public.supplier s
   where (nullif(btrim(s.email), '') is not null
          and not exists (select 1 from public.supplier_contact c where c.supplier_id = s.id and lower(btrim(c.email)) = lower(btrim(s.email))))
      or (nullif(btrim(s.phone), '') is not null
          and not exists (select 1 from public.supplier_contact c where c.supplier_id = s.id and btrim(c.phone) = btrim(s.phone)));

  select count(*) into v_esperados_contactos from c01b_sin_contacto;

  with nuevos as (
    insert into public.supplier_contact (account_id, supplier_id, name, role, phone, email, is_primary, notes, created_by_name)
    select account_id, supplier_id, name, 'other', phone, email, principal,
           'Pasado desde la ficha antigua (C01b). Falta decir su papel.', 'Migración C01b'
      from c01b_sin_contacto
    returning id, account_id, supplier_id, email, phone
  ), reg as (
    insert into public.c01b_movimiento_registro (account_id, supplier_id, campo, valor, destino, destino_id)
    select account_id, supplier_id, 'email', email, 'supplier_contact', id from nuevos where email is not null
    union all
    select account_id, supplier_id, 'phone', phone, 'supplier_contact', id from nuevos where phone is not null
    returning 1
  )
  select count(*) into v_contactos from nuevos;

  -- ── 2. Direcciones, como propuesta por confirmar ya repartida ─────────────
  select count(*) into v_esperadas_propuestas
    from public.supplier s
   where nullif(btrim(s.address), '') is not null
     and nullif(btrim(s.fiscal_street), '') is null
     and not exists (select 1 from public.supplier_proposal p where p.supplier_id = s.id and p.source = 'legacy_address');

  with base as (
    select s.id, s.account_id, btrim(s.address) as linea,
           (regexp_match(s.address, '\m(\d{5})\M'))[1] as cp
      from public.supplier s
     where nullif(btrim(s.address), '') is not null
       and nullif(btrim(s.fiscal_street), '') is null
       and not exists (select 1 from public.supplier_proposal p where p.supplier_id = s.id and p.source = 'legacy_address')
  ), repartida as (
    select b.*,
           case when b.cp is null then regexp_replace(b.linea, '[,\s]+$', '')
                else nullif(regexp_replace(split_part(b.linea, b.cp, 1), '[,\s\-–]+$', ''), '') end as calle,
           pc.place_name as poblacion, pc.province as provincia
      from base b
      left join lateral (select place_name, province from public.postal_code_place
                          where postal_code = b.cp order by ord limit 1) pc on true
  ), nuevas as (
    insert into public.supplier_proposal (account_id, supplier_id, field, value, source, source_label)
    select r.account_id, r.id, 'fiscal_address',
           jsonb_build_object('line', r.linea, 'street', r.calle, 'postal_code', r.cp,
                              'city', r.poblacion, 'province', r.provincia),
           'legacy_address', 'De la dirección que tenía la ficha'
      from repartida r
    returning id, account_id, supplier_id, value->>'line' as linea
  ), reg as (
    insert into public.c01b_movimiento_registro (account_id, supplier_id, campo, valor, destino, destino_id)
    select account_id, supplier_id, 'address', linea, 'supplier_proposal', id from nuevas
    returning 1
  )
  select count(*) into v_propuestas from nuevas;

  -- La dirección vieja de quien YA tiene calle estructurada no se propone (la
  -- ficha ya la tiene), pero la línea queda escrita en el registro: al borrar
  -- la columna no desaparece sin rastro.
  insert into public.c01b_movimiento_registro (account_id, supplier_id, campo, valor, destino, destino_id)
  select s.account_id, s.id, 'address', btrim(s.address), 'ya_en_ficha', null
    from public.supplier s
   where nullif(btrim(s.address), '') is not null
     and nullif(btrim(s.fiscal_street), '') is not null
     and not exists (select 1 from public.c01b_movimiento_registro r
                      where r.supplier_id = s.id and r.campo = 'address' and r.destino = 'ya_en_ficha');

  if v_contactos <> v_esperados_contactos or v_propuestas <> v_esperadas_propuestas then
    raise exception 'C01b datos ABORTADO: contactos %/% y propuestas %/% no cuadran. No se ha tocado nada.',
      v_contactos, v_esperados_contactos, v_propuestas, v_esperadas_propuestas;
  end if;

  -- ── 3. IVA habituales: de porcentajes a referencias ──────────────────────
  create temp table c01b_iva on commit drop as
  select s.id as supplier_id, s.account_id, x.pct,
         (select array_agg(t.id) from public.tax_rate t
           where t.is_system and t.treatment = 'taxed' and t.rate = x.pct
             and t.valid_from <= current_date and (t.valid_to is null or t.valid_to >= current_date)
             and t.territory = tr.territorio
             and t.tax_system = case tr.territorio when 'canarias' then 'igic' when 'ceuta_melilla' then 'ipsi' else 'iva' end) as candidatos
    from public.supplier s
    join c01b_territorio tr on tr.account_id = s.account_id
    cross join lateral unnest(s.usual_vat_rates) as x(pct)
   where cardinality(s.usual_vat_rates) > 0;

  select count(*) into v_iva_malos from c01b_iva where cardinality(coalesce(candidatos, '{}')) <> 1;
  if v_iva_malos > 0 then
    raise exception 'C01b datos ABORTADO: % IVA habituales de proveedor no tienen exactamente un tipo vigente en su territorio. No se ha tocado nada.', v_iva_malos;
  end if;

  update public.supplier s
     set usual_tax_rate_ids = q.ids
    from (select supplier_id, array_agg(distinct candidatos[1]) as ids from c01b_iva group by supplier_id) q
   where s.id = q.supplier_id and cardinality(s.usual_tax_rate_ids) = 0;

  insert into public.c01b_movimiento_registro (account_id, supplier_id, campo, valor, destino, destino_id)
  select i.account_id, i.supplier_id, 'usual_vat_rates', i.pct::text, 'supplier.usual_tax_rate_ids', i.candidatos[1]
    from c01b_iva i
   where not exists (select 1 from public.c01b_movimiento_registro r
                      where r.supplier_id = i.supplier_id and r.campo = 'usual_vat_rates' and r.valor = i.pct::text);

  -- ── ANTES = DESPUÉS, proveedor a proveedor ───────────────────────────────
  select count(*) into v_faltan from (
    select s.id from public.supplier s
     where nullif(btrim(s.email), '') is not null
       and not exists (select 1 from public.supplier_contact c where c.supplier_id = s.id and lower(btrim(c.email)) = lower(btrim(s.email)))
    union all
    select s.id from public.supplier s
     where nullif(btrim(s.phone), '') is not null
       and not exists (select 1 from public.supplier_contact c where c.supplier_id = s.id and btrim(c.phone) = btrim(s.phone))
    union all
    select s.id from public.supplier s
     where nullif(btrim(s.address), '') is not null
       and nullif(btrim(s.fiscal_street), '') is null
       and not exists (select 1 from public.supplier_proposal p where p.supplier_id = s.id and p.field = 'fiscal_address'
                         and btrim(coalesce(p.value->>'line', '')) = btrim(s.address))
    union all
    select s.id from public.supplier s cross join lateral unnest(s.usual_vat_rates) x(pct)
     where not exists (select 1 from public.tax_rate t where t.id = any(s.usual_tax_rate_ids) and t.rate = x.pct)
  ) f;
  if v_faltan > 0 then
    raise exception 'C01b datos ABORTADO: % datos de las columnas viejas no están en la fuente nueva. No se ha tocado nada.', v_faltan;
  end if;

  raise notice 'C01b datos OK: % contactos, % direcciones por confirmar, % IVA convertidos.',
    v_contactos, v_propuestas, (select count(*) from c01b_iva);
end $$;

-- Lo movido, por cuenta (sale en el registro del workflow).
select a.name as cuenta, r.campo, r.destino, count(*) as filas
  from public.c01b_movimiento_registro r join public.accounts a on a.id = r.account_id
 group by a.name, r.campo, r.destino
 order by a.name, r.campo;
