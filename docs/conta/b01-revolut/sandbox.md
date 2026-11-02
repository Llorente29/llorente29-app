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
| 5 | Sesión | Con esa conexión: leer movimientos (recargar saldo en el sandbox), y confirmar lo que solo está en las guías (token, renovación, firma del aviso, `balance`). Al parte. | 01/11, salvo la lectura de cada hora (abajo) |

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
| El aviso (`POST /api/2.0/webhooks`) con `WRITE` | `webhook_id` puesto y secreto `aviso` en el Vault, 11:04:53 | **Registrado** y **llega** (abajo) |
| Movimientos | 2 nuevos, 0 repetidos, del 01/08 al 01/11; una recarga (+3.490,00) y una transferencia (−210,00), cada uno con `reference_2` = id de la transacción:id de la pata | **Confirmado** |
| `balance` de la pata | Extracto `agregador:revolut`: saldo inicial 0, final 3.280,00, `balanced = true`; `bank_balance` del enlace, 3.280,00. 0 + 3.490 − 210 = 3.280 | **Cuadra** |
| Cuánto dura el token de acceso | El código no lo apunta en ningún sitio (pide uno nuevo en cada lectura, así que no depende de ello) | Sin medir; las guías dicen 40 minutos |
| Cuánto dura el token de renovación | Se verá si las lecturas de cada hora siguen saliendo bien con los días | Sin medir |

Peticiones a `conta-revolut-conectar` entre las 10:45 y las 11:06: todas 200.

## El aviso, con un movimiento nuevo (paso 5a, 01/11)

Julio hizo un pago en el sandbox a las 12:15 de Madrid (11:15 UTC).

| Qué | Cómo se ha visto | Resultado |
|---|---|---|
| Llega el aviso | `POST /functions/v1/conta-revolut-aviso` → 200, a las 11:15:20 UTC | **Llega**, segundos después del pago |
| Detrás, la lectura | `last_run_at` y `last_ok_at` 11:15:18, sin error. «2 nuevos y 2 que ya estaban, del 2026-11-01 al 2026-11-01» | **Confirmado**: lo terminado entra en cuanto llega |
| La comisión, aparte | −11,47 del pago y −0,16 de comisión (`…:comision`) | **Confirmado** |
| Sin duplicados | Se releyó el día entero: los 2 de antes cuentan como «ya estaban»; 4 movimientos y 4 huellas distintas | **Confirmado** |
| Un extracto del mismo día detrás de otro | Segundo extracto del 01/11 al 01/11, de 3.280,00 a 3.268,37, `balanced = true`, continuidad «sigue» (la 2212) | **Cuadra**: 3.280 − 11,47 − 0,16 = 3.268,37 |
| La firma del aviso | El aviso no se cree lo que trae: solo adelanta una lectura, y lo que entra lo dice la API | No hace falta comprobarla para lo que hace hoy |

**La lectura de cada hora no está en staging.** La 2210 solo programa
`conta-revolut-despertar` si existe `cron_secret` en el Vault, y en staging no
existe (en el Vault de staging está `project_url`, no `cron_secret`; el único
cron `conta…` es `conta-cierre-del-dia`). Así que en staging el respaldo no
corre y no se ha visto. Para verlo hace falta que Julio ponga `cron_secret` en
el Vault de staging y el mismo valor en `CRON_SECRET` de sus funciones, y volver
a pasar el bloque del cron de la 2210.

## Apuntado para otro encargo (T1)

- **`REVOLUT_DOMINIOS` en staging estaba mal** y la pantalla decía «Abre
  Sumied desde su dirección de siempre». Julio lo corrigió con el dominio de
  la vista previa. Para el siguiente: que el aviso diga qué dominio ha llegado
  y cuáles admite, sin tener que adivinarlo.
- **Staging no envía los correos de recuperación de contraseña**: el servidor
  de correo rechaza la clave (`535 Authentication credentials invalid`). No es
  del B01.
