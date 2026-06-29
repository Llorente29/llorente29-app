-- supabase/migrations/20260629T2100_ai_action_contrato_ejecucion.sql
--
-- CONTRATO DE EJECUCIÓN del marco de agentes de Folvy.
-- Tabla ai_action = libro mayor de cada acción que un agente propone/ejecuta,
-- con ciclo de vida (proposed→confirmed→executed/rejected/failed/rolled_back),
-- efecto previsto, resultado y plan de reversión.
--
-- Patrón propose→confirm→execute:
--   1. El edge (write tool) llama propose_ai_action(...) → fila 'proposed' + devuelve action_id.
--   2. El front muestra la tarjeta; al confirmar llama commit_ai_action(action_id, edited_args).
--   3. commit_ai_action ejecuta la escritura real (despacho por tool_name), audita, marca 'executed'.
--
-- Seguridad: RLS calcada de ai_memory/ai_interaction. Las RPC son SECURITY DEFINER
-- pero verifican current_user_is_admin_of(account) dentro. Idempotente.

-- ── Tabla ───────────────────────────────────────────────────────────────────
create table if not exists ai_action (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  agent           text not null,                              -- 'kitchen' | 'team' | ...
  tool_name       text not null,                              -- 'assign_resale_cost' | 'reprice_menu_item' | ...
  risk            text not null default 'L1' check (risk in ('L0','L1','L2')),
  status          text not null default 'proposed'
                  check (status in ('proposed','confirmed','executed','rejected','failed','rolled_back')),
  summary         text not null,                              -- "Asignar coste 2,30€ a QUESATACOS DE BIRRIA"
  target_table    text,
  target_id       uuid,
  args            jsonb not null default '{}'::jsonb,         -- args de ejecución
  effect_preview  jsonb,                                      -- {margin_before, margin_after, upside_month, ...}
  result          jsonb,                                      -- lo que devolvió la ejecución
  rollback_hint   jsonb,                                      -- cómo revertir (p.ej. {price: 8.50}) — OBLIGATORIO para L1/L2
  error_message   text,
  proposed_by     uuid,
  confirmed_by    uuid,
  session_id      uuid,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  executed_at     timestamptz
);

create index if not exists ai_action_account_status_idx on ai_action (account_id, status, created_at desc);

-- ── RLS (calcada de ai_memory/ai_interaction) ───────────────────────────────
alter table ai_action enable row level security;

drop policy if exists ai_action_read on ai_action;
create policy ai_action_read on ai_action for select
  using (account_id = any (current_user_account_ids()));

drop policy if exists ai_action_write on ai_action;
create policy ai_action_write on ai_action for all
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));

-- ── RPC: proponer una acción (la llama el edge tras calcular el efecto) ──────
-- Inserta una fila 'proposed' y devuelve su id. NO ejecuta nada de negocio.
create or replace function propose_ai_action(
  p_account_id     uuid,
  p_agent          text,
  p_tool_name      text,
  p_summary        text,
  p_args           jsonb,
  p_risk           text default 'L1',
  p_effect_preview jsonb default null,
  p_rollback_hint  jsonb default null,
  p_target_table   text default null,
  p_target_id      uuid default null,
  p_session_id     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not current_user_is_admin_of(p_account_id) then
    raise exception 'No autorizado para proponer acciones en esta cuenta';
  end if;

  -- Guardarraíl de fiabilidad: L1/L2 exigen plan de reversión.
  if p_risk in ('L1','L2') and p_rollback_hint is null then
    raise exception 'Las acciones L1/L2 requieren rollback_hint (plan de reversión)';
  end if;

  insert into ai_action(
    account_id, agent, tool_name, risk, status, summary,
    target_table, target_id, args, effect_preview, rollback_hint,
    proposed_by, session_id
  ) values (
    p_account_id, p_agent, p_tool_name, p_risk, 'proposed', p_summary,
    p_target_table, p_target_id, coalesce(p_args, '{}'::jsonb), p_effect_preview, p_rollback_hint,
    auth.uid(), p_session_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ── RPC: confirmar y ejecutar una acción ────────────────────────────────────
-- Idempotente. Verifica permiso. Despacha por tool_name. Audita. Nunca deja a medias.
create or replace function commit_ai_action(
  p_action_id   uuid,
  p_edited_args jsonb default null   -- Return of Control: el usuario pudo ajustar parámetros
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act     ai_action%rowtype;
  v_args    jsonb;
  v_result  jsonb;
begin
  select * into v_act from ai_action where id = p_action_id;
  if not found then
    raise exception 'Acción no encontrada';
  end if;

  if not current_user_is_admin_of(v_act.account_id) then
    raise exception 'No autorizado para confirmar esta acción';
  end if;

  -- Idempotencia: si ya se ejecutó, devuelve su resultado sin re-ejecutar.
  if v_act.status = 'executed' then
    return jsonb_build_object('status','executed','already',true,'result',v_act.result);
  end if;
  if v_act.status <> 'proposed' then
    raise exception 'La acción no está en estado proponible (estado actual: %)', v_act.status;
  end if;

  -- Args finales: los ajustados por el usuario sobrescriben los propuestos.
  v_args := coalesce(v_act.args, '{}'::jsonb) || coalesce(p_edited_args, '{}'::jsonb);

  -- Marca confirmada antes de ejecutar (rastro aunque la ejecución falle).
  update ai_action
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         args = v_args
   where id = p_action_id;

  -- ── DESPACHO POR TOOL ─────────────────────────────────────────────────────
  begin
    if v_act.tool_name = 'assign_resale_cost' then
      -- Asigna coste a un producto sin mapear (reventa). Reutiliza la RPC existente.
      select classify_unmapped_product(
        v_act.account_id,
        (v_args->>'product_name'),
        'resale',
        (v_args->>'unit_cost')::numeric,
        nullif(v_args->>'recipe_item_id','')::uuid
      ) into v_result;

    elsif v_act.tool_name = 'reprice_menu_item' then
      -- Cambia el PVP base de un menu_item.
      update menu_item
         set price = (v_args->>'new_price')::numeric,
             updated_at = now()
       where id = (v_args->>'menu_item_id')::uuid
         and account_id = v_act.account_id;
      v_result := jsonb_build_object('menu_item_id', v_args->>'menu_item_id',
                                     'new_price', (v_args->>'new_price')::numeric);

    else
      raise exception 'Tool no soportada por commit_ai_action: %', v_act.tool_name;
    end if;

    -- Éxito.
    update ai_action
       set status = 'executed', result = v_result, executed_at = now()
     where id = p_action_id;

    return jsonb_build_object('status','executed','result',v_result);

  exception when others then
    -- Fallo: registra el error, no deja a medias.
    update ai_action
       set status = 'failed', error_message = sqlerrm, executed_at = now()
     where id = p_action_id;
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end;
$$;

-- Permisos de ejecución (las RPC verifican admin internamente).
grant execute on function propose_ai_action(uuid,text,text,text,jsonb,text,jsonb,jsonb,text,uuid,uuid) to authenticated;
grant execute on function commit_ai_action(uuid,jsonb) to authenticated;
