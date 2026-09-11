// supabase/functions/lastapp-catalog-import/index.ts
//
// Importa el CATÁLOGO COMERCIAL de Last.app hacia las tablas de catálogo de
// marca de Folvy (Fase A). Trae solo lo que está EN USO (filtra la basura de
// Last.app: marcas sin catálogo, canal "informes", objetos huérfanos).
//
// ══ QUIÉN MANDA EN QUÉ (decisión de Julio, 08/09/2026) ════════════════════
//
// Sólo para las marcas CEDIDAS (`brand.ownership_type = 'licensed'`), que son
// las que tienen su carta en Last:
//
//   LAST manda en lo que ve el cliente  →  nombre, precio, opciones, en qué
//                                          platos van, disponible/agotado.
//   FOLVY manda en lo que cuesta        →  recipe_item_id (el escandallo),
//                                          modifier_recipe_impact, packaging,
//                                          IVA, objetivo de food cost, notas.
//   FOLVY manda en lo que Folvy creó    →  toda fila con external_source NULL.
//
// Para las marcas PROPIAS la fuente de verdad es FOLVY y no hay importación:
// esta función NO DEBE TOCARLAS NUNCA. Ver la guarda de `resuelveMarca`.
//
// ══ ALCANCE v2 (deuda explícita, no oculta) ═══════════════════════════════
//   - Trae TODOS los catálogos que el local declara, no solo el "default":
//     desde el 08/09 el descubrimiento va por `GET /catalogs?locationId=`
//     (`_shared/lastapp.ts`). El camino viejo —`brands[].catalogs.default`—
//     devolvía cero para las 20 marcas de Foodint mientras la carta real tenía
//     41 catálogos: Last dejó de rellenar ese puntero y nadie se enteró.
//   - NO crea recipe_items: menu_item.recipe_item_id = NULL. El escandallo lo
//     hace el cocinero después (enlaza/crea el recipe_item en ese momento).
//   - NO crea recipe_lines, NO costes, NO modifier_recipe_impact.
//   - Las VARIANTES POR CANAL (p.ej. el catálogo Glovo distinto de Scandal/
//     Bendito) son Fase B (menu_item_override) — tramo separado.
//   - NO BORRA NADA. Lo que Last ya no sirve se CUENTA y se lista
//     (`sobrantes`), no se archiva ni se borra: eso es decisión de Julio, con
//     la lista delante. Regla 7 — un umbral (o una ausencia) ordena, no
//     esconde.
//
// Entrada (POST JSON):
//   { account_id, lastapp_organization_id, dry_run?, aplicar_activo? }
// Auth: platform admin (JWT folvy.is_platform_admin) o x-internal-key.

import { corsHeaders } from "../_shared/cors.ts";
// El descubrimiento de catálogos y el cliente de Last viven en `_shared` desde
// el 08/09: esta función tenía SU copia y descubría por `brands[].catalogs
// .default`, que Last dejó de rellenar — 0 catálogos, 0 productos y las 20
// marcas en `brands_skipped_empty` mientras `last-catalog-sync`, con el
// endpoint bueno, traía 41 catálogos y 4.444 filas. Ver `_shared/lastapp.ts`.
import { lastGet, resolveLocationCatalogs } from "../_shared/lastapp.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Canales que NO son de venta real (reporting interno). Reservado para Fase B
// (variantes por canal); en v1 solo importamos el catálogo "default".
const EXCLUDED_CHANNELS = new Set(["informes"]);
void EXCLUDED_CHANNELS;

interface FolvyClaims {
  is_platform_admin?: boolean;
  full_name?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeFolvyClaims(jwt: string): FolvyClaims {
  try {
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json);
    return (parsed.folvy ?? {}) as FolvyClaims;
  } catch {
    return {};
  }
}

// Normalización para casar nombres de marca Last.app <-> Folvy.
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

// Alias de marca: desajustes conocidos de nombre Last.app -> Folvy.
// Clave y valor en forma NORMALIZADA. Sólo se usa cuando `external_brand_map`
// no tiene la marca por ID (ver `resuelveMarca`).
const BRAND_ALIAS: Record<string, string> = {
  "dirty burgers": "dirty burger", // Last (plural) -> Folvy (singular)
};

// Marcas DESCARTADAS a propósito: existen en Last pero NO se importan a Folvy
// ni se reportan como "sin resolver". Clave en forma NORMALIZADA.
//   - "foodint": es la "marca" que Last usa para la VENTA DIRECTA / tienda online
//     (shop: domicilio propio, takeaway, local, sin Glovo/Uber). Hoy solo tiene
//     pruebas, sin ventas reales. El cliente abandonará Last en breve y Folvy
//     tendrá su PROPIA shop de venta directa (canal 'shop', no una marca). Por eso
//     no se importa como marca: la venta directa es un CANAL transversal a las
//     marcas, no una marca en sí.
//   - "van van": marca de Last que Foodint NO trabaja ni va a trabajar (Julio,
//     08/09). Su carta existe en Last —«Van Van Chicken Bar», catálogos de Glovo
//     y Uber— y el recorrido la atribuye bien, así que sin esto sale cada pasada
//     en `brands_unresolved` como si faltara por casar. Descartarla a propósito
//     la saca del ruido y la deja CONTADA en `brands_discarded`, que es su sitio.
//
// Esta lista es el respaldo por NOMBRE. La forma buena de descartar es la fila
// de `external_brand_map` con `is_ignored = true`, que va por id y no depende
// de cómo se escriba la marca.
const DISCARDED_BRANDS: Set<string> = new Set(["foodint", "van van"]);

// Infiere el tipo de grupo de modificadores por su nombre (heurística).
function inferGroupType(name: string): string {
  const n = normalize(name);
  if (/\b(extra|anade|anadir|add|topping|adicional)\b/.test(n)) return "extras";
  if (/\b(sin|quitar|quita|remove|no\s)\b/.test(n)) return "removal";
  if (/\b(postre|bebida|drink|dessert|acompan|side|complemento)\b/.test(n)) return "cross_sell";
  if (/\b(punto|coccion|hecho|temperatura|nota|note)\b/.test(n)) return "info";
  // base / elige / escoge / selecciona + por defecto -> choice
  return "choice";
}

