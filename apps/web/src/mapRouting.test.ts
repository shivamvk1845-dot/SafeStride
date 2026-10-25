import { describe, expect, it } from "vitest";
import { replaceMapLayers } from "./mapRouting";

describe("journey map layer replacement", () => {
  it("replaces old route and address markers instead of accumulating layers", () => {
    const visibleLayers: string[] = [];
    const group = {
      clearLayers: () => { visibleLayers.length = 0; },
      addLayer: (layer: string) => { visibleLayers.push(layer); },
    };

    replaceMapLayers(group, ["old-route", "old-origin-marker", "old-destination-marker"]);
    expect(visibleLayers).toEqual(["old-route", "old-origin-marker", "old-destination-marker"]);

    replaceMapLayers(group, ["new-route", "new-origin-marker", "new-destination-marker"]);
    expect(visibleLayers).toEqual(["new-route", "new-origin-marker", "new-destination-marker"]);
    expect(new Set(visibleLayers).size).toBe(visibleLayers.length);
  });
});
