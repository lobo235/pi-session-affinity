/**
 * Test fixture, loaded beside the extension by scripts/virtual-model.test.ts: a virtual model `example-router/auto`
 * that routes every request to the physical model the agent dir defines (example-gateway/example-model), the way
 * a router extension picks another provider's model.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function exampleRouter(pi: ExtensionAPI): void {
  pi.registerVirtualModel({
    provider: "example-router",
    id: "auto",
    name: "Example router",
    contextWindow: 131072,
    maxTokens: 4096,
    input: ["text"],
    route(_request, ctx) {
      const model = ctx.modelRegistry.find("example-gateway", "example-model");
      if (model === undefined) throw new Error("example-router: example-gateway/example-model is not in models.json");
      return { model, thinkingLevel: "off" };
    },
  });
}
