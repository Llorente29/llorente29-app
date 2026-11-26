-- supabase/migrations/20261127T0015_k14c_tpv_por_cliente.sql
--
-- K14c · Los pagos con tarjeta (TPV) de noviembre de QBO Integrity, uno a uno y atados a su negociación del CRM
-- (Julio, 27/11). Los 12 abonos del TPV hasta el 24/11 (1.947,85 €) están en conta_banco_cobro como «tarjeta», sin
-- cliente: cada abono es la suma de los pagos de un día. Lo que dio Julio:
--   · la lista de operaciones del TPV (Excel y PDF de CaixaBank): 19 pagos de noviembre (2.141,45 €), con fecha, hora e
--     importe. Los 12 abonos son la suma de cada día; los dos de 96,80 € del 25/11 aún no tienen abono;
--   · las negociaciones «Pago prospecto» del CRM: importe, cuándo se creó, el cliente y la etapa.
-- Aquí NO va ningún nombre ni ningún número de tarjeta (T11): el número de la negociación, su etapa, la ficha (party) y
-- el código de cliente en Cegid, leído de la foto de conta_cegid_cliente (solo leyendo).
--
-- conta_banco_cobro_tarjeta, nueva: una fila por pago del TPV, con su abono (movement_id; null si aún no ha llegado):
--   · etapa         factura_final: ya está facturada en Cegid (no se manda) · enlace_pago: va a facturarse.
--   · casado        el pago es de esa negociación: el mismo día, con su importe, después de crearse la negociación, y no
--                   hay otra forma de repartir los pagos de ese día.
--   · por_confirmar la propuesta (otro día, o dos pagos iguales que no se sabe cuál es de cuál): la confirma Julio.
--   · sin_negociacion no se sabe de qué negociación es: para Julio.
-- Q lee lo que va a facturarse: estado = casado y etapa = enlace_pago. El cliente, party_id (puede no tener ficha) y
-- cegid_codigo (null: no existe en Cegid).
-- Medido el 27/11 (regla 31): 19 pagos; 12 casados, 5 por confirmar, 2 sin negociación.
--
-- No manda nada a Cegid (eso lo hace Q). No toca conta_banco_cobro: el abono sigue como «tarjeta», con su importe.
-- Solo añade (una tabla y sus filas). Nada en el camino del pedido.

create table if not exists public.conta_banco_cobro_tarjeta (
  company_id   uuid not null references public.company(id) on delete cascade,
  pagado_en    timestamptz not null,
  importe      numeric(14,2) not null check (importe > 0),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  movement_id  uuid references public.conta_banco_cobro(movement_id) on delete set null,
  crm_id       text,
  etapa        text check (etapa in ('factura_final', 'enlace_pago')),
  party_id     uuid references public.party(id) on delete set null,
  cegid_codigo int,
  estado       text not null check (estado in ('casado', 'por_confirmar', 'sin_negociacion')),
  porque       text not null,
  creado_en    timestamptz not null default now(),
  primary key (company_id, pagado_en, importe),
  unique (company_id, crm_id),
  check ((estado = 'sin_negociacion') = (crm_id is null)),
  check ((crm_id is null) = (etapa is null))
);
comment on table public.conta_banco_cobro_tarjeta is
  'K14c · Cada pago con tarjeta (TPV), con su abono del día (conta_banco_cobro, «tarjeta») y su negociación del CRM (crm_id, etapa). Q factura los casados en «enlace_pago» (estado = casado y etapa = enlace_pago): cliente party_id, código en Cegid cegid_codigo (null: no existe). Lo demás, para Julio, con su porqué.';
create index if not exists conta_banco_cobro_tarjeta_mov_idx on public.conta_banco_cobro_tarjeta (movement_id);
alter table public.conta_banco_cobro_tarjeta enable row level security;
drop policy if exists conta_banco_cobro_tarjeta_leer on public.conta_banco_cobro_tarjeta;
create policy conta_banco_cobro_tarjeta_leer on public.conta_banco_cobro_tarjeta for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_banco_cobro_tarjeta from anon;
grant select on public.conta_banco_cobro_tarjeta to authenticated;
grant all on public.conta_banco_cobro_tarjeta to service_role;

