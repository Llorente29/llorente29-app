-- supabase/migrations/20261126T2200_q10h_cuota_revisada.sql
--
-- Q10 · respuesta 6 (26/11) · LA GUARDA DE LAS CUOTAS FIJAS DE CEGID Y LO CORREGIDO DE CADA INCIDENCIA.
--   · conta_cegid_cuota_revisada: los clientes de Cegid con cuotas fijas en su ficha a los que Julio ya ha puesto
--     «Facturar hasta» (la API no lo devuelve: GetCustomer no trae ninguna fecha de fin, run 45901138694). A un
--     cliente con cuotas fijas que no está aquí, conta-cegid-mandar no le manda nada y dice «Cliente nuevo con cuota
--     fija en Cegid: ponle el Facturar hasta».
--     Se llena con los 190 clientes de QBO que tenían cuotas fijas en lo leído de Cegid el 25/11 a las 21:23Z, que Julio
--     revisó el 26/11/2026; por su código, como la 0652. Sin la empresa de QBO (staging), no mete nada.
--   · conta_cegid_incidencia.corregida_at y corregida_por: cuándo y quién corrigió por PUT una incidencia ya mandada
--     (descripción, tipo de IVA y total igual a la base; conta-cegid-corregir).
-- SOLO AÑADE (una tabla, dos columnas que admiten nulos y las filas de la tabla nueva). La escriben solo las funciones
-- (con la clave de servicio); la pantalla las lee con RLS. Vuelta atrás:
-- supabase/vuelta-atras/20261126T2200_q10h_cuota_revisada.down.sql.

create table if not exists public.conta_cegid_cuota_revisada (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- El código de cliente en Cegid.
  cliente int not null,
  revisada_el date not null,
  primary key (company_id, cliente)
);
comment on table public.conta_cegid_cuota_revisada is
  'Q10 · Los clientes de Cegid con cuotas fijas a los que ya se ha puesto «Facturar hasta». A uno con cuotas fijas que no está aquí no se le manda nada.';
alter table public.conta_cegid_cuota_revisada enable row level security;
drop policy if exists conta_cegid_cuota_revisada_leer on public.conta_cegid_cuota_revisada;
create policy conta_cegid_cuota_revisada_leer on public.conta_cegid_cuota_revisada for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_cuota_revisada from anon;
grant select on public.conta_cegid_cuota_revisada to authenticated;
grant all on public.conta_cegid_cuota_revisada to service_role;

alter table public.conta_cegid_incidencia add column if not exists corregida_at timestamptz;
alter table public.conta_cegid_incidencia add column if not exists corregida_por text;
comment on column public.conta_cegid_incidencia.corregida_at is
  'Q10 · Cuándo se corrigió por PUT la incidencia ya mandada (descripción, tipo de IVA y total igual a la base).';

do $revisadas$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; v_acc constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655';
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'Q10 · 2200: sin la empresa de QBO, no hay cuotas revisadas que meter.';
    return;
  end if;
  insert into public.conta_cegid_cuota_revisada (company_id, account_id, cliente, revisada_el)
  select v_e, v_acc, c, date '2026-11-26' from unnest(array[
    9, 21, 24, 33, 36, 40, 44, 47, 49, 52, 53, 64, 85, 97, 110, 116, 118, 122, 141, 144,
    146, 158, 163, 166, 167, 188, 193, 196, 198, 220, 229, 238, 241, 259, 263, 270, 271, 272, 292, 300,
    335, 337, 343, 356, 357, 359, 363, 364, 368, 370, 378, 381, 393, 394, 401, 406, 411, 412, 418, 426,
    429, 434, 437, 441, 445, 447, 450, 453, 461, 464, 468, 470, 473, 475, 477, 495, 496, 502, 503, 508,
    515, 520, 521, 532, 535, 536, 564, 567, 607, 609, 619, 630, 635, 650, 662, 676, 682, 685, 693, 694,
    695, 697, 698, 699, 701, 702, 703, 709, 712, 716, 719, 720, 723, 724, 725, 727, 729, 733, 734, 737,
    739, 740, 742, 743, 749, 751, 753, 757, 758, 761, 764, 765, 767, 770, 771, 773, 780, 781, 783, 787,
    788, 793, 798, 799, 800, 801, 802, 808, 809, 820, 821, 826, 827, 828, 841, 842, 854, 856, 857, 858,
    879, 885, 894, 895, 896, 897, 917, 924, 960, 968, 976, 982, 984, 989, 993, 994, 996, 1000, 1001, 1002,
    1003, 1009, 1010, 1012, 1013, 1014, 1099, 1254, 1255, 1258
  ]::int[]) c
  on conflict (company_id, cliente) do nothing;
end $revisadas$;
