# `catcher-probe` — rescatada de producción el 27/08/2026

Esta carpeta **no existía**. La función llevaba desplegada desde el 19/07/2026
(v17, ACTIVE, `verify_jwt: true`) sin una sola línea en el repositorio.

## Quién la encontró

El vigía de divergencia (`edge-drift-watchdog`), el primer día que se armó, con
el estado más grave del árbol: `sin_fuente_en_repo`. Código vivo en producción
que nadie podía leer ni revisar, y que el próximo despliegue habría borrado sin
dejar rastro.

## Qué es

Una sonda de diagnóstico temporal del encargo de Catcher (el pipeline de reparto
que despachaba contra el *sandbox* en vez de contra producción). Cumplida su
función se **inertizó**: responde `410 {"disabled": true}` a cualquier petición.
No toca nada — ni BBDD, ni Catcher, ni secrets. Dos líneas de código.

## Cómo se recuperó

El servidor MCP de Supabase **sí** desempaqueta el eszip que devuelve
`GET /v1/projects/{ref}/functions/{slug}/body`. Es justo lo que la Edge Function
no puede hacer desde dentro — el endpoint responde `application/octet-stream`, y
por eso el vigía se quedó sin comparación de contenido y tuvo que caer a la
huella del bundle. Vino entera y verificada: 2 líneas, idénticas a lo desplegado.

## Por qué `index.ts` no lleva ni un comentario de más

Porque el repositorio tiene que reflejar **lo que corre**, no lo que nos
gustaría que corriese. Una cabecera explicativa habría dejado `main` distinto de
producción y la función marcada como divergente para siempre. Todo el contexto
vive aquí; el fichero es byte a byte el desplegado.

## Al desplegar

Está desplegada con `verify_jwt: true`, al revés que los webhooks. Si alguna vez
se redespliega, hay que mantener esa flag.

## Propuesta pendiente de decisión

**Borrarla del proyecto.** Código muerto que responde 410 no aporta nada y suma
superficie. No se hace por iniciativa propia: eliminar una función desplegada no
se deshace solo.
