// supabase/functions/conta-revolut-leer/index.ts
//
// B01 Revolut · PR 1 · LA LECTURA DE CADA HORA, de respaldo del aviso. La
// despierta el cron conta-revolut-despertar (x-cron-secret = CRON_SECRET, sin
// sesión; verify_jwt = false). Por cada empresa con Revolut conectado:
//   1. la puerta (DM1): una cuenta de demostración no llama a Revolut;
//   2. leerEmpresa (_shared/revolut/servidor.ts): token nuevo con el de
//      renovación del Vault, cuentas en euros emparejadas por IBAN con su banco,
//      y lo TERMINADO hasta HOY (respuesta 3) por bank_importar, solo lo que
//      no estaba. Si Revolut ya no acepta el permiso, la conexión queda
//      «retirada» y Bancos lo dice.
// Devuelve el parte (por cuenta: los cuatro últimos, leídos, nuevos,
// repetidos y continuidad). Si alguna falla, responde 500: no calla.

import { createClient } from "npm:@supabase/supabase-js@2";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { COLUMNAS_CONEXION, leerEmpresa, paraElRegistro, type ConexionRevolut, type ParteEmpresa } from "../_shared/revolut/servidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const secreto = Deno.env.get("CRON_SECRET") ?? "";
  if (!secreto || req.headers.get("x-cron-secret") !== secreto) return json({ error: "secreto" }, 401);
  let empresa: string | null = null;
  try { const b = await req.json() as Record<string, unknown>; if (typeof b.empresa === "string") empresa = b.empresa; } catch { /* vacío */ }

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  let q = srv.from("revolut_conexion").select(COLUMNAS_CONEXION).eq("estado", "conectada");
  if (empresa) q = q.eq("company_id", empresa);
  const { data, error } = await q;
  if (error) return json({ error: `No se han podido leer las conexiones: ${error.message}` }, 500);

  const partes: (ParteEmpresa | { empresa: string; demo: true })[] = [];
  for (const c of (data ?? []) as ConexionRevolut[]) {
    if (!(await cuentaPuedeSalir(srv, c.account_id))) { partes.push({ empresa: c.company_id, demo: true }); continue; }
    partes.push(await leerEmpresa(srv, fetch, c));
  }
  const malas = partes.filter((p): p is ParteEmpresa => !("demo" in p) && (!!p.error || p.cuentas.some((x) => x.estado === "fallo")));
  console.log(`[conta-revolut-leer] ${JSON.stringify(partes.map((p) => ("demo" in p ? { empresa: p.empresa.slice(0, 8), demo: true } : paraElRegistro(p))))}`);
  return json({ partes: partes.map((p) => ("demo" in p ? p : paraElRegistro(p))) }, malas.length ? 500 : 200);
});
