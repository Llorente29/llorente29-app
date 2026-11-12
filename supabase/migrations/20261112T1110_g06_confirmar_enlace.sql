-- supabase/migrations/20261112T1110_g06_confirmar_enlace.sql
-- cambia: public.conta_gc_enlace · prueba: supabase/staging/sql/20261112_g06_confirmar_enlace_prueba.sql
-- cambia: public._conta_gestoria_juntar · prueba: supabase/staging/sql/20261112_g06_confirmar_enlace_prueba.sql
--
-- G06 · Tarea 3 · Las propuestas del casado y la confirmación con un clic (encargo G06; Julio, nº 141).
--
-- La lectura de GoCardless ya no ata sola lo que no casa por NIF ni por correo único: lo deja PROPUESTO en
-- conta_gc_enlace, con sus candidatas y su porqué (el correo está en varias fichas, o se llama igual que una o
-- varias). Una persona lo confirma con un clic, y eso manda sobre lo automático.
--
--   1 · conta_gc_enlace.antes (AÑADE, admite nulos): cómo estaba todo antes de la decisión de una persona, para
--       poder deshacerla en los segundos de después.
--   2 · El estado «sin_ficha» (CAMBIA: el CHECK solo amplía): una persona dice «No tiene ficha en Bitrix24». La
--       ficha la crea QBO a mano en Bitrix24; mientras, la lectura no le vuelve a proponer pareja.
--   3 · _conta_gc_enlace_guardar (AÑADE): lo que escribe la lectura, con la guarda dentro del on conflict: lo
--       automático no pisa lo de una persona ni un conflicto, y lo de una persona solo pisa una decisión más
--       antigua. Así una confirmación hecha mientras corre la lectura no se pierde.
--   4 · conta_gc_enlace_confirmar (AÑADE): «Es esta» y «Es otra…». Escribe el enlace de una persona, con quién y
--       cuándo, y por conta_gestoria_enlazar los dos enlaces de antes y la decisión (cautela del nº 140: se siguen
--       escribiendo hasta que todos los que los leen hayan cambiado).
--   5 · conta_gc_enlace_sin_ficha (AÑADE): «No tiene ficha en Bitrix24».
--   6 · conta_gc_enlace_deshacer (AÑADE): deshace la última decisión de una persona sobre ese cliente si es de
--       hace menos de 30 segundos (la pantalla ofrece 10; el resto, para la red). Deja todo como estaba: el enlace,
--       los dos de antes, la decisión y la diferencia «sin ficha».
--   7 · _conta_gestoria_juntar (CAMBIA, misma firma): al juntar dos fichas, su enlace (también el que confirmó una
--       persona) pasa a la ficha que queda, y en las candidatas de las propuestas la que se va se cambia por la
--       que queda (Julio, nº 141).
--
-- No toca recibos, cobros ni facturas. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261112T1110_g06_confirmar_enlace.down.sql

-- 1 · Cómo estaba antes de la decisión de una persona.
alter table public.conta_gc_enlace add column if not exists antes jsonb;
comment on column public.conta_gc_enlace.antes is
  'G06 · Cómo estaba todo antes de la última decisión de una persona (el enlace, los dos enlaces de antes, la decisión y las diferencias que cerró): lo usa conta_gc_enlace_deshacer.';

-- 2 · «No tiene ficha en Bitrix24». Solo amplía: lo que hay sigue valiendo.
alter table public.conta_gc_enlace
  drop constraint conta_gc_enlace_estado_check,
  add constraint conta_gc_enlace_estado_check check (estado in ('atado', 'propuesto', 'conflicto', 'sin_ficha'));

