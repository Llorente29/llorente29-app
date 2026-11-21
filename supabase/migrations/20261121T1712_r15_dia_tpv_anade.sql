-- supabase/migrations/20261121T1712_r15_dia_tpv_anade.sql
--
-- R15 · Los días del TPV se contabilizan al subirlos y se pueden abrir. Solo AÑADE
-- (una tabla nueva, una columna que admite nulos en una tabla pequeña y funciones
-- nuevas); no cambia nada de lo que existe: ni conta_tpv_dia_guardar, ni la propuesta,
-- ni conta_tpv_dia_validar (contabilizar al subir es la misma pieza que «Validar los N
-- listos», llamada desde la pantalla de subir).
--
--   1. conta_tpv_subida: cada subida, con su identificador, quién y cuándo. Y
--      conta_tpv_dia.subida_id: la subida en la que entró cada día (sus asientos, por
--      el día: entry_id y conta_dia_cobro). Para deshacer en grupo «lo que entró en una
--      subida».
--   2. conta_tpv_subida_apuntar(empresa, días, programa, quién): apunta una subida y
--      los días que entraron en ella.
--   3. conta_tpv_dia_ficha(día): el día por dentro, para su ficha: el día y su
--      programa, su estado (y el motivo si está en espera), sus facturas por contador
--      (primera y última), las facturas con NIF una a una, las devoluciones, base e IVA
--      por tipo, cómo se cobró por forma de pago con su cuenta, sus dos asientos, su PDF,
--      su línea de ERP10, la subida en la que entró y los tickets que pasan del límite de
--      la factura simplificada (Reglamento de facturación, art. 4: 400 €, o 3.000 € en
--      hostelería y restauración, IVA incluido).
--   4. conta_tpv_emitidas(empresa, desde, hasta): los días contabilizados como facturas
--      expedidas (una fila por día, con su rango y su PDF) y sus facturas con NIF, una
--      fila cada una. Para «Facturas emitidas». No son customer_invoice: no van a
--      Verifactu (los tickets los certifica el TPV).
-- Todo vale para cualquier TPV (conta_tpv_dia.programa): nada de aquí es de Revo.
-- Se puede pasar dos veces (if not exists, create or replace).
-- Vuelta atrás: supabase/vuelta-atras/20261121T1712_r15_dia_tpv_anade.down.sql

-- 1 · La subida ----------------------------------------------------------------------------------
create table if not exists public.conta_tpv_subida (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  programa        text not null,
  dias            integer not null default 0 check (dias >= 0),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
comment on table public.conta_tpv_subida is
  'R15. Cada subida de ventas del TPV, con su identificador: los días que entraron en ella llevan conta_tpv_dia.subida_id (y sus asientos, por el día). Para deshacer en grupo lo que entró en una subida.';
create index if not exists idx_conta_tpv_subida_empresa on public.conta_tpv_subida (company_id, created_at desc);
alter table public.conta_tpv_subida enable row level security;
drop policy if exists conta_tpv_subida_leer on public.conta_tpv_subida;
create policy conta_tpv_subida_leer on public.conta_tpv_subida for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_tpv_subida from anon, authenticated;
grant select on table public.conta_tpv_subida to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_tpv_subida to conta_lectura; end if;
end $$;

alter table public.conta_tpv_dia add column if not exists subida_id uuid references public.conta_tpv_subida(id) on delete set null;
comment on column public.conta_tpv_dia.subida_id is 'R15. La subida en la que entró el día (la última que lo guardó). Nulo en los subidos antes del R15.';
create index if not exists idx_conta_tpv_dia_subida on public.conta_tpv_dia (subida_id) where subida_id is not null;

-- 2 · Apuntar una subida -------------------------------------------------------------------------
create or replace function public.conta_tpv_subida_apuntar(p_company uuid, p_dias uuid[], p_programa text, p_quien_nombre text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $function$
declare v_acc uuid; v_id uuid; v_n int;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_programa), '') = '' then raise exception 'Falta el programa del TPV.' using errcode = '22023'; end if;
  insert into public.conta_tpv_subida (account_id, company_id, programa, created_by, created_by_name)
  values (v_acc, p_company, btrim(p_programa), auth.uid(), coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()))
  returning id into v_id;
  update public.conta_tpv_dia set subida_id = v_id
   where company_id = p_company and account_id = v_acc and id = any(coalesce(p_dias, '{}'));
  get diagnostics v_n = row_count;
  update public.conta_tpv_subida set dias = v_n where id = v_id;
  return v_id;
