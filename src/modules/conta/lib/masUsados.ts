// src/modules/conta/lib/masUsados.ts
//
// «Los más usados van primero» (encargo C01b §5): las opciones de un
// desplegable o unas píldoras se ordenan por cuántos proveedores de la cuenta
// las tienen puestas, de más a menos. A igualdad, se respeta el orden de la
// tabla (el que trae la lista). Ordena; nunca quita una opción (regla 7).

export function porUso<T>(opciones: readonly T[], clave: (o: T) => string, usados: readonly (string | null | undefined)[]): T[] {
  const cuenta = new Map<string, number>()
  for (const u of usados) if (u) cuenta.set(u, (cuenta.get(u) ?? 0) + 1)
  return opciones
    .map((o, i) => ({ o, i, n: cuenta.get(clave(o)) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.o)
}
