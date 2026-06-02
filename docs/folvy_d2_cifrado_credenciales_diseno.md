# Folvy — D2: Cifrado de credenciales de conectores (Supabase Vault)
### Documento de diseño para aprobación · v1 · 02/06/2026

> **Estado:** diseño previo a construcción. NADA construido aún.
>
> **Qué resuelve:** las integraciones (Glovo, Catcher, Last…) requieren guardar
> secretos (tokens, API keys). Hoy `account_connector.credentials_ref` existe pero
> está vacío y no hay mecanismo de cifrado. D2 construye ese mecanismo: **los
> secretos se cifran en Supabase Vault; en la tabla solo vive una REFERENCIA.**
> Cero secretos en claro — cumple las reglas de seguridad del proyecto.
>
> **Por qué ahora:** es el cimiento compartido por (a) la pantalla de configuración
> del módulo de Integraciones y (b) el conector Glovo G1. Construible HOY sin
> depender del acceso de Glovo (es infraestructura propia). Cuando lleguen las
> credenciales de stage de Glovo (ticket INTSUPPO-1382, en cola), G1 se monta
> sobre esta base.
>
> **Listón:** "como los mejores, no aparente". El token se guarda cifrado DE VERDAD
> (no se captura y se descarta). Es lo que hacen Toast/R365 con credenciales de
> terceros.

---

## 1. Estado real verificado (información_schema / pg_extension)

- **`supabase_vault` v0.3.1** instalada y activa.
- **`vault.secrets`** (tabla, cifrada en disco con Authenticated Encryption vía pgsodium).
- **`vault.decrypted_secrets`** (vista; descifra usando una clave que NO está
  disponible en SQL, solo referenciable por id — gestionada por Supabase).
- 0 secretos hoy.

## 2. Hallazgos de la investigación (restricciones de diseño)

| # | Hallazgo | Implicación |
|---|---|---|
| **V1** | **NO insertar secretos con INSERT crudo.** Las sentencias se loguean por defecto → el secreto acabaría sin cifrar en los logs de Supabase. | Usar SIEMPRE la función oficial **`vault.create_secret(secret, name, description)`** (y `vault.update_secret`), nunca `INSERT INTO vault.secrets`. |
| **V2** | **Acceso solo server-side, restringido a `service_role`.** El front (anon key) jamás lee/escribe secretos. | El guardado y lectura de secretos vive en una **Edge Function** que corre con service_role. El front llama a la Edge Function, no a Vault. |
| **V3** | El descifrado se hace por la vista `vault.decrypted_secrets`, referenciando el secreto por su **id (uuid)**. | `account_connector.credentials_ref` guarda ese **uuid** del secreto en Vault. Es la "referencia", no el valor. |
| **V4** | Authenticated Encryption: backups y réplicas preservan el cifrado. | No hay que hacer nada extra para que los backups estén seguros — Vault lo garantiza. |

## 3. Arquitectura

```
   FRONT (anon key)                 EDGE FUNCTION (service_role)            VAULT
   ConnectorDetailPage                connector-credentials                vault.secrets
        │                                   │                              (cifrado)
        │  POST { accountConnectorId,       │                                  │
        │         secrets: {token: "..."} } │                                  │
        ├──────────────────────────────────►                                  │
        │                                   │  vault.create_secret(token,…) ──►│ (cifra)
        │                                   │◄── secret_id (uuid) ─────────────┤
        │                                   │                                  │
        │                                   │  UPDATE account_connector        │
        │                                   │  SET credentials_ref = secret_id │
        │                                   │      status = 'connected'        │
        │◄── { ok, status } ────────────────┤  (NUNCA devuelve el secreto)     │
        │                                   │                                  │
   (el front nunca ve el secreto guardado, solo confirma que se guardó)
```

**Principios:**
- El secreto viaja del front a la Edge Function **una sola vez** (al guardar), por HTTPS. Nunca vuelve al front. Nunca se guarda en estado de React más de lo necesario para el envío.
- La tabla `account_connector` **solo** guarda `credentials_ref` (uuid del secreto en Vault). Nunca el token.
- Para USAR el secreto (ej. el webhook de Glovo verificando su token), otra Edge Function (la del conector, G1) lo lee de `vault.decrypted_secrets` por su id, server-side. El front jamás.

## 4. Componentes a construir

