// supabase/functions/conta-cegid-mandar/banco.ts
//
// Q10 · respuesta 7 (27/11) · Lo cobrado por el banco y con tarjeta de un mes, como lo necesita el plan de
// _shared/cegidBanco.ts: cada cobro con sus recibos de GoCardless, el código de Cegid de su ficha (leído de la ficha,
// conta_cobro_cliente.codigo_cliente, como siempre) y la decisión de Julio. Y, de Cegid, solo leyendo, en qué meses
// tiene factura cada cliente (para la regla 1). Lo usan «banco_leer» y «mandar_banco».

import { claveTarjeta, type CobroBanco, type DecisionBanco } from "../_shared/cegidBanco.ts";
import { type ClienteDiezRec, FalloDiezRec, rutaFacturasCliente } from "../_shared/diezRec.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Srv = any;
type Fila = Record<string, unknown>;
const txt = (v: unknown) => (v == null ? null : String(v).trim() || null);
/** La fecha de Madrid (AAAA-MM-DD) de un momento. */
const fechaMadrid = (t: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

async function todas(q: () => Srv): Promise<Fila[]> {
  const r: Fila[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q().range(i, i + 999);
    if (error) throw new Error(error.message);
    r.push(...((data ?? []) as Fila[]));
    if ((data ?? []).length < 1000) return r;
  }
}

export async function cargarBanco(srv: Srv, companyId: string, accountId: string, mes: string): Promise<CobroBanco[]> {
  const inicio = `${mes}-01`;
  const bc = await todas(() => srv.from("conta_banco_cobro").select("movement_id, fecha, importe, via, estado, party_id")
    .eq("company_id", companyId).eq("account_id", accountId).eq("mes", inicio).neq("estado", "tarjeta").neq("estado", "no_es_cobro"));
  const movs = bc.map((x) => String(x.movement_id));
  const textos = new Map<string, string | null>();
  for (let i = 0; i < movs.length; i += 200) {
    const { data } = await srv.from("bank_movement").select("id, bank_concept").eq("account_id", accountId).in("id", movs.slice(i, i + 200));
    for (const m of (data ?? []) as Fila[]) textos.set(String(m.id), txt(m.bank_concept));
  }
  const { data: rr } = movs.length ? await srv.from("conta_banco_cobro_recibo").select("movement_id, gc_id, importe").eq("company_id", companyId).in("movement_id", movs) : { data: [] };
  const recibos = (rr ?? []) as Fila[];
  const gcIds = [...new Set(recibos.map((x) => String(x.gc_id)))];
  const { data: gg } = gcIds.length ? await srv.from("conta_gc_cobro").select("gc_id, fecha, suscripcion_gc_id, descripcion").eq("company_id", companyId).in("gc_id", gcIds) : { data: [] };
  const gc = new Map(((gg ?? []) as Fila[]).map((x) => [String(x.gc_id), x]));
  const subs = [...new Set([...gc.values()].map((x) => txt(x.suscripcion_gc_id)).filter((x): x is string => !!x))];
  const { data: ss } = subs.length ? await srv.from("conta_gc_suscripcion").select("gc_id, nombre").eq("company_id", companyId).in("gc_id", subs) : { data: [] };
  const sus = new Map(((ss ?? []) as Fila[]).map((x) => [String(x.gc_id), txt(x.nombre)]));
  const { data: el } = await srv.from("conta_cegid_concepto_elegido").select("que, gc_id, concepto").eq("company_id", companyId).in("gc_id", [...gcIds, ...subs]);
  const elegido = new Map(((el ?? []) as Fila[]).map((x) => [`${x.que}:${x.gc_id}`, String(x.concepto)]));

  // Tarjeta (K14c): los pagos uno a uno, con su abono. Sin la tabla, ninguno.
  let tarjeta: Fila[] = [];
  const t = await srv.from("conta_banco_cobro_tarjeta").select("pagado_en, importe, movement_id, estado, etapa, falta, party_id, cegid_codigo, porque")
    .eq("company_id", companyId).eq("account_id", accountId);
  if (!t.error) tarjeta = ((t.data ?? []) as Fila[]).filter((x) => fechaMadrid(String(x.pagado_en)).slice(0, 7) === mes);

  const partes = [...new Set([...bc, ...tarjeta].map((x) => txt(x.party_id)).filter((x): x is string => !!x))];
  const codigo = new Map<string, number>();
  for (let i = 0; i < partes.length; i += 200) {
    const { data } = await srv.from("conta_cobro_cliente").select("party_id, codigo_cliente").eq("company_id", companyId).in("party_id", partes.slice(i, i + 200)).not("codigo_cliente", "is", null);
    for (const x of (data ?? []) as Fila[]) codigo.set(String(x.party_id), Number(x.codigo_cliente));
  }
  const { data: dd } = await srv.from("conta_banco_decision").select("clave, decision, concepto, cliente, texto, factura, quien, at").eq("company_id", companyId);
  const decision = new Map(((dd ?? []) as Fila[]).map((x) => [String(x.clave), {
    decision: x.decision, concepto: txt(x.concepto), cliente: x.cliente == null ? null : Number(x.cliente), texto: txt(x.texto), factura: txt(x.factura), quien: txt(x.quien), at: txt(x.at),
  } as DecisionBanco]));

  const cobros: CobroBanco[] = bc.map((x) => {
    const mov = String(x.movement_id), clave = `mov:${mov}`;
    return {
      clave, tipo: "banco", movementId: mov, fecha: String(x.fecha), importe: Number(x.importe), via: String(x.via), estado: String(x.estado),
      texto: textos.get(mov) ?? null, codigo: x.party_id ? codigo.get(String(x.party_id)) ?? null : null,
      recibos: recibos.filter((r) => String(r.movement_id) === mov).map((r) => {
        const g = gc.get(String(r.gc_id));
        const s = txt(g?.suscripcion_gc_id);
        return { gcId: String(r.gc_id), importe: Number(r.importe), fecha: String(g?.fecha ?? x.fecha), texto: (s ? sus.get(s) : null) ?? txt(g?.descripcion),
          elegido: (s ? elegido.get(`suscripcion:${s}`) : elegido.get(`cobro:${r.gc_id}`)) ?? null };
      }),
      decision: decision.get(clave) ?? null,
    };
  });
  for (const x of tarjeta) {
    const clave = claveTarjeta(String(x.pagado_en), Number(x.importe));
    const ficha = x.party_id ? codigo.get(String(x.party_id)) ?? null : null;
    cobros.push({ clave, tipo: "tarjeta", movementId: txt(x.movement_id), fecha: fechaMadrid(String(x.pagado_en)), importe: Number(x.importe), via: "tarjeta",
      estado: String(x.estado), texto: txt(x.porque), codigo: ficha ?? (x.cegid_codigo == null ? null : Number(x.cegid_codigo)), recibos: [],
      etapa: txt(x.etapa), falta: txt(x.falta), decision: decision.get(clave) ?? null });
  }
  return cobros.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));
}

