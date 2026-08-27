// supabase/functions/edge-drift-watchdog/index.ts
//
// VIGIA DE DIVERGENCIA: LO DESPLEGADO vs `main`.
// ============================================================================
// POR QUE EXISTE. El 13/08 un despliegue de hubrise-webhook se llevo por
// delante dos arreglos que solo vivian en la version desplegada: la captura de
// `collection_code` -> `platform_order_code` (14 dias, 148 pedidos sin el
// codigo que ve el cliente) y `resolveHubriseToken` por conexion (el 404 del
// push). Ninguna de las dos estaba commiteada, y nada comparaba produccion con
// el repositorio, asi que no salto nada.
//
// REPARTO DE RESPONSABILIDAD. Esta funcion recoge HECHOS y no juzga:
//   - que Edge Functions hay desplegadas, con que version y de que fecha
//     (Management API de Supabase)
//   - que hay en `main` para cada una, y de cuando es su ultimo commit
//     (API de GitHub)
//   - si el contenido coincide, fichero a fichero
// El juicio (que es normal, que es divergencia, como de grave) vive en SQL:
// edge_drift_registrar() lo decide y edge_drift_watchdog() avisa. Asi se puede
// revisar y corregir el criterio sin volver a desplegar esta funcion --
// justamente el problema que este vigia existe para detectar.
//
// COMPARACION EXACTA, SIN NORMALIZAR NADA. Del lado de GitHub se pide el ARBOL
// (`git/trees?recursive=1`), que trae el sha1 de blob de cada fichero. Del lado
// desplegado se calcula ESE MISMO sha1 sobre los bytes que devuelve la API:
//     sha1("blob " + longitud + "\0" + bytes)
// Es la identidad que usa git. Si coinciden, el fichero es byte a byte el de
// main; si no, difiere. Sin trims, sin normalizar saltos de linea, sin
// heuristicas que puedan tapar una diferencia real.
//
// SE COMPARAN TODOS LOS FICHEROS DEL BUNDLE, no solo index.ts: un cambio en
// `_shared/hubrisePush.ts` es exactamente lo que se perdio el 13/08.
//
// SI NO SE PUEDE LEER EL FUENTE DESPLEGADO. El endpoint de la Management API
// que devuelve el cuerpo de una funcion no tiene contrato publicado. Si no
// responde algo legible, esta funcion NO inventa: marca `contenido:
// 'no_comprobable'` y deja que el SQL caiga al criterio por fechas (mas flojo,
// documentado en la migracion). Nunca da por bueno lo que no ha podido leer.
//
// MODO SECO: `?dry=1` devuelve la tabla comparada y NO avisa ni escribe estado.
// Es el modo con el que se estrena, para ver que la comparacion de contenido
// funciona de verdad antes de dejar que mande correos.
//
// Se despliega con --no-verify-jwt (lo invoca pg_cron; la seguridad la hace
// CRON_SECRET).
//
// Variables de entorno (secrets):
//   CRON_SECRET             -- compartido cron <-> functions internas (ya existe)
//   MGMT_API_TOKEN          -- PAT de Supabase (Management API)             [NUEVO]
//   GITHUB_TOKEN            -- PAT de GitHub, permiso Contents: read-only   [NUEVO]
//
// OJO CON EL NOMBRE: NO se llama SUPABASE_ACCESS_TOKEN. El prefijo `SUPABASE_`
// esta reservado por la plataforma (ahi viven SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, etc., inyectadas automaticamente) y un secret
// propio con ese prefijo puede rechazarse al guardarlo. De ahi MGMT_API_TOKEN.
//   GITHUB_REPO             -- "Llorente29/llorente29-app" (por defecto)
//   GITHUB_BRANCH           -- "main" (por defecto)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- inyectadas por la plataforma

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const MGMT_API = "https://api.supabase.com/v1";
const GH_API = "https://api.github.com";
const FUNC_DIR = "supabase/functions";
const CONCURRENCIA = 5;

type Contenido = "igual" | "distinto" | "no_comprobable";

