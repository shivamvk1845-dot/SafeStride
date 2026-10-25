import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("leaflet", () => ({ default: {} }));

import ExistingSafetyPlatform from "./ExistingSafetyPlatform";

describe("journey setup defaults", () => {
  it("keeps example addresses empty and makes demo simulation opt-in", () => {
    const markup = renderToStaticMarkup(<ExistingSafetyPlatform />);

    expect(markup).toContain('placeholder="Enter a starting address"');
    expect(markup).toContain('placeholder="Enter a destination"');
    expect(markup).toContain('<input type="checkbox" class="mt-0.5 accent-teal-400"/>');
    expect(markup).toContain("Demo simulation");
  });
});