// ── Qué campos de cada tabla los manda LAST ───────────────────────────────
//
// Lo que NO está en esta lista NO se toca al actualizar, aunque el importador
// lo escriba al INSERTAR. Es la traducción a código de la decisión de arriba, y
// está en un solo sitio a propósito: si mañana alguien quiere que Last mande en
// una columna más, se añade aquí y se ve en el diff. Ausencias deliberadas:
//
//   menu_item.recipe_item_id  — el escandallo. Es de Folvy. Pisarlo sería
//                               tirar el trabajo del cocinero.
//   menu_item.is_active       — está detrás de `aplicar_activo` (ver abajo).
//   menu_item.archived_at     — archivar es un acto de Folvy; esta función no
//                               desarchiva ni archiva. Cuenta y lista.
//   menu_item.vat_rate        — Last no tiene IVA; es de Folvy.
//   modifier_group.group_type — lo INFIERE `inferGroupType` por el nombre. Es
//                               una interpretación de Folvy, y un humano puede
//                               haberla corregido: no se pisa cada pasada con
//                               el resultado de una heurística.
//   modifier_group.brand_id   — ver la nota de la clave, más abajo.
//   modifier_option.recipe_item_id — de Folvy (hoy muerta: deuda declarada).
const CAMPOS_DE_LAST: Record<string, string[]> = {
  menu_category: ["name"],
  menu_item: ["name", "price", "is_available", "menu_category_id", "product_type"],
  modifier_group: ["name", "min_selections", "max_selections"],
  // `pos_modifier_id` va aquí Y NO SOLO EN EL INSERT (A1, 11/09): las 210
  // opciones cedidas que ya existen se crearon sin él, y si no está en esta
  // lista el importador no las tocaría nunca —«casa por external_id, ya está,
  // salta»— y el código no llegaría jamás a las filas que importan.
  modifier_option: ["modifier_group_id", "name", "price_impact", "position", "pos_modifier_id"],
  // `combo_item_id`, `combo_slot_id` y `modifier_group_id` son enlaces al padre,
  // y el padre lo decide entero el catálogo de Last. Van aquí desde el 09/09:
  // sin ellos, cuando un combo estrena fila `menu_item` —pasó con 12 en la
  // primera pasada de verdad— sus slots se quedan colgando de la fila vieja y
  // el combo se queda sin partes sin que nadie lo note. Un enlace que no sigue
  // a su padre es la version silenciosa del mismo fallo.
  combo_slot: ["combo_item_id", "name", "min_selections", "max_selections", "position"],
  combo_slot_option: ["combo_slot_id", "menu_item_id", "price_impact", "position"],
};

// ── La CLAVE con la que se casa una fila de Last con la de Folvy ──────────
//
// LA DECIDE EL ÍNDICE DE LA BASE. No mi criterio. Esto está escrito así porque
// el 09/09 la primera importación de verdad murió con
// `duplicate key value violates unique constraint "uq_combo_slot_external"`,
// y la causa fue exactamente eso: yo había elegido las claves «con cabeza» —el
// ámbito natural de cada tabla— y la base tenía las suyas. Dos definiciones de
// «esta es la misma fila», y el día que discreparon ganó la base, como debía.
//
// El error de medición que lo dejó pasar: comprobé la unicidad mirando
// `pg_constraint`, y **un índice único PARCIAL no es una constraint**. Los seis
// `uq_*_external` son `CREATE UNIQUE INDEX … WHERE external_id IS NOT NULL`, o
// sea que viven en `pg_index` y mi consulta no los veía. Conclusión con la vara
// equivocada: «ninguna tabla tiene unicidad sobre (cuenta, origen, id)».
//
// Lo que la base dice DE VERDAD (medido el 09/09 sobre pg_index):
//
//   uq_menu_item_external          (account_id, external_source, external_id, brand_id)
//   uq_menu_category_external      (account_id, external_source, external_id)
//   uq_modifier_group_external     (account_id, external_source, external_id)
//   uq_modifier_option_external    (account_id, external_source, external_id)
//   uq_combo_slot_external         (account_id, external_source, external_id)
//   uq_combo_slot_option_external  (account_id, external_source, external_id)
//
// `account_id` y `external_source` son fijos en una pasada, así que la clave se
// reduce a `external_id`, y en `menu_item` a `(brand_id, external_id)`. Que
// `menu_item` lleve la marca no es un capricho del índice: son las BEBIDAS.
// Last tiene UN producto «COCA-COLA ORIGINAL» y Folvy una ficha por marca —
// nueve para ese id. 513 filas etiquetadas reparten 361 external_id.
//
// CÓMO MORDIÓ, con los números de la pasada que falló: había 132 slots colgando
// de las filas de combo de junio. La pasada creó 12 combos NUEVOS, con `id`
// nuevo, así que `itemMap` devolvía otro `combo_item_id`; con la clave vieja
// —(combo_item_id, external_id)— esos slots no casaban con nada y salían como
// «nuevos». 31 INSERT contra un índice que sólo mira external_id.
//
// Y no era sólo `combo_slot`: `menu_category`, `modifier_option` y
// `combo_slot_option` tenían el mismo desajuste. No estallaron porque hoy sus
// external_id no se repiten dentro de la cuenta — o sea que estaban esperando.
const AMBITO: Record<string, string | null> = {
  menu_category: null,
  menu_item: "brand_id",   // el índice lleva brand_id; las bebidas lo exigen
  modifier_group: null,
  modifier_option: null,
  combo_slot: null,
  combo_slot_option: null,
};

// ── Comprobar la clave contra la base ANTES de tocar nada ────────────────
//
// La tabla de arriba dice con qué clave decide ESTE código. `pg_index` dice con
// cuál decide la BASE. El 09/09 no coincidían y la primera importación de
// verdad murió a mitad, con 112 categorías y 166 platos ya escritos y los
// combos sin entrar. Esto se pregunta al arrancar, antes de la primera llamada
// a Last, para que ese fallo pase de «a mitad y con un duplicate key» a «no ha
// empezado y te dice exactamente qué no cuadra».
//
// VERIFICA, NO DERIVA. La clave sigue declarada arriba, a la vista, y esto sólo
// comprueba que sigue siendo la de la base. Derivarla del índice haría que el
// comportamiento cambiara solo el día que alguien toca un índice — que es justo
// el día en que hace falta que alguien mire.
//
// Y el techo, dicho: esto cubre lo que uno sabe preguntar. No habría cazado la
// columna `updated_at` que faltaba en `combo_slot_option`, porque a nadie se le
// ocurrió preguntarlo. Por eso la otra mitad del arreglo es que, cuando algo se
// escape igualmente, el error hable claro: ver el `pista` del insert.
const TABLAS_CON_CLAVE_EXTERNA = [
  "menu_category", "menu_item", "modifier_group",
  "modifier_option", "combo_slot", "combo_slot_option",
] as const;

interface ClaveDeLaBase {
  tabla: string;
  indice: string;
  columnas: string[];
  parcial: boolean;
}

/** Lo que ESTE código usa como clave, en las mismas columnas que un índice. */
function claveDelCodigo(tabla: string): string[] {
  const ambito = AMBITO[tabla] ?? null;
  // `account_id` y `external_source` los fija cada consulta de existencia
  // (`.eq("account_id", …)`, `.eq("external_source", "lastapp")`), así que
  // forman parte de la clave aunque no aparezcan en AMBITO.
  return ["account_id", "external_source", "external_id", ...(ambito ? [ambito] : [])];
}

