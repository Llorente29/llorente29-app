-- K14e · vuelta atrás de 20261127T0119: las 5 fichas sin código de Cegid (como estaban: 4 con su fila vacía y 1 sin
-- fila; la fila que se le creó se queda, vacía, que se lee igual que no tenerla), lo apuntado en conta_cegid_atado por
-- la K14e fuera, y los 5 pagos sin cegid_codigo.
do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
begin
  update public.conta_cobro_cliente set codigo_cliente = null, updated_at = now(), updated_by_name = 'K14e · vuelta atrás'
   where company_id = emp and codigo_cliente between 1266 and 1270
     and party_id in (select party_id from public.conta_cegid_atado where company_id = emp and quien = 'K14e · alta en Cegid del 27/11');
  delete from public.conta_cegid_atado where company_id = emp and quien = 'K14e · alta en Cegid del 27/11';
  update public.conta_banco_cobro_tarjeta set cegid_codigo = null
   where company_id = emp and crm_id in ('25347', '26805', '26806', '26809', '26804') and cegid_codigo between 1266 and 1270;
end $$;