interface Fila {
  slug: string;
  repo_path: string | null;
  repo_blob_sha: string | null;
  repo_commit_at: string | null;
  desplegada: boolean;
  deploy_version: number | null;
  deploy_bundle_sha: string | null;
  deploy_at: string | null;
  contenido: Contenido;
  contenido_detalle: string | null;
}

// ── sha1 de blob de git sobre unos bytes ────────────────────────────────────
// git identifica un fichero por sha1("blob " + longitud_en_bytes + "\0" + bytes).
// Calcularlo aqui permite comparar contra el sha que ya viene en el arbol de
// GitHub sin descargar ni un fichero del repositorio.
async function gitBlobSha1(bytes: Uint8Array): Promise<string> {
  const cabecera = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const buf = new Uint8Array(cabecera.byteLength + bytes.byteLength);
  buf.set(cabecera, 0);
  buf.set(bytes, cabecera.byteLength);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Ejecuta `tareas` con un tope de concurrencia. Sin esto, 60 funciones lanzan
// 60 peticiones a la vez y GitHub responde 403 por abuso.
async function enTandas<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const obreros = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(obreros);
  return out;
}

// ── Lado desplegado: que Edge Functions corren ──────────────────────────────
async function listarDesplegadas(ref: string, pat: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`${MGMT_API}/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!r.ok) throw new Error(`Management API /functions: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("Management API /functions: se esperaba un array");
  return j as Array<Record<string, unknown>>;
}

// ── Lado desplegado: el fuente ──────────────────────────────────────────────
// El contrato de este endpoint no esta publicado. Se acepta lo que se pueda
// leer y se devuelve null cuando no; nunca se da por bueno lo no leido.
// Devuelve el mapa "ruta dentro del bundle" -> bytes.
async function leerFuenteDesplegado(
  ref: string, pat: string, slug: string,
): Promise<{ mapa: Map<string, Uint8Array> | null; diag: string }> {
  let r: Response;
  try {
    r = await fetch(`${MGMT_API}/projects/${ref}/functions/${encodeURIComponent(slug)}/body`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
    });
  } catch (e) {
    return { mapa: null, diag: `red: ${e instanceof Error ? e.message : String(e)}` };
  }

  const tipo = (r.headers.get("content-type") ?? "").toLowerCase();

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { mapa: null, diag: `HTTP ${r.status} (${tipo || "sin content-type"}) ${t.slice(0, 140)}` };
  }
  if (!tipo.includes("json")) {
    await r.body?.cancel();
    return { mapa: null, diag: `HTTP ${r.status} content-type=${tipo || "vacio"} (no es JSON)` };
  }

  let j: unknown;
  try { j = await r.json(); } catch { return { mapa: null, diag: `HTTP ${r.status} JSON ilegible` }; }

  // Forma esperada: { files: [{ name, content }] }. Cualquier otra -> no leible.
  const files = (j as { files?: unknown })?.files;
  if (!Array.isArray(files) || files.length === 0) {
    const claves = (j && typeof j === "object") ? Object.keys(j as object).slice(0, 8).join(",") : typeof j;
    return { mapa: null, diag: `HTTP ${r.status} JSON sin files[]; claves=${claves}` };
  }

  const mapa = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  let sinContenido = 0;
  for (const f of files) {
    const nombre = (f as { name?: unknown })?.name;
    const contenido = (f as { content?: unknown })?.content;
    if (typeof nombre !== "string" || typeof contenido !== "string") { sinContenido++; continue; }
    mapa.set(nombre, enc.encode(contenido));
  }
  if (!mapa.size) {
    return { mapa: null, diag: `HTTP ${r.status} files[${files.length}] pero ninguno con name+content` };
  }
  return { mapa, diag: `ok: ${mapa.size} ficheros${sinContenido ? `, ${sinContenido} sin contenido` : ""}` };
}

