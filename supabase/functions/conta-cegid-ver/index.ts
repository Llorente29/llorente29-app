// supabase/functions/conta-cegid-ver/index.ts
//
// Q10 · respuesta 5 (26/11) · VER EN CEGID, SOLO LEER. Julio corrigió a mano la incidencia del cliente 9 en Cegid
// (descripción, tipo de IVA y total sin IVA) y así sale bien en el precálculo. Para saber qué campos de la API son esos,
// se lee la incidencia tal cual la devuelve la API (GET /api/Incidences/GetIncidence/{cliente}/{incidencia}), y la
// ficha de su cliente (GET /api/Customers/GetCustomer/{cliente}), para ver si sus conceptos fijos dicen hasta cuándo se
// facturan.
//   · { company_id, pares: «9/2 10/1» }: como mucho 5 pares cliente/incidencia.
// Solo con la clave de servicio, desde el workflow «Ver incidencias en Cegid» lanzado a mano desde main. No escribe
// nada: el cliente de _shared/diezRec.ts va sin `escribe`, así que solo sale el GET (y el POST del login).
// Devuelve la incidencia entera (no lleva nombre ni NIF del cliente) y, de la ficha, solo lo que no es personal
// (ver.ts). Lo entero, también de la ficha, queda en el registro de la función, que no es público.
// verify_jwt = false (config.toml): la puerta es la clave de servicio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { ClienteDiezRec, rutaCliente } from "../_shared/diezRec.ts";
import { revisarClave } from "../conta-bitrix-leer/clave.ts";
import { type Fila, fichaSinPersonales, leerPares } from "./ver.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const clave = revisarClave(req.headers.get("x-internal-key"), { antigua: SERVICIO ?? "", nuevas: Deno.env.get("SUPABASE_SECRET_KEYS") ?? "" });
  if (!clave.vale) return json({ error: `Solo se lanza desde su workflow, con la clave de servicio: ${clave.porque}.` }, 403);

  let b: Fila = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const pares = leerPares(b.pares);
  if (!companyId || !pares) return json({ error: "faltan company_id o los pares (cliente/incidencia, como mucho 5: «9/2 10/1»)" }, 400);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data: co } = await srv.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (!co) return json({ error: "No existe esa sociedad." }, 404);
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: "En la demo no se lee nada de Cegid.", demo: true }, 409);
  const { data: filas, error } = await srv.from("account_connector").select("id, scope, company_id, external_account_id, connector!inner(code)")
    .eq("account_id", co.account_id).eq("connector.code", "diezrec").in("scope", ["account", "company"]);
  if (error) return json({ error: `no se ha podido leer la conexión con Cegid: ${error.message}` }, 500);
  const xs = (filas ?? []) as Fila[];
  const cuenta = xs.find((x) => x.scope === "account");
  const empresa = String(xs.find((x) => x.scope === "company" && x.company_id === companyId)?.external_account_id ?? "").trim();
  if (!cuenta || !empresa) return json({ error: "Esta sociedad no está conectada con la facturación de Cegid." }, 409);
  const { data: s } = await srv.rpc("connector_secret_read", { p_account_connector_id: cuenta.id });
  const sec = ((s as { secrets?: Record<string, string> } | null)?.secrets ?? {}) as Record<string, string>;
  if (!sec.client_id || !sec.client_secret || !sec.username || !sec.password) return json({ error: "Faltan las claves de la facturación de Cegid." }, 409);
  // Sin `escribe`: solo lee.
  const api = new ClienteDiezRec({ claves: { client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password }, empresa,
    fetch: (url, init) => fetch(url, init) });

  try {
    const leidas = [];
    const fichas: Record<string, unknown> = {};
    for (const p of pares) {
      const r = await api.get(`/api/Incidences/GetIncidence/${p.cliente}/${p.incidencia}`);
      console.log(`[conta-cegid-ver] incidencia ${p.cliente}/${p.incidencia} (${r.status}): ${r.texto}`);
      leidas.push({ cliente: p.cliente, incidencia: p.incidencia, status: r.status, campos: r.status === 200 ? r.json : null });
      if (!(String(p.cliente) in fichas)) {
        const f = await api.get(rutaCliente(p.cliente));
        console.log(`[conta-cegid-ver] ficha ${p.cliente} (${f.status}): ${f.texto}`);
        fichas[String(p.cliente)] = f.status === 200 ? { status: 200, ...fichaSinPersonales(f.json) } : { status: f.status };
      }
    }
    return json({ ok: true, incidencias: leidas, fichas, frase: `Leídas de Cegid ${leidas.length} ${leidas.length === 1 ? "incidencia" : "incidencias"}. No se ha escrito nada.` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
