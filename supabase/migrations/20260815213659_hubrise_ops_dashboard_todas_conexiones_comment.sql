comment on function public.hubrise_ops_dashboard() is
$cmt$Tablero de vigilancia HubRise (Fase 3, A.1) -- SUPERADMIN-ONLY (platform admin,
gateado por current_user_is_admin(), RAISE EXCEPTION si no lo es). Cruza TODAS las
cuentas -- distinto de hubrise_location_status (SECURITY INVOKER, admin de UNA
cuenta, pantalla de ajustes del cliente). Devuelve jsonb: locations[] (una fila
POR CONEXIÓN hubrise de cada cuenta x local -- la conexión estándar "Folvy"
siempre, más cualquier otra conexión que esté ACTIVA ahora mismo, etiquetada
como no estándar; corregido 15/08 tras certificación de Julio: filtrar solo por
connection_name='Folvy' escondía conexiones vivas reales, ej. "Folvy Test" en
el laboratorio), writers[] (una fila por escritora de cuenta), y alerts_48h
(contador global de system_alert_queue, sin atribuir a fila -- esa tabla no
tiene account_id/location_id estructurado; parsear el mensaje de texto sería
fabricar fragilidad, decisión de Julio 15/08). Deuda declarada: el día que se
toque system-alert por otro motivo, añadirle account_id/location_id
estructurados y entonces el tablero podrá atribuir alertas por fila.$cmt$;