// supabase/functions/conta-banco-agregador/index.ts
//
// B01c · LOS MOVIMIENTOS DEL BANCO ENTRAN SOLOS, cada noche, por la conexión
// directa de open-banking.io (sobre Enable Banking). Solo para las empresas
// que tienen su fila en bank_aggregator_connection: hoy, Foodint (las tres
// cuentas de BBVA de Llorente29 Food). No se ofrece a nadie más todavía.
//
// La despierta el cron conta-banco-agregador-despertar a las 03:00 de Madrid
// (cabecera x-cron-secret = CRON_SECRET, sin sesión). Por cada empresa:
//   1. Abre la conexión con el credentials.json de su secreto (el nombre está
//      en la fila: OPEN_BANKING_IO_CREDENTIALS para Foodint). El fichero trae
//      la clave de la API y la clave privada que descifra los datos: los datos
//      viajan cifrados y se descifran aquí, en memoria.
//   2. sincronizarEmpresa (_shared/bancoAgregador.ts): pide al banco lo nuevo,
//      empareja cada cuenta por IBAN, mete lo de hasta ayer por bank_importar
//      (lo que ya entró por Norma 43 se reconoce por la huella suave y no se
//      duplica) y apunta cómo ha ido en bank_aggregator_link, que es lo que
//      enseña Bancos: «Conectada con BBVA · actualizada hoy a las 03:00» o
//      «Caduca el permiso en 7 días · Renovar».
// Devuelve el parte entero (por cuenta: leídos, nuevos, repetidos, saldo del
// banco y continuidad). Si una empresa no se puede ni abrir (falta el secreto,
// la clave no vale), lo apunta en su fila y responde 500: no calla.
//
// verify_jwt = false (config.toml): el cron llama sin sesión; aquí se comprueba
// el secreto. Sin él, 401 y nada más.
//
// B01·14 (03/11) · MIRAR, sin importar nada: con el mismo secreto y el cuerpo
// {"mirar": {"desde": "AAAA-MM-DD", "hasta": "AAAA-MM-DD"}}, pide al banco lo
// nuevo (syncAll, lo mismo que cada noche) y devuelve, cuenta a cuenta, lo que
// da open-banking.io de esos días: con el filtro de fechas que usa la lectura y
// lo que sin filtro tiene alguna fecha en ellos. Sin conceptos ni nombres. No
// escribe nada en la base ni en Bancos: es para medir (los traspasos del 30/10).

import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";
import { ibanLimpio, mirarCuenta, proveedorOpenBankingIo, RELEER_DIAS_OBI, sincronizarEmpresa, type BaseAgregador, type ParteCuenta } from "../_shared/bancoAgregador.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** El día de Madrid de un instante, AAAA-MM-DD. */
const diaMadrid = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function baseDe(srv: SupabaseClient): BaseAgregador {
  const fallo = (que: string, e: { message: string }) => new Error(`${que}: ${e.message}`);
  return {
    async bancos(accountId, companyId) {
      const { data, error } = await srv.from("treasury_account").select("id, name, iban")
        .eq("account_id", accountId).eq("company_id", companyId).eq("kind", "bank").eq("is_active", true);
      if (error) throw fallo("No se han podido leer los bancos", error);
      return (data ?? []).map((t) => ({ id: String(t.id), nombre: String(t.name), iban: t.iban ? String(t.iban) : null }));
    },
    async extractos(treasuryId) {
      const { data, error } = await srv.from("bank_statement").select("source, period_from, period_to").eq("treasury_account_id", treasuryId);
      if (error) throw fallo("No se han podido leer los extractos", error);
      return (data ?? []).map((e) => ({ fuente: String(e.source), desde: String(e.period_from), hasta: String(e.period_to) }));
    },
    async importar(args) {
      const { data, error } = await srv.rpc("bank_importar", args);
      if (error) throw fallo("La base no lo ha dejado entrar", error);
      return (data ?? {}) as Record<string, unknown>;
    },
    async apuntar(args) {
      const { error } = await srv.rpc("bank_agregador_apuntar", args);
      if (error) throw fallo("No se ha podido apuntar cómo ha ido", error);
    },
    // Cola 1b · Lo que ya está en Folvy de los días que se releen (para no duplicar).
    async movimientosEnFolvy(treasuryId, desde, hasta) {
      const { data, error } = await srv.from("bank_movement").select("op_date, amount, reference_2")
        .eq("treasury_account_id", treasuryId).gte("op_date", desde).lte("op_date", hasta).limit(5000);
      if (error) throw fallo("No se ha podido mirar lo que ya estaba", error);
      return ((data ?? []) as { op_date: string; amount: number | string; reference_2: string | null }[])
        .map((m) => ({ fecha: String(m.op_date), importeCent: Math.round(Number(m.amount) * 100), ref2: m.reference_2 ?? null }));
    },
    // Cola 1b · El registro de cada lectura (pendientes y lo que llegó tarde). Sin la tabla (antes de la tanda), no para.
    async registrar(args) {
      const { error } = await srv.rpc("bank_agregador_lectura_apuntar", args);
      if (error && !/bank_agregador_lectura_apuntar|schema cache|does not exist/i.test(error.message)) throw fallo("No se ha podido apuntar la lectura", error);
    },
  };
}

