// supabase/functions/conta-cegid-corregir/index.ts
//
// Q10 · respuesta 6 (26/11) · CORREGIR EN CEGID LAS INCIDENCIAS YA MANDADAS, por la API (PUT), sin borrarlas. Julio
// corrigió a mano la 9/2 y así sale bien en el precálculo; las demás se cambian igual, en los tres campos que dijo
// (run 45901138694 y su respuesta del 26/11):
//   · textoIncidencia: la descripción, en RTF, con el mismo formato que la 9/2;
//   · ivaConcepto: el tipo de IVA de Cegid de su porcentaje (21 % → «1», I.V.A. GENERAL). Con otro, para y lo dice;
//   · total: igual a la base (el importe sin IVA).
// fecha y serieFactura no se tocan. Una incidencia que ya está así (la 9/2) no se toca.
//   · { company_id, mes, pares: «33/2» }: solo esas (como mucho 5), que tienen que ser de las mandadas por Sumied.
//   · { company_id, mes, todas: true, max? }: las mandadas del mes aún sin corregir, como mucho `max` (40) por llamada;
//     el workflow vuelve a llamar hasta que no queda ninguna.
// Una a una: la lee (GET), la cambia (PUT) y la vuelve a leer para ver que Cegid ha guardado los tres campos. PARA en el
// primer fallo y dice cuál y por qué. Cada una queda apuntada en conta_cegid_incidencia (corregida_at y corregida_por);
// lo leído antes y después, en el registro de la función (que no es público).
// Escribe en Cegid solo incidencias (diezRec.ts con escribe: 'incidencias'). Solo con la clave de servicio, desde el
// workflow «Corregir incidencias en Cegid» lanzado a mano desde main. En una cuenta de demostración, nada (puerta.ts).
// verify_jwt = false (config.toml): la puerta es la clave de servicio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { ClienteDiezRec } from "../_shared/diezRec.ts";
import { corregirIncidencia, faltaTrasCorregir } from "../_shared/cegidMandar.ts";
import { revisarClave } from "../conta-bitrix-leer/clave.ts";
import { leerPares } from "../conta-cegid-ver/ver.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QUIEN = "conta-cegid-corregir (workflow)";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Fila = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const clave = revisarClave(req.headers.get("x-internal-key"), { antigua: SERVICIO ?? "", nuevas: Deno.env.get("SUPABASE_SECRET_KEYS") ?? "" });
  if (!clave.vale) return json({ error: `Solo se lanza desde su workflow, con la clave de servicio: ${clave.porque}.` }, 403);

  let b: Fila = {};
  try { b = await req.json(); } catch { /* vacío */ }
  const companyId = typeof b.company_id === "string" && /^[0-9a-f-]{36}$/i.test(b.company_id) ? b.company_id : "";
  const mes = typeof b.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.mes) ? b.mes : "";
  const todas = b.todas === true;
  const pares = b.pares == null || b.pares === "" ? null : leerPares(b.pares);
  const max = Math.min(Math.max(Math.trunc(Number(b.max ?? 40)) || 40, 1), 60);
  if (!companyId || !mes) return json({ error: "faltan company_id o el mes (AAAA-MM)" }, 400);
  if (todas === !!pares || (b.pares != null && b.pares !== "" && !pares)) return json({ error: "o los pares (cliente/incidencia, como mucho 5: «33/2»), o todas: true; una de las dos" }, 400);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data: co } = await srv.from("company").select("id, account_id").eq("id", companyId).maybeSingle();
  if (!co) return json({ error: "No existe esa sociedad." }, 404);
  if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ error: "En la demo no se escribe nada en Cegid.", demo: true }, 409);
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
  const api = new ClienteDiezRec({ claves: { client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password }, empresa,
    fetch: (url, init) => fetch(url, init), escribe: "incidencias" });

  // Lo mandado por Sumied este mes y aún sin facturar: solo eso se corrige.
  let q = srv.from("conta_cegid_incidencia").select("id, cliente, incidencia, base, corregida_at").eq("company_id", companyId).eq("account_id", co.account_id)
    .eq("mes", mes).eq("estado", "mandada").not("incidencia", "is", null).order("cliente").order("incidencia");
  if (todas) q = q.is("corregida_at", null);
  const { data: md, error: e1 } = await q;
  if (e1) return json({ error: `no se ha podido leer lo mandado a Cegid: ${e1.message}` }, 500);
  let cola = (md ?? []) as Fila[];
  if (pares) {
    const clave = new Map(cola.map((x) => [`${x.cliente}/${x.incidencia}`, x]));
    const fuera = pares.filter((p) => !clave.has(`${p.cliente}/${p.incidencia}`)).map((p) => `${p.cliente}/${p.incidencia}`);
    if (fuera.length) return json({ error: `No son incidencias de ${mes} mandadas por Sumied y sin facturar: ${fuera.join(", ")}. No se toca nada.` }, 409);
    cola = pares.map((p) => clave.get(`${p.cliente}/${p.incidencia}`)!);
  }
  const total = cola.length;
  cola = cola.slice(0, max);

  const corregidas: string[] = [], yaBien: string[] = [];
  let fallo: { incidencia: string; porque: string } | null = null;
  const apuntar = (id: unknown, quien: string) => srv.from("conta_cegid_incidencia").update({ corregida_at: new Date().toISOString(), corregida_por: quien }).eq("id", id);
  for (const v of cola) {
    const id = `${v.cliente}/${v.incidencia}`;
    try {
      const antes = await api.leerIncidencia(Number(v.cliente), Number(v.incidencia));
      console.log(`[conta-cegid-corregir] ${id} antes: ${JSON.stringify(antes)}`);
      if (!antes) { fallo = { incidencia: id, porque: `La ${id} ya no está en Cegid.` }; break; }
      const c = corregirIncidencia(antes, Number(v.base));
      if (c.que === "parar") { fallo = { incidencia: id, porque: c.porque }; break; }
      if (c.que === "ya_bien") {
        yaBien.push(id);
        if (todas) await apuntar(v.id, "ya estaba bien en Cegid: no se tocó");
        continue;
      }
      await api.modificarIncidencia(c.cuerpo);
      const despues = await api.leerIncidencia(Number(v.cliente), Number(v.incidencia));
      console.log(`[conta-cegid-corregir] ${id} después: ${JSON.stringify(despues)}`);
      const falta = despues ? faltaTrasCorregir(despues, c) : `La ${id} ya no está en Cegid después de cambiarla`;
      if (falta) { fallo = { incidencia: id, porque: `${falta} en la ${id}.` }; break; }
      const { error: e2 } = await apuntar(v.id, QUIEN);
      if (e2) { fallo = { incidencia: id, porque: `Corregida en Cegid, pero no se ha podido apuntar en Sumied: ${e2.message}` }; corregidas.push(id); break; }
      corregidas.push(id);
    } catch (e) {
      fallo = { incidencia: id, porque: e instanceof Error ? e.message : String(e) };
      break;
    }
  }
  const quedan = total - corregidas.length - yaBien.length;
  const frase = `Corregidas en Cegid ${corregidas.length} ${corregidas.length === 1 ? "incidencia" : "incidencias"}${corregidas.length ? ` (${corregidas.slice(0, 10).join(", ")}${corregidas.length > 10 ? "…" : ""})` : ""}`
    + `${yaBien.length ? `; ${yaBien.length} ya estaban bien y no se tocan (${yaBien.slice(0, 10).join(", ")})` : ""}`
    + `${fallo ? `. PARADO en la ${fallo.incidencia}: ${fallo.porque}` : ""}. Quedan ${quedan}.`;
  return json({ ok: !fallo, corregidas, ya_bien: yaBien, fallo, quedan, frase }, fallo ? 409 : 200);
});
