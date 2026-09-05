# Los porqués de seis migraciones del 02/09, rescatados

**Fecha del rescate:** 05/09/2026 · **Motivo:** cerrar la regla 17 sin perder la memoria.

---

## Por qué existe este documento

Las 31 migraciones vivas ya están en `main` bajo una invariante dura: **el fichero
del repo es, byte a byte, el texto que se ejecutó** (`md5(fichero)` =
`md5(array_to_string(statements, E'\n'))`).

Seis de las del 02/09 se aplicaron por MCP mandando el SQL **sin las líneas de
comentario**. Eso significa que el fichero fiel —el que cuadra— no lleva la
cabecera que explicaba por qué se hizo. Y esas cabeceras no eran adorno: llevan
mediciones, alternativas descartadas, y en un caso **trabajo pendiente declarado
que no está en ningún otro sitio**.

Decisión de Julio, 05/09: *«La invariante ‹el repo dice lo que la base tiene›
vale más que la cabecera. Rescata los comentarios a `docs/` como documentación,
con el nombre de la migración al lado.»*

Así que aquí está el porqué, y en `supabase/migrations/` está el qué. **182 líneas
recuperadas.** Los ficheros originales siguen vivos en el historial de git, en
ramas de trabajo sin fusionar, con nombre `20260902T*.sql`.

**Esto es documentación histórica, no una instrucción viva.** Lo que dice era
cierto el 02/09; algunas cosas —la pieza que falta del alta de usuarios, por
ejemplo— pueden seguir abiertas o no. No se ha actualizado nada: se ha rescatado.

---

## `20260902052950_alcance_por_local_escritura.sql`

Escrita como `20260902T0530_alcance_por_local_escritura.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T0530_alcance_por_local_escritura.sql
>
> APLICADA EN PRODUCCIÓN el 02/09/2026 05:29:50 UTC (07:29 Madrid),
> versión `20260902052950` en supabase_migrations.schema_migrations.
> Este fichero es el original que se aplicó, palabra por palabra. Regla 1: una
> corrección que vive solo en el desplegado tiene fecha de caducidad.
>
> ══ LO QUE ESTA MIGRACIÓN NO HACE, Y HAY QUE LEERLO ANTES QUE NADA ══════════
>
> LA CUENTA DE JOSÉ NO SE CREA HASTA QUE LA LECTURA ESTÉ ACOTADA.
>
> Aquí solo se acota la ESCRITURA. La lectura sigue siendo por cuenta: un admin
> de Foodint que entrara hoy vería Alcalá entera — el listado de pedidos, las
> ventas, la plantilla. Julio pidió «ni verlos, ni tocarlos», y esta migración
> entrega la mitad de atrás. Dar de alta a José con la lectura sin acotar sería
> cumplir la petición al revés de como se pidió.
>
> PIEZA QUE FALTA (no es una nota al pie, es trabajo pendiente):
> NO HAY FORMA DE DAR DE ALTA A UN USUARIO DESDE EL PRODUCTO. `get_auth_user_id_by_email`
> solo BUSCA un usuario que ya existe; no crea ninguno, no manda invitación y no
> fija contraseña. Hoy un alta se hace a mano contra auth.users desde fuera de la
> aplicación. Mientras eso siga así, cada empleado nuevo, cada encargado y cada
> cliente 2 depende de que alguien con acceso al panel de Supabase lo haga por su
> cuenta — y no queda registro dentro del producto de quién lo dio de alta.
>
> ═══════════════════════════════════════════════════════════════════════════


## `20260902062202_aterrizaje_mira_lo_reciente.sql`

Escrita como `20260902T0620_aterrizaje_mira_lo_reciente.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T0620_aterrizaje_mira_lo_reciente.sql
>
> UN AVISO PERMANENTE DEJA DE SER UN AVISO.
>
> Al entrar en la aplicación, si hay algo accionable, se aterriza en Pendientes
> en vez de en Inicio. La regla es buena y se queda. Lo que no vale es el
> criterio: `actionableCount > 0` cuenta TODO lo abierto, tenga la edad que
> tenga, así que basta con una fila vieja que nadie va a cerrar para que la
> aplicación mande a Pendientes todos los días, para siempre.
>
> Medido en Foodint el 02/09, y conviene decirlo porque el dato que circulaba
> era otro: el contador NO son las 66 líneas pendientes de oficina —esas no
> entran en pending_board, no hay ningún pending_kind que las recoja—. Son 18:
>
> linea_sin_coste            6   la más vieja del 16/06, 2 de más de 30 días
> albaran_sin_pedido         4   del 12/08 al 28/08
> recuento_abierto           3   del 01/09 y 02/09
> albaran_borrador_atascado  2   del 10/07 y del 31/07, las DOS de más de 30 días
> recuento_sin_aprobar       1   del 24/08
> pedido_vencido             1   del 19/08
> pedido_borrador_atascado   1   del 24/08
>
> Son OCHO filas viejas —dos borradores de julio y seis líneas sin coste desde
> junio— las que llevan un mes mandando a Julio a la pantalla equivocada.
>
> ── POR QUÉ NO BASTA CON MIRAR LA CAPA ─────────────────────────────────────
> «Que mire lo de ahora y esta semana» suena a que las capas ya lo resuelven,
> y no: `ahora` y `semana` son clases de URGENCIA, no de antigüedad. Un
> borrador de albarán atascado desde el 10/07 está en `semana` y es MÁS urgente
> por viejo, no menos. Filtrar por capa no quita ni una de las ocho.
>
> ── DÓNDE VA EL UMBRAL, Y DÓNDE NO ─────────────────────────────────────────
> Regla 7: un umbral ordena, no esconde. La pantalla de Pendientes la abre
> alguien a propósito y sigue enseñando LAS 18, y el contador de la pestaña
> sigue diciendo 18 — ahí no se filtra nada. El umbral vive donde toca: en lo
> que INTERRUMPE, que aquí es secuestrar la pantalla de entrada.
>
> Esta migración no decide nada: solo añade el dato que faltaba para poder
> decidirlo. `detail` gana `newest_at` y `items_recientes`. Es aditivo: quien
> lea `oldest_at` sigue leyéndolo igual.
>
> Se edita con pg_get_functiondef + replace, no retranscribiendo: la función
> tiene 90 líneas y ya está bien; retranscribir a mano es como se cuela un
> cambio que nadie pidió.

