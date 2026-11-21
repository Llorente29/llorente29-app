# E06 · ¿Se puede conectar el banco de cualquier cliente desde Sumied?

Respuesta al apartado 2 del encargo E06 (19/11), antes de escribir nada.

**De dónde sale.** Del SDK `@open-banking-io/client@1.3.0`, que es el que ya usa `conta-banco-agregador`: su README («Partner Connect») y sus tipos (`dist/index.d.ts`). También del `README` y el `THREAT_MODEL.md` de su repositorio (github.com/open-banking-io/clients).

**Lo que no he podido leer.** Las páginas de open-banking.io (`/en/docs/partners`, la lista de bancos): la red de esta sesión no llega a ese dominio. Tampoco la API de Enable Banking (`api.enablebanking.com`). Lo que depende de esas páginas está marcado como «no lo sé».

## 1. ¿Una sola cuenta de Sumied puede dar de alta conexiones para muchos clientes?

**Sí.** open-banking.io lo tiene: **Partner Connect**, un OAuth 2.0 con PKCE.
- **Sumied se registra una vez como socio.** Eso le da un `client_id`, un secreto de cliente, sus direcciones de vuelta y **una sola clave de descifrado** para todos sus clientes.
- **Cada cliente pasa una vez por el flujo:**
  1. Sumied lo lleva a open-banking.io (`buildAuthorizeUrl`);
  2. allí entra con su correo y un código, elige su banco y da el permiso en la web del banco;
  3. open-banking.io vuelve a Sumied con un código (`parseRelay`), y Sumied lo cambia por **un token de ese cliente** (`exchangeCode`).
- **Leer:** con el token de un cliente y la clave de descifrado de Sumied, `OpenBankingClient.fromTokenResponse(token, clave)` lee sus cuentas, sus movimientos y sus conexiones. Es la misma librería, con los mismos `syncAll`, `getAccounts` y `getTransactions` que la lectura de cada noche de hoy (`sincronizarEmpresa`).
- **Renovar:** `buildAuthorizeUrl({ …, renewConnection: sessionId })` lleva al cliente directo a su banco. Después, `closeReplacedConsents` cierra el permiso anterior.
- **Quitar:** `revokeToken`, que puede cerrar a la vez los permisos en el banco.

Lo que dice el README, literal: «Partners let their users connect banks through open-banking.io», «You hold your own **decryption key**: every user who connects through your client is encrypted to it, and you decrypt their data with the one private half your deployment loads».

**Lo que pide, y no puedo hacerlo yo:**
1. **Registrar Sumied como socio** en `open-banking.io/app/partner`: el `client_id`, el secreto de cliente, la dirección de vuelta e instalar la clave de descifrado. «Until you do, a Connect client cannot be registered and every authorization answers `temporarily_unavailable`.» Lo hace Julio, con la cuenta de Llorente29.
2. **Guardar el token de cada cliente.** Ver «Lo que hay que decidir antes», punto A.

## 2. ¿Qué bancos españoles da?

**No lo sé.** El SDK no tiene una función para la lista de bancos, y la página de bancos de open-banking.io no se puede abrir desde aquí.

De lo que sé con seguridad:
- **BBVA** funciona (Foodint, en producción desde el B01c).
- La conexión dice de qué país es el banco (`aspspCountry`).
- open-banking.io va sobre Enable Banking (lo dice su propio SDK: «the decrypted Enable Banking session id»).

Sobre Santander, CaixaBank, Sabadell, Bankinter, Unicaja, Kutxabank, ING, Openbank, Abanca, Ibercaja y Revolut, **no lo he podido comprobar**.

## 3. ¿Cuánto dura el permiso y cómo se sabe?

**Cómo se sabe: igual que hoy.** Cada conexión trae `validUntil`, y `isLive` dice si sigue viva «por el reloj del servicio». Ojo: `status` sigue en `Active` después de `validUntil`.

**Cuánto dura en cada banco: no lo sé.** Ni el SDK ni el repositorio lo dicen; lo diría la documentación que no puedo abrir. Lo que se ve en el SDK es que varía por permiso, porque cada conexión trae su propio `validUntil`. Un dato real: el de Foodint con BBVA lo enseña hoy Bancos («Caduca el permiso en N días»).

Del token del cliente, el SDK da `expiresIn`, pero no cuánto vale. Tampoco dice si se renueva solo: no hay *refresh token*.

## Lo que hay que decidir antes de escribir

**A. Dónde se guarda el token de cada cliente.**
- El token es la clave de la API de ese cliente: con él (y la clave de descifrado de Sumied) se leen sus movimientos. El modelo de amenazas lo llama «full-tenant API key, revocable».
- **No puede ir en claro en la base.**
- Hoy hay **un secreto por empresa** en las funciones de Supabase (`OPEN_BANKING_IO_CREDENTIALS`). Eso no sirve para muchos clientes, porque los secretos de las funciones no se crean desde la aplicación.
- **Lo que propongo:**
  - **Supabase Vault** (`vault.secrets`), una entrada por conexión, cifrada en reposo;
  - en `bank_aggregator_connection`, solo el id de esa entrada (nunca el token);
  - lo leen y lo escriben solo las funciones de servidor con la clave de servicio, nunca el navegador;
  - el secreto de cliente y la clave de descifrado de Sumied, que son **uno solo**, van como secretos de las funciones (`OBI_PARTNER_CLIENT_ID`, `OBI_PARTNER_CLIENT_SECRET`, `OBI_PARTNER_DECRYPTION_KEY`).

  ¿Vale Vault, u otra cosa?

**B. «Elige el banco» no puede estar en Sumied.**
- La dirección de autorización no tiene ningún parámetro para el banco. Solo tiene `issuer`, `clientId`, `redirectUri`, `state`, `codeChallenge`, `scope`, `loginHint`, `challenge`, `uiLocales` y `renewConnection`.
- El banco se elige **en la página de open-banking.io**, después de que el cliente entre con su correo.
- **Lo que propongo para el panel de la derecha:**
  1. «Conectar otro banco» → Sumied te lleva a open-banking.io (allí entras con tu correo, eliges el banco y das el permiso en su web);
  2. vuelve sola;
  3. sus cuentas, como en la maqueta.

  El paso 1 de la maqueta («escribe el banco, Intro») se queda fuera. ¿Vale así, o se pregunta a open-banking.io si pueden preseleccionar el banco?

**C. El cliente entra en open-banking.io con su correo.**
- Lo hace la primera vez: queda con una cuenta suya allí.
- Al renovar, `renewConnection` lo lleva directo a su banco. Que no tenga que volver a entrar con el correo no lo puedo confirmar.
- ¿Vale para un cliente de una gestoría?

**D. Para leer su documentación y su lista de bancos,** esta sesión necesita llegar a `open-banking.io`. El entorno de este repositorio en Claude permite dominios, pero esta sesión corre en el Default, que no llega. Con eso contestaría bien los puntos 2 y 3.

## Lo que no cambia, decidan lo que decidan

- **Foodint sigue leyendo cada noche** con su `credentials.json` mientras no tenga su conexión nueva.
- El paso al modelo nuevo se hace sin perder ninguna noche:
  1. la lectura de cada noche aprende a abrir **también** las conexiones con token;
  2. cuando Foodint conecte su BBVA por el camino nuevo, las dos conviven una noche;
  3. se comprueba que la nueva lee lo mismo;
  4. y entonces se apaga la vieja.

  Lo detallo en el PR cuando se escriba.
