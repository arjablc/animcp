export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="flex h-8 items-center rounded-md border border-white/10 bg-white/[.025]"><span className="w-7 text-center font-mono text-[8px] text-zinc-600">{label}</span><input type="number" className="min-w-0 flex-1 bg-transparent font-mono text-[9px] text-zinc-400 outline-none" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
