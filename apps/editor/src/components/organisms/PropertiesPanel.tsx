import * as Slider from "@radix-ui/react-slider";
import { Diamond, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import { hasKeyframe, partValue } from "../../editor/animation";
import type { Layer, SvgPart, SvgProperty, SvgValue } from "../../editor/model";
import { Button } from "../atoms/Button";
import { LayerIcon } from "../atoms/LayerIcon";
import { NumberField } from "../molecules/NumberField";
import { PropertySection } from "../molecules/PropertySection";

export function PropertiesPanel({ layer, part, time, onChange, onPartChange, onToggleKeyframe, onDelete }: { layer: Layer; part?: SvgPart; time: number; onChange: (patch: Partial<Layer>) => void; onPartChange: (property: SvgProperty, value: SvgValue) => void; onToggleKeyframe: (property: SvgProperty, value: SvgValue) => void; onDelete: () => void }) {
  if (part) return <PartProperties layer={layer} part={part} time={time} onChange={onPartChange} onToggleKeyframe={onToggleKeyframe} />;
  return <aside className="size-full overflow-y-auto bg-zinc-900"><Header />
    <div className="m-3 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[.025] p-2.5"><LayerIcon type={layer.type} className="size-4" /><div className="min-w-0 flex-1"><input className="select-text w-full bg-transparent text-[10px] font-semibold outline-none focus:text-lime-300" value={layer.name} onChange={(event) => onChange({ name: event.target.value })} /><span className="block text-[8px] capitalize text-zinc-600">{layer.type}</span></div><Button className="size-7 text-zinc-600 hover:text-red-400" disabled={layer.type === "group"} onClick={onDelete}><Trash2 className="size-3.5" /></Button></div>
    {layer.type === "svg" && <p className="mx-3 mb-1 rounded-md border border-lime-300/15 bg-lime-300/5 px-2.5 py-2 text-[9px] leading-4 text-lime-200">Select a named SVG part on the canvas or in the Layers panel to edit and animate it.</p>}
    <PropertySection title="Transform" action={<RotateCcw className="size-3" />}><div className="grid grid-cols-2 gap-1.5">{(["x", "y", "width", "height", "rotation"] as const).map((key) => <NumberField key={key} label={{ x: "X", y: "Y", width: "W", height: "H", rotation: "R" }[key]} value={layer[key]} onChange={(value) => onChange({ [key]: value })} />)}</div></PropertySection>
    <PropertySection title="Appearance" action={<Plus className="size-3" />}>{layer.type !== "svg" && <ColorField label="Fill" value={layer.fill} onChange={(fill) => onChange({ fill })} />}<div className={layer.type === "svg" ? "grid grid-cols-[50px_1fr_34px] items-center text-[9px] text-zinc-500" : "mt-3 grid grid-cols-[50px_1fr_34px] items-center text-[9px] text-zinc-500"}><span>Opacity</span><Slider.Root value={[layer.opacity]} max={100} step={1} onValueChange={([opacity]) => onChange({ opacity })} className="relative flex h-4 touch-none items-center"><Slider.Track className="relative h-0.5 flex-1 rounded bg-white/10"><Slider.Range className="absolute h-full rounded bg-lime-300" /></Slider.Track><Slider.Thumb className="block size-3 rounded-full bg-lime-300 outline-none ring-zinc-900 focus:ring-2" /></Slider.Root><span className="text-right font-mono text-[8px] text-zinc-400">{layer.opacity}%</span></div></PropertySection>
  </aside>;
}

function PartProperties({ layer, part, time, onChange, onToggleKeyframe }: { layer: Layer; part: SvgPart; time: number; onChange: (property: SvgProperty, value: SvgValue) => void; onToggleKeyframe: (property: SvgProperty, value: SvgValue) => void }) {
  const value = (property: SvgProperty) => partValue(layer, part, property, time);
  return <aside className="size-full overflow-y-auto bg-zinc-900"><Header />
    <div className="m-3 rounded-lg border border-lime-300/15 bg-lime-300/5 p-2.5"><strong className="block truncate text-[10px] text-lime-200">{part.name}</strong><span className="font-mono text-[8px] text-zinc-600">#{part.id} · {part.tag}</span></div>
    <PropertySection title="Part transform" action={<RotateCcw className="size-3" />}><div className="space-y-1.5">{(["translateX", "translateY", "rotation", "scaleX", "scaleY"] as const).map((property) => <KeyframeNumber key={property} property={property} label={{ translateX: "X", translateY: "Y", rotation: "Rotate", scaleX: "Scale X", scaleY: "Scale Y" }[property]} value={Number(value(property))} keyed={hasKeyframe(layer, part.id, property, time)} onChange={(next) => onChange(property, next)} onKeyframe={() => onToggleKeyframe(property, value(property))} />)}</div></PropertySection>
    <PropertySection title="Part appearance" action={<Plus className="size-3" />}><div className="space-y-1.5"><KeyframeNumber property="opacity" label="Opacity" value={Number(value("opacity"))} keyed={hasKeyframe(layer, part.id, "opacity", time)} onChange={(next) => onChange("opacity", Math.max(0, Math.min(1, next)))} onKeyframe={() => onToggleKeyframe("opacity", value("opacity"))} /><KeyframeNumber property="strokeWidth" label="Stroke" value={Number(value("strokeWidth"))} keyed={hasKeyframe(layer, part.id, "strokeWidth", time)} onChange={(next) => onChange("strokeWidth", Math.max(0, next))} onKeyframe={() => onToggleKeyframe("strokeWidth", value("strokeWidth"))} />
      {(["fill", "stroke"] as const).map((property) => <div key={property} className="grid grid-cols-[52px_1fr_24px] items-center gap-1"><ColorField label={property === "fill" ? "Fill" : "Stroke"} value={String(value(property))} onChange={(next) => onChange(property, next)} /><KeyButton active={hasKeyframe(layer, part.id, property, time)} onClick={() => onToggleKeyframe(property, value(property))} /></div>)}</div></PropertySection>
  </aside>;
}

function Header() {
  return <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5"><strong className="text-[11px]">Properties</strong><Button className="size-7 text-zinc-500"><MoreHorizontal className="size-4" /></Button></div>;
}

function KeyframeNumber({ label, value, keyed, onChange, onKeyframe }: { property: SvgProperty; label: string; value: number; keyed: boolean; onChange: (value: number) => void; onKeyframe: () => void }) {
  return <div className="grid grid-cols-[52px_1fr_24px] items-center gap-1"><span className="text-[8px] text-zinc-500">{label}</span><input type="number" step="any" className="min-w-0 rounded border border-white/10 bg-white/[.025] px-2 py-1 text-right font-mono text-[9px] outline-none focus:border-lime-300/40" value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0} onChange={(event) => onChange(Number(event.target.value))} /><KeyButton active={keyed} onClick={onKeyframe} /></div>;
}

function KeyButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return <Button className={active ? "size-6 text-lime-300" : "size-6 text-zinc-600"} title={active ? "Remove keyframe" : "Add keyframe"} onClick={onClick}><Diamond className={active ? "size-2.5 fill-current" : "size-2.5"} /></Button>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return <label className="col-span-2 flex h-7 items-center gap-2 rounded-md border border-white/10 bg-white/[.025] px-2 text-[8px] text-zinc-500"><span className="w-9">{label}</span><input type="color" className="size-4 cursor-pointer rounded border-0 bg-transparent p-0" value={color} onChange={(event) => onChange(event.target.value)} /><input className="min-w-0 flex-1 bg-transparent font-mono text-[8px] text-zinc-400 outline-none" value={value} onChange={(event) => (/^#[0-9a-f]{6}$/i.test(event.target.value) || event.target.value === "none") && onChange(event.target.value)} /></label>;
}
