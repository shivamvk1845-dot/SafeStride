export type MapPanel = "traveler" | "guardian";
export type MapTab = "setup" | MapPanel;

export interface ResizableMap {
  invalidateSize(options?: { pan?: boolean; debounceMoveend?: boolean }): unknown;
}

export function isMapPanelVisible(activeTab: MapTab, panel: MapPanel): boolean {
  return activeTab === panel;
}

export function scheduleMapResize(
  map: ResizableMap,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): () => void {
  const frame = requestFrame(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
  return () => cancelFrame(frame);
}
