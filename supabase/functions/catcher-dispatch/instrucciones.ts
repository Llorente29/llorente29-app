// supabase/functions/catcher-dispatch/instrucciones.ts
//
// R03 · Lo que va en `orderInstructions` de Catcher. Aparte de index.ts y sin
// dependencias de Deno, para probarlo con vitest
// (tests/unit/modules/reparto/instruccionesCatcher.test.ts).
//
// El teléfono de Uber es una centralita que solo conecta con el código de
// acceso. No sabemos qué campo enseña la app del repartidor, así que va AL
// PRINCIPIO de las instrucciones: «Tel. centralita <tel> + código <código>».

/** «Tel. centralita <tel> + código <código>» delante de la nota, si hay código. */
export function instruccionesParaCatcher(nota: string | null, telefono: string | null, codigo: string | null): string {
  const n = (nota ?? "").trim();
  const c = (codigo ?? "").trim();
  if (!c) return n;
  const t = (telefono ?? "").trim();
  const cab = `Tel. centralita${t ? " " + t : ""} + código ${c}`;
  return n ? `${cab} · ${n}` : cab;
}
