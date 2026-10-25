import { describe, expect, it, vi } from "vitest";
import { isMapPanelVisible, scheduleMapResize } from "./mapLifecycle";

describe("persistent journey map panels", () => {
  it("keeps the same panel visible again through repeated tab switches", () => {
    const sequence = ["traveler", "guardian", "traveler", "setup", "guardian", "traveler"] as const;
    const visiblePanels: string[] = [];

    for (const activeTab of sequence) {
      const travelerVisible = isMapPanelVisible(activeTab, "traveler");
      const guardianVisible = isMapPanelVisible(activeTab, "guardian");
      expect(Number(travelerVisible) + Number(guardianVisible)).toBe(activeTab === "setup" ? 0 : 1);
      if (travelerVisible) visiblePanels.push("traveler");
      if (guardianVisible) visiblePanels.push("guardian");
    }

    expect(visiblePanels).toEqual(["traveler", "guardian", "traveler", "guardian", "traveler"]);
  });

  it("invalidates a previously hidden map after it becomes visible", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => { callbacks.delete(id); });
    const invalidateSize = vi.fn();
    const cancel = scheduleMapResize({ invalidateSize }, requestFrame, cancelFrame);

    expect(invalidateSize).not.toHaveBeenCalled();
    callbacks.get(1)?.(0);
    expect(invalidateSize).toHaveBeenCalledWith({ pan: false, debounceMoveend: true });

    cancel();
    expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});
