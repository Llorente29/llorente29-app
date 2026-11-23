-- supabase/migrations/20261123T1712_x29_extractos_anade.sql
--
-- X29 · Gestión de extractos bancarios, como ERP10 (maqueta 23, aprobada; respuestas X29 · 1 y 2). Solo AÑADE:
--   1. Validar por movimiento, como ERP10 («Poner validación» / «Quitar validación»): bank_movement.validated_at y
--      validated_by_name (las dos opcionales), con bank_validar y bank_quitar_validacion. Validar es la marca de
--      «revisado» de la línea del banco: NO toca su asiento (lo conciliado ya queda validado en el diario, R08).
--   2. El panel «Casar con facturas», plegado o no, por persona: conta_user_pref.casar_plegado (opcional).
--   3. Borrar líneas del extracto que no están contabilizadas, sin que vuelvan: bank_movimiento_borrado guarda SOLO la
--      huella (el banco, la huella, cuándo y quién), con su índice único por banco y huella; bank_movimientos_borrar
--      apunta la huella y borra la línea en la misma transacción (solo lo no contabilizado ni casado: dice cuántas ha
--      borrado y por qué no las demás); bank_movimiento_borrado_quitar quita la huella (la línea vuelve en la
--      siguiente lectura). Que una huella borrada no vuelva a entrar lo hace la 1713 (bank_importar y el disparador).
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita lo nuevo.

-- 1 · Validar por movimiento -------------------------------------------------------------------------------------------
alter table public.bank_movement add column if not exists validated_at timestamptz;
alter table public.bank_movement add column if not exists validated_by_name text;
comment on column public.bank_movement.validated_at is
  'X29 · «Validado» como en ERP10: la línea del extracto, revisada por una persona (cuándo). No es el asiento: ese se valida al conciliar (R08).';
comment on column public.bank_movement.validated_by_name is 'X29 · Quién la validó.';

