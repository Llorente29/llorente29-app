# N5 · Un proyecto de Vercel propio para app.sumied.com — el plan

> Paso 2 de la auditoría C09. **Solo el plan escrito**: mover el dominio puede
> cortar el servicio y eso lo hace Julio despierto. Esta noche no se ha tocado
> nada en Vercel salvo las variables de vista previa de las ramas `conta/n*`,
> como siempre.

## 0 · Cómo está hoy (medido el 24/10)

- **Un solo proyecto**, `folvy-app` (`prj_HjbJkb6T1Zn5zaLYqva1eVUS52ad`), con
  cuatro dominios: `app.folvy.app`, `foodint.folvy.app`, `app.sumied.com` y
  `folvy-app.vercel.app`. Un despliegue sirve los dos productos.
- **La marca la decide `vercel.json`**: el host `app.sumied.com` (o
  `?marca=sumied` fuera de los dominios de Folvy) se reescribe a
  `/marcas/sumied/index.html`; el resto, a `/index.html`. Más las reescrituras
  de `/E/:token` y `/e/:token` a `label-scan` (etiquetas de Folvy).
- **La guarda de vista previa** (`build/guardaVistaPrevia.ts`) hace fallar el
  build de una rama `conta/**` o `reparto-**` que no tenga sus dos variables de
  staging limitadas a la rama.
- **Qué arrastra hoy cada fusión**: cualquier push a `main` despliega el front
  de los dos productos, y con él la web de las tablets de cocina (la que no va
  por paquete OTA).

## 1 · Lo que se quiere

Dos proyectos del mismo repositorio. **`sumied-app`** sirve `app.sumied.com` y
**`folvy-app`** se queda con el resto. Cada uno **ignora el build** de un push
que solo toca al otro (`ignoreCommand` de Vercel con el reparto de
`productosTocados` de `scripts/e2e/area.mjs`). Así, una fusión solo de Sumied no
publica Folvy ni las tablets, y una de cocina no publica Sumied.

## 2 · Los pasos

**A · Preparar, sin tocar el dominio** (se puede hacer de día, no corta nada):

1. Crear el proyecto `sumied-app` en el mismo equipo, conectado al mismo
   repositorio y rama `main`. Mismo framework (Vite), mismo `npm run build`,
   misma carpeta de salida.
2. Copiar las variables de producción que lee el front
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y las demás `VITE_*` de
   `folvy-app`) al proyecto nuevo, **en producción**. Las de vista previa
   generales, **no**: las de las ramas `conta/**` se crean en el proyecto nuevo
   por rama, como hoy (la guarda sigue igual).
3. Un `vercel.json` propio para `sumied-app`. Vercel lee `vercel.json` de la
   raíz, así que hay dos opciones:
   - **(a)** el mismo `vercel.json` para los dos, que ya decide la marca por el
     host: no cambia nada y es lo más seguro;
   - **(b)** un `vercel.sumied.json` con solo la reescritura a
     `/marcas/sumied/index.html`, usado con la opción de fichero de
     configuración del proyecto. **Recomiendo la (a) primero**, y la (b) solo
     cuando el nivel 2 separe los builds.
4. El `ignoreCommand` de cada proyecto: un `node scripts/vercel/ignorar.mjs
   sumied` (o `folvy`) que sale con 0 (no construir) si el push no toca su
   producto, según `productosTocados`, y con 1 (construir) si lo toca o toca lo
   común. **Por defecto, construir**: si no sabe, construye. Va en un PR propio,
   con sus pruebas.
5. Que `sumied-app` construya `main` una vez, sin dominio, y probar su URL
   `*.vercel.app` con `?marca=sumied`: entrar, Inicio, Libros, Compras. **READY y
   probado** antes de seguir.

**B · Mover el dominio** (Julio, despierto, fuera de las horas de más uso de
la contabilidad, por ejemplo un sábado por la mañana):

6. Bajar el TTL del DNS de `app.sumied.com` unas horas antes, si el DNS lo
   gestiona fuera de Vercel.
