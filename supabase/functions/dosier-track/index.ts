// supabase/functions/dosier-track/index.ts
//
// Seguimiento de visitas del dosier comercial (dosier.folvy.app).
// POST  -> apunta una visita (open | ping | pdf). Siempre 204, también ante error.
// GET ?panel=1 -> datos del panel, protegido por cabecera x-panel-key.
//
// Sin cookies ni IP guardada: el dispositivo se distingue por
// visitor_hash = sha256(ip|user-agent|DOSIER_SALT). DOSIER_SALT no se cambia nunca.
//
// Se despliega con verify_jwt = false (lo llama un visitante anónimo).
//
// Secrets: DOSIER_SALT, DOSIER_PANEL_KEY, RESEND_API_KEY (ya existe),
//          SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (automáticos).

import { createClient } from "@supabase/supabase-js";

const ORIGIN = "https://dosier.folvy.app";
const PANEL_URL = `${ORIGIN}/panel`;
const FROM = "Folvy <no-reply@folvy.app>";
const TO = "hello@folvy.app";
const MAX_FILAS_24H = 200;
const MAX_CORREOS_DIA = 20;

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-panel-key",
};

const BOT_RE =
  /bot|crawl|spider|preview|facebookexternalhit|slack|headlesschrome|telegram|discord|linkedin|twitter|skype|curl|wget|python-requests|lighthouse|pingdom|uptime|monitor/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const noContent = (): Response => new Response(null, { status: 204, headers: cors });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación en tiempo constante: se comparan los digests (longitud fija).
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

function dispositivoDe(ua: string): string {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "movil";
  return "ordenador";
}

function navegadorDe(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/samsungbrowser/i.test(ua)) return "Samsung";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Otro";
}

function hostDe(ref: string): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).host.slice(0, 120) || null;
  } catch {
    return null;
  }
}

function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}

function textoCorto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function seccionesDe(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = textoCorto(x, 60);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 40) break;
  }
  return out;
}

function madrid(d: Date): string {
  return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "short" });
}

async function avisar(
  sid: string,
  n: number,
  dispositivo: string,
  navegador: string,
  origen: string | null,
): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error("dosier-track: falta RESEND_API_KEY");
      return;
    }
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supabase
      .from("dosier_visita")
      .select("sid", { count: "exact", head: true })
      .gte("avisado_at", desde);
    if ((count ?? 0) >= MAX_CORREOS_DIA) return;

    const text =
      `Un dispositivo nuevo ha abierto el dosier.\n\n` +
      `Cuándo: ${madrid(new Date())}\n` +
      `Dispositivo: ${dispositivo} · ${navegador}\n` +
      `Origen: ${origen ?? "enlace directo"}\n\n` +
      `Panel: ${PANEL_URL}\n`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `Dosier: lo ha abierto un dispositivo nuevo (n.º ${n})`,
        text,
      }),
    });
    if (!res.ok) {
      console.error("dosier-track: Resend falló", res.status, await res.text());
      return;
    }
    await supabase.from("dosier_visita").update({ avisado_at: new Date().toISOString() }).eq("sid", sid);
  } catch (e) {
    console.error("dosier-track: error al avisar", String(e));
  }
}

