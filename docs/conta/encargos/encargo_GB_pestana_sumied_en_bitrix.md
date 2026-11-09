# Encargo GB — La pestaña «Sumied» dentro de la ficha de Bitrix24 (primera parte: solo ver)

Sesión de Code: **Code 4, solo para este encargo**, en paralelo con Code 1 (G05), Code 2 (GD) y Code 3 (GP). Rama: `conta/gb-pestana-bitrix`, sacada de `main`. Producto: **Sumied**. Escribe siempre en español.

## Para qué

Que alguien de la gestoría, con la ficha de una empresa abierta en Bitrix24, vea **sin salir de Bitrix24** lo que Sumied sabe de ese cliente. QBO trabaja todo el día en Bitrix24: es lo que más le va a convencer.

**Fecha:** cuanto antes, **mejor mañana 10/11 por la mañana**. Sale en el vídeo para QBO, que Code 2 graba por escenas: la de la pestaña se cambia cuando esté. Para el congreso del 17/11 tiene que estar terminada y probada.

## Dónde

- **Solo en el Bitrix24 de pruebas (b24-s3mr2y) y en la «Gestoría Demo».**
- En el Bitrix24 real de QBO **no se instala nada** hasta que QBO y Julio digan sí.
- **Zona:** tuya es la pestaña: su aplicación de Bitrix24, su página (una entrada aparte, como pagar.html, sin tocar App.tsx), sus funciones `conta-bitrix-pestana*` y sus tablas `conta_bitrix_pestana*` si las necesitas.
- **Solo lees:** clientes, recibos, cobros y la ficha (Code 1 y G04), y la conexión del CRM (`_shared/crm/`).
- Los reales los lanza Julio, de uno en uno. Antes de una migración, mira las ramas y los PR abiertos y usa una hora posterior.

## Diseño (sección obligatoria)

- **Fiel a la maqueta aprobada** «Sumied dentro de Bitrix24» (`EnCRM.dc.html` del tablero https://claude.ai/artifact/CcUm9bbc2AH9qRQ2vdRScG), con el estilo de Sumied, no el de Bitrix24.
- Cabe en el ancho de la pestaña de Bitrix24 sin barra lateral. **Abre en menos de 1 segundo**: una sola lectura, preparada por la base.
- Palabras de oficina: recibo, cobro, devuelto, trabajadores. Ningún código interno.

## Lo que se construye (primera parte, solo ver)

1. **La aplicación de Sumied en el Bitrix24 de pruebas**, que añade la pestaña «Sumied» a la ficha de la **empresa** y del **contacto** (placements de la ficha del CRM).
   - Si su alta pide algo que solo puede hacer el administrador del portal, dile a Julio exactamente qué pulsar, o pídeselo a Claude: el portal de pruebas está abierto en el Chrome de Julio.
2. **Saber quién mira y qué ficha:**
   - Bitrix24 manda a la página la ficha (empresa o contacto) y la sesión del usuario.
   - Sumied **comprueba con Bitrix24** quién es ese usuario y busca qué cuenta de Sumied tiene ese portal conectado.
   - Si el usuario de Bitrix24 no es nadie de la gestoría en Sumied (se busca por su correo), la pestaña dice «Pide acceso a Sumied a tu administrador» y no enseña nada.
   - Nunca se enseña nada sin esa comprobación.
3. **Lo que enseña:**
   - el cliente y su situación;
   - su cuota y **el recibo de este mes, línea a línea**, con el porqué de cada cambio;
   - sus últimos cobros, y si tiene algo devuelto o pendiente;
   - sus servicios y sus trabajadores;
   - lo que está en «Pendiente de revisar»;
   - el botón «Abrir en Sumied ↗».
   - Si esa ficha no está enlazada con ningún cliente de Sumied, lo dice.
4. **Prueba de que nadie ve lo que no debe:** un usuario sin acceso, otro portal y una ficha de otra cuenta fallan.

## La segunda parte (después del 17/11, no ahora)

Dar de alta trabajadores, servicios, niveles y precios desde la pestaña, con el recibo nuevo antes de guardar, escribiendo en Sumied y en Bitrix24. Ver `bitrix24_qbo_lo_que_hay.md` y la decisión del 07/11 en `decisiones_qbo.md`.

## Tareas

1. **Comprobaciones previas**, solo leyendo, y para a informar (corto, que va contrarreloj):
   - qué pide Bitrix24 para una aplicación local con pestaña en la ficha, y cómo se comprueba al usuario;
   - qué hay ya en Sumied que sirva (la conexión del CRM, la ficha y su lectura);
   - un plan por horas.
2. La aplicación, la comprobación del usuario y la lectura, con su tanda si la hay.
3. La pestaña, fiel a la maqueta, con su e2e y una captura dentro del Bitrix24 de pruebas.

---

## Cómo se instala la aplicación (lo aprendido en el portal de pruebas, nº 6, 09/11)

> Para que en el Bitrix24 real de QBO vaya bien a la primera, cuando QBO y Julio
> digan sí. Hasta entonces la función solo acepta el portal de pruebas
> (`supabase/functions/conta-bitrix-pestana/puro.ts` · `PORTALES`): el real se
> añade ahí, en su propio PR.

En Bitrix24: **Recursos para desarrolladores › Otro › Aplicación local** (lo
hace el administrador del portal).

| Campo | Valor |
|---|---|
| Dirección del controlador (la pestaña) | `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-bitrix-pestana?paso=pestana` |
| Dirección de instalación | `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-bitrix-pestana?paso=instalar` |
| Permisos | **`crm`**, **`placement`** y **`user_basic`** («Usuarios (básico)») |

- **`user_basic`, no `user_brief`.** Con `user_brief`, `user.current` no trae el
  correo del usuario, Sumied no sabe quién mira y la pestaña dice «No se ha
  podido comprobar que eres tú». Pasó en el portal de pruebas el 09/11 (app
  nº 13): con `user_basic` y «Reinstalar», la pestaña enseñó la ficha.
- Después de guardar, Bitrix24 da el **código de la aplicación** («local.…»): va
  en el secreto `BITRIX_PESTANA_CLIENT_ID` de la función (Supabase ›
  Edge Functions › Secrets). Sin él, o con otro, el mismo mensaje.
- Un permiso cambiado no vale hasta pulsar **«Reinstalar»**.
- Cada persona de la gestoría que use la pestaña tiene que estar **en la cuenta
  de Sumied con el mismo correo que en Bitrix24**. Si no, la pestaña dice «Pide
  acceso a Sumied a tu administrador», que es lo correcto.
- Desde el #543, si algo falla, el registro de `conta-bitrix-pestana` dice por qué
  (`{"gb":"no_es_sumied","porque":[…]}`), sin datos personales ni secretos.

Texto para la **descripción de la aplicación** en Bitrix24:

> Sumied · la pestaña «Sumied» en la ficha de la empresa y del contacto (solo
> ver). Permisos: crm, placement y user_basic (no user_brief: sin el correo,
> Sumied no puede comprobar quién mira). El código de esta aplicación va en el
> secreto BITRIX_PESTANA_CLIENT_ID. Tras cambiar un permiso, «Reinstalar».
