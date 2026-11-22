-- K11a · vuelta atrás de 20261122T0840: _journal_entry_proponer desde su respaldo (sin «canal_id»). Va antes que la de
-- la 0839, que quita journal_line.channel_id (la columna que escribe esta).
select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261122T0840_k11a_plataforma_en_el_asiento');