### 4.1 — Edge Function `connector-credentials` (nueva)
Corre con service_role. Tres operaciones (por acción en el body):
- **`save`**: recibe `{ accountConnectorId, secrets: {...}, config: {...} }`. Por cada
  campo `type:'secret'` del `config_schema`, llama a `vault.create_secret()` (o
  `vault.update_secret()` si ya había un `credentials_ref`). Guarda el uuid en
  `account_connector.credentials_ref`. Guarda los campos NO-secretos (store_ids,
  auto_accept, etc.) en una columna de config no sensible (ver 4.3). Actualiza
  `status`. **Nunca devuelve el secreto.**
- **`status`**: devuelve si hay credenciales guardadas (sin revelar el valor) —
  para que la pantalla muestre "configurado ✓" sin enseñar el token.
- **`clear`**: borra el secreto de Vault y limpia `credentials_ref` (al desconectar).

> Decisión: ¿un solo secreto por conexión (JSON con todos los campos secret) o uno
> por campo? **Recomendación: un secreto por conexión** (un JSON cifrado con todos
> los campos sensibles). Más simple, un solo `credentials_ref`. Glovo solo tiene un
> secret (shared_token), así que de momento es trivial.

### 4.3 — Config no sensible: ¿dónde viven store_ids, auto_accept…?
Los campos NO-secretos del `config_schema` (store_ids, auto_accept, verify_signature)
no son secretos pero hay que guardarlos. Opciones:
- **(A)** Columna nueva `account_connector.config jsonb` (no sensible). Limpio.
- **(B)** Reutilizar algún campo existente.
**Recomendación (A):** añadir `account_connector.config jsonb` para los campos no
sensibles. Verificar esquema antes; es una columna nueva → regenerar `database.ts`.

### 4.4 — Front: `ConnectorDetailPage`
Pantalla de detalle/configuración (la que cierra el módulo). Renderiza el formulario
dinámico desde `config_schema`. Al guardar, llama a la Edge Function `connector-credentials`
(acción `save`). Muestra estado "configurado ✓" leyendo `status`. NUNCA muestra el
secreto guardado (solo permite re-introducirlo para cambiarlo).

## 5. Modelo de datos

- **Sin tablas nuevas.** Reutiliza `account_connector` (ya existe) + Vault (ya existe).
- **1 columna nueva propuesta:** `account_connector.config jsonb` (campos no sensibles).
  Decisión a confirmar (§4.3). Si se aprueba: ALTER TABLE transaccional + regenerar tipos.
- `account_connector.credentials_ref` (ya existe): pasa a guardar el uuid del secreto Vault.

## 6. Plan de construcción (cerrar bien, una pieza cada vez)

- **D2.1 — (si se aprueba) columna `config jsonb`** en account_connector + regenerar tipos.
- **D2.2 — Edge Function `connector-credentials`** (save/status/clear) con las funciones
  Vault (`create_secret`/`update_secret`), restringida a service_role. Probar desde la app.
- **D2.3 — `ConnectorDetailPage`** (formulario dinámico) + enganche desde el Marketplace +
  consumo de la Edge Function. Cierra el módulo de Integraciones.
- **(Futuro, con Glovo) G1** lee el secreto de Vault server-side para verificar el token.

## 7. Decisiones abiertas

- **DD1:** ¿un secreto por conexión (JSON) o uno por campo? (Rec: JSON por conexión.)
- **DD2:** ¿columna `config jsonb` nueva o reaprovechar? (Rec: nueva, limpio.)
- **DD3:** la Edge Function `connector-credentials`, ¿genérica para todos los conectores
  o una por conector? (Rec: **genérica** — recibe el connector code y actúa según su
  config_schema. Una sola pieza para Glovo/Catcher/futuros. Más sólido.)
- **DD4:** ¿gating de quién puede guardar credenciales? (Rec: manager/admin de la cuenta,
  validado en la Edge Function leyendo el rol — no solo en el front.)

---

*Documento vivo. Al aprobar, versionar en `docs/` y referenciar en CONTEXTO.
Construible HOY (infra propia, no depende de Glovo). Es el cimiento de la pantalla de
configuración y del uso de credenciales en G1. Verificar esquema real antes de la
columna nueva. Edge Function: NUNCA INSERT crudo en vault.secrets (usar create_secret);
solo service_role; el secreto nunca vuelve al front.*