> LO RECIENTE, contado aparte. No sustituye a `items`: convive con él.
> Un grupo con cinco filas viejas y una nueva TIENE que aterrizar, y por
> eso no vale mirar `newest_at` a secas ni, mucho menos, `oldest_at`.

> ── Verificación ───────────────────────────────────────────────────────────

> Lo viejo sigue: esto es aditivo, no un cambio de contrato.

> Y el conteo de siempre no se ha tocado: el contador de la pestaña no miente.


## `20260902070753_queue_system_alert_fuera_de_anon.sql`

Escrita como `20260902T0640_queue_system_alert_fuera_de_anon.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T0640_queue_system_alert_fuera_de_anon.sql
> ============================================================================
> `_queue_system_alert` ERA EJECUTABLE CON LA CLAVE ANONIMA.
>
> Apareció montando el vigía de despliegue fallido: al buscar por dónde meter
> un aviso desde GitHub Actions, la respuesta cómoda era «con la clave anon
> vale». Que valiera es el fallo.
>
> QUÉ PERMITÍA: encolar cualquier alerta de sistema —asunto y cuerpo libres—
> con la clave pública que viaja en el bundle del front. El drenador corre cada
> minuto, así que iba directo al buzón de operaciones. No es una fuga de datos:
> es la capacidad de llenar de ruido el único canal por el que gritan los siete
> vigías. Y hoy hemos visto lo que cuesta un canal con ruido — cinco correos de
> despliegue fallido en un buzón con 96 diarios de cierres de marca, ninguno
> leído.
>
> POR QUÉ NO BASTA `revoke ... from anon`, que era la orden literal:
> el ACL de la función era
>
> {=X/postgres, postgres=X/postgres, anon=X/postgres,
> authenticated=X/postgres, service_role=X/postgres}
>
> y ese `=X/postgres` de delante, sin rol, es PUBLIC. Quitarle el permiso a
> `anon` por nombre y dejar el de PUBLIC habría dejado a anon entrando igual
> —hereda de PUBLIC— con una migración aplicada y cara de arreglado. Se
> revocan los dos. Es la misma lección de método del 29/08: el dato bueno lo
> da `has_function_privilege`, que sí tiene en cuenta lo concedido a PUBLIC.
>
> QUÉ NO SE ROMPE
> El único llamador es `availability-watchdog`, que construye su cliente con
> SERVICE_ROLE_KEY (index.ts:73). Los demás vigías la llaman desde dentro de la
> base, en funciones SECURITY DEFINER propiedad de postgres o desde pg_cron:
> ahí el permiso de anon no interviene. Verificado que ningún fichero del front
> la nombra.
>
> LO QUE ESTA MIGRACIÓN NO CIERRA, Y SE DICE:
> `authenticated` conserva su permiso explícito. Con una sesión de cualquier
> cuenta se puede seguir encolando alertas. Es mucho menos grave que anon —hace
> falta una cuenta— pero no es cero, y no hay ningún llamador legítimo que lo
> necesite. Se deja fuera a propósito porque el encargo decía «abierto a anon»
> y tocar permisos toca pantallas: es una línea, y la decide Julio.
> ============================================================================

> ── GUARDA ─────────────────────────────────────────────────────────────────

> Cerrado para anon. Se pregunta por privilegio efectivo, no por el texto del
> ACL: un `like '%anon%'` sobre proacl es como se firma un cierre que no está.

> Y abierto para quien tiene que poder: comprobar solo el cierre deja el
> canal de alarma roto y nadie se entera hasta que calla un vigía.

> El drenador sigue existiendo: sin él la cola se llena y no sale nada.


## `20260902071309_queue_system_alert_fuera_de_authenticated.sql`

Escrita como `20260902T0650_queue_system_alert_fuera_de_authenticated.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T0650_queue_system_alert_fuera_de_authenticated.sql
>
> Segunda pasada de 20260902T0640, y la que faltaba. Aquella cerró `anon` y
> PUBLIC y dejó dicho que `authenticated` seguía dentro. Decisión de Julio:
> también fuera. Encolar alertas de sistema no es algo que deba poder hacer un
> empleado con su usuario, y no hay ningún llamador con sesión que lo necesite:
> el único es `availability-watchdog`, que construye su cliente con
> SERVICE_ROLE_KEY. Ningún fichero del front la nombra.
>
> Mismo método que la anterior, y por el mismo motivo: se comprueba con
> `has_function_privilege`, no con el texto del ACL. Un `like '%authenticated%'`
> sobre proacl es como se firma un cierre que no está.

