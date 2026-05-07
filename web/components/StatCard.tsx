export function StatCard({
  label,
  value,
  color = 'text-white',
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-slate-400 text-xs mt-1">{label}</p>
    </div>
  )
}
