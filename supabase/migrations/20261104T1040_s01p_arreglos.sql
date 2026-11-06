-- supabase/migrations/20261104T1040_s01p_arreglos.sql
--
-- S01p · 1 · Los arreglos de antes de construir «Cerrar el mes» (Julio, 04/11,
-- respuesta S01p·1). Cada uno daba un falso verde o un fallo medido en
-- producción el 04/11 (solo lectura) sobre octubre de Foodint:
--
-- 1. «Lo que falta» del mes que se cierra, el día que sea. conta_esperadas_no_llegadas
--    no devuelve nada antes del día 15 (es el aviso de Compras: hasta el 15
--    todavía se espera la del mes anterior). Para cerrar un mes hay que ver lo
--    que le falta YA: el 04/11 decía 0 y faltaban 7 (5 alquileres, Cloudtown e
--    Iberdrola). Nueva: conta_esperadas_del_mes(empresa, mes), sin el día 15.
--    El aviso sigue igual, y ahora la usa (una sola regla de qué falta).
--
-- 2. Una esperada quincenal no rompe «al día». conta_puerta_fuentes_proponer
--    proponía el día 0 para lo quincenal (el 15 y fin de mes), y la columna
--    typical_day solo admite 1–31: conta_puerta_al_dia fallaba entera con la
--    esperada de Glovo de Foodint (cadencia «varias» que pasa a «quincenal»).
--    Lo quincenal ya dice cuándo llega; el día va vacío, como el de «varias».
--
-- 3. La factura recibida sabe su asiento. supplier_invoice.journal_entry_id lo
--    rellenaba solo _conta_factura_guarda, y solo con los migrados de Diez: de
--    las 299 de Foodint lo tienen 130 (todos asientos migrados, del 30/06 al
--    30/09) y a 147 que tienen su asiento propio (por source_id) les falta. Lo
--    leen el 303 y las retenciones («recibidas por correo sin apuntar») y
--    Documentos: las 21 de correo con asiento contaban como sin apuntar.
--    Desde ahora un disparador lo pone al crear, cambiar de estado, cambiar de
--    origen o borrar un asiento de factura (_s01p_asiento_de_factura: el
--    migrado que ya tenía, si sigue vivo; si no, el suyo vivo; si no, ninguno).
--    Las de antes, en la 1041.
--
-- Lo demás de la lista del paso 0 no toca la base:
--   · Ventas de las marcas propias: la regla ya existe (conta_pedidos_del_dia
--     devuelve «propia», la del cierre del día). El bloque de Ventas la usará.
--   · Revolut sin saldo: bank_mes_cerrar ya exige el saldo de fin de mes (o
--     cerrar a sabiendas). El bloque de Bancos dirá «sin medir».
--   · El préstamo desde octubre: datos de Foodint, en la 1042.
--
-- Nada en el camino del pedido. No toca filas.
--
-- cambia: public.conta_puerta_fuentes_proponer · prueba: supabase/staging/sql/20261104_s01p_arreglos_prueba.sql
-- cambia: public.conta_esperadas_no_llegadas · prueba: supabase/staging/sql/20261104_s01p_arreglos_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261104_s01p_arreglos_prueba.sql
--   (un disparador nuevo, s01p_factura_su_asiento, AFTER: no toca la fila del asiento, solo el campo de su factura)