> Y que no se ha reabierto por detrás lo que cerró la migración anterior.


## `20260902080431_panel_del_86_casa_como_la_tienda.sql`

Escrita como `20260902T0710_panel_del_86_casa_como_la_tienda.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T0710_panel_del_86_casa_como_la_tienda.sql
>
> UN 86 EN VIGOR QUE LA PANTALLA DEL 86 NO ENSEÑABA.
>
> «Wrap seoul chicken», Foodint Carabanchel, agotado el 30/08 a las 13:54, sin
> fecha de vuelta. Vive en CUATRO cartas activas —Milanesa Haus ×2, Big Mike's
> y KDB— y llevaba TRES DÍAS agotado de verdad en la tienda y en el TPV,
> mientras la pantalla de Disponibilidad decía que no lo estaba. Nadie podía
> reactivarlo desde el producto.
>
> ── UN CRITERIO, DOS ESCRITURAS (Regla 10) ─────────────────────────────────
> La tienda (`shop_brand_menu_by_slug`) y el TPV (`pos_item_config`) deciden si
> un producto está agotado casando por las DOS vías:
>
> and ((mi.external_id   is not null and pa.external_id   = mi.external_id)
> or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id))
>
> `_availability_panel_core` casaba SOLO por `external_id`. La fila del Wrap
> tiene `external_id` a NULL y va ligada por `recipe_item_id`, así que el panel
> no la reconocía, `tiene_ficha` salía falso y el filtro final la tiraba. El 86
> surtía efecto y era invisible: la peor combinación de las dos.
>
> Esta migración copia la condición del sitio que manda. No la reinventa: la
> tienda y el TPV son quienes deciden si algo se vende, y el panel es quien lo
> cuenta; si cuentan distinto, uno de los dos miente.
>
> ── LO QUE NO CAMBIA, Y ES A PROPÓSITO ─────────────────────────────────────
> La AGRUPACIÓN se queda como está. De las 66 filas de Carabanchel, 3 se
> agrupan porque son el mismo producto físico agotado bajo varias marcas —es lo
> que se pidió el 01/09 para no ver «Milanesa de ternera» cuatro veces— y una
> se caía por este fallo. 66 → 63 agrupando (bien) → 62 filtrando (mal).
>
> ── MEDIDO ANTES Y DESPUÉS ─────────────────────────────────────────────────
> Foodint Carabanchel   62 → 63   (aparece el Wrap)
> Foodint Alcalá        18 → 18   (no cambia)
> Toda la cuenta        80 → 81
> La verificación de abajo aborta si esas cifras no salen: un arreglo de
> visibilidad que no cambia lo que se ve no ha arreglado nada.
>
> Se edita con pg_get_functiondef + replace, con cuatro sustituciones ancladas
> y verificadas. La función tiene 90 líneas y el resto queda byte a byte igual.

> dejaria de filtrar -- de arreglar una fuga a abrirla del todo. Se
> cambia a la vez que su origen, no despues.

> ── Verificación, con las cifras de verdad ─────────────────────────────────


## `20260902151741_home_layout_descartadas.sql`

Escrita como `20260902T1620_home_layout_descartadas.sql`. Rescatado de la rama de trabajo sin fusionar.

> 20260902T1620_home_layout_descartadas.sql
> APLICADA el 02/09. Verificacion pasada: columna creada, con defecto, sin nulos.
>
> usado el producto es justo quien deja de ver lo que se anade. El cajon avisa
> de las novedades; esta columna guarda las que el usuario ya dijo que NO