7. En Vercel: quitar `app.sumied.com` de `folvy-app` y añadirlo a
   `sumied-app`, **seguido**. Un dominio no puede estar en dos proyectos a la
   vez, así que entre las dos operaciones el dominio no sirve nada: **ese es el
   corte**, normalmente de segundos a un par de minutos, más lo que tarde el
   certificado si hay que volver a emitirlo.
8. Comprobar en el momento: `https://app.sumied.com` carga la marca Sumied,
   entrar con un usuario de contabilidad, Inicio y Libros. Y comprobar que
   `app.folvy.app` y `foodint.folvy.app` siguen igual.
9. **Vuelta atrás**: el mismo movimiento al revés (quitar de `sumied-app`,
   poner en `folvy-app`). `folvy-app` sigue construyendo la marca Sumied (la
   reescritura del host no se toca), así que volver es inmediato.

**C · Después** (ya sin prisa):

10. Activar el `ignoreCommand` en los dos proyectos (paso 4).
11. Dejar en `folvy-app` la reescritura de `app.sumied.com` durante unas
    semanas (no estorba) y quitarla después.
12. Actualizar `CLAUDE.md`: «una fusión está hecha cuando Vercel dice READY»
    pasa a ser **en el proyecto o los proyectos que toca**; y el aviso de que
    una fusión publica la web de las tablets solo vale para `folvy-app`.

## 3 · Lo que hay que mirar antes del paso B

- **Supabase Auth**: la URL del sitio y las direcciones de vuelta permitidas
  incluyen `app.sumied.com`. No cambian, porque el dominio es el mismo; pero
  las de vista previa (`*-llorente29s-projects.vercel.app`) del proyecto nuevo
  tendrán otro patrón, y hay que añadirlas en staging.
- **CORS de las funciones** (`_shared/cors.ts`): hoy es
  `Access-Control-Allow-Origin: *`, así que el proyecto nuevo no cambia nada.
  Si algún día se cierra por origen, hay que contar con los dos proyectos y sus
  vistas previas.
- **Los correos de Sumied** (contraseña, invitaciones, asesoría) llevan
  enlaces a `app.sumied.com`: no cambian.
- **Nada de Folvy se sirve desde `app.sumied.com`**: el manifiesto OTA de las
  tablets (`apps/bundle.json`) no está en Vercel, está en el almacenamiento de
  Supabase (`src/native/appUpdate.ts`), así que no le afecta. Las etiquetas
  (`/E/…`) y la tienda sí van por Vercel, en los dominios de Folvy: comprobar en
  los registros de Vercel de los 30 últimos días que ninguna de esas rutas se
  pide con el host `app.sumied.com`. Si se pide alguna, se lleva también su
  reescritura.

## 4 · Riesgos

| Riesgo | Cómo se tapa |
|---|---|
| El corte del paso 7 | Hacerlo seguido y a una hora tranquila; la vuelta atrás es el mismo gesto. |
| El proyecto nuevo construye contra producción una rama `conta/**` | La guarda de vista previa ya lo impide: el build falla si faltan las variables de la rama. |
| El `ignoreCommand` se equivoca y no construye algo que debía | Por defecto construye; lo común (migraciones, workflows, `src/lib`…) construye los dos. Y una prueba con los 40 últimos PR, como el N1. |
| Dos proyectos gastan el doble de minutos de build | Solo mientras el `ignoreCommand` no esté activo; con él, cada push construye solo lo suyo. |

## 5 · Lo que tiene que decidir Julio

1. ¿Cuándo hace el paso B (el movimiento del dominio)?
2. ¿`vercel.json` común (a) o uno propio para Sumied (b)? Recomiendo la (a).
3. ¿El DNS de `sumied.com` está en Vercel o fuera? Si está fuera, hay que bajar
   el TTL antes.
4. ¿Quiere el `ignoreCommand` en el mismo PR que el proyecto nuevo, o después,
   cuando el proyecto lleve unos días funcionando? Recomiendo después.
