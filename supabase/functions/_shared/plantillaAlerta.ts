// supabase/functions/_shared/plantillaAlerta.ts
//
// LA PLANTILLA ÚNICA de los correos de alerta (paso 4 del estándar, 09/09).
//
// ── POR QUÉ ESTÁ AQUÍ Y NO DENTRO DE LA EDGE ─────────────────────────────
// Vive en `_shared` por dos razones, y la segunda es la que importa:
//  1. Es «UNA plantilla» de verdad, no una función suelta dentro del correo.
//  2. `system-alert/index.ts` llama a `Deno.serve` nada más importarse, así que
//     desde un test no se puede importar sin levantar un servidor. Sacando la
//     composición aquí, el ensayo puede correr las cifras y los asuntos REALES
//     por la plantilla sin arrancar nada.
//
// ── LO QUE COMPONE, Y DE DÓNDE SALE ──────────────────────────────────────
// De los CAMPOS (`account_id`, `location_id`, `brand_id`, `severity`), que el
// drenaje convierte en nombres antes de llamar. Ningún vigía vuelve a escribir
// su propio «[Negocio · Local]»: lo pone esto, igual para todos, o no lo pone
// nadie.
//
// ⚠️ DEUDA DE `_shared`: el despliegue lo excluye por nombre y cada función se
// lleva su copia dentro del paquete, así que tocar este fichero NO redespliega
// a quien lo usa. Al cambiarlo hay que tocar también `system-alert`.

/** Los cuatro escalones. `null` = el vigía aún no la declara (ver más abajo). */
export type Severidad = "critico" | "alto" | "aviso" | "info";

// Sobrio a propósito (§5 del estándar: «nada de rojo por un aviso menor»).
export const PINTA: Record<Severidad, { etiqueta: string; color: string }> = {
  critico: { etiqueta: "CRÍTICO", color: "#b42318" },
  alto:    { etiqueta: "Alto",    color: "#b54708" },
  aviso:   { etiqueta: "Aviso",   color: "#475467" },
  info:    { etiqueta: "Info",    color: "#98a2b3" },
};

export function severidadDe(v: unknown): { sev: Severidad; declarada: boolean } {
  if (v === "critico" || v === "alto" || v === "aviso" || v === "info") {
    return { sev: v, declarada: true };
  }
  // NULL NO ES «poco importante». Los 16 vigías viejos aún no la declaran, y
  // tratar «no lo sé» como bajo los silenciaría a todos de golpe sin que nadie
  // se entere. Se trata como ALTO y el pie dice que no está declarada, para
  // que se vea cuáles faltan por migrar en vez de esconderlo.
  return { sev: "alto", declarada: false };
}

/**
 * `[Negocio · Local] QUÉ pasa`.
 *
 * El asunto es la única línea que alguien lee de un vistazo, así que el
 * prefijo NUNCA se recorta: si hay que cortar, se corta la cola. Y se corta
 * con «…», que se ve, en vez de dejar una frase que parece entera y no lo es.
 */
export function componerAsunto(qué: string, negocio?: string | null, local?: string | null): string {
  const partes = [negocio, local].filter((x): x is string => !!x && x.trim().length > 0);
  const prefijo = partes.length > 0 ? `[${partes.join(" · ")}] ` : "[Folvy] ";
  const TOPE = 78;
  const sitio = TOPE - prefijo.length;
  const cola = qué.length > sitio && sitio > 12 ? qué.slice(0, sitio - 1).trimEnd() + "…" : qué;
  return prefijo + cola;
}

