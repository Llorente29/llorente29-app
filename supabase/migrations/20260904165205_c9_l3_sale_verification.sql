-- C9 · Lote 3 §1 (04/09/2026). El resultado de verificar un pedido.
--
-- NACE CERRADA E INERTE. Cerrada: RLS encendida, revoke a anon y authenticated,
-- comprobado en la misma migracion (regla 16, B51). Inerte: no la escribe nadie
-- todavia -- no hay lector desplegado, no hay puerta, no hay tablet. Existir sin
-- que nadie escriba es exactamente lo que se pide en este lote.
--
-- LA PUERTA NO BLOQUEA EL PEDIDO, BLOQUEA LA AFIRMACION de que estaba completo.
-- Por eso `salio_igual` y `motivo_excepcion` no son un caso raro: son parte del
-- flujo normal. Un pedido incompleto SALE, y lo que queda escrito es que salio
-- incompleto y quien lo firmo. La operacion nunca se para (regla de B53).
--
-- `modo` distingue los tres estados del frente:
--   'sombra'    se verifica y se guarda, pero no se le enseña nada a nadie.
--               Es como nace L3 y como se queda hasta que Julio apruebe la cifra.
--   'puerta'    el «Listo» se habilita o no segun el resultado.
--   'degradado' las etiquetas no se imprimieron (impresora muda): lista manual
--               + foto. Se registra COMO degradado, no como verificacion normal,
--               porque no prueba lo mismo.
--
-- `unidades_esperadas` / `unidades_leidas` son numeros, no un booleano, porque
-- «6 de 7» y «0 de 7» son problemas distintos y un booleano los iguala.
--
-- `faltantes` guarda CUALES faltan, no cuantas: una pantalla que dice «falta 1»
-- no sirve para nada en el pase; «falta la 3 de 7, Patatas» si.

create table if not exists public.sale_verification (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null,
  location_id         uuid not null,
  sale_id             uuid not null,
  device_id           uuid,
  capture_id          uuid,
  modo                text not null default 'sombra',
  verificado_at       timestamptz not null default now(),
  unidades_esperadas  int,
  unidades_leidas     int,
  completo            boolean,
  faltantes           jsonb,
  leidas_por_qr       int,
  leidas_por_texto    int,
  lector_ms           int,
  salio_igual         boolean not null default false,
  motivo_excepcion    text,
  excepcion_por       uuid,
  excepcion_por_nombre text,
  created_at          timestamptz not null default now(),
  constraint sale_verification_modo_ck check (modo in ('sombra','puerta','degradado')),
  -- Si alguien firma la excepcion, tiene que decir por que. Una excepcion sin
  -- motivo es una excepcion que no se puede auditar.
  constraint sale_verification_excepcion_ck
    check (salio_igual is false or (motivo_excepcion is not null and length(btrim(motivo_excepcion)) > 0))
);

comment on table public.sale_verification is
  'C9 L3: resultado de verificar el embolsado de un pedido. Nace inerte: no la escribe nadie hasta que exista el lector. La puerta NO bloquea el pedido, bloquea la afirmacion de que estaba completo.';
comment on column public.sale_verification.modo is
  'sombra = se guarda y no se enseña (asi nace). puerta = decide si se habilita «Listo». degradado = sin etiquetas impresas, lista manual + foto; no prueba lo mismo y por eso se marca aparte.';
comment on column public.sale_verification.faltantes is
  'CUALES faltan, no cuantas: «falta 1» no sirve en el pase, «falta la 3 de 7, Patatas» si.';
comment on column public.sale_verification.salio_igual is
  'El pedido salio pese a estar incompleto. No es un caso raro: es el flujo normal cuando el operario firma la excepcion. Lo que queda escrito es que salio incompleto y quien lo firmo.';

create index if not exists ix_sale_verification_sale on public.sale_verification (sale_id);
create index if not exists ix_sale_verification_cuenta_fecha on public.sale_verification (account_id, verificado_at desc);
create index if not exists ix_sale_verification_incompletos on public.sale_verification (account_id, verificado_at desc)
  where completo is false;

alter table public.sale_verification enable row level security;
revoke all on public.sale_verification from anon, authenticated;

drop policy if exists sv_read on public.sale_verification;
create policy sv_read on public.sale_verification
  for select to authenticated
  using (public.belongs_to_account(account_id));

do $verif$
declare v_rol text; v_priv text;
begin
  foreach v_rol in array array['anon','authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_rol, 'public.sale_verification', v_priv) then
        raise exception 'C9 L3: % conserva % sobre sale_verification. La tabla NO nace cerrada.', v_rol, v_priv;
      end if;
    end loop;
  end loop;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='sale_verification' and c.relrowsecurity) then
    raise exception 'C9 L3: RLS no esta encendida en sale_verification.';
  end if;
  -- Inerte de verdad: ni un trigger, ni una funcion que la escriba todavia.
  if exists (select 1 from pg_trigger where tgrelid = 'public.sale_verification'::regclass and not tgisinternal) then
    raise exception 'C9 L3: sale_verification tiene triggers; deberia nacer inerte.';
  end if;
end
$verif$;
