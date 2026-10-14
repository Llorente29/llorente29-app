-- cambia: bank_activity_log_action_check · prueba: supabase/staging/sql/20261101_b01_cierre_agente_prueba.sql
-- ============================================================================
-- B01 · 6 · RESPUESTA 4: ALIAS, REGLAS QUE SE APAGAN SOLAS, CIERRE DEL MES,
--          EL AGENTE «CONCILIACIÓN» Y EL AGREGADOR (sin pantalla)
-- ----------------------------------------------------------------------------
-- Todo es del frente B y de esta misma tanda (nada de esto está en producción).
-- Añade, salvo UNA cosa que cambia en caliente y se declara arriba: el CHECK
-- de bank_activity_log.action SOLO AMPLÍA (cierre, reapertura, agente), para
-- que el cierre y el agente queden en «Lo que ha hecho Folvy».
--
--   treasury_account.short_name   el alias corto del banco (respuesta 4, 1),
--                                 editable en «Cuentas y extractos». Admite nulos.
--   bank_rule.corrections         cuántas veces la persona corrigió lo que
--                                 propuso la regla. A la segunda se apaga sola
--                                 (respuesta 4, 3) y lo dice. Admite nulos.
--   bank_month_close              el cierre del mes de un banco: saldo del
--                                 banco, de contabilidad, la diferencia y lo
--                                 que la explica; «a sabiendas» con su porqué.
--   bank_agent_run                cada pasada del agente «Conciliación»
--                                 (después de un extracto, o la del día).
--   bank_aggregator_link          la cuenta conectada por un agregador (Enable
--                                 Banking o el simulado) y su consentimiento,
--                                 que caduca a los 180 días. Sin pantalla.
--
-- Funciones nuevas: bank_cuenta_alias, _bank_regla_corregida, bank_mes_cerrar,
-- bank_mes_reabrir, bank_agente_registrar, bank_agente_toca_hoy,
-- bank_consentimientos_por_caducar. bank_casar (la corrección de una regla) y
-- bank_importar (el mismo movimiento por el agregador y por Norma 43) cambian
-- en su fichero, la 0110, de esta misma tanda (mismas firmas).
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0150_b01_cierre_agente.down.sql
-- ============================================================================

-- ── Alias del banco ─────────────────────────────────────────────────────────
alter table public.treasury_account add column if not exists short_name text;
comment on column public.treasury_account.short_name is
  'B01 (respuesta 4). El nombre corto del banco en la barra de Bancos («Norte»); si no hay, el nombre entero.';

