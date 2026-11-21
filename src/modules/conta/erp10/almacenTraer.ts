// src/modules/conta/erp10/almacenTraer.ts
//
// X12 · Dónde guarda el lector de «Traer de ERP10» cada página leída, para seguir donde se quedó
// aunque se cierre la pestaña: en el navegador (IndexedDB), en la base «sumied-traer-erp10». Lo
// leído es de quien lo trae, como un fichero que se suelta: no sale de su navegador hasta «Traerlo».
// Si el navegador no deja guardar (una ventana privada, sin espacio), se queda en memoria: se puede
// traer igual, pero si se cierra la pestaña se empieza de nuevo.

import type { AlmacenTraer } from './lectorTraer'

const BASE = 'sumied-traer-erp10'
const CAJA = 'paginas'

/** En memoria (las pruebas, y cuando el navegador no deja guardar). */
export function almacenEnMemoria(): AlmacenTraer & { cosas: Map<string, unknown> } {
  const cosas = new Map<string, unknown>()
  return {
    cosas,
    leer: async (prefijo) => [...cosas.entries()].filter(([k]) => k.startsWith(prefijo)).map(([k, v]) => [k, structuredClone(v)] as [string, unknown]),
    guardar: async (k, v) => { cosas.set(k, structuredClone(v)) },
    borrar: async (prefijo) => { for (const k of [...cosas.keys()]) if (k.startsWith(prefijo)) cosas.delete(k) },
  }
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BASE, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(CAJA)) r.result.createObjectStore(CAJA) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error ?? new Error('No se ha podido abrir el almacén del navegador'))
  })
}
const hecho = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error) })
const rango = (prefijo: string) => IDBKeyRange.bound(prefijo, `${prefijo}￿`)

/** En IndexedDB; si no se puede, en memoria. */
export function almacenDelNavegador(): AlmacenTraer {
  const memoria = almacenEnMemoria()
  let db: Promise<IDBDatabase | null> | null = null
  const base = () => (db ??= (typeof indexedDB === 'undefined' ? Promise.resolve(null) : abrir().catch(() => null)))
  return {
    async leer(prefijo) {
      const d = await base()
      if (!d) return memoria.leer(prefijo)
      try {
        const t = d.transaction(CAJA, 'readonly'), s = t.objectStore(CAJA)
        const [claves, valores] = await Promise.all([
          new Promise<IDBValidKey[]>((res, rej) => { const r = s.getAllKeys(rango(prefijo)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }),
          new Promise<unknown[]>((res, rej) => { const r = s.getAll(rango(prefijo)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }),
        ])
        return claves.map((k, i) => [String(k), valores[i]] as [string, unknown])
      } catch { return memoria.leer(prefijo) }
    },
    async guardar(k, v) {
      await memoria.guardar(k, v)
      const d = await base()
      if (!d) return
      try { const t = d.transaction(CAJA, 'readwrite'); t.objectStore(CAJA).put(v, k); await hecho(t) } catch { /* se queda en memoria */ }
    },
    async borrar(prefijo) {
      await memoria.borrar(prefijo)
      const d = await base()
      if (!d) return
      try { const t = d.transaction(CAJA, 'readwrite'); t.objectStore(CAJA).delete(rango(prefijo)); await hecho(t) } catch { /* nada que borrar */ }
    },
  }
}