async function verificaClavesContraLaBase(sb: SupabaseClient): Promise<ClaveDeLaBase[]> {
  const { data, error } = await sb.rpc("claves_unicas_externas", {
    p_tablas: [...TABLAS_CON_CLAVE_EXTERNA],
  });

  if (error) {
    const falta = /does not exist|could not find|schema cache/i.test(error.message);
    throw new Error(
      falta
        ? "No se puede comprobar con qué clave decide la base: falta la función " +
          "public.claves_unicas_externas. Es la migración 20260909081014, y va ANTES " +
          "de desplegar este importador. No se ha escrito nada."
        : `No se pudo comprobar la clave contra la base: ${error.message}. No se ha escrito nada.`,
    );
  }

  const deLaBase = (data ?? []) as ClaveDeLaBase[];
  for (const tabla of TABLAS_CON_CLAVE_EXTERNA) {
    const fila = deLaBase.find((f) => f.tabla === tabla);
    if (!fila) {
      throw new Error(
        `La base no tiene ningún índice único sobre external_id en ${tabla}, ` +
        `y este importador decide existencia con «${claveDelCodigo(tabla).join(" + ")}». ` +
        `Sin índice, nada impide dos filas para la misma de Last. No se ha escrito nada.`,
      );
    }
    // Se comparan como CONJUNTO: el orden dentro del índice cambia para qué
    // consultas sirve, no qué filas considera iguales.
    const mia = [...claveDelCodigo(tabla)].sort().join(",");
    const suya = [...fila.columnas].sort().join(",");
    if (mia !== suya) {
      throw new Error(
        `El importador decide existencia en ${tabla} con «${claveDelCodigo(tabla).join(" + ")}» ` +
        `y la base la decide con «${fila.columnas.join(" + ")}» ` +
        `(índice ${fila.indice}${fila.parcial ? ", parcial" : ""}). ` +
        `No se ha escrito nada. Alinea AMBITO en lastapp-catalog-import/index.ts ` +
        `o cambia el índice, pero no las dos a la vez.`,
      );
    }
  }
  return deLaBase;
}

interface ContadorTabla {
  nuevas: number;
  actualizadas: number;
  sin_cambios: number;
  total: number;
  cambios_ejemplo: any[];
}

function contadorNuevo(): ContadorTabla {
  return { nuevas: 0, actualizadas: 0, sin_cambios: 0, total: 0, cambios_ejemplo: [] };
}

// Compara un valor de Last con el que devuelve PostgREST. `numeric` vuelve como
// cadena ("2.6"), así que comparar con === marcaría como cambiada cada fila de
// cada pasada — y el informe diría "actualizadas: 500" para siempre.
function mismoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  }
  return String(a) === String(b);
}

