-- K14f · vuelta atrás de 20261127T0823_k14f_codigos_cegid: las 6 fichas sin código de Cegid (si se les creó la fila, se queda vacía, que se
-- lee igual que no tenerla) y lo apuntado por la K14f en conta_cegid_atado, fuera.
do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
begin
  update public.conta_cobro_cliente set codigo_cliente = null, updated_at = now(), updated_by_name = 'K14f · vuelta atrás'
   where company_id = emp and codigo_cliente in (725, 1006, 1259, 818, 1271, 1272)
     and party_id in (select party_id from public.conta_cegid_atado where company_id = emp and quien = 'K14f · códigos de Cegid del 27/11');
  delete from public.conta_cegid_atado where company_id = emp and quien = 'K14f · códigos de Cegid del 27/11';
end $$;
