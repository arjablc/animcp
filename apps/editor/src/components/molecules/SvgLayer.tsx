import { useMemo, type MouseEvent } from "react";
import type { Layer } from "../../editor/model";
import { renderSvg } from "../../editor/animation";
import { svgContent } from "../../svg/document";

export function SvgLayer({ source, layer, time, selectedPart, onSelectPart }: { source: string; layer: Layer; time: number; selectedPart?: string; onSelectPart: (partId?: string) => void }) {
  const rendered = useMemo(() => svgContent(renderSvg(source, layer, time, selectedPart)), [source, layer, time, selectedPart]);

  function select(event: MouseEvent<SVGSVGElement>) {
    const target = event.target as Element;
    let element: Element | null = target;
    while (element && element !== event.currentTarget) {
      if (element.id && layer.svgParts?.some((part) => part.id === element!.id)) { onSelectPart(element.id); return; }
      element = element.parentElement;
    }
    onSelectPart(undefined);
  }

  return <svg viewBox={rendered.viewBox} className="size-full overflow-visible [&_.animcp-selected]:[filter:drop-shadow(0_0_2px_#b9ff66)]" onClick={select} dangerouslySetInnerHTML={{ __html: rendered.content }} />;
}
