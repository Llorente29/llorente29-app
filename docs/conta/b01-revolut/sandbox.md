# B01 Revolut · La cuenta de pruebas del sandbox, paso a paso

> Para la e2e completa contra el sandbox de Revolut Business (encargo B01,
> respuesta 2: «pídeme la cuenta de pruebas paso a paso»). Nada secreto aquí:
> lo que hay que pegar lo pega Julio en Vercel, en la pantalla de Sumied o en
> los secretos de staging, nunca en el chat ni en el repositorio (T11).

| Paso | Quién | Qué | Hecho |
|---|---|---|---|
| 1 | Julio | Cuenta de empresa de pruebas en `sandbox-business.revolut.com`, con datos inventados. | 01/11 |
| 2 | Julio | Vercel › folvy-app › Environment Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` de staging-conta, **solo Preview** y **solo la rama** `claude/revolut-business-sumied-9fhlsh`. Sin ellas, la vista previa de una rama `claude/…` se construye contra **producción** (`guardaVistaPrevia.ts` solo cubre `conta/**` y `reparto-**`). | 01/11 |
| 2b | Sesión | Comprobar en el registro del despliegue que la vista previa va contra staging-conta. | |
| 3 | Julio | En los secretos de las funciones de staging: `REVOLUT_DOMINIOS` = el dominio de la vista previa de la rama (para que la dirección de vuelta sea la suya). | |
| 4 | Julio | En la vista previa, Bancos › Cuentas y extractos › Conectar Revolut: copiar el certificado, pegarlo en el sandbox › Settings › APIs con la dirección de vuelta, pegar el Client ID en Sumied y autorizar. | |
| 5 | Sesión | Con esa conexión: leer movimientos (recargar saldo en el sandbox), y confirmar lo que solo está en las guías (token, renovación, firma del aviso, `balance`). Al parte. | |

Recordatorio para producción: `REVOLUT_ENTORNO = produccion` en los secretos
de las funciones de producción antes de que Foodint conecte su Revolut de
verdad. Sin ella, las funciones hablan con el sandbox.