end $function$;
comment on function public.conta_tpv_subida_apuntar(uuid, uuid[], text, text) is 'R15: apunta una subida de ventas del TPV y los días que entraron en ella (conta_tpv_dia.subida_id). Devuelve su identificador.';
revoke all on function public.conta_tpv_subida_apuntar(uuid, uuid[], text, text) from public, anon;
grant execute on function public.conta_tpv_subida_apuntar(uuid, uuid[], text, text) to authenticated, service_role;

-- 3 · El día por dentro --------------------------------------------------------------------------
create or replace function public.conta_tpv_dia_ficha(p_dia uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  d public.conta_tpv_dia; v_limite numeric; v_motivo text; v_cobro uuid; v_out jsonb;
begin
  select * into d from public.conta_tpv_dia where id = p_dia;
  if d.id is null or not (public.belongs_to_account(d.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Ese día no es de tu cuenta.' using errcode = '42501';
  end if;
  -- Reglamento de facturación (RD 1619/2012), art. 4: factura simplificada hasta 400 € (IVA incluido) o,
  -- en hostelería y restauración, hasta 3.000 €.
  v_limite := case when (select c.sector from public.company c where c.id = d.company_id) = 'hosteleria' then 3000 else 400 end;
  if d.estado = 'guardado' then v_motivo := public._conta_tpv_propuesta(d.id) ->> 'sin_propuesta'; end if;
  select k.cobro_entry_id into v_cobro from public.conta_dia_cobro k where k.factura_entry_id = d.entry_id;

  select jsonb_build_object(
    'id', d.id, 'company_id', d.company_id, 'dia', d.dia, 'programa', d.programa,
    'programa_nombre', case d.programa when 'revo' then 'Revo' else initcap(d.programa) end,
    'estado', case when d.estado = 'contabilizado' then 'validado' when v_motivo is not null then 'en_espera' else 'por_validar' end,
    'motivo', v_motivo,
    'documentos', d.documentos, 'primero', d.primer_numero, 'ultimo', d.ultimo_numero,
    'base', d.base, 'cuota', d.cuota, 'total', d.total,
    'subido_por', d.subido_por_nombre, 'subido_en', d.subido_en,
    'subida', (select jsonb_build_object('id', s.id, 'cuando', s.created_at, 'quien', s.created_by_name, 'dias', s.dias)
                 from public.conta_tpv_subida s where s.id = d.subida_id),
    'contadores', coalesce((select jsonb_agg(jsonb_build_object('contador', x.contador, 'facturas', x.n, 'primero', x.a, 'ultimo', x.b, 'total', x.t) order by x.contador)
                     from (select contador, count(*) as n, min(numero) as a, max(numero) as b, sum(total) as t
                             from public.conta_tpv_documento where dia_id = d.id group by contador) x), '[]'::jsonb),
    'con_nif', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero, 'contador', x.contador, 'nif', x.cliente_nif, 'cliente', x.cliente_nombre,
                                                         'base', x.base, 'cuota', x.cuota, 'total', x.total) order by x.numero)
                    from public.conta_tpv_documento x where x.dia_id = d.id and x.cliente_nif is not null), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero, 'contador', x.contador, 'total', x.total) order by x.numero)
                    from public.conta_tpv_documento x where x.dia_id = d.id and x.total < 0), '[]'::jsonb),
    'sobre_limite', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero, 'total', x.total) order by x.numero)
                    from public.conta_tpv_documento x where x.dia_id = d.id and x.total > v_limite and x.cliente_nif is null), '[]'::jsonb),
    'limite', v_limite,
    'iva', coalesce((select jsonb_agg(jsonb_build_object('tipo', y.tipo, 'base', y.b, 'cuota', y.q, 'facturas', y.n) order by y.tipo)
                from (select i.tipo, sum(i.base) as b, sum(i.cuota) as q, count(distinct i.documento_id) as n
                        from public.conta_tpv_impuesto i join public.conta_tpv_documento x on x.id = i.documento_id
                       where x.dia_id = d.id group by i.tipo) y), '[]'::jsonb),
    'cobros', coalesce((select jsonb_agg(jsonb_build_object('forma', z.forma, 'importe', z.importe, 'pagos', z.n,
                                   'cuenta', (select a.code from public.conta_tpv_forma_cuenta f join public.company_account a on a.id = f.company_account_id
                                               where f.company_id = d.company_id and f.forma = z.forma and f.canal is null limit 1),
                                   'nombre', (select a.name from public.conta_tpv_forma_cuenta f join public.company_account a on a.id = f.company_account_id
                                               where f.company_id = d.company_id and f.forma = z.forma and f.canal is null limit 1),
                                   'por_canal', exists (select 1 from public.conta_tpv_forma_cuenta f where f.company_id = d.company_id and f.forma = z.forma and f.canal is not null))
                                 order by z.forma)
                   from (select c.forma, sum(c.importe) as importe, count(*) as n from public.conta_tpv_cobro c where c.dia_id = d.id group by c.forma) z), '[]'::jsonb),
    'factura', (select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'estado', e.status) from public.journal_entry e where e.id = d.entry_id),
    'cobro', (select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'estado', e.status) from public.journal_entry e where e.id = v_cobro),
    'pdf', (select jsonb_build_object('ruta', j.storage_path, 'nombre', j.file_name) from public.journal_entry_document j
             where j.entry_id = d.entry_id and j.kind = 'resumen_ventas' order by j.created_at desc limit 1),
    'erp10', (select jsonb_build_object('estado', p.estado, 'serie', p.erp10_serie, 'documento', p.erp10_documento, 'cuando', p.creado_en)
                from public.conta_erp10_salida_partida p where p.entry_id = d.entry_id order by p.creado_en desc limit 1))
    into v_out;
  return v_out;
