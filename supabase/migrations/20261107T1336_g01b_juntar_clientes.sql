-- supabase/migrations/20261107T1336_g01b_juntar_clientes.sql
--
-- G01b · La unión junta también los clientes que ya existían (Julio, 07/11,
-- tras «Aplicar la unión y leer» de las 13:02 UTC: los 18 grupos de NIF
-- repetido salieron como «ficha_no_guardada», «sus 2 fichas de Bitrix24 ya son
-- 2 clientes distintos en Sumied»).
--
-- cambia: public.conta_bitrix_guardar_clientes · prueba: supabase/staging/sql/20261107_g01b_juntar_clientes_prueba.sql
--
--   1. conta_gestoria_union (nueva): el rastro de cada junta: qué cliente
--      queda, cuál se retira, qué se movió fila a fila, lo que se quedó en el
--      retirado y por qué.
--   2. _conta_gestoria_juntar (nueva): junta dos clientes de la misma cuenta.
--      Antes mira lo que el que se retira tiene colgado:
--        · lo de la gestoría y el cobro (líneas, tarifas, mandatos,
--          solicitudes, lo de GoCardless, decisiones, diferencias,
--          recordatorios, remesas, formas de pago y contratos) se mueve al que
--          queda;
--        · sus fichas de Bitrix24 pasan al que queda; su fila de la gestoría,
--          al rastro;
--        · su forma de cobro por empresa, si el que queda no tiene ya una;
--        · sus datos fiscales se quedan en él (el que queda tiene los suyos);
--        · su NIF, si el que queda no tiene;
--        · si tiene contabilidad (facturas, asientos, libro de IVA, banco,
--          liquidaciones, papeles o cuentas contables), NO se junta: se dice y
--          se hace a mano con «Fusionar con…».
--      El que se retira queda archivado, con su nota. No se borra nada.
--   3. conta_bitrix_guardar_clientes (la misma firma, con su respaldo): con
--      la unión aplicada, si las fichas de un NIF ya son varios clientes, los
--      junta en uno y lo dice («juntados»). Sin aplicar, como antes.
-- No lee ni escribe nada en Bitrix24. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261107T1336_g01b_juntar_clientes.down.sql

-- 1 · El rastro.
create table if not exists public.conta_gestoria_union (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  kept_party_id   uuid not null references public.party(id) on delete cascade,
  gone_party_id   uuid not null references public.party(id) on delete cascade,
  motivo          text not null,
  moved           jsonb not null,
  kept_on_gone    jsonb not null default '[]'::jsonb,
  summary         text not null,
  done_at         timestamptz not null default now(),
  done_by_name    text,
  check (kept_party_id <> gone_party_id)
);
comment on table public.conta_gestoria_union is
  'G01b · Cada vez que la unión de Bitrix24 junta dos clientes de Sumied (el mismo NIF): cuál queda, cuál se retira (archivado), qué se movió fila a fila (moved, con las filas como estaban), lo que se quedó en el retirado y por qué.';
create index if not exists conta_gestoria_union_cuenta on public.conta_gestoria_union (account_id, done_at desc);
alter table public.conta_gestoria_union enable row level security;
revoke all on table public.conta_gestoria_union from public, anon, authenticated;
grant select on table public.conta_gestoria_union to authenticated;
drop policy if exists conta_gestoria_union_leer on public.conta_gestoria_union;
create policy conta_gestoria_union_leer on public.conta_gestoria_union for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_gestoria_union to conta_lectura; end if;
end $$;