interface Conexion { id: string; account_id: string; company_id: string; provider: string; bank_name: string; secret_name: string; renew_url: string | null }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const secreto = Deno.env.get("CRON_SECRET") ?? "";
  if (!secreto || req.headers.get("x-cron-secret") !== secreto) return json({ error: "secreto" }, 401);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const cuerpo = await req.json().catch(() => ({})) as { mirar?: { desde?: string; hasta?: string } };
  if (cuerpo?.mirar) return await mirar(srv, cuerpo.mirar);
  const ahora = new Date();
  const hoy = diaMadrid(ahora);
  const ayer = diaMadrid(new Date(ahora.getTime() - 24 * 3600 * 1000));

  const { data: filas, error } = await srv.from("bank_aggregator_connection")
    .select("id, account_id, company_id, provider, bank_name, secret_name, renew_url").eq("enabled", true);
  if (error) return json({ error: `No se han podido leer las conexiones: ${error.message}` }, 500);

  const partes: { empresa: string; banco: string; cuentas: ParteCuenta[]; error: string | null; refresco?: unknown }[] = [];
  const refrescos = new Map<string, { cuentas: number; nuevos: number } | null>();
  for (const c of (filas ?? []) as Conexion[]) {
    let cuentas: ParteCuenta[] = [], fallo: string | null = null;
    // DM1 · PR 2a · La puerta: una cuenta de demo no habla con ningún banco de verdad.
    if (!(await cuentaPuedeSalir(srv, c.account_id))) {
      partes.push({ empresa: c.company_id, banco: c.bank_name, cuentas, error: null });
      console.log(`[conta-banco-agregador] ${c.bank_name}: ${EN_LA_DEMO}`);
      continue;
    }
    try {
      if (c.provider !== "open-banking-io") throw new Error(`No sé hablar con el proveedor «${c.provider}».`);
      const credenciales = Deno.env.get(c.secret_name);
      if (!credenciales) throw new Error(`Falta el secreto ${c.secret_name} en las funciones de Supabase: sin él no se puede abrir la conexión.`);
      const cliente = OpenBankingClient.fromCredentials(credenciales);
      const proveedor = proveedorOpenBankingIo(cliente, hoy);
      cuentas = await sincronizarEmpresa(baseDe(srv), proveedor,
        { accountId: c.account_id, companyId: c.company_id, banco: c.bank_name, renovar: c.renew_url }, hoy, ayer,
        { releerDias: RELEER_DIAS_OBI });
      refrescos.set(c.id, proveedor.ultimoRefresco());
    } catch (e) {
      fallo = e instanceof Error ? e.message : String(e);
    }
    const { error: e2 } = await srv.rpc("bank_agregador_conexion_apuntar", { p_conexion: c.id, p_error: fallo });
    if (e2) fallo = `${fallo ?? "Todo bien"} (y no se ha podido apuntar la pasada: ${e2.message})`;
    partes.push({ empresa: c.company_id, banco: c.bank_name, cuentas, error: fallo, refresco: refrescos.get(c.id) ?? null });
  }
  const mal = partes.some((p) => p.error || p.cuentas.some((x) => x.estado === "fallo"));
  // B01·14 · También lo que trajo del banco al ponerse al día (syncAll) y lo que dio de los días releídos.
  console.log(`[conta-banco-agregador] ${hoy}: ${JSON.stringify(partes.map((p) => ({ banco: p.banco, error: p.error, refresco: p.refresco,
    cuentas: p.cuentas.map((x) => ({ iban4: x.iban4, estado: x.estado, leidos: x.leidos, nuevos: x.nuevos, repetidos: x.repetidos, continuidad: x.continuidad,
      pendientes: x.pendientes, tarde: x.tarde, releidoDesde: x.desdeReleido, releidosDelBanco: x.releidosDelBanco ?? null, releidosDelBancoCent: x.releidosDelBancoCent ?? null })) })))}`);
  return json({ hoy, ayer, partes }, mal ? 500 : 200);
});

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** B01·14 · Lo que da open-banking.io de unos días, cuenta a cuenta, sin importar nada. */
async function mirar(srv: SupabaseClient, m: { desde?: string; hasta?: string }): Promise<Response> {
  if (!m.desde || !m.hasta || !DIA.test(m.desde) || !DIA.test(m.hasta) || m.desde > m.hasta) {
    return json({ error: "mirar: hacen falta desde y hasta, AAAA-MM-DD, con desde ≤ hasta." }, 400);
  }
  const { data: filas, error } = await srv.from("bank_aggregator_connection")
    .select("id, account_id, company_id, provider, bank_name, secret_name, renew_url").eq("enabled", true);
  if (error) return json({ error: `No se han podido leer las conexiones: ${error.message}` }, 500);
  const out: unknown[] = [];
  for (const c of (filas ?? []) as Conexion[]) {
    if (c.provider !== "open-banking-io" || !(await cuentaPuedeSalir(srv, c.account_id))) continue;
    const credenciales = Deno.env.get(c.secret_name);
    if (!credenciales) { out.push({ banco: c.bank_name, error: `Falta el secreto ${c.secret_name}.` }); continue; }
    try {
      const cliente = OpenBankingClient.fromCredentials(credenciales);
      const r = await cliente.syncAll();
      const cuentas = [];
      for (const a of await cliente.getAccounts()) {
        const iban = ibanLimpio(a.iban);
        cuentas.push({ iban4: iban ? iban.slice(-4) : null, ...(await mirarCuenta(cliente, a.id, m.desde, m.hasta)) });
      }
      const conexiones = (await cliente.getConnections()).map((x) => ({ estado: x.status, viva: x.isLive, valeHasta: x.validUntil, ultimaPuestaAlDia: x.lastSyncedAt }));
      out.push({ banco: c.bank_name, refresco: { cuentas: r.accounts, nuevos: r.newTransactions, fallos: r.failures }, conexiones, cuentas });
    } catch (e) {
      out.push({ banco: c.bank_name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log(`[conta-banco-agregador] mirar ${m.desde}..${m.hasta}: ${out.length} conexiones`);
  return json({ mirar: m, conexiones: out });
}