export function fechaMadrid(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return String(iso);
  // Los timestamps de la base están en UTC y se leen en Madrid (regla 4).
  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function escapa(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Origen visible en el pie del correo — derivado de `kind`, nunca fijo.
// Antes decía "vigilante de ingesta (Folvy)" en TODOS los avisos, incluidos
// los del vigía de salud de BBDD (kind='db-health*'), que es un sistema
// distinto — en una alerta real de madrugada ese pie manda a mirar donde no
// es. Lista cerrada de kinds conocidos (11/08); el fallback nunca afirma un
// origen que no se puede verificar, muestra el kind crudo en su lugar.
export function originFor(kind: string): string {
  if (kind.startsWith("db-health")) return "vigía de salud de BBDD (Folvy)";
  if (kind === "synthetic_ping") return "vigilante de ingesta — ping sintético (Folvy)";
  if (kind === "catcher-delivery") return "Catcher — entregas de pedidos (Folvy)";
  if (kind === "hubrise-callback") return "HubRise — callback de disponibilidad (Folvy)";
  if (kind === "hubrise-connection-health") return "HubRise — salud de token por conexión (Folvy)";
  if (kind === "hubrise-revoke-pending") return "HubRise — revocación de token pendiente (Folvy)";
  if (kind === "availability-dispatch" || kind === "location-status-dispatch" || kind === "brand-closure") {
    return "vigía de disponibilidad HubRise (Folvy)";
  }
  // B61 (04/09). El pie decía «kind sin mapear» en 6 de los 8 tipos que de
  // verdad se usan — 80 de los 89 avisos encolados, incluidos los 34 de
  // ingesta_silencio. Un aviso que se ve a medio hacer se acaba ignorando, y
  // entonces el vigía deja de servir aunque funcione.
  if (kind === "edge_drift") return "vigía de deriva de Edge Functions (Folvy)";
  if (kind === "ingesta_silencio") return "vigía de silencio de ingesta (Folvy)";
  if (kind === "venta_producto_sin_casar") return "vigía de ventas sin casar (Folvy)";
  if (kind === "kds_device_silencio") return "vigía de tablets mudas (Folvy)";
  if (kind === "kds_device_desfasado") return "vigía de bundle desfasado en tablet (Folvy)";
  if (kind === "autoinventario") return "autoinventario — cola de conteos (Folvy)";
  if (kind === "cost_sweep") return "barrido nocturno de costes de línea (Folvy)";
  if (kind === "impresora_muda") return "vigía de impresoras (Folvy)";
  // El fallback se queda: nunca afirma un origen que no se puede verificar.
  // Que salga es la señal de que hay un vigía nuevo sin dar de alta aquí.
  return `Folvy — kind sin mapear: "${kind}"`;
}


export interface CamposDelAviso {
  subject: string;
  message: string;
  kind?: string;
  severity?: string | null;
  negocio?: string | null;
  local?: string | null;
  marca?: string | null;
  alerta_id?: number | null;
  creado_at?: string | null;
}

export interface CorreoCompuesto {
  asunto: string;
  text: string;
  html: string;
}

/** El correo entero, desde los campos. Es el único sitio donde se decide su forma. */
export function componerCorreo(body: CamposDelAviso): CorreoCompuesto {
  const kind = (body.kind ?? "system").trim();
  const message = body.message;
  const subject = body.subject;
  const { sev, declarada } = severidadDe(body.severity);
  const pinta = PINTA[sev];

  // ── EL ASUNTO, COMPUESTO ────────────────────────────────────────────────
  const asunto = componerAsunto(subject, body.negocio, body.local);

  // ── EL PIE, IGUAL PARA TODOS ────────────────────────────────────────────
  // Primero el DÓNDE, que es lo que faltaba en 74 de 76 avisos. Después lo
  // técnico. La severidad sin declarar se dice, no se disimula.
  const donde = [body.negocio, body.local, body.marca]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(" · ");
  const tecnico = [
    kind,
    fechaMadrid(body.creado_at),
    originFor(kind),
    body.alerta_id ? `aviso #${body.alerta_id}` : null,
  ].filter(Boolean).join(" · ");
  const linea_sev = declarada
    ? pinta.etiqueta
    : `${pinta.etiqueta} (severidad sin declarar por el vigía)`;

  const text =
    `${message}\n\n` +
    `— — —\n` +
    (donde ? `${donde}\n` : `Sin local: este aviso no es de un local concreto.\n`) +
    `${linea_sev}\n` +
    `${tecnico}`;

  // El HTML es el que se lee; el texto queda de reserva para clientes que no lo
  // pinten. Sobrio a propósito: sin imágenes, sin logos, sin colores de fondo.
  // Lo único que colorea es la barra de la izquierda, por severidad.
  const html =
    `<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#101828;max-width:600px">` +
    `<div style="border-left:3px solid ${pinta.color};padding-left:12px">` +
    `<div style="font-weight:600;margin-bottom:8px">${escapa(asunto)}</div>` +
    `<div style="white-space:pre-wrap">${escapa(message)}</div>` +
    `</div>` +
    `<div style="margin-top:20px;padding-top:10px;border-top:1px solid #eaecf0;color:#667085;font-size:12px">` +
    (donde
      ? `<div>${escapa(donde)}</div>`
      : `<div>Sin local: este aviso no es de un local concreto.</div>`) +
    `<div>${escapa(linea_sev)}</div>` +
    `<div style="color:#98a2b3">${escapa(tecnico)}</div>` +
    `</div></div>`;

  return { asunto, text, html };
}