-- 2 · Juntar dos clientes de la misma cuenta.
create or replace function public._conta_gestoria_juntar(p_cuenta uuid, p_queda uuid, p_se_va uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_a public.party; v_b public.party; v_mov jsonb := '{}'::jsonb; v_quedan jsonb := '[]'::jsonb; v_filas jsonb; v_n int := 0; v_cont int; v_t text;
        v_nif boolean := false; v_resumen text; v_id uuid;
begin
  if p_queda = p_se_va then raise exception 'es el mismo cliente' using errcode = '22023'; end if;
  select * into v_a from public.party where id = p_queda and account_id = p_cuenta for update;
  select * into v_b from public.party where id = p_se_va and account_id = p_cuenta for update;
  if v_a.id is null or v_b.id is null then raise exception 'los clientes que se juntan no son de esta cuenta' using errcode = 'P0001'; end if;

  -- Lo contable no se mueve aquí: si el que se retira lo tiene, no se junta (se hace a mano con «Fusionar con…»).
  select (select count(*) from public.customer_invoice where party_id = p_se_va) + (select count(*) from public.journal_entry where party_id = p_se_va)
       + (select count(*) from public.journal_line where party_id = p_se_va) + (select count(*) from public.vat_book_entry where party_id = p_se_va)
       + (select count(*) from public.bank_match_item where party_id = p_se_va) + (select count(*) from public.channel_settlement where party_id = p_se_va)
       + (select count(*) from public.licensed_settlement where party_id = p_se_va) + (select count(*) from public.brand_licensing_agreement where party_id = p_se_va)
       + (select count(*) from public.brand_partner_contribution where party_id = p_se_va) + (select count(*) from public.conta_liquidacion_resolucion where party_id = p_se_va)
       + (select count(*) from public.party_role where party_id = p_se_va) + (select count(*) from public.platform_store where party_id = p_se_va)
       + (select count(*) from public.company_account_link where entity = 'customer' and entity_id = p_se_va::text)
    into v_cont;
  if v_cont > 0 then
    raise exception 'el cliente que se retira tiene % documentos, apuntes o papeles de contabilidad: se juntan a mano en Clientes y proveedores › «Fusionar con…»', v_cont
      using errcode = 'P0001';
  end if;

  -- Lo de la gestoría y el cobro: se mueve entero al que queda, guardando las filas como estaban.
  foreach v_t in array array['conta_linea', 'conta_tarifa', 'conta_mandato', 'conta_solicitud', 'conta_gc_cliente', 'conta_gc_importacion',
                             'conta_gestoria_decision', 'conta_gestoria_diferencia', 'conta_recordatorio', 'conta_cobro_remesa_linea',
                             'payment_method', 'recurring_contract', 'conta_gestoria_ficha'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.party_id = $1', v_t) into v_filas using p_se_va;
    if jsonb_array_length(v_filas) > 0 then
      execute format('update public.%I set party_id = $1 where party_id = $2', v_t) using p_queda, p_se_va;
      v_mov := v_mov || jsonb_build_object(v_t, v_filas); v_n := v_n + jsonb_array_length(v_filas);
    end if;
  end loop;

  -- La forma de cobro, empresa a empresa, si el que queda no tiene ya una con esa empresa.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_filas from public.conta_cobro_cliente x
   where x.party_id = p_se_va and not exists (select 1 from public.conta_cobro_cliente y where y.party_id = p_queda and y.company_id = x.company_id);
  if jsonb_array_length(v_filas) > 0 then
    update public.conta_cobro_cliente x set party_id = p_queda
     where x.party_id = p_se_va and not exists (select 1 from public.conta_cobro_cliente y where y.party_id = p_queda and y.company_id = x.company_id);
    v_mov := v_mov || jsonb_build_object('conta_cobro_cliente', v_filas); v_n := v_n + jsonb_array_length(v_filas);
  end if;
  if exists (select 1 from public.conta_cobro_cliente where party_id = p_se_va) then v_quedan := v_quedan || jsonb_build_array('forma_de_cobro'); end if;
  if exists (select 1 from public.customer_fiscal where party_id = p_se_va) then v_quedan := v_quedan || jsonb_build_array('datos_fiscales'); end if;

  -- Su fila de la gestoría: al rastro (sus fichas ya están en el que queda).
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_filas from public.conta_gestoria_cliente x where x.party_id = p_se_va;
  delete from public.conta_gestoria_cliente where party_id = p_se_va;
  v_mov := v_mov || jsonb_build_object('conta_gestoria_cliente_retirada', v_filas);

  -- El NIF, si el que queda no tiene (el índice único por cuenta obliga a soltarlo antes).
  if v_a.tax_id is null and v_b.tax_id is not null then
    update public.party set tax_id = null where id = p_se_va;
    update public.party set tax_id = v_b.tax_id where id = p_queda;
    v_nif := true;
  end if;

  update public.party set archived_at = coalesce(archived_at, now()), archived_note = format('Unido con %s: %s.', v_a.name, p_motivo), updated_at = now()
   where id = p_se_va;
  v_resumen := format('%s unido con %s (%s): %s %s movido%s%s.', v_b.name, v_a.name, p_motivo, v_n, case when v_n = 1 then 'dato' else 'datos' end,
    case when v_n = 1 then '' else 's' end, case when v_nif then ', con su NIF' else '' end);
  insert into public.conta_gestoria_union (account_id, kept_party_id, gone_party_id, motivo, moved, kept_on_gone, summary, done_by_name)
  values (p_cuenta, p_queda, p_se_va, p_motivo,
          v_mov || jsonb_build_object('nif', v_nif, 'antes', jsonb_build_object('archived_at', v_b.archived_at, 'archived_note', v_b.archived_note, 'tax_id', v_b.tax_id)),
          v_quedan, v_resumen, coalesce(public.conta_nombre_actor(), 'Bitrix24 · unión'))
  returning id into v_id;
  return jsonb_build_object('union', v_id, 'resumen', v_resumen, 'movidos', v_n);
end $$;
comment on function public._conta_gestoria_juntar(uuid, uuid, uuid, text) is
  'G01b · Junta dos clientes de la misma cuenta (el mismo NIF en Bitrix24): mueve lo de la gestoría y el cobro al que queda, archiva el otro y deja el rastro en conta_gestoria_union. Si el que se retira tiene contabilidad, no junta.';
revoke all on function public._conta_gestoria_juntar(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public._conta_gestoria_juntar(uuid, uuid, uuid, text) to service_role;

-- 3 · Guardar los clientes: con la unión, junta los que ya eran varios. La de antes se guarda (_respaldar_funcion).
select public._respaldar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261107T1336_g01b_juntar_clientes');
create or replace function public.conta_bitrix_guardar_clientes(p_account uuid, p_clientes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; f jsonb; v_p jsonb; v_ids text[]; v_partes uuid[]; v_party uuid; v_huella text; v_antes text; v_nif text; v_nif_bitrix text;
        v_motivo text; v_otro uuid; v_juntados int := 0; v_nuevos int := 0; v_cambiados int := 0; v_iguales int := 0; v_errores jsonb := '[]'::jsonb; v_otras jsonb; v_porque text;
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_clientes, '[]'::jsonb)) loop
    v_p := c->'principal';
    v_ids := array(select x->>'bitrixId' from jsonb_array_elements(coalesce(c->'fichas', '[]'::jsonb)) x where coalesce(x->>'bitrixId', '') <> '');
    if coalesce(v_p->>'bitrixId', '') = '' or cardinality(v_ids) = 0 then continue; end if;
    begin
      v_huella := md5(c::text);
      v_motivo := nullif(c->>'motivo', '');
      v_nif := nullif(public.party_nif(nullif(c->>'nif', '')), '');
      v_nif_bitrix := nullif(public.party_nif(nullif(v_p->>'nif', '')), '');
      -- El cliente: el de sus fichas (si ya estaban) o, si no, el de su NIF.
      select coalesce(array_agg(distinct x.party_id), '{}') into v_partes from (
        select party_id from public.conta_gestoria_ficha where account_id = p_account and bitrix_id = any(v_ids)
        union select party_id from public.conta_gestoria_cliente where account_id = p_account and bitrix_id = any(v_ids)) x;
      if cardinality(v_partes) > 1 then
        -- G01b (07/11) · Sin la unión aplicada, no se junta nada.
        if c->>'clave' not like 'nif:%' then
          raise exception 'sus % fichas de Bitrix24 ya son % clientes distintos en Sumied', cardinality(v_ids), cardinality(v_partes) using errcode = 'P0001';
        end if;
        -- Con ella, los clientes ya creados por separado se juntan en uno: el que ya tenía la ficha principal; si no, el que
        -- más tiene colgado de la gestoría (líneas, mandatos, GoCardless); si no, el más antiguo. Los otros, retirados.
        select x into v_party from unnest(v_partes) x
         order by (exists (select 1 from public.conta_gestoria_cliente g where g.party_id = x and g.bitrix_id = v_p->>'bitrixId'))::int desc,
                  ((select count(*) from public.conta_linea l where l.party_id = x) + (select count(*) from public.conta_mandato m where m.party_id = x)
                   + (select count(*) from public.conta_gc_cliente k where k.party_id = x)) desc,
                  (select p.created_at from public.party p where p.id = x), x
         limit 1;
        foreach v_otro in array v_partes loop
          if v_otro <> v_party then
            perform public._conta_gestoria_juntar(p_account, v_party, v_otro, 'el mismo NIF en Bitrix24 (fichas ' || array_to_string(v_ids, ', ') || ')');
            v_juntados := v_juntados + 1;
          end if;
        end loop;
        v_partes := array[v_party];
      end if;
      v_party := v_partes[1];
      -- Por su NIF, solo con la unión aplicada (clave «nif:…»): sin aplicar no se une nada, ni a escondidas.
      if v_party is null and v_nif is not null and c->>'clave' like 'nif:%' then
        select id into v_party from public.party where account_id = p_account and tax_id = v_nif;
        if exists (select 1 from public.conta_gestoria_cliente g where g.party_id = v_party and g.bitrix_id <> all(v_ids)) then
          raise exception 'su NIF ya es de otro cliente de Sumied, con otra ficha de Bitrix24' using errcode = 'P0001';
        end if;
      end if;
      select g.huella into v_antes from public.conta_gestoria_cliente g where g.party_id = v_party;
      if v_party is null then
        insert into public.party (account_id, name, tax_id, source, created_by_name)
        values (p_account, coalesce(nullif(trim(v_p->>'nombre'), ''), 'Empresa ' || (v_p->>'bitrixId') || ' de Bitrix24'), v_nif, 'crm', 'Bitrix24')
        returning id into v_party;
        v_nuevos := v_nuevos + 1;
      elsif v_antes is distinct from v_huella then
        -- Un NIF que no se usa (sin formato o en 10 fichas o más) se quita si era el que se le puso antes.
        update public.party set name = coalesce(nullif(trim(v_p->>'nombre'), ''), name),
               tax_id = case when v_motivo in ('nif_no_valido', 'nif_en_muchas') and tax_id is not distinct from v_nif_bitrix then null else coalesce(v_nif, tax_id) end,
               updated_at = now()
         where id = v_party and account_id = p_account;
        v_cambiados := v_cambiados + 1;
      else
        v_iguales := v_iguales + 1;
        update public.conta_gestoria_cliente set leido_at = now() where party_id = v_party;
        update public.conta_gestoria_ficha set leido_at = now() where account_id = p_account and bitrix_id = any(v_ids);
        continue;
      end if;
      insert into public.customer_fiscal (party_id, account_id, legal_name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province)
      values (v_party, p_account, nullif(trim(v_p->>'nombre'), ''), nullif(v_p->>'calle', ''), nullif(v_p->>'cp', ''), nullif(v_p->>'poblacion', ''), nullif(v_p->>'provincia', ''))
      on conflict (party_id) do update set legal_name = coalesce(excluded.legal_name, customer_fiscal.legal_name),
        fiscal_street = excluded.fiscal_street, fiscal_postal_code = excluded.fiscal_postal_code, fiscal_city = excluded.fiscal_city,
        fiscal_province = excluded.fiscal_province, updated_at = now();
      -- Las otras fichas del cliente, para la ficha («Lo que dice Bitrix24»).
      select coalesce(jsonb_agg(jsonb_build_object('bitrixId', x->>'bitrixId', 'nombre', x->>'nombre', 'situacion', x->'situacion', 'situacionTexto', x->'situacionTexto')), '[]'::jsonb)
        into v_otras from jsonb_array_elements(c->'fichas') x where x->>'bitrixId' <> v_p->>'bitrixId';
      insert into public.conta_gestoria_cliente (party_id, account_id, bitrix_id, situacion, servicios, forma_pago_bitrix, emisor_segun_bitrix, ficha, huella, leido_at)
      values (v_party, p_account, v_p->>'bitrixId', nullif(c->>'situacion', ''),
              coalesce(array(select jsonb_array_elements_text(v_p->'servicios')), '{}'), nullif(v_p->>'formaPago', ''),
              (select id from public.company where id::text = v_p->>'emisorSegunBitrix' and account_id = p_account),
              v_p || jsonb_build_object('otrasFichas', v_otras, 'motivo', v_motivo), v_huella, now())
      on conflict (party_id) do update set bitrix_id = excluded.bitrix_id, situacion = excluded.situacion, servicios = excluded.servicios,
        forma_pago_bitrix = excluded.forma_pago_bitrix, emisor_segun_bitrix = excluded.emisor_segun_bitrix, ficha = excluded.ficha,
        huella = excluded.huella, leido_at = now();
      for f in select * from jsonb_array_elements(c->'fichas') loop
        insert into public.conta_gestoria_ficha (account_id, bitrix_id, party_id, situacion, ficha, huella, leido_at)
        values (p_account, f->>'bitrixId', v_party, nullif(f->>'situacion', ''), f, md5(f::text), now())
        on conflict (account_id, bitrix_id) do update set party_id = excluded.party_id, situacion = excluded.situacion,
          ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
      end loop;
      -- Una ficha que ya no es de este cliente deja de colgar de él (la recoge el suyo).
      delete from public.conta_gestoria_ficha where account_id = p_account and party_id = v_party and bitrix_id <> all(v_ids);
    exception when others then
      v_porque := case when sqlstate = '23505' and sqlerrm like '%ux_party_nif%' then 'su NIF ya es de otro cliente de Sumied'
                       when sqlstate = '23505' then 'choca con otro cliente de Sumied (' || sqlerrm || ')'
                       else sqlerrm end;
      v_errores := v_errores || jsonb_build_array(jsonb_build_object('bitrixIds', to_jsonb(v_ids), 'nombre', v_p->>'nombre',
        'emisor', v_p->>'emisorSegunBitrix', 'codigo', sqlstate, 'porque', v_porque));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'cambiados', v_cambiados, 'iguales', v_iguales, 'juntados', v_juntados, 'errores', v_errores);
end $$;
revoke all on function public.conta_bitrix_guardar_clientes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_guardar_clientes(uuid, jsonb) to service_role;
