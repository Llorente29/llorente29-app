// src/modules/conta/ventas/PdfsQueFaltan.tsx
//
// V01 · El histórico (tanda 20261024T1730): las facturas emitidas que aún no
// tienen su PDF (los traídos de Diez, que la tanda deja con su factura pero
// sin papel). «Hacer los N PDF» los hace aquí, en el navegador, con la misma
// plantilla y el mismo guardado que una factura emitida a mano
// (facturaVentaPdf + conta_venta_pdf_guardar, que lo deja también junto a su
// asiento para el traspaso del mes). Nada se envía a Diez.
//
// Sale solo si hay alguna sin PDF; dice cuántas y, al acabar, cuántas ha
// hecho y cuáles no y por qué (regla 8). «Volver a intentarlo» las hace otra
// vez (V01b), con la misma cuenta al acabar: las que ya lo tienen no se tocan.
// Nombres dentro de cadenas (regla 40): customer_invoice (status, pdf_path,
// account_id, company_id), de la 0835.

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { useLeer } from '@/modules/conta/libros/contexto'
import { facturasSinPdf, hacerPdfs } from '@/modules/conta/services/pdfsQueFaltanService'

export function PdfsQueFaltan({ accountId, companyId }: { accountId: string; companyId: string }) {
  const [vuelta, setVuelta] = useState(0)
  const [paso, setPaso] = useState<{ hechas: number; total: number } | null>(null)
  const [fin, setFin] = useState<{ hechas: number; fallos: { id: string; numero: string | null; motivo: string }[] } | null>(null)
  const sin = useLeer(() => facturasSinPdf(accountId, companyId), `${accountId}:${companyId}:sin-pdf:${vuelta}`)
  const ids = sin.datos ?? []
  if (sin.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">{sin.error}</p>
  if (!fin && ids.length === 0) return null
  const n = ids.length
  // Las que faltan, de una en una; al acabar, cuántas y cuáles no, con su motivo (regla 8).
  const hacer = async () => {
    setFin(null)
    setPaso({ hechas: 0, total: n })
    const r = await hacerPdfs(accountId, companyId, ids, (h) => setPaso({ hechas: h, total: n }))
    setPaso(null); setFin(r); setVuelta((v) => v + 1)
  }
  return (
    <div className="s-aviso-lista" data-tono={fin ? (fin.fallos.length ? 'duda' : 'ok') : 'duda'} role="status" data-prueba="pdfs-que-faltan">
      {fin ? (
        <>
          <p><strong>Hechos {fin.hechas.toLocaleString('es-ES')} PDF</strong>, cada uno guardado con su factura y junto a su asiento.{fin.fallos.length ? ` No se han podido hacer ${fin.fallos.length.toLocaleString('es-ES')}:` : ''}</p>
          {fin.fallos.length > 0 && <ul>{fin.fallos.slice(0, 10).map((f) => <li key={f.id}>{f.numero ?? f.id}: {f.motivo}</li>)}{fin.fallos.length > 10 && <li>y {fin.fallos.length - 10} más</li>}</ul>}
          {n > 0 && <Boton variante="secundario" disabled={!!paso || sin.datos === null} onClick={hacer}>Volver a intentarlo con las {n.toLocaleString('es-ES')} que faltan</Boton>}
        </>
      ) : (
        <p>
          <strong>{n === 1 ? 'Una factura emitida no tiene' : `${n.toLocaleString('es-ES')} facturas emitidas no tienen`} su PDF</strong> (las traídas de Diez, sobre todo). Se hacen aquí, desde su factura, y se guardan junto a su asiento; no se envía nada a Diez.{' '}
          <Boton variante="principal" disabled={!!paso} onClick={hacer}>{paso ? `Haciendo ${paso.hechas.toLocaleString('es-ES')} de ${paso.total.toLocaleString('es-ES')}…` : `Hacer ${n === 1 ? 'su PDF' : `los ${n.toLocaleString('es-ES')} PDF`}`}</Boton>
        </p>
      )}
    </div>
  )
}
