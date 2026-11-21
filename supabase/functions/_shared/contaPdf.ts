// supabase/functions/_shared/contaPdf.ts
//
// B01r·26 · Lo que conta-pdf contesta sin el PDF, en un sitio que se prueba sin
// Deno ni base (tests/unit/conta/contaPdf.test.ts): el método, la forma de la
// llave y el resultado de conta_pdf_servir. Devuelve la respuesta, o null si hay
// que servir el PDF.

export const LLAVE = /^[0-9a-f]{32}$/;

const cabeceras = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export function decidir(o: { metodo: string; llave: string; resultado?: string; fallo?: boolean }): Response | null {
  if (o.metodo !== "GET" && o.metodo !== "HEAD") return new Response("Solo GET.", { status: 405, headers: { ...cabeceras, Allow: "GET, HEAD" } });
  if (o.fallo) return new Response("No se ha podido servir el documento.", { status: 500, headers: cabeceras });
  // Una llave mal formada ni siquiera llega a la base.
  if (!LLAVE.test(o.llave)) return new Response("No existe.", { status: 404, headers: cabeceras });
  if (o.resultado === undefined) return null;
  if (o.resultado === "servido") return null;
  if (o.resultado === "tope") return new Response("Demasiadas peticiones para este documento. Prueba dentro de una hora.", { status: 429, headers: { ...cabeceras, "Retry-After": "3600" } });
  // retirada, anulado o no_existe: la misma respuesta.
  return new Response("No existe.", { status: 404, headers: cabeceras });
}
