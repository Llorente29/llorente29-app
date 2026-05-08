// src/pages/trabajador/MiBolsaHoras.tsx
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import BolsaHorasView from '../../components/personal/BolsaHorasView'
import type { Employee } from '../../types'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MiBolsaHoras({ employee, onBack }: Props) {
  const { staff } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mi bolsa de horas</p>
            <p className="font-bold text-gray-900">{current.name.split(' ')[0]}</p>
          </div>
        </div>

        <BolsaHorasView employee={current} variant="mobile" />

        <Card className="p-3 mt-4 bg-blue-50 border-blue-200">
          <p className="text-[11px] text-blue-800 leading-relaxed">
            💡 La bolsa compara tus horas trabajadas contra las teóricas según tu horario.
            Saldo positivo = horas a tu favor. Saldo negativo = horas pendientes.
            Se actualiza con cada fichaje.
          </p>
        </Card>
      </div>
    </div>
  )
}