create or replace function public.bank_cuenta_alias(p_treasury uuid, p_alias text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_alias text := nullif(trim(coalesce(p_alias, '')), '');
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  if length(v_alias) > 24 then raise exception 'El nombre corto, de 24 letras como mucho: es para la barra.' using errcode = '23514'; end if;
  update public.treasury_account set short_name = v_alias where id = p_treasury;
end $$;
grant execute on function public.bank_cuenta_alias(uuid, text) to authenticated;

-- ── Reglas: dos correcciones la apagan ─────────────────────────────────────
alter table public.bank_rule add column if not exists corrections integer;
comment on column public.bank_rule.corrections is
  'B01 (respuesta 4). Veces que la persona casó con otra cosa lo que proponía esta regla. A la segunda, la regla se apaga sola.';

/** La persona casó con otra cosa lo que proponía la regla: una corrección más; a la segunda, apagada y dicho. */
create or replace function public._bank_regla_corregida(p_rule uuid, p_movement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bank_rule; v_n integer;
begin
  select * into v from public.bank_rule where id = p_rule for update;
  if v.id is null then return; end if;
  v_n := coalesce(v.corrections, 0) + 1;
  update public.bank_rule set corrections = v_n, updated_at = now() where id = p_rule;
  insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
  values (v.account_id, p_rule, 'cambiada', jsonb_build_object('correcciones', v_n - 1), jsonb_build_object('correcciones', v_n, 'movimiento', p_movement),
          auth.uid(), public.conta_nombre_actor());
  if v_n >= 2 and v.status = 'activa' then
    update public.bank_rule set status = 'apagada', updated_at = now() where id = p_rule;
    insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
    values (v.account_id, p_rule, 'apagada', jsonb_build_object('estado', 'activa'), jsonb_build_object('estado', 'apagada', 'por', 'dos correcciones'),
            null, 'Folvy');
    perform public._bank_log(v.account_id, v.company_id, p_movement, null, null, 'regla', 'folvy',
      'He apagado la regla «' || v.words || '»: la has corregido dos veces. Puedes volver a encenderla en Reglas.',
      jsonb_build_object('regla', p_rule, 'correcciones', v_n));
  end if;
end $$;
revoke all on function public._bank_regla_corregida(uuid, uuid) from public, anon, authenticated;

-- ── «Lo que ha hecho Folvy» también cuenta el cierre y el agente ───────────
alter table public.bank_activity_log drop constraint if exists bank_activity_log_action_check;
alter table public.bank_activity_log add constraint bank_activity_log_action_check
  check (action in ('importado', 'casado', 'enlazado', 'propuesto', 'por_aclarar', 'validado', 'deshecho', 'ignorado', 'regla',
                    'cierre', 'reabierto', 'agente'));

-- ── Cierre del mes de un banco ─────────────────────────────────────────────
create table if not exists public.bank_month_close (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete restrict,
  month               date not null check (extract(day from month) = 1),
  bank_balance        numeric(14,2),
  book_balance        numeric(14,2) not null,
  difference          numeric(14,2),
  loose_count         integer not null check (loose_count >= 0),
  loose_amount        numeric(14,2) not null,
  knowingly           boolean not null default false,
  reason              text,
  status              text not null default 'cerrado' check (status in ('cerrado', 'reabierto')),
  closed_at           timestamptz not null default now(),
  closed_by           uuid,
  closed_by_name      text,
  reopened_at         timestamptz,
  reopened_by_name    text,
  reopen_reason       text,
  -- «A sabiendas» siempre con su porqué; y lo que no cuadra o queda suelto, solo a sabiendas.
  constraint bank_month_close_a_sabiendas check (not knowingly or length(trim(coalesce(reason, ''))) > 0),
  constraint bank_month_close_sueltos check (knowingly or (loose_count = 0 and coalesce(difference, 0) = 0 and bank_balance is not null)),
  constraint bank_month_close_reabierto check ((status = 'reabierto') = (reopened_at is not null and reopen_reason is not null))
);
create unique index if not exists bank_month_close_uno_vivo on public.bank_month_close (treasury_account_id, month) where status = 'cerrado';
comment on table public.bank_month_close is
  'B01 (respuesta 4). El cierre del mes de un banco: saldo del banco y de contabilidad, la diferencia y lo que la explica. Con movimientos sin casar o diferencia, solo «a sabiendas» y con su porqué.';
alter table public.bank_month_close enable row level security;
drop policy if exists bank_month_close_select on public.bank_month_close;
create policy bank_month_close_select on public.bank_month_close for select using ((select public.belongs_to_account(account_id)));

/** El estado del mes de un banco, sin cerrar nada: lo que enseña «Cierre del mes» y lo que comprueba el cierre. */
create or replace function public._bank_mes_estado(p_treasury uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.treasury_account; v_desde date := date_trunc('month', p_mes)::date; v_hasta date; v_572 text;
  v_banco numeric; v_libro numeric; v_n int; v_suma numeric; v_extracto date;
begin
  v_hasta := (v_desde + interval '1 month - 1 day')::date;
  select * into v_t from public.treasury_account where id = p_treasury;
  v_572 := public._bank_cuenta_572(p_treasury);
  -- El saldo del banco a fin de mes: el del último extracto que llega hasta ese día (con saldos).
  select s.closing_balance, s.period_to into v_banco, v_extracto from public.bank_statement s
   where s.treasury_account_id = p_treasury and s.closing_balance is not null and s.period_to <= v_hasta
   order by s.period_to desc, s.imported_at desc limit 1;
  if v_extracto is not null and v_extracto < v_hasta and exists (select 1 from public.bank_movement m
       where m.treasury_account_id = p_treasury and m.op_date > v_extracto and m.op_date <= v_hasta) then
    v_banco := null;  -- hay movimientos después del último saldo conocido: el saldo de fin de mes no se sabe
  end if;
  select coalesce(sum(jl.debit - jl.credit), 0) into v_libro
    from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account ca on ca.id = jl.company_account_id
   where ca.company_id = v_t.company_id and ca.code = v_572 and je.status in ('validado', 'anulado', 'propuesto')
     and je.entry_date <= v_hasta and je.source_type <> 'closing';
  select count(*), coalesce(sum(amount), 0) into v_n, v_suma from public.bank_movement
   where treasury_account_id = p_treasury and op_date between v_desde and v_hasta and status not in ('casado', 'ignorado');
  return jsonb_build_object('mes', v_desde, 'hasta', v_hasta, 'cuenta', v_572, 'saldo_banco', v_banco, 'extracto_hasta', v_extracto,
    'saldo_libro', v_libro, 'diferencia', case when v_banco is null then null else v_banco - v_libro end,
    'sueltos', v_n, 'sueltos_importe', v_suma);
end $$;
revoke all on function public._bank_mes_estado(uuid, date) from public, anon, authenticated;

create or replace function public.bank_mes_cerrar(p_treasury uuid, p_mes date, p_a_sabiendas boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_cuenta uuid; v_e jsonb; v_id uuid; v_sab boolean := coalesce(p_a_sabiendas, false);
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._bank_cuenta_de_empresa(v_t.company_id);
  if public._bank_cuenta_572(p_treasury) is null then
    raise exception '«%» no tiene su cuenta en contabilidad: no hay con qué comparar.', v_t.name using errcode = '23514';
  end if;
  if date_trunc('month', p_mes)::date >= date_trunc('month', now() at time zone 'Europe/Madrid')::date then
    raise exception 'El mes aún no ha terminado: se cierra a partir del día 1 del siguiente.' using errcode = '23514';
  end if;
  if exists (select 1 from public.bank_month_close where treasury_account_id = p_treasury and month = date_trunc('month', p_mes)::date and status = 'cerrado') then
    raise exception 'Ese mes de «%» ya está cerrado.', v_t.name using errcode = '23505';
  end if;
  v_e := public._bank_mes_estado(p_treasury, p_mes);
  if not v_sab then
    if (v_e->>'sueltos')::int > 0 then
      raise exception 'Quedan % movimientos sin casar en «%» (% en total). Cásalos, o ciérralo a sabiendas diciendo por qué.',
        v_e->>'sueltos', v_t.name, public.conta_euros_exactos((v_e->>'sueltos_importe')::numeric) using errcode = '23514';
    end if;
    if v_e->>'saldo_banco' is null then
      raise exception 'Falta el extracto con el saldo de fin de mes de «%»: súbelo, o ciérralo a sabiendas diciendo por qué.', v_t.name using errcode = '23514';
    end if;
    if (v_e->>'diferencia')::numeric <> 0 then
      raise exception 'El banco dice % y contabilidad %: difieren %. Explícalo, o ciérralo a sabiendas diciendo por qué.',
        public.conta_euros_exactos((v_e->>'saldo_banco')::numeric), public.conta_euros_exactos((v_e->>'saldo_libro')::numeric),
        public.conta_euros_exactos((v_e->>'diferencia')::numeric) using errcode = '23514';
    end if;
  elsif length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Cerrar a sabiendas pide el porqué: queda escrito con tu nombre.' using errcode = '23514';
  end if;
  insert into public.bank_month_close (account_id, company_id, treasury_account_id, month, bank_balance, book_balance, difference, loose_count, loose_amount,
                                       knowingly, reason, closed_by, closed_by_name)
  values (v_cuenta, v_t.company_id, p_treasury, (v_e->>'mes')::date, (v_e->>'saldo_banco')::numeric, (v_e->>'saldo_libro')::numeric,
          (v_e->>'diferencia')::numeric, (v_e->>'sueltos')::int, (v_e->>'sueltos_importe')::numeric, v_sab, nullif(trim(coalesce(p_motivo, '')), ''),
          auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  perform public._bank_log(v_cuenta, v_t.company_id, null, null, null, 'cierre', 'persona',
    case when v_sab then format('Cerrado %s de %s a sabiendas: %s', to_char((v_e->>'mes')::date, 'MM/YYYY'), v_t.name, trim(p_motivo))
         else format('Cerrado %s de %s: el banco y contabilidad dicen lo mismo, %s', to_char((v_e->>'mes')::date, 'MM/YYYY'), v_t.name,
                     public.conta_euros_exactos((v_e->>'saldo_banco')::numeric)) end,
    v_e || jsonb_build_object('cierre', v_id, 'a_sabiendas', v_sab));
  return v_e || jsonb_build_object('cierre', v_id, 'a_sabiendas', v_sab);
end $$;
grant execute on function public.bank_mes_cerrar(uuid, date, boolean, text) to authenticated;

create or replace function public.bank_mes_reabrir(p_cierre uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bank_month_close;
begin
  select * into v from public.bank_month_close where id = p_cierre for update;
  if v.id is null then raise exception 'Ese cierre no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v.company_id);
  if v.status <> 'cerrado' then raise exception 'Ese mes ya estaba reabierto.' using errcode = '23514'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Reabrir un mes pide el porqué.' using errcode = '23514'; end if;
  update public.bank_month_close set status = 'reabierto', reopened_at = now(), reopened_by_name = public.conta_nombre_actor(), reopen_reason = trim(p_motivo)
   where id = p_cierre;
  perform public._bank_log(v.account_id, v.company_id, null, null, null, 'reabierto', 'persona',
    format('Reabierto %s: %s', to_char(v.month, 'MM/YYYY'), trim(p_motivo)), jsonb_build_object('cierre', p_cierre));
end $$;
grant execute on function public.bank_mes_reabrir(uuid, text) to authenticated;

/** El estado del mes de cada banco de la empresa, para la pantalla «Cierre del mes» (y el agente). */
create or replace function public.bank_meses_estado(p_company uuid, p_mes date)
returns table (treasury_account_id uuid, estado jsonb, cierre_id uuid, cerrado_a_sabiendas boolean, cerrado_por text, cerrado_el timestamptz, motivo text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._bank_cuenta_de_empresa(p_company);
  return query
    select t.id, public._bank_mes_estado(t.id, p_mes), c.id, c.knowingly, c.closed_by_name, c.closed_at, c.reason
      from public.treasury_account t
      left join public.bank_month_close c on c.treasury_account_id = t.id and c.month = date_trunc('month', p_mes)::date and c.status = 'cerrado'
     where t.company_id = p_company and t.kind = 'bank' and t.is_active;
end $$;
grant execute on function public.bank_meses_estado(uuid, date) to authenticated;

-- ── El agente «Conciliación»: cada pasada, con su resumen ──────────────────
create table if not exists public.bank_agent_run (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  trigger             text not null check (trigger in ('extracto', 'diario')),
  ran_at              timestamptz not null default now(),
  matched             integer not null default 0 check (matched >= 0),
  proposed            integer not null default 0 check (proposed >= 0),
  to_clarify          integer not null default 0 check (to_clarify >= 0),
  before_cutover      integer not null default 0 check (before_cutover >= 0),
  failures            integer not null default 0 check (failures >= 0),
  summary             text not null check (length(trim(summary)) > 0),
  detail              jsonb not null default '{}'::jsonb,
  run_by              uuid,
  run_by_name         text
);
create index if not exists bank_agent_run_empresa on public.bank_agent_run (company_id, ran_at desc);
comment on table public.bank_agent_run is
  'B01 (respuesta 4). Cada pasada del agente «Conciliación» (después de un extracto, o la del día) y lo que hizo. Su resumen es la banda verde de Bancos.';
alter table public.bank_agent_run enable row level security;
drop policy if exists bank_agent_run_select on public.bank_agent_run;
create policy bank_agent_run_select on public.bank_agent_run for select using ((select public.belongs_to_account(account_id)));

create or replace function public.bank_agente_registrar(p_company uuid, p_disparo text, p_resultado jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company); v_id uuid; v_resumen text;
  v_c int := coalesce((p_resultado->>'casados')::int, 0); v_p int := coalesce((p_resultado->>'propuestos')::int, 0);
  v_a int := coalesce((p_resultado->>'por_aclarar')::int, 0); v_f int := coalesce((p_resultado->>'fallos')::int, 0);
begin
  if p_disparo not in ('extracto', 'diario') then raise exception 'El agente corre después de un extracto o una vez al día.' using errcode = '23514'; end if;
  v_resumen := case when v_c + v_p + v_a = 0 then 'He mirado los movimientos pendientes: no había nada nuevo.'
    else format('He casado yo %s; te propongo %s y quedan %s por aclarar.', v_c, v_p, v_a) end
    || case when v_f > 0 then format(' %s no se han podido casar: quedan por aclarar con el motivo.', v_f) else '' end;
  insert into public.bank_agent_run (account_id, company_id, trigger, matched, proposed, to_clarify, before_cutover, failures, summary, detail, run_by, run_by_name)
  values (v_cuenta, p_company, p_disparo, v_c, v_p, v_a, coalesce((p_resultado->>'antes_corte')::int, 0), v_f, v_resumen,
          coalesce(p_resultado, '{}'::jsonb), auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  perform public._bank_log(v_cuenta, p_company, null, null, null, 'agente', 'folvy',
    case when p_disparo = 'extracto' then 'Al subir el extracto: ' else 'La pasada del día: ' end || v_resumen,
    jsonb_build_object('pasada', v_id, 'disparo', p_disparo));
  return v_id;
end $$;
grant execute on function public.bank_agente_registrar(uuid, text, jsonb) to authenticated;

/** ¿Le toca hoy la pasada del día? (ninguna pasada hoy, en Madrid). */
create or replace function public.bank_agente_toca_hoy(p_company uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select not exists (select 1 from public.bank_agent_run r where r.company_id = p_company
                      and (r.ran_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date)
$$;
grant execute on function public.bank_agente_toca_hoy(uuid) to authenticated;

-- ── El agregador (Enable Banking o el simulado): la cuenta y su consentimiento ──
create table if not exists public.bank_aggregator_link (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete cascade,
  provider            text not null check (provider in ('simulado', 'enable_banking')),
  external_account_id text not null,
  consent_id          text not null,
  consent_valid_until timestamptz not null,
  status              text not null default 'activo' check (status in ('activo', 'caducado', 'revocado')),
  last_sync_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  created_by_name     text,
  unique (provider, external_account_id)
);
comment on table public.bank_aggregator_link is
  'B01 (respuesta 4). Una cuenta del banco conectada por un agregador (PSD2, RDL 19/2018 art. 3.38) y su consentimiento, que caduca a los 180 días. Sin pantalla hasta que exista el contrato.';
alter table public.bank_aggregator_link enable row level security;
drop policy if exists bank_aggregator_link_select on public.bank_aggregator_link;
create policy bank_aggregator_link_select on public.bank_aggregator_link for select using ((select public.belongs_to_account(account_id)));

/** Los consentimientos que caducan en los próximos `p_dias` (o ya caducados y aún activos): el aviso de 7 días antes. */
create or replace function public.bank_consentimientos_por_caducar(p_company uuid, p_dias integer default 7)
returns table (id uuid, treasury_account_id uuid, banco text, provider text, caduca timestamptz, dias integer)
language sql stable security invoker set search_path = public as $$
  select l.id, l.treasury_account_id, t.name, l.provider, l.consent_valid_until,
         ((l.consent_valid_until at time zone 'Europe/Madrid')::date - (now() at time zone 'Europe/Madrid')::date)::int
    from public.bank_aggregator_link l join public.treasury_account t on t.id = l.treasury_account_id
   where l.company_id = p_company and l.status = 'activo'
     and (l.consent_valid_until at time zone 'Europe/Madrid')::date <= (now() at time zone 'Europe/Madrid')::date + coalesce(p_dias, 7)
   order by l.consent_valid_until
$$;
grant execute on function public.bank_consentimientos_por_caducar(uuid, integer) to authenticated;
