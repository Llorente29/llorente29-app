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

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";
import { proveedorOpenBankingIo, sincronizarEmpresa, type BaseAgregador, type ParteCuenta } from "../_shared/bancoAgregador.ts";

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
  };
}

interface Conexion { id: string; account_id: string; company_id: string; provider: string; bank_name: string; secret_name: string; renew_url: string | null }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const secreto = Deno.env.get("CRON_SECRET") ?? "";
  if (!secreto || req.headers.get("x-cron-secret") !== secreto) return json({ error: "secreto" }, 401);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const ahora = new Date();
  const hoy = diaMadrid(ahora);
  const ayer = diaMadrid(new Date(ahora.getTime() - 24 * 3600 * 1000));

  const { data: filas, error } = await srv.from("bank_aggregator_connection")
    .select("id, account_id, company_id, provider, bank_name, secret_name, renew_url").eq("enabled", true);
  if (error) return json({ error: `No se han podido leer las conexiones: ${error.message}` }, 500);

  const partes: { empresa: string; banco: string; cuentas: ParteCuenta[]; error: string | null }[] = [];
  for (const c of (filas ?? []) as Conexion[]) {
    let cuentas: ParteCuenta[] = [], fallo: string | null = null;
    try {
      if (c.provider !== "open-banking-io") throw new Error(`No sé hablar con el proveedor «${c.provider}».`);
      const credenciales = Deno.env.get(c.secret_name);
      if (!credenciales) throw new Error(`Falta el secreto ${c.secret_name} en las funciones de Supabase: sin él no se puede abrir la conexión.`);
      const cliente = OpenBankingClient.fromCredentials(credenciales);
      cuentas = await sincronizarEmpresa(baseDe(srv), proveedorOpenBankingIo(cliente, hoy),
        { accountId: c.account_id, companyId: c.company_id, banco: c.bank_name, renovar: c.renew_url }, hoy, ayer);
    } catch (e) {
      fallo = e instanceof Error ? e.message : String(e);
    }
    const { error: e2 } = await srv.rpc("bank_agregador_conexion_apuntar", { p_conexion: c.id, p_error: fallo });
    if (e2) fallo = `${fallo ?? "Todo bien"} (y no se ha podido apuntar la pasada: ${e2.message})`;
    partes.push({ empresa: c.company_id, banco: c.bank_name, cuentas, error: fallo });
  }
  const mal = partes.some((p) => p.error || p.cuentas.some((x) => x.estado === "fallo"));
  console.log(`[conta-banco-agregador] ${hoy}: ${JSON.stringify(partes.map((p) => ({ banco: p.banco, error: p.error,
    cuentas: p.cuentas.map((x) => ({ iban4: x.iban4, estado: x.estado, leidos: x.leidos, nuevos: x.nuevos, repetidos: x.repetidos, continuidad: x.continuidad })) })))}`);
  return json({ hoy, ayer, partes }, mal ? 500 : 200);
});