create or replace function public.bank_validar(p_movimientos uuid[], p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_m public.bank_movement; v_n int := 0; v_ya int := 0; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  if coalesce(array_length(p_movimientos, 1), 0) = 0 then raise exception 'No hay ningún movimiento marcado.' using errcode = '22023'; end if;
  for v_m in select * from public.bank_movement where id = any(p_movimientos) order by op_date, id for update loop
    perform public._bank_cuenta_de_empresa(v_m.company_id);
    if v_m.validated_at is not null then v_ya := v_ya + 1; continue; end if;
    update public.bank_movement set validated_at = now(), validated_by_name = v_quien, updated_at = now() where id = v_m.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('validados', v_n, 'ya', v_ya,
    'texto', format('Validados: %s%s.', case when v_n = 1 then '1 movimiento' else v_n || ' movimientos' end,
                    case when v_ya > 0 then format(' (%s ya lo estaba%s)', v_ya, case when v_ya = 1 then '' else 'n' end) else '' end));
end $function$;
comment on function public.bank_validar(uuid[], text) is 'X29 · Valida (revisado) las líneas del extracto marcadas. No toca sus asientos.';
revoke all on function public.bank_validar(uuid[], text) from public, anon;
grant execute on function public.bank_validar(uuid[], text) to authenticated, service_role;

create or replace function public.bank_quitar_validacion(p_movimientos uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_m public.bank_movement; v_n int := 0;
begin
  if coalesce(array_length(p_movimientos, 1), 0) = 0 then raise exception 'No hay ningún movimiento marcado.' using errcode = '22023'; end if;
  for v_m in select * from public.bank_movement where id = any(p_movimientos) and validated_at is not null order by op_date, id for update loop
    perform public._bank_cuenta_de_empresa(v_m.company_id);
    update public.bank_movement set validated_at = null, validated_by_name = null, updated_at = now() where id = v_m.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('quitadas', v_n,
    'texto', case when v_n = 0 then 'Ninguno de los marcados estaba validado.' else format('Quitada la validación de %s.', case when v_n = 1 then '1 movimiento' else v_n || ' movimientos' end) end);
end $function$;
comment on function public.bank_quitar_validacion(uuid[]) is 'X29 · Quita la validación (revisado) de las líneas marcadas.';
revoke all on function public.bank_quitar_validacion(uuid[]) from public, anon;
grant execute on function public.bank_quitar_validacion(uuid[]) to authenticated, service_role;

-- 2 · El panel «Casar con facturas», plegado o no, por persona -----------------------------------------------------------
alter table public.conta_user_pref add column if not exists casar_plegado boolean;
comment on column public.conta_user_pref.casar_plegado is
  'X29 · Si el panel «Casar con facturas» de Gestión de extractos está plegado (true) o desplegado (false); sin valor, desplegado.';

-- 3 · Borrar líneas sin que vuelvan: solo la huella ---------------------------------------------------------------------
create table if not exists public.bank_movimiento_borrado (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete cascade,
  fingerprint         text not null,
  borrado_at          timestamptz not null default now(),
  borrado_por         text not null
);
comment on table public.bank_movimiento_borrado is
  'X29 · La huella de cada línea del extracto borrada a mano (solo el banco, la huella, cuándo y quién): la siguiente lectura del banco o un extracto que la traiga no la vuelve a meter (1713). Quitar la huella (bank_movimiento_borrado_quitar) la deja volver.';
create unique index if not exists bank_movimiento_borrado_huella on public.bank_movimiento_borrado (treasury_account_id, fingerprint);
alter table public.bank_movimiento_borrado enable row level security;
drop policy if exists bank_movimiento_borrado_leer on public.bank_movimiento_borrado;
create policy bank_movimiento_borrado_leer on public.bank_movimiento_borrado for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.bank_movimiento_borrado from anon, authenticated;
grant select on table public.bank_movimiento_borrado to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.bank_movimiento_borrado to conta_lectura;
  end if;
end $$;

create or replace function public.bank_movimientos_borrar(p_movimientos uuid[], p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v_m public.bank_movement; v_n int := 0; v_no text[] := '{}'; v_por_que text;
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  if coalesce(array_length(p_movimientos, 1), 0) = 0 then raise exception 'No hay ninguna línea marcada.' using errcode = '22023'; end if;
  for v_m in select * from public.bank_movement where id = any(p_movimientos) order by op_date, id for update loop
    perform public._bank_cuenta_de_empresa(v_m.company_id);
    v_por_que := case
      when v_m.status = 'casado' or exists (select 1 from public.bank_match b where b.movement_id = v_m.id and b.status = 'vivo')
        then 'está contabilizada: deshazla antes'
      when exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id where i.other_movement_id = v_m.id and b.status = 'vivo')
        then 'es el otro lado de un traspaso contabilizado'
      when v_m.receipt_path is not null then 'tiene su justificante: guárdalo antes'
    end;
    if v_por_que is not null then
      v_no := array_append(v_no, format('%s, %s: %s', to_char(v_m.op_date, 'DD/MM'), public.conta_euros_exactos(v_m.amount), v_por_que));
      continue;
    end if;
    insert into public.bank_movimiento_borrado (account_id, treasury_account_id, fingerprint, borrado_por)
    values (v_m.account_id, v_m.treasury_account_id, v_m.fingerprint, v_quien)
    on conflict (treasury_account_id, fingerprint) do nothing;
    -- Lo que la línea arrastraba sin estar contabilizada (casados ya deshechos), fuera con ella.
    delete from public.bank_match_item i using public.bank_match b where b.id = i.match_id and b.movement_id = v_m.id;
    delete from public.bank_match where movement_id = v_m.id;
    delete from public.bank_movement where id = v_m.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('borradas', v_n, 'no', to_jsonb(v_no),
    'texto', concat_ws(' ',
      case when v_n = 0 then 'No se ha borrado ninguna.' else format('Borradas: %s. No volverán al leer el banco ni al subir el extracto.', case when v_n = 1 then '1 línea' else v_n || ' líneas' end) end,
      case when array_length(v_no, 1) > 0 then format('%s no: %s.', case when array_length(v_no, 1) = 1 then 'Una' else array_length(v_no, 1)::text end, array_to_string(v_no, ' · ')) end));
end $function$;
comment on function public.bank_movimientos_borrar(uuid[], text) is
  'X29 · Borra las líneas del extracto marcadas que no están contabilizadas, y guarda su huella para que no vuelvan. Dice cuántas ha borrado y por qué no las demás.';
revoke all on function public.bank_movimientos_borrar(uuid[], text) from public, anon;
grant execute on function public.bank_movimientos_borrar(uuid[], text) to authenticated, service_role;

create or replace function public.bank_movimiento_borrado_quitar(p_banco uuid, p_huella text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_t public.treasury_account; v_n int;
begin
  select * into v_t from public.treasury_account where id = p_banco;
  if v_t.id is null then raise exception 'Ese banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  delete from public.bank_movimiento_borrado where treasury_account_id = p_banco and fingerprint = p_huella;
  get diagnostics v_n = row_count;
  return jsonb_build_object('quitada', v_n > 0,
    'texto', case when v_n > 0 then 'Quitada: la línea vuelve en la siguiente lectura del banco o al subir el extracto.' else 'Esa línea no estaba borrada.' end);
end $function$;
comment on function public.bank_movimiento_borrado_quitar(uuid, text) is 'X29 · Quita la huella de una línea borrada: vuelve en la siguiente lectura.';
revoke all on function public.bank_movimiento_borrado_quitar(uuid, text) from public, anon;
grant execute on function public.bank_movimiento_borrado_quitar(uuid, text) to authenticated, service_role;