-- Las filas de QBO Integrity (solo si está: en staging no hay nada que atar).
do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; cta constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; v_n int;
begin
  if not exists (select 1 from public.company where id = emp) then
    raise notice 'K14c: esta base no tiene QBO Integrity: no hay pagos con tarjeta que atar.';
    return;
  end if;
  create temp table _k14c (movement_id uuid, pagado_en timestamptz, importe numeric, crm_id text, etapa text, party_id uuid, cegid_codigo int, estado text, porque text) on commit drop;
  insert into _k14c values
    ('672399be-3f94-4b56-a2d1-29a73799fc5b'::uuid, timestamptz '2026-11-03 15:14:23+01', 60.00, '25345', 'factura_final', null::uuid, null::int, 'por_confirmar', 'uno de los dos pagos de 60 € del 03/11; los dos de ese día son de las negociaciones 25345 (del 29/10) y 26781, pero cuál es de cuál no se sabe. Ya facturada: no se manda'),
    ('672399be-3f94-4b56-a2d1-29a73799fc5b'::uuid, timestamptz '2026-11-03 16:55:30+01', 60.00, '26781', 'factura_final', null::uuid, null::int, 'por_confirmar', 'uno de los dos pagos de 60 € del 03/11; los dos de ese día son de las negociaciones 25345 (del 29/10) y 26781, pero cuál es de cuál no se sabe. Ya facturada: no se manda'),
    ('f6ea18c5-2a7d-4c68-b413-cb67e3bb36b9'::uuid, timestamptz '2026-11-04 12:19:02+01', 18.15, '26783', 'factura_final', 'a2979e21-0fab-4f78-94c2-d52179d7550b'::uuid, 801::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('f6ea18c5-2a7d-4c68-b413-cb67e3bb36b9'::uuid, timestamptz '2026-11-04 13:45:34+01', 60.50, '26784', 'factura_final', '02d9017e-9902-48ab-af80-1c6928513597'::uuid, 827::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('f6ea18c5-2a7d-4c68-b413-cb67e3bb36b9'::uuid, timestamptz '2026-11-04 17:58:10+01', 48.40, '26785', 'factura_final', null::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su nombre no es el de ninguna ficha'),
    ('a99bbd3e-9d55-4ac1-ac43-7a546a512cc3'::uuid, timestamptz '2026-11-05 09:37:18+01', 1000.00, '25347', 'enlace_pago', 'f8938378-aad9-4ba8-8806-583ab50fb640'::uuid, null::int, 'por_confirmar', 'la única negociación de 1.000 €, pero creada el 30/10: otro día. No está en Cegid'),
    ('a99bbd3e-9d55-4ac1-ac43-7a546a512cc3'::uuid, timestamptz '2026-11-05 13:31:06+01', 60.00, '26789', 'factura_final', null::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su nombre no es el de ninguna ficha'),
    ('3ca2208d-4d25-471c-849c-8a7a170b7a23'::uuid, timestamptz '2026-11-06 14:09:52+01', 60.50, '26790', 'factura_final', 'a31db703-9467-4e93-8872-e5267cca7077'::uuid, 341::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('8a650bd5-2479-4082-86f2-fcf8e23f75e5'::uuid, timestamptz '2026-11-09 15:43:54+01', 60.00, '26792', 'enlace_pago', null::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su nombre no es el de ninguna ficha ni está en Cegid'),
    ('bd58a3f0-4dd4-4928-8aec-5575f49c5eec'::uuid, timestamptz '2026-11-11 13:40:28+01', 48.40, '26797', 'factura_final', '944a5e29-d52d-4685-b0a4-983d3091b9ee'::uuid, 1263::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('30dbef37-cc7c-40a8-94cb-a0a92b4db9cb'::uuid, timestamptz '2026-11-12 14:43:10+01', 60.50, '26799', 'factura_final', '944a5e29-d52d-4685-b0a4-983d3091b9ee'::uuid, 1263::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('bc06c32a-8144-4f33-9f9f-43d310a4b934'::uuid, timestamptz '2026-11-13 11:00:52+01', 48.40, '26800', 'factura_final', 'a31db703-9467-4e93-8872-e5267cca7077'::uuid, 341::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día'),
    ('93208169-ea6c-43af-80f4-889df78f8f82'::uuid, timestamptz '2026-11-16 21:12:04+01', 96.80, null, null, null::uuid, null::int, 'sin_negociacion', 'hay tres pagos de 96,80 € (16/11 y dos del 25/11) y una sola negociación de ese importe (26786, del 04/11): no se sabe de cuál es'),
    ('2e336cd8-25aa-488c-97ad-1baa5625a662'::uuid, timestamptz '2026-11-19 13:41:55+01', 48.40, '26805', 'enlace_pago', null::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; su nombre no es el de ninguna ficha ni está en Cegid'),
    ('2e336cd8-25aa-488c-97ad-1baa5625a662'::uuid, timestamptz '2026-11-19 16:55:17+01', 48.40, '26806', 'enlace_pago', '6d206f9f-25d3-4da3-84bc-db5dcd677d29'::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; no está en Cegid'),
    ('93aeba59-7930-4ccc-9216-107319ff7291'::uuid, timestamptz '2026-11-20 11:09:39+01', 121.00, '26804', 'enlace_pago', null::uuid, null::int, 'por_confirmar', 'la única negociación de 121 €, pero creada el 19/11: otro día. Su nombre no es el de ninguna ficha ni está en Cegid'),
    ('aac4df9c-ed61-4181-a8ff-def1655029fa'::uuid, timestamptz '2026-11-24 18:45:56+01', 48.40, '26809', 'enlace_pago', '75f926e5-6949-443e-8f35-51abbd9f86dd'::uuid, null::int, 'casado', 'el mismo día, con su importe, después de crearse la negociación, y no hay otra forma de repartir los pagos de ese día; no está en Cegid'),
    (null::uuid, timestamptz '2026-11-25 17:06:06+01', 96.80, null, null, null::uuid, null::int, 'sin_negociacion', 'hay tres pagos de 96,80 € (16/11 y dos del 25/11) y una sola negociación de ese importe (26786, del 04/11): no se sabe de cuál es. Sin abono en el banco todavía'),
    (null::uuid, timestamptz '2026-11-25 18:35:08+01', 96.80, null, null, null::uuid, null::int, 'sin_negociacion', 'hay tres pagos de 96,80 € (16/11 y dos del 25/11) y una sola negociación de ese importe (26786, del 04/11): no se sabe de cuál es. Sin abono en el banco todavía')
;
  -- Como se midió: los 12 abonos son de QBO, del TPV, y cada uno es la suma de sus pagos; las fichas son de la cuenta
  -- y los códigos de Cegid, de la foto de la empresa.
  if (select count(distinct movement_id) from _k14c) <> 12
     or exists (select 1 from _k14c x left join public.conta_banco_cobro c on c.movement_id = x.movement_id and c.company_id = emp and c.estado = 'tarjeta'
                 where x.movement_id is not null and c.movement_id is null)
     or exists (select 1 from (select movement_id, sum(importe) s from _k14c where movement_id is not null group by 1) z
                  join public.conta_banco_cobro c on c.movement_id = z.movement_id where c.importe <> z.s)
     or exists (select 1 from _k14c x where x.party_id is not null and not exists (select 1 from public.party p where p.id = x.party_id and p.account_id = cta))
     or exists (select 1 from _k14c x where x.cegid_codigo is not null and not exists (select 1 from public.conta_cegid_cliente g where g.company_id = emp and g.codigo = x.cegid_codigo)) then
    raise exception 'K14c · 0: los abonos del TPV de QBO no están como se midieron el 27/11 (12, «tarjeta», cada uno con la suma de sus pagos), o una ficha o un código de Cegid no es de QBO.';
  end if;
  insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, movement_id, crm_id, etapa, party_id, cegid_codigo, estado, porque)
  select emp, pagado_en, importe, cta, movement_id, crm_id, etapa, party_id, cegid_codigo, estado, porque from _k14c
  on conflict (company_id, pagado_en, importe) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'K14c: % pagos con tarjeta (% casados; % para facturar).', v_n,
    (select count(*) from _k14c where estado = 'casado'), (select count(*) from _k14c where estado = 'casado' and etapa = 'enlace_pago');
end $$;