// ── Casa por (ámbito, external_id): inserta lo nuevo y ACTUALIZA lo de Last ──
//
// Devuelve un Map "ámbito|external_id" -> id de Folvy (preexistentes y nuevos).
//
// v1 hacía sólo la mitad: insertaba lo que faltaba y saltaba lo que ya estaba,
// así que un cambio hecho en el TPV no llegaba NUNCA. Esto es la otra mitad, y
// va con dos frenos: sólo escribe las columnas de `CAMPOS_DE_LAST`, y sólo
// sobre filas que de verdad han cambiado (si no, `sin_cambios`).
async function casarYActualizar(
  sb: SupabaseClient,
  table: string,
  accountId: string,
  rows: Array<Record<string, unknown> & { external_id: string }>,
  dryRun: boolean,
  contador: ContadorTabla,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  contador.total = rows.length;
  if (rows.length === 0) return map;

  const ambito = AMBITO[table] ?? null;
  const campos = CAMPOS_DE_LAST[table] ?? [];
  const clave = (r: Record<string, unknown>) =>
    ambito ? `${String(r[ambito] ?? "")}|${String(r.external_id)}` : String(r.external_id);

  const extIds = [...new Set(rows.map((r) => r.external_id))];

  // 1) Preexistentes. Se traen también las columnas de Last para poder decir
  //    "esta ya estaba y está igual" sin escribir.
  const columnas = ["id", "external_id", ...(ambito ? [ambito] : []), ...campos].join(", ");
  const existentes: any[] = [];
  // `in` con muchos ids hace una URL enorme; se trocea.
  for (let i = 0; i < extIds.length; i += 200) {
    const { data, error } = await sb
      .from(table)
      .select(columnas)
      .eq("account_id", accountId)
      .eq("external_source", "lastapp")
      .in("external_id", extIds.slice(i, i + 200));
    if (error) throw new Error(`select ${table}: ${error.message}`);
    existentes.push(...(data ?? []));
  }
  const filaPorClave = new Map<string, any>();
  for (const e of existentes) {
    const k = clave(e);
    filaPorClave.set(k, e);
    map.set(k, e.id as string);
  }

  // 2) Repartir en "hay que actualizar", "está igual" y "es nueva".
  const nuevas: Array<Record<string, unknown>> = [];
  const aActualizar: Array<{ id: string; campos: Record<string, unknown>; antes: Record<string, unknown> }> = [];
  const vistas = new Set<string>();
  for (const r of rows) {
    const k = clave(r);
    if (vistas.has(k)) continue;
    vistas.add(k);
    const existente = filaPorClave.get(k);
    if (!existente) {
      nuevas.push(r);
      continue;
    }
    const cambios: Record<string, unknown> = {};
    const antes: Record<string, unknown> = {};
    for (const c of campos) {
      // En dry_run un padre NUEVO no tiene id todavía y lleva uno sintético
      // ("dry-…"). Compararlo con el uuid que la fila tiene hoy diría "ha
      // cambiado" sin que nada haya cambiado, y el informe del dry_run —que es
      // justo lo que se mira ANTES de aplicar— saldría inflado.
      if (typeof r[c] === "string" && (r[c] as string).startsWith("dry-")) continue;
      if (!mismoValor(r[c], existente[c])) {
        cambios[c] = r[c];
        antes[c] = existente[c];
      }
    }
    if (Object.keys(cambios).length === 0) {
      contador.sin_cambios++;
    } else {
      aActualizar.push({ id: existente.id as string, campos: cambios, antes });
    }
  }
  contador.nuevas = nuevas.length;
  contador.actualizadas = aActualizar.length;
  // Muestra de qué cambia, para poder mirarlo ANTES de aplicar. No es un
  // resumen: son las filas de verdad, con su antes y su después.
  contador.cambios_ejemplo = aActualizar.slice(0, 10).map((u) => ({
    id: u.id, antes: u.antes, despues: u.campos,
  }));

  // En dry_run NO escribimos, pero generamos ids sintéticos para que los pasos
  // hijos (opciones, slots, assignments) puedan contar correctamente.
  if (dryRun) {
    for (const r of nuevas) map.set(clave(r), `dry-${clave(r)}`);
    return map;
  }

  // 3) Actualizar. PostgREST no sabe hacer un UPDATE masivo con valores
  //    distintos por fila, así que va una a una, en tandas para no soltar 500
  //    peticiones a la vez.
  for (let i = 0; i < aActualizar.length; i += 20) {
    const tanda = aActualizar.slice(i, i + 20);
    const resultados = await Promise.all(
      tanda.map((u) =>
        sb.from(table).update({ ...u.campos, updated_at: new Date().toISOString() }).eq("id", u.id)
      ),
    );
    for (const r of resultados) {
      if (r.error) throw new Error(`update ${table}: ${r.error.message}`);
    }
  }

  // 4) Insertar lo nuevo.
  if (nuevas.length > 0) {
    const { data: inserted, error: insErr } = await sb
      .from(table)
      .insert(nuevas)
      .select(columnas);
    if (insErr) {
      // Si vuelve a chocar contra un índice único, que el informe diga CONTRA
      // QUÉ y CON QUÉ FILAS. El 09/09 esto murió con un «duplicate key value
      // violates unique constraint uq_combo_slot_external» a secas, y
      // reconstruir de ahí que la clave del código no era la del índice costó
      // una pasada entera. Un error que no dice con qué filas chocó obliga a
      // repetir el trabajo de diagnóstico cada vez.
      const choque = /duplicate key|unique constraint/i.test(insErr.message);
      const pista = choque
        ? ` · La clave con la que este importador decide existencia en ${table} es` +
          ` «${ambito ? `${ambito} + external_id` : "external_id"}». Si el índice de la base` +
          ` mira otras columnas, el importador cree que son nuevas y las inserta.` +
          ` external_id de las ${nuevas.length} que intentaba insertar: ` +
          nuevas.slice(0, 15).map((r) => String(r.external_id)).join(", ") +
          (nuevas.length > 15 ? ` … (+${nuevas.length - 15})` : "")
        : "";
      throw new Error(`insert ${table}: ${insErr.message}${pista}`);
    }
    for (const i of ((inserted ?? []) as any[])) map.set(clave(i), i.id as string);
  }

  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // ── Auth dual ──
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("LASTAPP_INTERNAL_KEY") ?? "";
  const internalKey = req.headers.get("x-internal-key");
  const isInternal = internalSecret !== "" && internalKey === internalSecret;
  if (!isInternal) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const claims = decodeFolvyClaims(authHeader.slice(7));
    if (claims.is_platform_admin !== true) {
      return jsonResponse({ error: "Forbidden: platform admin required" }, 403);
    }
  }

  // ── Body ──
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const accountId = body.account_id;
  const orgId = body.lastapp_organization_id;
  const dryRun = body.dry_run === true;
  // Last manda también en activo/inactivo (decisión de Julio), pero eso son
  // cientos de filas que pueden cambiar de estado en la PRIMERA pasada, y una
  // pantalla que se vacía de golpe no se distingue de una avería. Va detrás de
  // un interruptor: el informe SIEMPRE dice cuántas cambiarían
  // (`platos_que_last_no_sirve` / `platos_inactivos_que_last_si_sirve`), y con
  // `aplicar_activo: true` se escribe. Contar no se puede desactivar.
  const aplicarActivo = body.aplicar_activo === true;
  if (!accountId || !orgId) {
    return jsonResponse({ error: "account_id and lastapp_organization_id required" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ── Token de la integración ──
  const { data: integ, error: integErr } = await sb
    .from("external_integration")
    .select("token_secret_name")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_org_id", orgId)
    .single();
  if (integErr || !integ) return jsonResponse({ error: "Integration not found" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return jsonResponse({ error: `Secret ${integ.token_secret_name} not set` }, 500);

  // ── Marcas de Folvy ──
  const { data: folvyBrands, error: brErr } = await sb
    .from("brand").select("id, name, ownership_type").eq("account_id", accountId);
  if (brErr) return jsonResponse({ error: `brands: ${brErr.message}` }, 500);
  const brandByNorm = new Map<string, string>();
  const marcaPorId = new Map<string, { name: string; ownership: string }>();
  for (const b of folvyBrands ?? []) {
    brandByNorm.set(normalize(b.name), b.id as string);
    marcaPorId.set(b.id as string, { name: b.name as string, ownership: (b.ownership_type as string) ?? "" });
  }

  // ── Marca por ID: external_brand_map ──
  // (cuenta, 'lastapp', local, id de marca en Last) -> marca de Folvy, o
  // `is_ignored` para las descartadas a propósito. Existe desde el 12/06 y el
  // importador no la miraba: resolvía por nombre, que es lo que obliga a tener
  // alias ("Dirty Burgers"/"Dirty Burger") y lo que deja a «Milanesa Haus»
  // (cedida) a un tilde de «Milanesa House» (propia).
  const { data: brandMapRows, error: bmErr } = await sb
    .from("external_brand_map")
    .select("external_location_id, external_brand_id, brand_id, is_ignored")
    .eq("account_id", accountId)
    .eq("source", "lastapp");
  if (bmErr) return jsonResponse({ error: `external_brand_map: ${bmErr.message}` }, 500);
  const mapaMarca = new Map<string, { brandId: string | null; ignorada: boolean }>();
  for (const m of brandMapRows ?? []) {
    mapaMarca.set(`${m.external_location_id}|${m.external_brand_id}`, {
      brandId: (m.brand_id as string) ?? null,
      ignorada: m.is_ignored === true,
    });
  }

  // ANTES de la primera llamada a Last: si la clave no es la de la base, aquí
  // no ha pasado nada todavía y se puede decir por qué sin dejar el catálogo a
  // medias. Se comprueba también en dry_run: un ensayo que no valida la clave
  // no está ensayando la pasada de verdad.
  let clavesDeLaBase: ClaveDeLaBase[];
  try {
    clavesDeLaBase = await verificaClavesContraLaBase(sb);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }, 409);
  }

  const report: any = {
    dry_run: dryRun,
    aplicar_activo: aplicarActivo,
    // Con qué clave se ha comprobado que decide la base en esta pasada. Va en
    // el informe a propósito: una comprobación que no se ve no tranquiliza a
    // nadie, y el día que cambie un índice el informe lo enseña.
    claves_verificadas: clavesDeLaBase.map((c) =>
      `${c.tabla}: ${c.columnas.join(" + ")} (${c.indice})`
    ),
    brands_in_use: [] as string[],
    brands_skipped_empty: [] as string[],
    brands_unresolved: [] as string[],
    brands_discarded: [] as string[],   // marcas descartadas a propósito
    // La guarda de la decisión de Julio: una marca de Last que casa con una
    // marca PROPIA de Folvy. No se importa nada suyo. Si esto sale con algo
    // dentro, no es un aviso menor: es que un nombre de Last apunta a una carta
    // cuya verdad es Folvy, y hay que mirarlo antes de la siguiente pasada.
    marcas_propias_rechazadas: [] as any[],
    // Cómo se resolvió cada marca. Que esto se llene por el lado del nombre no
    // es un fallo, pero sí es lo que hay que ir vaciando: el nombre se escribe
    // mal, el id no.
    marcas_por_id: 0,
    marcas_por_nombre: [] as string[],
    // Qué se ha descubierto, por local, ANTES de contar nada: si esto viene a
    // cero otra vez, se ve de un vistazo dónde se rompió (08/09).
    discovery: [] as any[],
    catalogs_discovered: 0,
    catalogs_without_brand: [] as string[],
    // Si esto no está vacío, hay marcas de `brands_skipped_empty` y de
    // `brands_unresolved` que en realidad son el MISMO catálogo mal atribuido.
    catalogs_brand_por_nombre: [] as any[],
    categories: 0, products: 0, combos: 0,
    modifier_groups: 0, modifier_options: 0, assignments: 0,
    combo_slots: 0, combo_slot_options: 0,
    // Nuevo/actualizado/igual por tabla. Es lo que hace comparable una pasada
    // con la siguiente: "products: 186" no distingue 186 altas de 186 filas que
    // ya estaban y no han cambiado.
    tablas: {} as Record<string, ContadorTabla>,
    // Lo que Last ya NO sirve y en Folvy sigue vivo. Se cuenta y se lista; no
    // se borra ni se archiva.
    sobrantes: {
      platos_que_last_no_sirve: 0,
      platos_que_last_no_sirve_ejemplo: [] as any[],
      platos_inactivos_que_last_si_sirve: 0,
      asignaciones_que_last_no_tiene: 0,
    },
    warnings: [] as string[],
  };

  try {
    // ════════════════ FASE 1: local → sus catálogos ════════════════
    //
    // 08/09: ANTES esto leía `brands[].catalogs.default` del detalle de cada
    // local y, si venía vacío, daba la marca por «sin catálogo» y seguía. Ese
    // puntero está vacío HOY para las 20 marcas de Foodint, así que el
    // importador descubría 0 catálogos y no traía nada — mientras
    // `last-catalog-sync`, esa misma madrugada, traía 41 catálogos y 4.444
    // filas de producto de las mismas marcas.
    //
    // Ahora el descubrimiento es el de la hermana, compartido en
    // `_shared/lastapp.ts`: `GET /catalogs?locationId=` es la lista
    // AUTORITATIVA y `brands[].catalogs` sólo aporta la etiqueta de marca y
    // canal cuando la tiene. Verificado en vivo el 12/08 (Carabanchel: el walk
    // veía 8 catálogos y 208 productos donde el endpoint bueno da la carta
    // entera).
    const locResp = await lastGet(`/locations?organizationId=${orgId}`, token, { "organizationID": orgId });
    const locations: any[] = Array.isArray(locResp) ? locResp : (locResp?.value ?? []);

    // catalogInfo: catalogId -> qué marca de Last lo reclama, con qué id y en
    // qué local (los tres hacen falta para resolver por `external_brand_map`).
    const catalogInfo = new Map<string, { brandName: string; lastBrandId: string | null; locId: string }>();
    const canonicalCatalogs = new Set<string>();
    // Presencia de catálogo por marca (across locations): una marca está "en
    // uso" si aparece en ALGÚN catálogo de ALGUNA location.
    const brandHasCatalog = new Map<string, boolean>();
    // Catálogos que el endpoint devuelve sin poder atribuir a una marca. Antes
    // esto no existía porque el walk siempre traía el nombre de la marca; con
    // la lista autoritativa puede haber catálogos que `brands[]` no menciona, y
    // callarlos sería volver al mismo sitio (regla 7: se cuentan, no se
    // esconden).
    const catalogsSinMarca: string[] = [];
    // Catálogos cuya marca NO la dio el recorrido de `brands[].catalogs`, sino
    // el nombre del catálogo puesto como último recurso. Comprobación pedida por
    // Julio (§19) y hace falta: un recorrido fallido es INVISIBLE sin esto — la
    // marca de verdad se queda sin catálogo y sale como «sin carta en Last»,
    // mientras el nombre del catálogo aparece como marca fantasma «sin
    // resolver». Dos síntomas separados y nada que diga que son lo mismo.
    const catalogsMarcaPorNombre: Array<{ catalogo: string; usada_como_marca: string }> = [];

    for (const loc of locations) {
      const { catalogMap, debug } = await resolveLocationCatalogs(token, String(loc.id));
      report.discovery.push({
        location: loc?.name ?? String(loc.id),
        catalogs: catalogMap.size,
        raw_list_length: debug?.raw_list_length ?? null,
        deleted: debug?.deleted_count ?? null,
      });

      for (const [catId, info] of catalogMap) {
        const brandName = (info.brand ?? "").trim();
        if (!brandName) {
          if (!catalogsSinMarca.includes(catId)) catalogsSinMarca.push(catId);
          continue;
        }
        if (!info.brandFromWalk) {
          catalogsMarcaPorNombre.push({ catalogo: info.name ?? catId, usada_como_marca: brandName });
        }
        brandHasCatalog.set(brandName, true);
        if (!canonicalCatalogs.has(catId)) {
          canonicalCatalogs.add(catId);
          catalogInfo.set(catId, {
            brandName,
            lastBrandId: info.brandId,
            locId: String(loc.id),
          });
        }
      }

      // Las marcas que el local declara pero que no aparecen en ningún
      // catálogo suyo: se anotan como «sin catálogo» sólo si no la tienen en
      // otro local (igual que antes).
      const detalle = await lastGet(`/locations/${loc.id}`, token, { "LocationID": loc.id });
      for (const b of (detalle?.brands ?? [])) {
        const brandName: string = (b?.name ?? "").trim();
        if (!brandName) continue;
        if (!brandHasCatalog.has(brandName)) brandHasCatalog.set(brandName, false);
      }
    }

    // Marcas sin catálogo en NINGUNA location (deduplicado).
    report.brands_skipped_empty = [...brandHasCatalog.entries()]
      .filter(([, has]) => !has)
      .map(([name]) => name);
    report.catalogs_without_brand = catalogsSinMarca;
    report.catalogs_brand_por_nombre = catalogsMarcaPorNombre;
    report.catalogs_discovered = canonicalCatalogs.size;

    // ════════════════ FASE 1b: resolver la marca de cada catálogo ════════════
    //
    // Se resuelve UNA VEZ por catálogo, no una vez por fila: la marca de un
    // producto es la del catálogo donde aparece, y resolverla mil veces sólo
    // multiplica las ocasiones de resolverla distinto.
    const resueltasCache = new Map<string, string | null>();
    const resuelveMarca = (catId: string): string | null => {
      if (resueltasCache.has(catId)) return resueltasCache.get(catId) ?? null;
      const info = catalogInfo.get(catId);
      const decide = (): string | null => {
        if (!info) return null;
        const { brandName, lastBrandId, locId } = info;

        // 1) Por ID (external_brand_map). Es la vía buena.
        if (lastBrandId) {
          const fila = mapaMarca.get(`${locId}|${lastBrandId}`);
          if (fila) {
            if (fila.ignorada) {
              if (!report.brands_discarded.includes(brandName)) report.brands_discarded.push(brandName);
              return null;
            }
            if (fila.brandId) {
              report.marcas_por_id++;
              return fila.brandId;
            }
          }
        }

        // 2) Descartadas por nombre (respaldo de la lista de arriba).
        const norm = normalize(brandName);
        if (DISCARDED_BRANDS.has(norm)) {
          if (!report.brands_discarded.includes(brandName)) report.brands_discarded.push(brandName);
          return null;
        }

        // 3) Por nombre + alias. Sigue existiendo porque el mapa no cubre
        //    todos los catálogos; cada marca que caiga aquí se LISTA.
        const aliased = BRAND_ALIAS[norm] ?? norm;
        const id = brandByNorm.get(aliased) ?? null;
        if (!id) {
          if (!report.brands_unresolved.includes(brandName)) report.brands_unresolved.push(brandName);
          return null;
        }
        if (!report.marcas_por_nombre.includes(brandName)) report.marcas_por_nombre.push(brandName);
        return id;
      };

      let id = decide();

      // ── LA GUARDA ────────────────────────────────────────────────────────
      // Resuelva por id o por nombre, si la marca de Folvy NO es cedida, aquí
      // no se importa nada. La verdad de una marca propia es Folvy y esta
      // función viene de Last.
      //
      // No es hipotético: hoy 206 platos VIVOS de las 9 marcas propias llevan
      // `external_source = 'lastapp'` —etiqueta vieja de junio— y ninguna
      // propia tiene un plato sin ella. O sea que "¿lo trajo Last?" NO se puede
      // preguntar mirando `external_source`: la respuesta es que sí para todos.
      // Se pregunta por `brand.ownership_type`, que es lo que esto hace.
      if (id) {
        const marca = marcaPorId.get(id);
        if (!marca || marca.ownership !== "licensed") {
          report.marcas_propias_rechazadas.push({
            marca_en_last: info?.brandName ?? "(sin nombre)",
            marca_en_folvy: marca?.name ?? "(desconocida)",
            ownership_type: marca?.ownership ?? "(sin tipo)",
            motivo: "la verdad de esta marca es Folvy; el importador de Last no la toca",
          });
          id = null;
        }
      }

      resueltasCache.set(catId, id);
      return id;
    };

    // ════════════════ FASE 2: productos/combos EN USO por catálogo ════════════════
    // inUseProducts: orgProductId -> { brandId, brandName, catExtId, catName }
    // inUseCombos:   orgComboId   -> { brandId, brandName }
    const inUseProducts = new Map<string, { brandId: string; brandName: string; catExtId: string | null; catName: string | null }>();
    const inUseCombos = new Map<string, { brandId: string; brandName: string }>();
    const categoryRows = new Map<string, { name: string; brandId: string }>(); // catExtId -> ...

    for (const catId of canonicalCatalogs) {
      const info = catalogInfo.get(catId)!;
      const brandId = resuelveMarca(catId);
      if (!brandId) continue;
      let catalog: any;
      try {
        catalog = await lastGet(`/catalogs/${catId}`, token, { "locationID": info.locId });
      } catch (e) {
        report.warnings.push(`catalog ${catId} (${info.brandName}): ${String(e)}`);
        continue;
      }
      for (const cat of (catalog?.categories ?? [])) {
        const catExtId: string = cat?.id ?? "";
        const catName: string = cat?.name ?? "";
        if (catExtId && !categoryRows.has(catExtId)) {
          categoryRows.set(catExtId, { name: catName, brandId });
        }
        for (const p of (cat?.products ?? [])) {
          const type = (p?.type ?? "PRODUCT").toUpperCase();
          if (type === "COMBO") {
            const comboId = p?.organizationComboId ?? p?.organizationProductId ?? null;
            if (comboId && !inUseCombos.has(comboId)) {
              inUseCombos.set(comboId, { brandId, brandName: info.brandName });
            }
          } else {
            const prodId = p?.organizationProductId ?? null;
            if (prodId && !inUseProducts.has(prodId)) {
              inUseProducts.set(prodId, {
                brandId, brandName: info.brandName,
                catExtId: catExtId || null, catName: catName || null,
              });
            }
          }
        }
      }
    }

    // ════════════════ FASE 3: catálogo rico de la organización ════════════════
    const orgCat = await lastGet(`/organizations/${orgId}/catalog`, token, { "organizationID": orgId });
    const orgProducts: any[] = orgCat?.products ?? [];
    const orgModifierGroups: any[] = orgCat?.modifierGroups ?? [];
    const orgModifiers: any[] = orgCat?.modifiers ?? [];
    const orgCombos: any[] = orgCat?.combos ?? [];

    const orgProductById = new Map<string, any>();
    for (const p of orgProducts) orgProductById.set(p.id, p);
    const orgGroupById = new Map<string, any>();
    for (const g of orgModifierGroups) orgGroupById.set(g.id, g);
    const orgModifierById = new Map<string, any>();
    for (const m of orgModifiers) orgModifierById.set(m.id, m);
    const orgComboById = new Map<string, any>();
    for (const c of orgCombos) orgComboById.set(c.id, c);

    // ── ¿ESTÁN EN EL CATÁLOGO LOS CÓDIGOS QUE TRAEN LOS PEDIDOS? ──────────
    //
    // El freno del §2.1: A1 sólo sirve si `om.modifierId` es de verdad lo que
    // llega en `organizationModifierId`. Se cuenta aquí, con la MISMA vara que
    // va a usar A2 después, y se cuenta SIEMPRE —no sólo en seco— para que
    // quede en el parte de cada pasada.
    //
    // La pregunta «¿es cedida?» la contesta `brand.ownership_type`, no el
    // origen de la línea: medirlo por `external_source = 'lastapp'` da 408
    // líneas donde hay 175, porque mete dentro marcas PROPIAS que entraron con
    // esa etiqueta en junio. Por eso el recuento vive en SQL
    // (`modificadores_cobertura_de_codigos`) y no aquí.
    try {
      const { data: cobertura, error: covErr } = await sb.rpc(
        "modificadores_cobertura_de_codigos",
        { p_account_id: accountId, p_catalog_ids: [...orgModifierById.keys()] },
      );
      if (covErr) {
        report.warnings.push(`cobertura_de_codigos: ${covErr.message}`);
      } else {
        report.cobertura_de_codigos = cobertura;
      }
    } catch (e) {
      report.warnings.push(`cobertura_de_codigos: ${String(e)}`);
    }

    // ════════════════ FASE 4: filtrar a "en uso" + cascada ════════════════

    // 4.0 Productos componente de COMBO también están "en uso" (aunque no se
    // vendan sueltos). Los añadimos con la marca del combo que los referencia,
    // para que los slots de combo queden completos (deuda 0).
    for (const [comboId, comboInfo] of inUseCombos) {
      const oc = orgComboById.get(comboId);
      if (!oc) continue;
      for (const cat of (oc.categories ?? [])) {
        for (const p of (cat.products ?? [])) {
          const pid = p?.productId;
          if (pid && !inUseProducts.has(pid) && orgProductById.has(pid)) {
            inUseProducts.set(pid, {
              brandId: comboInfo.brandId, brandName: comboInfo.brandName,
              catExtId: null, catName: null,
            });
          }
        }
      }
    }

    // Grupos en uso = los asignados a productos en uso (org product.modifierGroups)
    const inUseGroupIds = new Set<string>();
    for (const prodId of inUseProducts.keys()) {
      const op = orgProductById.get(prodId);
      for (const gid of (op?.modifierGroups ?? [])) inUseGroupIds.add(gid);
    }

    // ════════════════ FASE 5: construir filas + casar/actualizar ════════════════

    const cuenta = (t: string): ContadorTabla => {
      const c = contadorNuevo();
      report.tablas[t] = c;
      return c;
    };

    // 5.1 menu_category
    const catRows: Array<any> = [];
    for (const [catExtId, info] of categoryRows) {
      catRows.push({
        account_id: accountId, brand_id: info.brandId, name: info.name || "(sin nombre)",
        external_source: "lastapp", external_id: catExtId,
      });
    }
    const catMap = await casarYActualizar(sb, "menu_category", accountId, catRows, dryRun, cuenta("menu_category"));
    report.categories = catRows.length;

    // 5.2 menu_item (productos)
    const itemRows: Array<any> = [];
    for (const [prodId, info] of inUseProducts) {
      const op = orgProductById.get(prodId);
      const name = op?.name ?? "(producto)";
      const priceCents = typeof op?.price === "number" ? op.price : 0;
      const catFolvyId = info.catExtId ? (catMap.get(info.catExtId) ?? null) : null;
      itemRows.push({
        account_id: accountId, brand_id: info.brandId, channel_id: null, recipe_item_id: null,
        name, price: priceCents / 100, product_type: "item",
        menu_category_id: catFolvyId,
        is_active: true,                       // está en la carta (estructural)
        is_available: op?.enabled !== false,   // agotado (enabled=false) -> no disponible, pero entra
        source: "import",
        external_source: "lastapp", external_id: prodId,
      });
    }
    // 5.3 menu_item (combos)
    for (const [comboId, info] of inUseCombos) {
      const oc = orgComboById.get(comboId);
      const name = oc?.name ?? "(combo)";
      const priceCents = typeof oc?.price === "number" ? oc.price : 0;
      itemRows.push({
        account_id: accountId, brand_id: info.brandId, channel_id: null, recipe_item_id: null,
        name, price: priceCents / 100, product_type: "combo",
        menu_category_id: null,
        is_active: true,
        is_available: oc?.enabled !== false,
        source: "import",
        external_source: "lastapp", external_id: comboId,
      });
    }
    const itemMap = await casarYActualizar(sb, "menu_item", accountId, itemRows, dryRun, cuenta("menu_item"));
    report.products = itemRows.filter((r) => r.product_type === "item").length;
    report.combos = itemRows.filter((r) => r.product_type === "combo").length;

    // 5.4 modifier_group
    const groupRows: Array<any> = [];
    const groupBrand = new Map<string, string>(); // groupExtId -> brand_id Folvy (1ª marca que lo usa)
    for (const prodId of inUseProducts.keys()) {
      const op = orgProductById.get(prodId);
      const bid = inUseProducts.get(prodId)!.brandId;
      for (const gid of (op?.modifierGroups ?? [])) {
        if (!groupBrand.has(gid)) groupBrand.set(gid, bid);
      }
    }
    for (const gid of inUseGroupIds) {
      const g = orgGroupById.get(gid);
      if (!g) continue;
      const brandId = groupBrand.get(gid);
      if (!brandId) continue;
      groupRows.push({
        account_id: accountId, brand_id: brandId,
        name: g.name ?? "(grupo)",
        min_selections: typeof g.min === "number" ? g.min : 0,
        max_selections: typeof g.max === "number" ? g.max : 1,
        group_type: inferGroupType(g.name ?? ""),
        external_source: "lastapp", external_id: gid,
      });
    }
    const groupMap = await casarYActualizar(sb, "modifier_group", accountId, groupRows, dryRun, cuenta("modifier_group"));
    report.modifier_groups = groupRows.length;

    // 5.5 modifier_option (de organizationModifiers: priceOverride manda)
    const optionRows: Array<any> = [];
    for (const gid of inUseGroupIds) {
      const g = orgGroupById.get(gid);
      const groupFolvyId = groupMap.get(gid);
      if (!g || !groupFolvyId) continue;
      let pos = 0;
      for (const om of (g.organizationModifiers ?? [])) {
        const mod = orgModifierById.get(om.modifierId);
        const optName = mod?.name ?? "(opción)";
        const priceImpact = typeof om.priceOverride === "number"
          ? om.priceOverride / 100
          : (typeof mod?.priceImpact === "number" ? mod.priceImpact / 100 : 0);
        optionRows.push({
          account_id: accountId, modifier_group_id: groupFolvyId,
          name: optName, price_impact: priceImpact, recipe_item_id: null,
          position: pos++,
          external_source: "lastapp", external_id: om.id, // id del organizationModifier (único en el grupo)
          // EL CÓDIGO QUE SÍ TRAEN LOS PEDIDOS (A1, 11/09). `om.id` es el
          // HUECO del extra dentro de esta pregunta; `om.modifierId` es EL
          // EXTRA, y es lo que llega en `organizationModifierId` cuando alguien
          // compra. Medido: de 53 referencias de pedidos cedidos en 30 días,
          // sólo 2 coincidían con algún `external_id`. Con esto pasan a casar
          // por código en vez de por nombre a ciegas.
          //
          // `external_id` NO se toca: sigue siendo la clave del importador, y
          // es lo único único por pregunta.
          pos_modifier_id: om.modifierId ?? null,
        });
      }
    }
    const optionMap = await casarYActualizar(sb, "modifier_option", accountId, optionRows, dryRun, cuenta("modifier_option"));
    void optionMap;
    report.modifier_options = optionRows.length;

    // 5.6 modifier_group_assignment (producto -> grupo)
    const assignRows: Array<any> = [];
    for (const [prodId, info] of inUseProducts) {
      const menuItemId = itemMap.get(`${info.brandId}|${prodId}`);
      if (!menuItemId) continue;
      const op = orgProductById.get(prodId);
      let pos = 0;
      for (const gid of (op?.modifierGroups ?? [])) {
        const groupFolvyId = groupMap.get(gid);
        if (!groupFolvyId) continue;
        assignRows.push({
          account_id: accountId, modifier_group_id: groupFolvyId,
          menu_item_id: menuItemId, position: pos++,
        });
      }
    }
    // Insert con tolerancia al duplicado (UNIQUE group+item) — ignora conflictos.
    if (!dryRun && assignRows.length > 0) {
      const { error: aErr } = await sb
        .from("modifier_group_assignment")
        .upsert(assignRows, { onConflict: "modifier_group_id,menu_item_id", ignoreDuplicates: true });
      if (aErr) report.warnings.push(`assignments: ${aErr.message}`);
    }
    report.assignments = assignRows.length;

    // 5.7 combo_slot + 5.8 combo_slot_option
    const slotRows: Array<any> = [];
    for (const [comboId, info] of inUseCombos) {
      const comboFolvyId = itemMap.get(`${info.brandId}|${comboId}`);
      const oc = orgComboById.get(comboId);
      if (!comboFolvyId || !oc) continue;
      let spos = 0;
      for (const cat of (oc.categories ?? [])) {
        slotRows.push({
          account_id: accountId, combo_item_id: comboFolvyId,
          name: cat.name ?? "(slot)",
          min_selections: typeof cat.min === "number" ? cat.min : 1,
          max_selections: typeof cat.max === "number" ? cat.max : 1,
          position: spos++,
          external_source: "lastapp", external_id: cat.id,
        });
      }
    }
    const slotMap = await casarYActualizar(sb, "combo_slot", accountId, slotRows, dryRun, cuenta("combo_slot"));
    report.combo_slots = slotRows.length;

    const slotOptRows: Array<any> = [];
    for (const [comboId, comboInfo] of inUseCombos) {
      const oc = orgComboById.get(comboId);
      const comboFolvyId = itemMap.get(`${comboInfo.brandId}|${comboId}`);
      if (!oc || !comboFolvyId) continue;
      for (const cat of (oc.categories ?? [])) {
        const slotFolvyId = slotMap.get(cat.id);
        if (!slotFolvyId) continue;
        let opos = 0;
        for (const p of (cat.products ?? [])) {
          const compInfo = inUseProducts.get(p.productId);
          const menuItemId = compInfo ? itemMap.get(`${compInfo.brandId}|${p.productId}`) : undefined;
          if (!menuItemId) {
            report.warnings.push(`combo slot "${cat.name}": producto ${p.productId} no está en uso, opción omitida`);
            continue;
          }
          slotOptRows.push({
            account_id: accountId, combo_slot_id: slotFolvyId,
            menu_item_id: menuItemId, modifier_group_id: null,
            price_impact: typeof p.priceImpact === "number" ? p.priceImpact / 100 : 0,
            position: opos++,
            external_source: "lastapp", external_id: p.id, // id de la categoría-producto (único)
          });
        }
      }
    }
    await casarYActualizar(sb, "combo_slot_option", accountId, slotOptRows, dryRun, cuenta("combo_slot_option"));
    report.combo_slot_options = slotOptRows.length;

    // ════════════════ FASE 6: lo que SOBRA, contado y listado ════════════════
    //
    // No se borra nada aquí. Un plato que desaparece de la carta de Last puede
    // ser una baja de verdad o una pasada incompleta de Last, y la diferencia
    // no se ve desde dentro de una pasada. Lo que sí se puede hacer —y hay que
    // hacer— es DECIRLO: la lista existe, con nombre, para que Julio decida.
    const marcasCedidasTocadas = [...new Set(
      [...inUseProducts.values(), ...inUseCombos.values()].map((v) => v.brandId),
    )];
    if (marcasCedidasTocadas.length > 0) {
      const idsDeLast = new Set(itemRows.map((r) => `${r.brand_id}|${r.external_id}`));
      const { data: vivos, error: vErr } = await sb
        .from("menu_item")
        .select("id, name, brand_id, external_id, is_active")
        .eq("account_id", accountId)
        .eq("external_source", "lastapp")
        .is("archived_at", null)
        .in("brand_id", marcasCedidasTocadas);
      if (vErr) {
        report.warnings.push(`sobrantes: ${vErr.message}`);
      } else {
        const sobra = (vivos ?? []).filter(
          (m: any) => !idsDeLast.has(`${m.brand_id}|${m.external_id}`),
        );
        report.sobrantes.platos_que_last_no_sirve = sobra.length;
        report.sobrantes.platos_que_last_no_sirve_ejemplo = sobra.slice(0, 15).map((m: any) => ({
          plato: m.name,
          marca: marcaPorId.get(m.brand_id)?.name ?? m.brand_id,
          activo_en_folvy: m.is_active,
        }));
        // Asignaciones grupo->plato que Folvy tiene y Last ya no manda. Mismo
        // criterio: se cuentan, no se borran. Este número es el que dirá si la
        // pantalla de Modificadores está enseñando preguntas que el cliente ya
        // no ve.
        const idsVivos = new Set((vivos ?? []).map((m: any) => m.id as string));
        const asignacionesDeLast = new Set(
          assignRows.map((a) => `${a.modifier_group_id}|${a.menu_item_id}`),
        );
        const listaVivos = [...idsVivos];
        let sobranAsig = 0;
        let falloAsig = false;
        for (let i = 0; i < listaVivos.length; i += 200) {
          const { data: asigActuales, error: asErr } = await sb
            .from("modifier_group_assignment")
            .select("modifier_group_id, menu_item_id")
            .eq("account_id", accountId)
            .in("menu_item_id", listaVivos.slice(i, i + 200));
          if (asErr) {
            report.warnings.push(`asignaciones sobrantes: ${asErr.message}`);
            falloAsig = true;
            break;
          }
          sobranAsig += (asigActuales ?? []).filter(
            (a: any) => !asignacionesDeLast.has(`${a.modifier_group_id}|${a.menu_item_id}`),
          ).length;
        }
        // Si la medición falló a medias NO se publica media cifra: un número
        // incompleto presentado como completo es peor que no tenerlo (regla 31).
        report.sobrantes.asignaciones_que_last_no_tiene = falloAsig ? null : sobranAsig;

        // Al revés: platos que Folvy tiene apagados y Last SÍ sirve. Es lo que
        // `aplicar_activo` encendería.
        const apagados = (vivos ?? []).filter(
          (m: any) => m.is_active === false && idsDeLast.has(`${m.brand_id}|${m.external_id}`),
        );
        report.sobrantes.platos_inactivos_que_last_si_sirve = apagados.length;
        if (aplicarActivo && !dryRun && apagados.length > 0) {
          for (let i = 0; i < apagados.length; i += 20) {
            const tanda = apagados.slice(i, i + 20);
            const res = await Promise.all(
              tanda.map((m: any) =>
                sb.from("menu_item")
                  .update({ is_active: true, updated_at: new Date().toISOString() })
                  .eq("id", m.id)
              ),
            );
            for (const r of res) if (r.error) report.warnings.push(`activo: ${r.error.message}`);
          }
        }
      }
    }

    // Resumen de marcas en uso RESUELTAS (excluye las no resueltas, ya listadas aparte).
    report.brands_in_use = [...new Set([...inUseProducts.values()].map((v) => v.brandName))]
      .filter((bn) => !report.brands_unresolved.includes(bn));

    return jsonResponse({ ok: true, ...report });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e), partial: report }, 500);
  }
});