/**
 * Regla 1: los meses (AAAA-MM) en que cada cliente tiene factura en Cegid, leídos ahora de Cegid (solo GET), para los
 * clientes y ejercicios que lo necesitan (los de los recibos que paga el banco).
 */
export async function mesesFacturados(api: ClienteDiezRec, cobros: readonly CobroBanco[]): Promise<Record<string, string[]>> {
  const pedir = new Map<number, Set<number>>();
  for (const c of cobros) {
    if (c.tipo !== "banco" || c.codigo == null || !c.recibos.length || c.decision) continue;
    const anos = pedir.get(c.codigo) ?? new Set<number>();
    for (const r of c.recibos) anos.add(Number(r.fecha.slice(0, 4)));
    pedir.set(c.codigo, anos);
  }
  const r: Record<string, string[]> = {};
  for (const [cliente, anos] of pedir) {
    const meses = new Set<string>();
    for (const ano of anos) {
      for (let pagina = 0; pagina < 20; pagina++) {
        const x = await api.get(rutaFacturasCliente(ano, cliente, pagina));
        if (x.status === 204) break;
        if (x.status !== 200) throw new FalloDiezRec(`Cegid contesta ${x.status} al leer las facturas del cliente ${cliente}`, x.status);
        const filas = Array.isArray((x.json as Fila | null)?.datos) ? ((x.json as Fila).datos as Fila[]) : [];
        for (const f of filas) {
          if (Number(f.cliente) !== cliente) continue;
          const d = String(f.fecha ?? "");
          if (/^\d{8}$/.test(d)) meses.add(`${d.slice(0, 4)}-${d.slice(4, 6)}`);
        }
        if (filas.length < 200) break;
      }
    }
    r[String(cliente)] = [...meses].sort();
  }
  return r;
}