async function apuntar(req: Request): Promise<void> {
  const ua = req.headers.get("user-agent") ?? "";
  // WhatsApp solo cuenta como robot si el UA EMPIEZA por "WhatsApp/" (vista previa del enlace).
  if (!ua || BOT_RE.test(ua) || ua.startsWith("WhatsApp/")) return;

  let b: Record<string, unknown>;
  try {
    b = JSON.parse(await req.text());
  } catch {
    return;
  }
  if (!b || typeof b !== "object") return;

  const t = b.t;
  if (t !== "open" && t !== "ping" && t !== "pdf") return;
  const sid = typeof b.sid === "string" ? b.sid.toLowerCase() : "";
  if (!UUID_RE.test(sid)) return;

  const salt = Deno.env.get("DOSIER_SALT") ?? "";
  if (!salt) {
    console.error("dosier-track: falta DOSIER_SALT");
    return;
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const visitorHash = await sha256Hex(`${ip}|${ua}|${salt}`);

  // Tope anti-abuso por huella
  const hace24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: filas24h } = await supabase
    .from("dosier_visita")
    .select("sid", { count: "exact", head: true })
    .eq("visitor_hash", visitorHash)
    .gte("created_at", hace24h);
  if ((filas24h ?? 0) > MAX_FILAS_24H) return;

  const scroll = entero(b.s, 0, 100);
  const segundos = entero(b.secs, 0, 14400);
  const secciones = seccionesDe(b.secc);
  const ancho = entero(b.w, 0, 20000);

  const { data: existente, error: errSel } = await supabase
    .from("dosier_visita")
    .select("sid, scroll_max, segundos, secciones, pdf")
    .eq("sid", sid)
    .maybeSingle();
  if (errSel) throw errSel;

  if (existente) {
    if (t === "open") return; // reintento de un open ya registrado
    const union = [...new Set([...(existente.secciones ?? []), ...secciones])].slice(0, 40);
    const { error } = await supabase
      .from("dosier_visita")
      .update({
        scroll_max: Math.max(existente.scroll_max ?? 0, scroll ?? 0),
        segundos: Math.max(existente.segundos ?? 0, segundos ?? 0),
        secciones: union,
        pdf: existente.pdf || t === "pdf",
        updated_at: new Date().toISOString(),
      })
      .eq("sid", sid);
    if (error) throw error;
    return;
  }

  // No existe: open, o ping/pdf cuyo open se perdió -> se inserta como open.
  const { count: previas } = await supabase
    .from("dosier_visita")
    .select("sid", { count: "exact", head: true })
    .eq("visitor_hash", visitorHash);
  const esNuevo = (previas ?? 0) === 0;

  const dispositivo = dispositivoDe(ua);
  const navegador = navegadorDe(ua);
  const origen = hostDe(textoCorto(b.ref, 300));

  const { error: errIns } = await supabase.from("dosier_visita").insert({
    sid,
    visitor_hash: visitorHash,
    es_nuevo: esNuevo,
    dispositivo,
    navegador,
    origen,
    src: textoCorto(b.src, 60) || null,
    ancho,
    scroll_max: scroll ?? 0,
    segundos: segundos ?? 0,
    secciones,
    pdf: t === "pdf",
  });
  if (errIns) {
    if (errIns.code === "23505") return; // carrera: otro request insertó el mismo sid
    throw errIns;
  }

  if (esNuevo) {
    const { data: hashes } = await supabase.from("dosier_visita").select("visitor_hash").limit(50000);
    const n = new Set((hashes ?? []).map((r: { visitor_hash: string }) => r.visitor_hash)).size;
    await avisar(sid, n, dispositivo, navegador, origen);
  }
}

async function panel(req: Request): Promise<Response> {
  const clave = Deno.env.get("DOSIER_PANEL_KEY") ?? "";
  const got = req.headers.get("x-panel-key") ?? "";
  const headers = { ...cors, "Content-Type": "application/json" };
  if (!clave || !(await safeEqual(got, clave))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const { data, error } = await supabase
    .from("dosier_visita")
    .select("created_at, visitor_hash, es_nuevo, dispositivo, navegador, origen, scroll_max, segundos, secciones, pdf")
    .order("created_at", { ascending: false })
    .limit(50000);
  if (error) {
    console.error("dosier-track: panel", error.message);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers });
  }
  const filas = data ?? [];

  const largas = filas.filter((f) => (f.segundos ?? 0) > 5);
  const segundosMedia = largas.length
    ? Math.round(largas.reduce((a, f) => a + (f.segundos ?? 0), 0) / largas.length)
    : 0;

  const porTitulo = new Map<string, number>();
  for (const f of filas) {
    for (const s of new Set<string>(f.secciones ?? [])) porTitulo.set(s, (porTitulo.get(s) ?? 0) + 1);
  }

  const body = {
    visitas: filas.length,
    dispositivos: new Set(filas.map((f) => f.visitor_hash)).size,
    segundos_media: segundosMedia,
    pdf: filas.filter((f) => f.pdf).length,
    secciones: [...porTitulo.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([titulo, n]) => ({ titulo, n })),
    ultimas: filas.slice(0, 100).map((f) => ({
      cuando: f.created_at,
      dispositivo: `${f.dispositivo ?? "?"} · ${f.navegador ?? "?"}`,
      segundos: f.segundos ?? 0,
      scroll: f.scroll_max ?? 0,
      origen: f.origen ?? "directo",
      nuevo: f.es_nuevo,
      pdf: f.pdf,
    })),
  };
  return new Response(JSON.stringify(body), { status: 200, headers });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("panel") !== "1") return noContent();
    try {
      return await panel(req);
    } catch (e) {
      console.error("dosier-track: panel", String(e));
      return new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  }

  if (req.method === "POST") {
    try {
      await apuntar(req);
    } catch (e) {
      console.error("dosier-track: apuntar", String(e));
    }
  }
  return noContent();
});
