# Folvy Shop — Registro de deuda (act. 02/07/2026)

Estado del Shop: EN PRODUCCIÓN. Checkout con confirmación veraz + Bizum + página
de seguimiento del cliente, todo verificado en vivo. Este documento lista lo que
queda abierto, con su disparador. Una línea = una deuda con condición de cierre.

## Pago / checkout
- **Certificar el caso PAID real** (dinero llega a Llorente29 + 5% application_fee).
  Aún no probado de punta a punta con dinero real. Bloqueo: un pedido pagado entra
  en cocina. Disparador/solución: construir el "modo prueba del Shop" (abajo) o
  probar con cocina fuera de servicio.
- **Modo prueba del Shop**: pedido marcado como prueba que recorre pago→webhook→
  estado→seguimiento pero NUNCA llega a cocina (ni tablet, ni impresión, ni Catcher).
  Desbloquea certificar pagos siempre. NO construido.
- **Nombre público Stripe**: hoy figura "Fplvy S.L." (cosmético). Cambiar a "Folvy".
  Lo ve el cliente al pagar. Disparador: antes de abrir el Shop a más clientes.
- **Retorno de Bizum con redirección real**: la confirmación veraz se apoya en que
  CheckoutRoute siga montado. Con Bizum de test funcionó (resolvió en la misma
  página). Si en producción Bizum hace redirección de página completa, al volver el
  checkout no se remonta. Solución limpia: apuntar el return_url a /seguir?t=<token>
  (la página de seguimiento ya existe y lo resuelve). NO tocar el flujo certificado
  hasta hacerlo a propósito. Disparador: primer pago real con Bizum que redirija.

## Seguimiento del pedido
- **Señal fina "En preparación / Listo para recoger"**: el stepper es conservador
  (correcto pero no marca pasos sin dato real). El intermedio "Listo para recoger"
  (pickup) no tiene señal fiable hasta enganchar el estado del KDS al estado del
  Shop. Disparador: wiring KDS→shop status.
- **"Ver al repartidor" (mapa/link en vivo)**: la moto en vivo NO se dibuja propia.
  Se surfaceará como botón al tracking de Catcher, cuando Catcher confirme si da
  (a) link de tracking del cliente, (b) coordenadas del rider, o (c) SMS propio.
  Añadir esas 2 preguntas al email abierto con it@catcher.delivery. Hueco preparado,
  sin código muerto. Disparador: respuesta de Catcher.
- **Rider / ETA no fluyen aún**: los campos están cableados en la página y se
  rellenan solos cuando entre el webhook de Catcher. Bloqueo: Catcher no tiene
  registrada la URL del webhook (external_webhook_log = 0 filas de Catcher).
  Disparador: que Catcher registre https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-webhook.
- **Seguimiento para reparto propio de CUALQUIER canal** (p.ej. Glovo que reparte
  Folvy): la página es agnóstica al canal, pero solo los pedidos del Shop tienen
  public_token (lo genera place_shop_order). Falta: mintear public_token a ventas
  own_delivery no-Shop (migración pequeña) + verificar que Last pasa la dirección
  del cliente en esos pedidos. Disparador: querer dar seguimiento a esos pedidos.

## Aviso al cliente (mensajería)
- **Email de seguimiento**: hoy el cliente solo llega a la página si pulsa "Seguir
  mi pedido" o guarda el enlace; Folvy no envía nada proactivo. Falta: (1) añadir
  campo email al checkout (hoy solo guarda nombre/teléfono/nota), (2) función que al
  confirmarse el pedido mande el correo con el enlace /seguir?t=<token>. Tubería lista
  (Resend verificado). Disparador: querer que el enlace llegue solo.
- **WhatsApp de aviso**: lo más usado en hostelería. Falta proveedor de la API de
  WhatsApp (plantillas Meta pre-aprobadas) + consentimiento del cliente. Mensaje =
  texto corto + botón "Seguir mi pedido" que abre la página. SOLO para clientes de
  la tienda propia (no de plataformas: dato de plataforma sin consentimiento = ilegal
  RGPD). Disparador: tras el email, cuando se elija proveedor.

## Datos / infra que afectan al Shop
- **Bug de zona de reparto**: Calle de Menorca 4, 28009 cae dentro del polígono de
  Zona 20 pero shop_check_delivery la rechazó (desajuste polígono-por-carretera vs
  ST_DWithin por radio). Disparador: revisar la lógica de cobertura.
- **Rotaciones de credenciales**: secrets de TEST de Stripe (ya no usados),
  fv_catdisp_ (secreto interno del trigger de Catcher), credenciales sandbox de
  Catcher, service_role/webhook tokens. Disparador: paso definitivo a producción.

## Dominio de la tienda
- **Wildcard automático + dominios propios del cliente (Capa 2)**: hoy cada tienda
  nueva se da de alta a mano en Vercel (Add Existing <slug>.folvy.app); OVH resuelve
  por el CNAME wildcard *. El wildcard automático (cero alta por cliente) y el dominio
  100% propio del cliente (pedidos.sumarca.com, con verificación TXT + SSL) requieren
  migrar el DNS a un proveedor con wildcard sin fricción. Se aborda JUNTO con la
  migración de correo (OVH → mejor proveedor), como frente único. Disparador: escalar
  clientes o migrar el correo.
- **Aviso "DNS Change Recommended" de Vercel en foodint**: cosmético. Funciona por el
  CNAME wildcard. Opcional: CNAME específico foodint → 9339610a59be5a0b.vercel-dns-016.com.
  No urgente.
- **Migración de correo OVH MXPLAN → mejor proveedor**: 2 buzones (hello@ sin correos,
  y otro CON correos que no se pueden perder). Frente propio con estudio de coste +
  plan de migración sin pérdida. Se junta con la migración de DNS/wildcard.
- **www.folvy.app NXDOMAIN**: sigue pendiente, aparte.

## Migración a canal propio (frente estratégico, no del Shop en sí)
- **Owned-channel migration**: NO se puede contactar por WhatsApp a clientes de
  Glovo/Uber (dato de plataforma = sin consentimiento = ilegal RGPD, multas hasta
  20M€; nº puente + baneo de Meta por opt-in). Camino legal = QR/pegatina física en
  la entrega que invita a registrarse → el cliente da el consentimiento → entonces sí
  WhatsApp/tienda/loyalty. Frente grande con diseño legal propio (3 patas: BI agregado
  legal + captación de consentimiento + CRM/loyalty). Disparador: sesión dedicada.

## Transversal (no exclusivo del Shop)
- **database.ts roto al regenerar**: las vistas PostGIS (geometry_columns/
  geography_columns) se cuelan como tablas y tumban los tipos de todos los servicios
  .from() de supply. Se revierte con git checkout. El Shop no lo necesita (va por RPC
  con any). Fix: filtrar/post-procesar esas vistas antes de regenerar. Disparador:
  cuando se necesite regenerar tipos.
