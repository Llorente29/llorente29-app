// supabase/functions/conta-revolut-aviso/index.ts
//
// B01 Revolut · PR 1 · EL AVISO DE REVOLUT (webhook v2: TransactionCreated y
// TransactionStateChanged). verify_jwt = false: llama Revolut, sin sesión.
//
// EL AVISO NO SE CREE (respuestas 1 y 2): solo dice «mira esta empresa». Lo que
// trae el cuerpo no entra en ninguna parte; la función lee lo de Revolut con
// su token, como la lectura de cada hora (leerEmpresa). Así un aviso falso no
// mete nada: como mucho adelanta una lectura, y para eso hay un freno (una
// por empresa cada 30 segundos).
//
// La empresa va en la dirección del aviso (?c=<conexión>), que Sumied registra
// al conectar. La firma (Revolut-Signature) se comprueba en el sandbox con el
// primer aviso y va al parte: hasta entonces no decide nada, por lo de arriba.
// Contesta 200 siempre que la petición tenga forma: Revolut no necesita saber
// cómo ha ido la lectura.

import { createClient } from "npm:@supabase/supabase-js@2";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { COLUMNAS_CONEXION, leerEmpresa, paraElRegistro, type ConexionRevolut } from "../_shared/revolut/servidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Una lectura por empresa cada tanto, como mucho (un aviso repetido o falso no la dispara otra vez). */
const SEGUNDOS_FRENO = 30;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const c = new URL(req.url).searchParams.get("c") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(c)) return json({ error: "sin conexión" }, 400);
  let evento = "";
  try { const b = await req.json() as Record<string, unknown>; evento = typeof b.event === "string" ? b.event.slice(0, 40) : ""; } catch { /* el cuerpo no cuenta */ }

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data } = await srv.from("revolut_conexion").select(COLUMNAS_CONEXION).eq("id", c).eq("estado", "conectada").maybeSingle();
  if (!data) return json({ ok: true, leida: false });
  const conexion = data as ConexionRevolut;
  if (conexion.last_run_at && Date.now() - Date.parse(conexion.last_run_at) < SEGUNDOS_FRENO * 1000) return json({ ok: true, leida: false, freno: true });
  if (!(await cuentaPuedeSalir(srv, conexion.account_id))) return json({ ok: true, leida: false, demo: true });

  const p = await leerEmpresa(srv, fetch, conexion);
  console.log(`[conta-revolut-aviso] ${evento || "aviso"} ${JSON.stringify(paraElRegistro(p))}`);
  return json({ ok: true, leida: true });
});
