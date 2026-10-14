# D01 · El correo de facturas: los pasos en Resend (para Julio)

Hasta que esto esté hecho, **el correo está apagado en producción**: no llega
nada a `entrada.folvy.app`, y aunque llegara, cada dirección nace con
`company_inbound_address.active = false`. La subida a mano funciona sin esto.

Todo lo de abajo lo hace una persona con acceso a Resend, a la zona DNS de
`folvy.app` y a los secretos de Supabase. Claude Code no lo puede hacer desde
la sesión.

## 1 · El dominio de entrada

1. Resend › **Domains** › *Add domain* › `entrada.folvy.app` (un subdominio
   propio: así las nóminas, que van por `*.resend.app`, no se tocan, y el
   correo normal de `folvy.app` tampoco).
2. Activar **Receiving** (recibir correo) en ese dominio.
3. Resend enseña los registros. En el DNS de `folvy.app`:
   - el **MX** de `entrada` que da Resend, con la prioridad que da Resend
     (se copia de la pantalla, no de aquí: lo fija Resend);
   - los registros de verificación que pida (TXT/SPF/DKIM) si los pide para
     recibir.
4. Esperar a que Resend lo ponga **Verified**.

## 2 · El webhook

1. Resend › **Webhooks** › *Add endpoint*.
2. URL: `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-facturas-entrada`
3. Evento: solo **`email.received`**.
4. Copiar el **signing secret** (empieza por `whsec_`).

## 3 · Los secretos en Supabase (producción)

Supabase › Edge Functions › Secrets:

| Secreto | Valor |
|---|---|
| `RESEND_FACTURAS_WEBHOOK_SECRET` | el `whsec_…` del paso 2 (es **otro** que el de nóminas, `RESEND_WEBHOOK_SECRET`, que no se toca) |
| `RESEND_API_KEY` | ya existe (lo usan las nóminas); hace falta que pueda leer los correos recibidos y sus adjuntos |

La función `conta-facturas-entrada` sale a producción con la fusión de esta
rama a `main` (como todas las edge functions). Sin el secreto contesta 500
«falta configurar el secreto del webhook» y no hace nada.

## 4 · Encender una empresa

Cada empresa tiene su dirección `facturas-<empresa>@entrada.folvy.app`
(`conta_direccion_facturas`; `<empresa>` sale del nombre comercial, nunca del
NIF). Se enciende una a una: `company_inbound_address.active = true`. Eso lo
dejo como tanda de producción cuando el dominio esté verificado, para una
empresa primero.

## 5 · Cómo se comprueba que funciona (no con el color del run)

1. Mandar un correo a la dirección encendida con un PDF de factura.
2. `inbound_email_log`: una fila con ese correo y `resultado = 'recibido'`.
3. `document_inbox`: la llegada, con su fichero en `receipt-uploads` y estado
   `factura` (o el que diga por qué no).
4. Mandar **el mismo correo otra vez**: no aparece otra llegada (se reconoce
   por el `email_id` y por la huella del fichero).
5. Mandar uno a `facturas-nadie@entrada.folvy.app`: queda apuntado como
   `sin_destino` y no se lee nada.

## Después: la marca del frente C

El mismo esquema irá en el dominio de la marca cuando C lo tenga: otro dominio
de entrada en Resend y otro valor en `company_inbound_address.domain`. La
función no cambia.