-- ── 1 · Lo que le falta a un mes, el día que sea ────────────────────────────
create or replace function public.conta_esperadas_del_mes(p_company uuid, p_mes date)
returns table(expected_id uuid, supplier_id uuid, supplier_name text, label text, periodo date, ultima date, pedida text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_mes date := date_trunc('month', p_mes)::date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return query
  select x.id, x.supplier_id, s.name, coalesce(x.label, s.name), v_mes,
         greatest((select max(i.invoice_date) from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'),
                  (select max(e.entry_date) from public.journal_entry e
                     join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                     join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                        and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                    where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado')),
         (select r.status from public.supplier_invoice_request r where r.supplier_id = x.supplier_id and r.period = v_mes order by r.created_at desc limit 1)
    from public.supplier_expected_invoice x
    join public.supplier s on s.id = x.supplier_id and s.account_id = v_acc
   where x.company_id = p_company and x.account_id = v_acc and x.active
     and not exists (select 1 from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'
                        and i.invoice_date >= v_mes and i.invoice_date < (v_mes + interval '1 month')::date)
     and not exists (select 1 from public.journal_entry e
                       join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                       join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                          and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                      where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
                        and e.entry_date >= v_mes and e.entry_date < (v_mes + interval '1 month')::date)
   order by s.name;
end $$;
comment on function public.conta_esperadas_del_mes(uuid, date) is
  'S01p · Lo que se esperaba en el mes y no ha llegado (ni factura ni asiento validado del proveedor), el día que sea. La usan el aviso de Compras (desde el 15 del mes siguiente) y Cerrar el mes.';
revoke all on function public.conta_esperadas_del_mes(uuid, date) from public, anon;
grant execute on function public.conta_esperadas_del_mes(uuid, date) to authenticated, service_role;

-- El aviso de Compras: lo mismo que antes (desde el día 15, el mes anterior), con la regla de arriba.
do $$ begin
  if strpos(pg_get_functiondef('public.conta_esperadas_no_llegadas(uuid,date)'::regprocedure), 'conta_esperadas_del_mes') = 0 then
    perform public._respaldar_funcion('public.conta_esperadas_no_llegadas(uuid,date)', '20261104T1040_s01p_arreglos');
  end if;
end $$;
create or replace function public.conta_esperadas_no_llegadas(p_company uuid, p_hoy date default ((now() at time zone 'Europe/Madrid'))::date)
returns table(expected_id uuid, supplier_id uuid, supplier_name text, label text, periodo date, ultima date, pedida text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Antes del día 15 todavía se espera la del mes anterior; desde el 15, falta.
  -- (Cerrar el mes no espera al 15: usa conta_esperadas_del_mes directamente.)
  if extract(day from p_hoy) < 15 then return; end if;
  return query select * from public.conta_esperadas_del_mes(p_company, (date_trunc('month', p_hoy) - interval '1 month')::date);
end $$;

-- ── 2 · Lo quincenal, sin día ───────────────────────────────────────────────
do $$
declare
  f constant text := 'public.conta_puerta_fuentes_proponer(uuid)';
  a constant text := 'when ''quincenal'' then 0 end,';
  b constant text := 'end,  -- quincenal: el 15 y fin de mes, sin día (S01p)';
  v_def text; v_n int;
begin
  v_def := pg_get_functiondef(f::regprocedure);
  if strpos(v_def, b) > 0 then raise notice 'S01p·1: % ya propone lo quincenal sin día.', f; return; end if;
  v_n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if v_n <> 1 then
    raise exception 'S01p·1: en % «%» sale % veces y tenía que salir una: no se toca.', f, a, v_n;
  end if;
  perform public._respaldar_funcion(f, '20261104T1040_s01p_arreglos');
  execute replace(v_def, a, b);
end $$;

-- ── 3 · La factura recibida sabe su asiento ─────────────────────────────────
-- Qué asiento contabiliza la factura, en este orden:
--   1. el que ya tenía apuntado si es de OTRO origen y sigue vivo: los 130 de
--      Foodint apuntan a asientos migrados de Diez (validados, sin source_id),
--      que _conta_factura_guarda enlaza para no volver a apuntarla. Ese enlace
--      no sale de ningún otro sitio: si se pisara, se perdería;
--   2. si no, el suyo, vivo (source_id = la factura, no anulado; el más reciente);
--   3. si no, ninguno.
create or replace function public._s01p_asiento_de_factura(p_factura uuid, p_cuenta uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.id from public.supplier_invoice f
       join public.journal_entry e on e.id = f.journal_entry_id and e.account_id = f.account_id
      where f.id = p_factura and f.account_id = p_cuenta and e.status <> 'anulado'
        and not (e.source_type = 'supplier_invoice' and e.source_id = p_factura)),
    (select e.id from public.journal_entry e
      where e.source_type = 'supplier_invoice' and e.source_id = p_factura and e.account_id = p_cuenta
        and e.status <> 'anulado'
      order by e.created_at desc, e.id desc limit 1))
$$;
comment on function public._s01p_asiento_de_factura(uuid, uuid) is
  'S01p · El asiento que contabiliza una factura recibida: el de otro origen que ya tenía y sigue vivo (un migrado de Diez); si no, el suyo vivo (por source_id); si no, ninguno.';
revoke all on function public._s01p_asiento_de_factura(uuid, uuid) from public, anon, authenticated;

create or replace function public._s01p_factura_su_asiento(p_factura uuid, p_cuenta uuid)
returns void language sql security definer set search_path = public as $$
  update public.supplier_invoice f
     set journal_entry_id = public._s01p_asiento_de_factura(f.id, f.account_id)
   where f.id = p_factura and f.account_id = p_cuenta
     and f.journal_entry_id is distinct from public._s01p_asiento_de_factura(f.id, f.account_id)
$$;
comment on function public._s01p_factura_su_asiento(uuid, uuid) is
  'S01p · Deja en supplier_invoice.journal_entry_id el asiento que la contabiliza (_s01p_asiento_de_factura).';
revoke all on function public._s01p_factura_su_asiento(uuid, uuid) from public, anon, authenticated;

create or replace function public._tg_s01p_factura_su_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' and new.source_type = 'supplier_invoice' and new.source_id is not null then
    perform public._s01p_factura_su_asiento(new.source_id, new.account_id);
  end if;
  if tg_op <> 'INSERT' and old.source_type = 'supplier_invoice' and old.source_id is not null
     and (tg_op = 'DELETE' or old.source_id is distinct from new.source_id or old.source_type is distinct from new.source_type) then
    perform public._s01p_factura_su_asiento(old.source_id, old.account_id);
  end if;
  return null;
end $$;
revoke all on function public._tg_s01p_factura_su_asiento() from public, anon, authenticated;

drop trigger if exists s01p_factura_su_asiento on public.journal_entry;
create trigger s01p_factura_su_asiento
  after insert or delete or update of status, source_id, source_type on public.journal_entry
  for each row execute function public._tg_s01p_factura_su_asiento();
