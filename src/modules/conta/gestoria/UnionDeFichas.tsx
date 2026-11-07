// src/modules/conta/gestoria/UnionDeFichas.tsx
//
// G01b · «Unir las fichas repetidas», en la tarjeta de Bitrix24 de Ajustes ›
// Cobros (Julio, 07/11):
//   · «Ver qué se va a unir (PDF)»: un ensayo con los datos que lee la función
//     en ese momento; lo genera el navegador y se descarga. No cambia nada.
//   · «Aplicar la unión y leer»: después de revisar el PDF. Dice antes qué va a
//     pasar y después lo que ha hecho (regla 8).
// Sin aplicar, cada ficha va sola; las que chocan salen en «Pendiente de
// revisar» y la lectura sigue.

import { useState } from 'react'
import type { MapaBitrix } from './queEsCadaCampo'
import { descargarEnsayo, type DatosEnsayo } from './pdfUnion'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const fechaHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`
}

export function UnionDeFichas({ mapa, alEnsayar, alAplicar, descargar = descargarEnsayo }: {
  mapa: MapaBitrix | null
  alEnsayar: () => Promise<DatosEnsayo>
  alAplicar: () => Promise<string>
  /** Quién descarga el PDF (en las pruebas y las capturas, uno que no baja nada). */
  descargar?: (d: DatosEnsayo) => void
}) {
  const [ocupado, setOcupado] = useState<'ensayo' | 'aplicar' | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [visto, setVisto] = useState<DatosEnsayo | null>(null)
  const confirmado = !!mapa?.confirmado
  const union = mapa?.union ?? null

  const ensayar = async () => {
    setOcupado('ensayo'); setAviso(null)
    try {
      const d = await alEnsayar()
      descargar(d)
      setVisto(d)
      const r = d.resumen
      setAviso({ ok: true, texto: `PDF descargado: ${miles(r.fichas)} fichas darían ${miles(r.clientes)} clientes; ${miles(r.fichasUnidas)} fichas se unen en ${miles(r.clientesUnidos)} clientes y ${miles(r.sinNifPorFormato + r.sinNifPorMuchas)} entran sin NIF. No se ha cambiado nada.` })
    } catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(null) }
  }
  const aplicar = async () => {
    setOcupado('aplicar'); setAviso(null)
    try { setAviso({ ok: true, texto: await alAplicar() }); setAbierto(false) }
    catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(null) }
  }

  return (
    <section className="cxg-mapa" aria-labelledby="unir-fichas" data-prueba="unir-fichas">
      <h3 id="unir-fichas" className="cxg-ficha-sub">Unir las fichas repetidas</h3>
      <p className="cxg-apoyo">
        Un mismo NIF es un solo cliente en Sumied, con todas sus fichas de Bitrix24 enlazadas, y su situación es la más viva de ellas
        (activo, moroso, solo la renta, sin clasificar, de baja). Un NIF sin formato de DNI, NIE o CIF, o que sale en 10 fichas o más, no se usa:
        esas fichas entran sin NIF, cada una aparte. Todo sale en «Pendiente de revisar».
      </p>
      {union
        ? <p className="cxg-mapa-estado" data-tono="verde" role="status">Unión aplicada{union.quien ? ` por ${union.quien}` : ''} el {fechaHora(union.cuando)}.</p>
        : <p className="cxg-nota">Sin aplicar: cada ficha va sola. Las que chocan con otra por el NIF no se guardan y salen en «Pendiente de revisar»; la lectura sigue con las demás.</p>}
      {!confirmado && <p className="s-aviso-lista" data-tono="falta" role="alert">Primero hay que confirmar «Qué es cada campo»: sin él no se sabe la situación de cada ficha.</p>}

      <div className="cxg-paso-botones">
        <button type="button" className="cxg-boton" onClick={() => void ensayar()} disabled={!confirmado || !!ocupado}>
          {ocupado === 'ensayo' ? 'Leyendo Bitrix24…' : 'Ver qué se va a unir (PDF)'}</button>
        {!union && !abierto && (
          <button type="button" className="cxg-boton cxg-boton-principal" onClick={() => setAbierto(true)} disabled={!confirmado || !!ocupado}>Aplicar la unión y leer</button>
        )}
      </div>
      {!union && abierto && (
        <div className="cxg-paso" role="group" aria-label="Aplicar la unión">
          <p className="cxg-paso-aviso">
            Desde ahora, cada lectura une en un solo cliente las fichas con el mismo NIF, y se leen de nuevo las fichas de Bitrix24 (solo se lee: no se cambia nada en Bitrix24).
            {visto ? ` Según el ensayo de hace un momento: ${miles(visto.resumen.clientes)} clientes, ${miles(visto.resumen.fichasUnidas)} fichas unidas y ${miles(visto.resumen.sinNifPorFormato + visto.resumen.sinNifPorMuchas)} sin NIF.` : ' Revisa antes el PDF del ensayo.'}
          </p>
          <div className="cxg-paso-botones">
            <button type="button" className="cxg-boton cxg-boton-principal" onClick={() => void aplicar()} disabled={!!ocupado}>{ocupado === 'aplicar' ? 'Aplicando y leyendo…' : 'Aplicar y leer'}</button>
            <button type="button" className="cx-enlace" onClick={() => setAbierto(false)} disabled={!!ocupado}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
    </section>
  )
}
