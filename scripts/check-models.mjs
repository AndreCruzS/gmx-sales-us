// One-off: list gateway models relevant to the voice pipeline.
import { gateway } from "ai";

const { models } = await gateway.getAvailableModels();
const interesting = models.filter(
  (m) =>
    /gemini|claude|gpt-5|whisper|transcribe/i.test(m.id) &&
    !/embed|image|tts|realtime/i.test(m.id),
);
for (const m of interesting) {
  console.log(
    m.id,
    "|",
    m.modelType ?? "?",
    "|",
    (m.specification?.inputModalities ?? m.inputModalities ?? []).join(","),
  );
}
