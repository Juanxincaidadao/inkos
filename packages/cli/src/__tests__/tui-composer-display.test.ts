import { describe, expect, it } from "vitest";
import { renderComposerDisplay } from "../tui/composer-display.js";

describe("tui composer display", () => {
  it("renders placeholder when empty", () => {
    expect(renderComposerDisplay("", "Ask InkOS")).toEqual({
      text: "Ask InkOS",
      isPlaceholder: true,
    });
  });

  it("renders plain input text with a block cursor when typing", () => {
    expect(renderComposerDisplay("continue", "Ask InkOS")).toEqual({
      text: "continue▌",
      isPlaceholder: false,
    });
  });
});
