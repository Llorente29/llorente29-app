// src/modules/conta/ajustes/useSeries.ts
//
// S01e · Cuántas series de facturas tiene la empresa, para la línea de
// «Numeración» del índice de Ajustes. Se cuentan igual que en la tabla
// (cuantosConceptos): el índice y la pantalla no pueden decir cosas distintas.
// null mientras carga o si no se ha podido leer (entonces no dice nada).

import { useEffect, useState } from 'react'
import { cargarTabla } from '@/modules/conta/services/tablasService'
import { cuantosConceptos, definicion } from '@/modules/conta/tablas/registro'

export function useSeries(companyId: string | null, hoy: string): number | null {
  const [n, setN] = useState<{ clave: string; n: number | null } | null>(null)
  useEffect(() => {
    const def = definicion('numeracion')
    if (!companyId || !def) return
    let vivo = true
    cargarTabla(companyId, def)
      .then((filas) => { if (vivo) setN({ clave: companyId, n: cuantosConceptos(def, filas, hoy) }) })
      .catch(() => { if (vivo) setN({ clave: companyId, n: null }) })
    return () => { vivo = false }
  }, [companyId, hoy])
  return n && n.clave === companyId ? n.n : null
}