-- 3 · Lo que escribe la lectura de GoCardless.
create or replace function public._conta_gc_enlace_guardar(p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.conta_gc_enlace as e (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at, updated_at)
  select f.company_id, f.gc_cliente_id, f.account_id, f.party_id, f.por, f.estado, coalesce(f.candidatas, '{}'), f.porque, f.quien, f.quien_name, f.decidido_at,
         coalesce(f.updated_at, now())
    from jsonb_populate_recordset(null::public.conta_gc_enlace, coalesce(p_filas, '[]'::jsonb)) f
  on conflict (company_id, gc_cliente_id) do update set
    party_id = excluded.party_id, por = excluded.por, estado = excluded.estado,
    -- Lo de una persona sobre lo de una persona: se queda con sus candidatas y su porqué (la lectura no los sabe).
    candidatas = case when excluded.por = 'persona' and e.por = 'persona' then e.candidatas else excluded.candidatas end,
    porque = case when excluded.por = 'persona' and e.por = 'persona' then e.porque else excluded.porque end,
    quien = excluded.quien, quien_name = excluded.quien_name, decidido_at = excluded.decidido_at, updated_at = excluded.updated_at
  where (excluded.por = 'persona' and (e.por <> 'persona' or e.decidido_at is null or excluded.decidido_at >= e.decidido_at))
     or (excluded.por <> 'persona' and e.por <> 'persona' and e.estado <> 'conflicto');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public._conta_gc_enlace_guardar(jsonb) is
  'G06 · Lo que escribe conta-gocardless-leer en conta_gc_enlace. Lo automático no pisa lo de una persona ni un conflicto; lo de una persona solo pisa una decisión más antigua. Devuelve las filas escritas.';
revoke all on function public._conta_gc_enlace_guardar(jsonb) from public, anon, authenticated;
grant execute on function public._conta_gc_enlace_guardar(jsonb) to service_role;

-- 4 · «Es esta» y «Es otra…».
create or replace function public.conta_gc_enlace_confirmar(p_company uuid, p_gc_cliente text, p_party uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_antes jsonb; v_gc jsonb; v_cc jsonb; v_difs uuid[]; v_r jsonb; v_dec uuid;
        v_quien text := public.conta_nombre_actor(); v_cliente text;
begin
  select to_jsonb(e) - 'antes' into v_antes from public.conta_gc_enlace e where e.company_id = p_company and e.gc_cliente_id = p_gc_cliente for update;
  select jsonb_build_object('party_id', g.party_id, 'casado_por', g.casado_por) into v_gc
    from public.conta_gc_cliente g where g.company_id = p_company and g.gc_id = p_gc_cliente;
  select to_jsonb(c) into v_cc from public.conta_cobro_cliente c where c.company_id = p_company and c.party_id = p_party;
  v_difs := array(select d.id from public.conta_gestoria_diferencia d
                   where d.company_id = p_company and d.vigente and d.tipo = 'gocardless_sin_ficha' and d.gc_cliente_id = p_gc_cliente);

  -- Comprueba el permiso, que el cliente esté en lo leído y que la ficha sea de la cuenta; escribe los dos de antes y la decisión.
  v_r := public.conta_gestoria_enlazar(p_company, p_gc_cliente, p_party);
  select d.id into v_dec from public.conta_gestoria_decision d
   where d.company_id = p_company and d.gc_cliente_id = p_gc_cliente and d.tipo = 'enlace' and d.party_id = p_party
   order by d.cuando desc, d.id desc limit 1;
  select name into v_cliente from public.party where id = p_party;

  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at, updated_at, antes)
  values (p_company, p_gc_cliente, v_cuenta, p_party, 'persona', 'atado',
          coalesce(array(select jsonb_array_elements_text(v_antes->'candidatas')::uuid), '{}'),
          format('%s dijo que es «%s».', coalesce(v_quien, 'Una persona'), v_cliente),
          auth.uid(), v_quien, now(), now(),
          jsonb_build_object('enlace', v_antes, 'gc_cliente', v_gc, 'cobro_cliente', v_cc, 'cobro_cliente_era', v_cc is not null,
                             'decision', v_dec, 'diferencias', to_jsonb(v_difs)))
  on conflict (company_id, gc_cliente_id) do update set
    party_id = excluded.party_id, por = 'persona', estado = 'atado', candidatas = excluded.candidatas, porque = excluded.porque,
    quien = excluded.quien, quien_name = excluded.quien_name, decidido_at = excluded.decidido_at, updated_at = excluded.updated_at,
    antes = excluded.antes;
  return jsonb_build_object('frase', v_r->>'frase', 'deshacer_hasta', now() + interval '10 seconds');
end $$;
comment on function public.conta_gc_enlace_confirmar(uuid, text, uuid) is
  'G06 · «Es esta» / «Es otra…»: el cliente de GoCardless es esa ficha. Lo guarda una persona, con quién y cuándo, y manda sobre lo automático. Escribe también los dos enlaces de antes (conta_gestoria_enlazar). Se deshace en 30 s con conta_gc_enlace_deshacer.';
revoke all on function public.conta_gc_enlace_confirmar(uuid, text, uuid) from public, anon;
grant execute on function public.conta_gc_enlace_confirmar(uuid, text, uuid) to authenticated;

-- 5 · «No tiene ficha en Bitrix24».
create or replace function public.conta_gc_enlace_sin_ficha(p_company uuid, p_gc_cliente text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_e public.conta_gc_enlace; v_gc text; v_quien text := public.conta_nombre_actor(); v_ficha text;
        v_frase text;
begin
  select coalesce(nombre, gc_id) into v_gc from public.conta_gc_cliente where company_id = p_company and gc_id = p_gc_cliente;
  if v_gc is null then raise exception 'Ese cliente no está en lo leído de GoCardless.' using errcode = 'P0002'; end if;
  select * into v_e from public.conta_gc_enlace where company_id = p_company and gc_cliente_id = p_gc_cliente for update;
  if v_e.estado = 'atado' then
    select name into v_ficha from public.party where id = v_e.party_id;
    raise exception 'Está enlazado con «%» (%): si no es esa ficha, elige la buena con «Es otra…».', v_ficha,
      case v_e.por when 'nif' then 'por su NIF' when 'correo' then 'por su correo' else 'lo enlazó una persona' end using errcode = 'P0001';
  end if;
  v_frase := format('%s no tiene ficha en Bitrix24: hay que crearla allí. Hasta entonces, sus cobros no salen en ninguna ficha.', v_gc);
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at, updated_at, antes)
  values (p_company, p_gc_cliente, v_cuenta, null, 'persona', 'sin_ficha', coalesce(v_e.candidatas, '{}'),
          format('%s dijo que no tiene ficha en Bitrix24.', coalesce(v_quien, 'Una persona')), auth.uid(), v_quien, now(), now(),
          jsonb_build_object('enlace', case when v_e.gc_cliente_id is null then null else to_jsonb(v_e) - 'antes' end))
  on conflict (company_id, gc_cliente_id) do update set
    party_id = null, por = 'persona', estado = 'sin_ficha', porque = excluded.porque,
    quien = excluded.quien, quien_name = excluded.quien_name, decidido_at = excluded.decidido_at, updated_at = excluded.updated_at,
    antes = excluded.antes;
  return jsonb_build_object('frase', v_frase, 'deshacer_hasta', now() + interval '10 seconds');
end $$;
comment on function public.conta_gc_enlace_sin_ficha(uuid, text) is
  'G06 · «No tiene ficha en Bitrix24»: lo dice una persona; la lectura deja de proponerle pareja. La ficha la crea QBO a mano en Bitrix24. Se deshace en 30 s con conta_gc_enlace_deshacer.';
revoke all on function public.conta_gc_enlace_sin_ficha(uuid, text) from public, anon;
grant execute on function public.conta_gc_enlace_sin_ficha(uuid, text) to authenticated;

-- 6 · Deshacer la última decisión, en los segundos de después.
create or replace function public.conta_gc_enlace_deshacer(p_company uuid, p_gc_cliente text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_e public.conta_gc_enlace; v_a jsonb; v_cc jsonb; v_gc text;
begin
  select * into v_e from public.conta_gc_enlace where company_id = p_company and gc_cliente_id = p_gc_cliente and account_id = v_cuenta for update;
  if v_e.gc_cliente_id is null or v_e.por <> 'persona' or v_e.antes is null then
    raise exception 'No hay nada que deshacer en ese cliente.' using errcode = 'P0002';
  end if;
  if v_e.decidido_at < now() - interval '30 seconds' then
    raise exception 'Ya no se puede deshacer (han pasado más de 30 segundos): cámbialo con «Es otra…».' using errcode = 'P0001';
  end if;
  v_a := v_e.antes;
  select coalesce(nombre, gc_id) into v_gc from public.conta_gc_cliente where company_id = p_company and gc_id = p_gc_cliente;

  -- Los dos enlaces de antes, como estaban (solo si la decisión los tocó: «Es esta» / «Es otra…»).
  if v_a ? 'gc_cliente' then
    update public.conta_gc_cliente set party_id = (v_a->'gc_cliente'->>'party_id')::uuid, casado_por = v_a->'gc_cliente'->>'casado_por'
     where company_id = p_company and gc_id = p_gc_cliente;
    if coalesce((v_a->>'cobro_cliente_era')::boolean, false) then
      v_cc := v_a->'cobro_cliente';
      update public.conta_cobro_cliente set gc_cliente_id = v_cc->>'gc_cliente_id', gc_casado_por = v_cc->>'gc_casado_por', forma_cobro = v_cc->>'forma_cobro',
             updated_at = (v_cc->>'updated_at')::timestamptz, updated_by_name = v_cc->>'updated_by_name'
       where company_id = p_company and party_id = v_e.party_id;
    else
      delete from public.conta_cobro_cliente where company_id = p_company and party_id = v_e.party_id and gc_cliente_id = p_gc_cliente and gc_casado_por = 'persona';
    end if;
    -- La decisión se quita: si se quedara, la lectura siguiente la volvería a aplicar.
    delete from public.conta_gestoria_decision where id = (v_a->>'decision')::uuid and tipo = 'enlace' and company_id = p_company;
    update public.conta_gestoria_diferencia set vigente = true
     where id = any(array(select jsonb_array_elements_text(coalesce(v_a->'diferencias', '[]'::jsonb))::uuid));
  end if;

  -- El enlace, como estaba (o nada, si no había).
  delete from public.conta_gc_enlace where company_id = p_company and gc_cliente_id = p_gc_cliente;
  if jsonb_typeof(v_a->'enlace') = 'object' then
    insert into public.conta_gc_enlace select * from jsonb_populate_record(null::public.conta_gc_enlace, v_a->'enlace');
  end if;
  return jsonb_build_object('frase', format('Deshecho: %s vuelve a estar como antes.', v_gc));
end $$;
comment on function public.conta_gc_enlace_deshacer(uuid, text) is
  'G06 · Deshace la última decisión de una persona sobre un cliente de GoCardless (Es esta / Es otra / No tiene ficha) si es de hace menos de 30 s: el enlace, los dos de antes, la decisión y la diferencia «sin ficha», como estaban.';
revoke all on function public.conta_gc_enlace_deshacer(uuid, text) from public, anon;
grant execute on function public.conta_gc_enlace_deshacer(uuid, text) to authenticated;

-- 7 · Juntar dos fichas: su enlace pasa a la que queda (misma firma; lo de antes, igual). Primero, la de antes al respaldo.
select public._respaldar_funcion('public._conta_gestoria_juntar(uuid,uuid,uuid,text)', '20261112T1110_g06_confirmar_enlace');
create or replace function public._conta_gestoria_juntar(p_cuenta uuid, p_queda uuid, p_se_va uuid, p_motivo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- G06 · Con el enlace con GoCardless (conta_gc_enlace), también el que confirmó una persona.
  foreach v_t in array array['conta_linea', 'conta_tarifa', 'conta_mandato', 'conta_solicitud', 'conta_gc_cliente', 'conta_gc_importacion',
                             'conta_gestoria_decision', 'conta_gestoria_diferencia', 'conta_recordatorio', 'conta_cobro_remesa_linea',
                             'payment_method', 'recurring_contract', 'conta_gestoria_ficha', 'conta_gc_enlace'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.party_id = $1', v_t) into v_filas using p_se_va;
    if jsonb_array_length(v_filas) > 0 then
      execute format('update public.%I set party_id = $1 where party_id = $2', v_t) using p_queda, p_se_va;
      v_mov := v_mov || jsonb_build_object(v_t, v_filas); v_n := v_n + jsonb_array_length(v_filas);
    end if;
  end loop;

  -- G06 · En las propuestas y los conflictos, la que se va se cambia por la que queda (sin repetirla).
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_filas from public.conta_gc_enlace x where x.account_id = p_cuenta and p_se_va = any(x.candidatas);
  if jsonb_array_length(v_filas) > 0 then
    update public.conta_gc_enlace x set candidatas = array(select distinct c from unnest(array_replace(x.candidatas, p_se_va, p_queda)) c order by c)
     where x.account_id = p_cuenta and p_se_va = any(x.candidatas);
    v_mov := v_mov || jsonb_build_object('conta_gc_enlace_candidatas', v_filas); v_n := v_n + jsonb_array_length(v_filas);
  end if;

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
end $function$;
