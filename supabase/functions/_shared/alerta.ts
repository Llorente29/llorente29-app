// supabase/functions/_shared/alerta.ts
//
// LA ÚNICA PUERTA AL CORREO DE ALERTAS desde una edge function.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
// Hasta el 09/09 había DOS caminos al correo:
//
//   vigías SQL ──> _queue_system_alert ──> system_alert_queue ──> drenaje ──┐
//                                                                          ├──> system-alert ──> Resend
//   6 edge functions ──────────── fetch POST directo ────────────────────────┘
//
// Los avisos del segundo camino NO APARECÍAN EN NINGUNA TABLA. Ni en el
// recuento de 76 de la RECON, ni en ningún sitio donde se pudieran contar. La
// prueba estaba en la propia edge del correo: su `originFor()` mapea nueve
// `kind` que la cola no ha visto nunca — `synthetic_ping`, `catcher-delivery`,
// `hubrise-callback`, `impresora_muda`… El buzón recibía más de lo que se podía
// medir, así que «hemos bajado el ruido» no se podía ni afirmar ni desmentir.
//
// Y sin cola no hay antirruido: `ingestion-synthetic-ping` corre cada 10
// minutos, así que una ingesta rota son 6 correos a la hora, para siempre. Es
// el mismo fallo que le costó a `availability-watchdog` 96 correos en un día.
//
// ── LA RESERVA, Y POR QUÉ NO ES UNA PUERTA TRASERA ───────────────────────
// Si la RPC falla, esto cae al POST directo de siempre. No es dejar el agujero
// abierto: es que el único motivo realista de que la RPC falle es que la BASE
// no esté, y sin base tampoco corre el drenaje — un aviso encolado en ese
// momento no saldría nunca. La reserva es justo para el caso en que más falta
// hace. Se registra en el log con `ALERTA_POR_LA_RESERVA` para que se pueda
// contar cuántas veces pasa; si ese contador sube, es una avería en sí mismo.
//
// ── LO QUE ESTA PUERTA NO HACE ───────────────────────────────────────────
// No compone el asunto ni el cuerpo: eso es el paso 4 del estándar (plantilla
// única en el drenaje). Aquí lo siguen escribiendo los vigías, igual que los
// de SQL. Lo que sí hace es que TODO pase por la cola y lleve sus campos.
//
// ⚠️ DEUDA CONOCIDA DE `_shared`: el despliegue excluye `_shared` por nombre y
// cada función se lleva su copia dentro de su paquete, así que cambiar ESTE
// fichero NO redespliega a quien lo usa. Al tocarlo hay que tocar también, aunque
// sea un comentario, cada función que lo importa — o desplegarlas a mano.

/** Los cuatro escalones del estándar. `info` no interrumpe a nadie. */
export type Severidad = "critico" | "alto" | "aviso" | "info";

export interface Alerta {
  /** El `kind` de siempre: lo usa el pie del correo para decir de quién viene. */
  kind: string;
  subject: string;
  message: string;
  /**
   * Obligatoria a propósito. En la cola, `severity` NULL significa «no
   * declarada» y aguas abajo se trata como ALTO — que es lo correcto para los
   * 24 puntos de llamada viejos, pero es un valor por defecto, no una decisión.
   * Aquí se declara.
   */
  severity: Severidad;
  /** Sin clave no hay antirruido: el aviso sale cada vez que corra el vigía. */
  debounceKind?: string | null;
  /** Intervalo de Postgres, p.ej. '2 hours'. */
  debounceWindow?: string | null;
  accountId?: string | null;
  locationId?: string | null;
  brandId?: string | null;
}

export type ResultadoAlerta =
  | "encolada"        // ha entrado en la cola, con su id
  | "callada"         // el antirruido la ha suprimido: es lo que tiene que pasar
  | "por-la-reserva"  // la cola falló y se ha mandado por el camino directo
  | "perdida";        // ni cola ni reserva: no ha salido nada

// `PromiseLike` y no `Promise`: el cliente de Supabase no devuelve una promesa,
// devuelve un constructor de consultas que además es «thenable». Con `Promise`
// el tipo no encaja y `deno check` lo canta.
interface ClienteRpc {
  rpc: (
    nombre: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface Reserva {
  supabaseUrl: string;
  cronSecret: string;
}

/**
 * Encola un aviso. NUNCA lanza: un vigía que se cae por no poder avisar es peor
 * que el fallo del que venía a avisar, y `catcher-webhook` además no puede
 * devolver 500 (Catcher reintentaría y duplicaría estado).
 *
 * Devuelve QUÉ ha pasado, no `void`: quien llama puede registrar «callada por
 * antirruido» distinto de «perdida», que son cosas opuestas y hasta hoy se
 * veían igual desde fuera.
 */
export async function encolarAlerta(
  sb: ClienteRpc,
  a: Alerta,
  reserva?: Reserva,
): Promise<ResultadoAlerta> {
  try {
    const { data, error } = await sb.rpc("encolar_alerta", {
      p_kind: a.kind,
      p_subject: a.subject,
      p_message: a.message,
      p_debounce_kind: a.debounceKind ?? null,
      p_debounce_window: a.debounceWindow ?? null,
      p_account_id: a.accountId ?? null,
      p_location_id: a.locationId ?? null,
      p_brand_id: a.brandId ?? null,
      p_severity: a.severity,
    });
    if (!error) {
      // La RPC devuelve el id encolado, o NULL si el antirruido la ha callado.
      return data === null || data === undefined ? "callada" : "encolada";
    }
    console.error("ALERTA_COLA_FALLO", a.kind, error.message);
  } catch (e) {
    console.error("ALERTA_COLA_EXCEPCION", a.kind, String(e));
  }

  return await porLaReserva(a, reserva);
}

async function porLaReserva(a: Alerta, reserva?: Reserva): Promise<ResultadoAlerta> {
  if (!reserva?.cronSecret || !reserva?.supabaseUrl) {
    console.error("ALERTA_PERDIDA", a.kind, a.subject);
    return "perdida";
  }
  try {
    const res = await fetch(`${reserva.supabaseUrl}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": reserva.cronSecret },
      body: JSON.stringify({ subject: a.subject, message: a.message, kind: a.kind }),
    });
    if (!res.ok) {
      console.error("ALERTA_PERDIDA", a.kind, `reserva devolvio http ${res.status}`);
      return "perdida";
    }
    console.error("ALERTA_POR_LA_RESERVA", a.kind, a.subject);
    return "por-la-reserva";
  } catch (e) {
    console.error("ALERTA_PERDIDA", a.kind, String(e));
    return "perdida";
  }
}

/** Clave de antirruido con el día dentro. Para SUCESOS que se repiten. */
export function claveDelDia(...partes: (string | null | undefined)[]): string {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  return [...partes.filter(Boolean), hoy].join("_");
}