// Traduce el nombre de un fichero DENTRO del bundle a su ruta en el repositorio.
// Observado: "functions/hubrise-webhook/index.ts", "functions/_shared/cors.ts".
// Algunas funciones se desplegaron desde otra raiz y llegan como "index.ts".
function rutaEnRepo(nombreBundle: string, slug: string): string {
  const n = nombreBundle.replace(/^\.?\//, "");
  if (n.startsWith("supabase/functions/")) return n;
  if (n.startsWith("functions/")) return `supabase/${n}`;
  return `${FUNC_DIR}/${slug}/${n}`;
}

// ── Lado repositorio: el arbol de main ──────────────────────────────────────
async function arbolDeMain(repo: string, rama: string, token: string): Promise<Map<string, string>> {
  const r = await fetch(`${GH_API}/repos/${repo}/git/trees/${encodeURIComponent(rama)}?recursive=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`GitHub /git/trees: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { tree?: Array<{ path?: string; type?: string; sha?: string }>; truncated?: boolean };
  if (j.truncated) throw new Error("GitHub /git/trees: respuesta truncada; el arbol no cabe en una llamada");
  const mapa = new Map<string, string>();
  for (const n of j.tree ?? []) {
    if (n.type === "blob" && typeof n.path === "string" && typeof n.sha === "string") mapa.set(n.path, n.sha);
  }
  return mapa;
}

// Fecha del ultimo commit de `main` que toco la carpeta de la funcion.
async function ultimoCommit(repo: string, rama: string, token: string, ruta: string): Promise<string | null> {
  const url = `${GH_API}/repos/${repo}/commits?sha=${encodeURIComponent(rama)}`
    + `&path=${encodeURIComponent(ruta)}&per_page=1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const j = await r.json() as Array<{ commit?: { committer?: { date?: string } } }>;
  return j?.[0]?.commit?.committer?.date ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || got !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const pat = Deno.env.get("MGMT_API_TOKEN") ?? "";
  const ghToken = Deno.env.get("GITHUB_TOKEN") ?? "";
  const repo = Deno.env.get("GITHUB_REPO") ?? "Llorente29/llorente29-app";
  const rama = Deno.env.get("GITHUB_BRANCH") ?? "main";
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const ref = supaUrl.replace(/^https?:\/\//, "").split(".")[0];

  const faltan: string[] = [];
  if (!pat) faltan.push("MGMT_API_TOKEN");
  if (!ghToken) faltan.push("GITHUB_TOKEN");
  if (!ref) faltan.push("SUPABASE_URL");
  if (faltan.length) {
    // Un vigia que no puede vigilar tiene que DECIRLO, no devolver ok.
    return new Response(JSON.stringify({ ok: false, error: `faltan secrets: ${faltan.join(", ")}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const [desplegadas, arbol] = await Promise.all([
      listarDesplegadas(ref, pat),
      arbolDeMain(repo, rama, ghToken),
    ]);

    // Slugs = union de lo desplegado y lo que hay en supabase/functions/ en main.
    // La union importa: una funcion desplegada que NO esta en main es el caso
    // mas grave, y no aparece si solo se mira el repositorio.
    const slugsRepo = new Set<string>();
    for (const p of arbol.keys()) {
      const m = p.match(/^supabase\/functions\/([^/]+)\/index\.ts$/);
      if (m && m[1] !== "_shared") slugsRepo.add(m[1]);
    }
    const porSlug = new Map<string, Record<string, unknown>>();
    for (const f of desplegadas) {
      const s = f["slug"];
      if (typeof s === "string") porSlug.set(s, f);
    }
    const slugs = Array.from(new Set([...porSlug.keys(), ...slugsRepo])).sort();

    // Estado anterior: sirve para no volver a preguntar la fecha del ultimo
    // commit de una funcion cuyo fichero no ha cambiado (60 llamadas menos).
    const sb = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false },
    });
    const previo = new Map<string, { repo_blob_sha: string | null; repo_commit_at: string | null }>();
    const { data: prevRows } = await sb.from("edge_function_deploy_state")
      .select("slug, repo_blob_sha, repo_commit_at");
    for (const r of (prevRows ?? []) as Array<Record<string, unknown>>) {
      previo.set(r["slug"] as string, {
        repo_blob_sha: (r["repo_blob_sha"] as string | null) ?? null,
        repo_commit_at: (r["repo_commit_at"] as string | null) ?? null,
      });
    }

    const filas = await enTandas<string, Fila>(slugs, CONCURRENCIA, async (slug) => {
      const dep = porSlug.get(slug) ?? null;
      const repoPath = `${FUNC_DIR}/${slug}/index.ts`;
      const blobSha = arbol.get(repoPath) ?? null;

      // Fecha del ultimo commit: solo se pregunta si el fichero cambio desde
      // la ultima vuelta (o si no habia dato).
      const antes = previo.get(slug);
      let commitAt: string | null = null;
      if (blobSha) {
        commitAt = (antes && antes.repo_blob_sha === blobSha && antes.repo_commit_at)
          ? antes.repo_commit_at
          : await ultimoCommit(repo, rama, ghToken, `${FUNC_DIR}/${slug}`);
      }

      let contenido: Contenido = "no_comprobable";
      let detalle: string | null = null;

      if (dep) {
        const { mapa: bundle, diag } = await leerFuenteDesplegado(ref, pat, slug);
        // Por que no se pudo comparar: se guarda tal cual. Un vigia que no
        // puede leer tiene que decir POR QUE, no encogerse de hombros.
        if (!bundle) detalle = diag;
        if (bundle) {
          const distintos: string[] = [];
          let comparados = 0;
          for (const [nombre, bytes] of bundle) {
            const ruta = rutaEnRepo(nombre, slug);
            const shaRepo = arbol.get(ruta);
            // Un fichero del bundle que no existe en main solo cuenta si es
            // codigo nuestro; los generados del despliegue (deno.json que no
            // esta versionado, etc.) no se inventan como divergencia.
            if (!shaRepo) {
              if (ruta === repoPath) distintos.push(`${ruta} (no esta en main)`);
              continue;
            }
            comparados++;
            const shaDesplegado = await gitBlobSha1(bytes);
            if (shaDesplegado !== shaRepo) distintos.push(ruta);
          }
          if (comparados > 0 || distintos.length > 0) {
            contenido = distintos.length ? "distinto" : "igual";
            if (distintos.length) detalle = distintos.slice(0, 6).join(", ")
              + (distintos.length > 6 ? ` (+${distintos.length - 6} mas)` : "");
          }
        }
      }

      return {
        slug,
        repo_path: blobSha ? repoPath : null,
        repo_blob_sha: blobSha,
        repo_commit_at: commitAt,
        desplegada: !!dep,
        deploy_version: dep ? Number(dep["version"] ?? 0) || null : null,
        deploy_bundle_sha: dep ? (dep["ezbr_sha256"] as string | null) ?? null : null,
        deploy_at: dep && dep["updated_at"] ? new Date(Number(dep["updated_at"])).toISOString() : null,
        contenido,
        contenido_detalle: detalle,
      };
    });

    if (dry) {
      return new Response(JSON.stringify({
        ok: true, modo: "seco", funciones: filas.length,
        contenido_legible: filas.filter((f) => f.contenido !== "no_comprobable").length,
        filas,
      }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: resumen, error: regErr } = await sb.rpc("edge_drift_registrar", { p_rows: filas });
    if (regErr) throw new Error(`edge_drift_registrar: ${regErr.message}`);

    const { data: avisadas, error: avErr } = await sb.rpc("edge_drift_watchdog");
    if (avErr) throw new Error(`edge_drift_watchdog: ${avErr.message}`);

    return new Response(JSON.stringify({
      ok: true, funciones: filas.length,
      contenido_legible: filas.filter((f) => f.contenido !== "no_comprobable").length,
      resumen, divergentes: avisadas,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("edge-drift-watchdog", msg);
    // 500 a proposito: un vigia que falla en silencio es peor que no tenerlo.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
