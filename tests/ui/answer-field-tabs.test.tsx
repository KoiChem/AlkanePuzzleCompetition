import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerFieldTabs, fieldLabel } from "../../src/features/play/AnswerFieldTabs";

describe("answer field tabs", () => {
  it("uses the structure transport field without exposing the legacy formula label", () => {
    expect(fieldLabel("formula","arrange")).toBe("構造");
    expect(fieldLabel("name","name")).toBe("名称");
    const html = renderToStaticMarkup(createElement(AnswerFieldTabs, {
      fields: [{ id: "formula", type: "formula" }],
      fieldStates: { formula: "pending" },
      selectedFieldId: "formula",
      mode: "arrange",
      onSelect: () => {},
    }));
    expect(html).toBe("");
  });
});