end $function$;
comment on function public.conta_tpv_dia_ficha(uuid) is 'R15: un día del TPV por dentro, para su ficha: facturas por contador, con NIF y devoluciones, IVA por tipo, cobros con su cuenta, sus dos asientos, su PDF, ERP10, su subida y los tickets por encima del límite de la factura simplificada. Solo lee.';
revoke all on function public.conta_tpv_dia_ficha(uuid) from public, anon;
grant execute on function public.conta_tpv_dia_ficha(uuid) to authenticated, service_role;

-- 4 · Los días como facturas expedidas -------------------------------------------------------------
create or replace function public.conta_tpv_emitidas(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(f order by f->>'dia' desc, f->>'orden', f->>'numero') from (
      select jsonb_build_object('clase', 'dia', 'orden', '0', 'dia_id', d.id, 'dia', d.dia, 'programa', d.programa,
               'programa_nombre', case d.programa when 'revo' then 'Revo' else initcap(d.programa) end,
               'numero', d.primer_numero, 'primero', d.primer_numero, 'ultimo', d.ultimo_numero, 'facturas', d.documentos,
               'base', d.base, 'cuota', d.cuota, 'total', d.total, 'asiento_id', d.entry_id,
               'pdf', (select j.storage_path from public.journal_entry_document j where j.entry_id = d.entry_id and j.kind = 'resumen_ventas' order by j.created_at desc limit 1)) as f
        from public.conta_tpv_dia d
       where d.company_id = p_company and d.account_id = v_acc and d.estado = 'contabilizado'
         and (p_desde is null or d.dia >= p_desde) and (p_hasta is null or d.dia <= p_hasta)
      union all
      select jsonb_build_object('clase', 'nif', 'orden', '1', 'dia_id', d.id, 'dia', d.dia, 'programa', d.programa,
               'numero', x.numero, 'contador', x.contador, 'nif', x.cliente_nif, 'cliente', x.cliente_nombre,
               'base', x.base, 'cuota', x.cuota, 'total', x.total, 'asiento_id', d.entry_id)
        from public.conta_tpv_dia d join public.conta_tpv_documento x on x.dia_id = d.id and x.cliente_nif is not null
       where d.company_id = p_company and d.account_id = v_acc and d.estado = 'contabilizado'
         and (p_desde is null or d.dia >= p_desde) and (p_hasta is null or d.dia <= p_hasta)
    ) z), '[]'::jsonb);
end $function$;
comment on function public.conta_tpv_emitidas(uuid, date, date) is 'R15: los días del TPV contabilizados como facturas expedidas (una fila por día, con su rango y su PDF) y sus facturas con NIF (una fila cada una), para «Facturas emitidas». Solo lee; no son customer_invoice y no van a Verifactu.';
revoke all on function public.conta_tpv_emitidas(uuid, date, date) from public, anon;
grant execute on function public.conta_tpv_emitidas(uuid, date, date) to authenticated, service_role;
