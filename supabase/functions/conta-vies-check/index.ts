// supabase/functions/conta-vies-check/index.ts
//
// C01 · Comprobar el NIF-IVA europeo de un proveedor en VIES.
//
// Encargo C01 §5.3: «consulta a VIES desde una función del servidor, nunca
// desde el navegador. Si VIES no responde, se guarda como pendiente de
// comprobar y se reintenta; no bloquea la ficha.»
//
// ── QUÉ HACE ───────────────────────────────────────────────────────────────
// Recibe { supplier_id }. Lee el proveedor CON EL JWT DE QUIEN LLAMA (la RLS
// decide si puede verlo), pregunta a VIES y apunta el resultado en el mismo
// proveedor, también con su JWT (la RLS de UPDATE exige admin o encargado de
// esa cuenta):
//   · válido   → tax_id_check_status = 'valid',   tax_id_verified_at = ahora
//   · inválido → tax_id_check_status = 'invalid', tax_id_verified_at = null
//   · VIES no contesta, o contesta con error de servicio → 'pending'.
//     La ficha dice «Comprobando con la UE…» y vuelve a pedirlo al abrirse.
// En los tres casos, tax_id_checked_at = ahora.
//
// No usa la clave de servicio: no hace nada que la persona no pudiera hacer.
//
// ── VIES ───────────────────────────────────────────────────────────────────
// API REST pública de la Comisión Europea, sin clave:
//   POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number
//   { countryCode, vatNumber } → { valid, name, address, ... }
// Grecia va como «EL» (no «GR»), igual que en el núcleo (src/modules/conta/lib/vatEu.ts).
//
// verify_jwt = true (declarado en config.toml): sin sesión no hay nada que hacer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const ESPERA_MS = 8000;

// Errores de VIES que significan «ahora no puedo», no «ese número no existe».
const VIES_NO_DISPONIBLE = new Set([
  "SERVICE_UNAVAILABLE", "MS_UNAVAILABLE", "TIMEOUT", "SERVER_BUSY",
  "GLOBAL_MAX_CONCURRENT_REQ", "MS_MAX_CONCURRENT_REQ",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Estado = "valid" | "invalid" | "pending";

async function preguntarVies(pais: string, numero: string): Promise<{ estado: Estado; nombre: string | null; direccion: string | null; motivo?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const r = await fetch(VIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: pais, vatNumber: numero }),
      signal: ctl.signal,
    });
    const cuerpo = await r.json().catch(() => ({})) as Record<string, unknown>;
    const error = typeof cuerpo.userError === "string" ? cuerpo.userError : null;
    if (!r.ok || (error && VIES_NO_DISPONIBLE.has(error))) {
      return { estado: "pending", nombre: null, direccion: null, motivo: error ?? `HTTP ${r.status}` };
    }
    const limpio = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.trim() !== "---" ? v.trim() : null);
    return {
      estado: cuerpo.valid === true ? "valid" : "invalid",
      nombre: limpio(cuerpo.name),
      direccion: limpio(cuerpo.address),
    };
  } catch (e) {
    return { estado: "pending", nombre: null, direccion: null, motivo: e instanceof Error ? e.message : "sin respuesta" };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: "no autenticado" }, 401);

  let supplierId = "";
  try {
    const b = await req.json() as { supplier_id?: unknown };
    supplierId = typeof b.supplier_id === "string" ? b.supplier_id : "";
  } catch { /* cuerpo vacío o roto */ }
  if (!supplierId) return json({ error: "falta supplier_id" }, 400);

  const { data: s, error: e1 } = await sb
    .from("supplier")
    .select("id, tax_id, tax_id_type")
    .eq("id", supplierId)
    .maybeSingle();
  if (e1) return json({ error: e1.message }, 500);
  if (!s) return json({ error: "no encuentro ese proveedor" }, 404);
  if (s.tax_id_type !== "vat_eu" || !s.tax_id) {
    return json({ error: "ese proveedor no tiene un NIF-IVA europeo que comprobar" }, 400);
  }

  const limpio = String(s.tax_id).toUpperCase().replace(/[^A-Z0-9]/g, "");
  let pais = limpio.slice(0, 2);
  if (pais === "GR") pais = "EL";
  const numero = limpio.slice(2);

  const r = await preguntarVies(pais, numero);
  const ahora = new Date().toISOString();
  const { error: e2 } = await sb
    .from("supplier")
    .update({
      tax_id_check_status: r.estado,
      tax_id_checked_at: ahora,
      tax_id_verified_at: r.estado === "valid" ? ahora : null,
    })
    .eq("id", supplierId);
  if (e2) return json({ error: `no se pudo apuntar el resultado: ${e2.message}` }, 403);

  return json({ status: r.estado, name: r.nombre, address: r.direccion, motivo: r.motivo ?? null });
});
