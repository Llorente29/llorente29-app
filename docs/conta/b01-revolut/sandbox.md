# B01 Revolut · La cuenta de pruebas del sandbox, paso a paso

> Para la e2e completa contra el sandbox de Revolut Business (encargo B01,
> respuesta 2: «pídeme la cuenta de pruebas paso a paso»). Nada secreto aquí:
> lo que hay que pegar lo pega Julio en Vercel, en la pantalla de Sumied o en
> los secretos de staging, nunca en el chat ni en el repositorio (T11).

| Paso | Quién | Qué | Hecho |
|---|---|---|---|
| 1 | Julio | Cuenta de empresa de pruebas en `sandbox-business.revolut.com`, con datos inventados. | 01/11 |
| 2 | Julio | Vercel › folvy-app › Environment Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` de staging-conta, **solo Preview** y **solo la rama** `claude/revolut-business-sumied-9fhlsh`. Sin ellas, la vista previa de una rama `claude/…` se construye contra **producción** (`guardaVistaPrevia.ts` solo cubre `conta/**` y `reparto-**`). | 01/11 |
| 2b | Sesión | Comprobar en el registro del despliegue que la vista previa va contra staging-conta. | 01/11 |
| 3 | Julio | En los secretos de las funciones de staging: `REVOLUT_DOMINIOS` = el dominio de la vista previa de la rama (para que la dirección de vuelta sea la suya). | 01/11 |
| 4 | Julio | En la vista previa, Bancos › Cuentas y extractos › Conectar Revolut: copiar el certificado, pegarlo en el sandbox › Settings › APIs con la dirección de vuelta, pegar el Client ID en Sumied y autorizar. | 01/11 |
| 5 | Sesión | Con esa conexión: leer movimientos (recargar saldo en el sandbox), y confirmar lo que solo está en las guías (token, renovación, firma del aviso, `balance`). Al parte. | en curso |

Recordatorio para producción: `REVOLUT_ENTORNO = produccion` en los secretos
de las funciones de producción antes de que Foodint conecte su Revolut de
verdad. Sin ella, las funciones hablan con el sandbox.

## Lo que se ha medido en staging (01/11, solo leyendo)

Empresa A de staging, conectada a las 11:04:53 UTC desde la vista previa de la
rama. Pantalla, al final: «Traídos 2 movimientos de Revolut». La cuenta en
euros del sandbox (···4781) quedó ligada a la 57200002 de la empresa A de
staging (en Foodint será la 57200004).

| Qué | Cómo se ha visto | Resultado |
|---|---|---|
| Página de autorizar (`/app-confirm`) y token con la firma del cliente (`POST /auth/token`) | `revolut_conexion.estado = conectada`, `conectada_at` 11:04:53; el Vault tiene `renovacion` escrito a la misma hora | **Confirmado**: lo de las guías funciona tal cual |
| Permisos separados por comas | `permisos = READ,WRITE` | **Confirmado** |
| Renovación del token | La lectura de las 11:06:05 no usa el código de la vuelta: pide el token con `refresh_token`, y sale bien (`last_ok_at` 11:06:05, `last_error` vacío) | **Confirmado**. Revolut no cambió el token de renovación al renovar (`renovacion` sigue con la hora 11:04:53) |
| El aviso (`POST /api/2.0/webhooks`) con `WRITE` | `webhook_id` puesto y secreto `aviso` en el Vault, 11:04:53 | **Registrado**. Que llegue, pendiente: los dos movimientos ya estaban antes de registrarlo |
| Movimientos | 2 nuevos, 0 repetidos, del 01/08 al 01/11; una recarga (+3.490,00) y una transferencia (−210,00), cada uno con `reference_2` = id de la transacción:id de la pata | **Confirmado** |
| `balance` de la pata | Extracto `agregador:revolut`: saldo inicial 0, final 3.280,00, `balanced = true`; `bank_balance` del enlace, 3.280,00. 0 + 3.490 − 210 = 3.280 | **Cuadra** |
| Cuánto dura el token de acceso | El código no lo apunta en ningún sitio (pide uno nuevo en cada lectura, así que no depende de ello) | Sin medir; las guías dicen 40 minutos |
| Cuánto dura el token de renovación | Se verá si las lecturas de cada hora siguen saliendo bien con los días | Sin medir |

Peticiones a `conta-revolut-conectar` entre las 10:45 y las 11:06: todas 200.

## Apuntado para otro encargo (T1)

- **`REVOLUT_DOMINIOS` en staging estaba mal** y la pantalla decía «Abre
  Sumied desde su dirección de siempre». Julio lo corrigió con el dominio de
  la vista previa. Para el siguiente: que el aviso diga qué dominio ha llegado
  y cuáles admite, sin tener que adivinarlo.
- **Staging no envía los correos de recuperación de contraseña**: el servidor
  de correo rechaza la clave (`535 Authentication credentials invalid`). No es
  del B01.
