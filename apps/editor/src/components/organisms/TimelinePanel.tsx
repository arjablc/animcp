import { useRef, type DragEvent } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Layer } from "../../editor/model";
import { formatTime, trackStartFromPointer } from "../../editor/model";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/Button";
import { LayerIcon } from "../atoms/LayerIcon";

export function TimelinePanel({ layers, selected, selectedPart, time, playing, onSelect, onTime, onPlaying, onChange }: { layers: Layer[]; selected: string; selectedPart?: string; time: number; playing: boolean; onSelect: (id: string) => void; onTime: (time: number) => void; onPlaying: (playing: boolean) => void; onChange: (id: string, patch: Partial<Layer>) => void }) {
  const tracks = layers.filter((layer) => layer.inTimeline);
  const selectedTracks = layers.find((layer) => layer.id === selected)?.animations?.filter((track) => selectedPart ? track.partId === selectedPart : track.partId === undefined) ?? [];
  const timeline = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; offset: number } | undefined>(undefined);

  function timelinePosition(clientX: number) {
    const rect = timeline.current!.getBoundingClientRect();
    return { rect, x: Math.max(0, Math.min(rect.width, clientX - rect.left)) };
  }

  function dropLayer(event: DragEvent) {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-animcp-layer");
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    const { rect, x } = timelinePosition(event.clientX);
    onChange(id, { inTimeline: true, start: trackStartFromPointer(x, rect.width, 0, layer.duration) });
    onSelect(id);
  }

  return <section className="flex size-full min-h-0 flex-col bg-zinc-900" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={dropLayer}>
    <div className="grid h-[43px] shrink-0 grid-cols-[115px_1fr_auto] items-center border-b border-white/10 sm:grid-cols-[190px_1fr_auto] lg:grid-cols-[238px_1fr_auto]"><div className="flex justify-center gap-1"><Button className="size-6 text-zinc-600" onClick={() => onTime(Math.max(0, time - 1 / 30))}><SkipBack className="size-3" /></Button><Button className="size-6 rounded-full bg-lime-300 text-zinc-950 hover:bg-lime-200" onClick={() => onPlaying(!playing)}>{playing ? <Pause className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}</Button><Button className="size-6 text-zinc-600" onClick={() => onTime(Math.min(5, time + 1 / 30))}><SkipForward className="size-3" /></Button></div><div className="flex gap-1.5 pl-3 font-mono text-[9px]"><strong className="text-lime-300">{formatTime(time)}</strong><span className="hidden text-zinc-700 sm:inline">/ 00:05:00</span></div><Button className="mr-3 text-[8px] text-zinc-600" onClick={() => onTime(0)}>Reset</Button></div>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="grid min-h-full min-w-[900px] grid-cols-[115px_1fr] sm:grid-cols-[190px_1fr] lg:grid-cols-[238px_1fr]">
        <div className="sticky left-0 z-20 border-r border-white/10 bg-zinc-900 pt-6">{selectedTracks.length ? selectedTracks.map((track) => <div key={track.property} className="flex h-[42px] items-center gap-2 px-3.5 text-[9px] text-lime-200"><span className="size-1.5 rotate-45 bg-lime-300" /><span className="truncate capitalize">{track.property}</span></div>) : tracks.map((layer) => <button key={layer.id} onClick={() => onSelect(layer.id)} className={cn("flex h-[42px] w-full min-w-0 items-center gap-2 px-3.5 text-left text-[9px] text-zinc-500", selected === layer.id && "bg-white/5 text-zinc-200")}><LayerIcon type={layer.type} /><span className="select-text truncate">{layer.name}</span></button>)}{!selectedTracks.length && tracks.length === 0 && <p className="px-3 py-6 text-[9px] text-zinc-600">Drag a layer here to begin</p>}</div>
        <div
          ref={timeline}
          data-timeline-dropzone
          className="relative min-h-full bg-[linear-gradient(90deg,#25252c_1px,transparent_1px)] bg-size-[10%_100%] pt-6"
          onPointerDown={(event) => { if ((event.target as HTMLElement).closest("[data-clip]")) return; const { rect, x } = timelinePosition(event.clientX); onTime(x / rect.width * 5); }}
        >
          <div className="absolute inset-x-0 top-0 h-6 border-b border-white/10">{[0, 1, 2, 3, 4, 5].map((tick) => <span key={tick} className="absolute top-1.5 font-mono text-[7px] text-zinc-600" style={{ left: `${tick * 20}%` }}>{tick}s</span>)}</div>
          <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-lime-300" style={{ left: `${time / 5 * 100}%` }}><span className="absolute -left-1 top-0 size-2 rounded-b-full bg-lime-300" /></div>
          {selectedTracks.length ? selectedTracks.map((track) => <div key={track.property} className="relative h-[42px] border-b border-white/5">{track.keyframes.map((keyframe) => <button key={keyframe.time} title={`${track.property} at ${keyframe.time}s`} className="absolute top-[17px] size-2 -translate-x-1/2 rotate-45 border border-zinc-950 bg-lime-300" style={{ left: `${keyframe.time / 5 * 100}%` }} onClick={(event) => { event.stopPropagation(); onTime(keyframe.time); }} />)}</div>) : tracks.map((layer, index) => <div key={layer.id} className="relative h-[42px] border-b border-white/5"><button
            data-clip
            onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const { rect, x } = timelinePosition(event.clientX); drag.current = { id: layer.id, offset: x - layer.start / 5 * rect.width }; onSelect(layer.id); }}
            onPointerMove={(event) => { if (drag.current?.id !== layer.id) return; const { rect, x } = timelinePosition(event.clientX); onChange(layer.id, { start: trackStartFromPointer(x, rect.width, drag.current.offset, layer.duration) }); }}
            onPointerUp={() => { drag.current = undefined; }}
            className={cn("absolute top-2 h-6 cursor-grab rounded border bg-violet-950/70 active:cursor-grabbing", index % 3 === 0 ? "border-red-400/70 bg-red-950/60" : index % 3 === 2 ? "border-blue-400/70 bg-blue-950/60" : "border-violet-400/70", selected === layer.id && "ring-1 ring-lime-300")}
            style={{ left: `${layer.start / 5 * 100}%`, width: `${Math.max(layer.duration / 5 * 100, 2)}%` }}
          ><i className="absolute left-1 top-2 size-1.5 rotate-45 bg-zinc-200" /><i className="absolute right-1 top-2 size-1.5 rotate-45 bg-zinc-200" /></button></div>)}
        </div>
      </div>
    </div>
  </section>;
}
