comment on function public.hubrise_ops_dashboard() is
$cmt$Tablero de vigilancia HubRise (Fase 3, A.1) -- SUPERADMIN-ONLY (platform admin,
gateado por current_user_is_admin(), RAISE EXCEPTION si no lo es). Cruza TODAS las
cuentas -- distinto de hubrise_location_status (SECURITY INVOKER, admin de UNA
cuenta, pantalla de ajustes del cliente). Devuelve jsonb: locations[] (una fila
por cuenta x local con rastro de HubRise -- conexion viva, desconectada, o
intento en curso <15 min), writers[] (una fila por escritora de cuenta), y
alerts_48h (contador global de system_alert_queue, sin atribuir a fila -- esa
tabla no tiene account_id/location_id estructurado; parsear el mensaje de texto
seria fabricar fragilidad, decision de Julio 15/08). Deuda declarada: el dia que
se toque system-alert por otro motivo, anadirle account_id/location_id
estructurados y entonces el tablero podra atribuir alertas por fila.$cmt$;