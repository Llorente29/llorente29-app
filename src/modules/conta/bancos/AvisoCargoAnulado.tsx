// src/modules/conta/bancos/AvisoCargoAnulado.tsx
//
// B01·20 · El aviso de Bancos, en la cuenta, cuando el banco anuló un cargo que
// la lectura ya había traído (maqueta aprobada por Julio, 07/11, fiel): el
// título, el porqué en una frase, el cargo (o los cargos) con [Quitarlo] y
// [No, es bueno], y las dos cifras. Cuándo sale lo decide la base
// (bank_cargos_anulados); los textos, lib/cargoAnulado.ts.

import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { textosAviso, type AvisoAnulado } from '@/modules/conta/lib/cargoAnulado'

export function AvisoCargoAnulado({ aviso, ocupado, alQuitar, alEsBueno }: {
  aviso: AvisoAnulado
  ocupado: boolean
  alQuitar: () => void
  alEsBueno: () => void
}) {
  const t = textosAviso(aviso)
  const uno = aviso.cargos.length === 1
  const botones = (
    <span className="cxb-anulado-botones">
      <button type="button" className="cx-boton" disabled={ocupado} onClick={alQuitar}>{ocupado ? 'Quitando…' : uno ? 'Quitarlo' : 'Quitarlos'}</button>
      <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={alEsBueno}>{uno ? 'No, es bueno' : 'No, son buenos'}</button>
    </span>
  )
  return (
    <section className="cxb-anulado" role="status" aria-label={t.titulo} data-testid={`anulado-${aviso.extracto}`}>
      <h2 className="cxb-anulado-titulo">{t.titulo}</h2>
      <p className="cxb-anulado-porque">{t.porque}</p>
      {aviso.cargos.map((c) => (
        <div key={c.id} className="cxb-anulado-cargo" data-testid={`anulado-cargo-${c.id}`}>
          <span className="cxb-anulado-fecha">{diaMesCorto(c.fecha)}</span>
          <span className="cxb-anulado-concepto">{c.concepto}</span>
          <span className="cxb-anulado-importe">{eurosExactos(c.importeCent / 100)}</span>
          {uno && botones}
        </div>
      ))}
      {!uno && <div className="cxb-anulado-pie-botones">{botones}</div>}
      {t.casado && <p className="cxb-anulado-cifras">{t.casado}</p>}
      <p className="cxb-anulado-cifras" data-testid="anulado-cifras">{t.cifras}</p>
    </section>
  )
}
