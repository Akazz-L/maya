I am trying to use AI to help write good novel or stories. The goal is NOT to write in one shot a full book but more likely in an iterative fashion where I use LLM to help me materialize my ideas with good writing chapter by chapter. So far, the outputs are clearly not satisfactory enough. The writing is rather monotonic, the story is not creative and sometimes even incorent with respect to the characters descriptions or the timeline.I am my self a machine learning engineer. I was wondering if this observed behaviour of LLM is intrinsic to the way there are trained (kind of regression to the mean in the probalistic view at inference time) and thus meaning this task could never be solved by LLM fully?Or do you think there is a way to solve it with either standard pipelines such as post training / finetuning or good context/prompt engineering.Thank you.Show more30 avr.Claude responded: Short answer: it's not intrinsic in a way that makes the task unsolvable, but the failure modes you're seeing are very much a predictable consequence of how to…Analyzed LLM training limitations and architected practical solutions for creative writingAnalyzed LLM training limitations and architected practical solutions for creative writingShort answer: it's not intrinsic in a way that makes the task unsolvable, but the failure modes you're seeing are very much a predictable consequence of how today's chat-tuned models are trained. Most of it is fixable; some of it requires building a pipeline rather than relying on a single prompt.
Why current outputs feel flat
Your "regression to the mean" intuition is on the right track, but the bigger culprit is RLHF/instruction tuning, not next-token prediction itself. Base models trained purely on language modeling actually produce quite varied, stylistically rich text. The "AI voice" — balanced, hedged, structurally tidy, slightly overwritten — comes from preference-tuning that rewards safe, helpful, average-pleasing outputs. This is well-documented as "mode collapse": the post-trained distribution becomes very peaked, so even with temperature you sample around a narrow mode. That's why creative output across providers tends to converge on the same prose tics.
The consistency problems (characters, timeline) are a different failure: there's no persistent world model, just whatever fits in context, and attention degrades over long contexts. The model doesn't "know" your protagonist is left-handed; it's re-deriving that every token from whatever's in the prompt.
What actually helps, in order of leverage

Pipeline / context engineering (highest leverage for you). Don't ask the model to write a chapter. Maintain an explicit story bible (characters, locations, timeline, established facts), an outline, and previous-chapter summaries, then use separate prompted passes: planner → drafter → continuity checker → line editor. Each pass has a narrow job. This is what tools like Sudowrite, NovelCrafter, and the Re3/DOC research line do, and it's the single biggest quality jump available without training anything.
Use less-aligned models for the drafting step. For prose generation specifically, base/completion models or models fine-tuned on fiction (there are several open-weight ones) often produce more interesting prose than chat-tuned assistants. Use the chat model for planning and editing, the more "raw" model for drafting.
Heavy few-shot with target style. Give 2–3 long passages of the exact voice you want. This shifts the conditional distribution far more than adjectives like "vivid" or "literary."
Sampling. Higher temperature, min-p sampling, repetition penalties. Helps at the margins, won't fix structural blandness.
Fine-tuning. DPO or LoRA on a curated corpus (your own writing, or authors you want to emulate) genuinely works for voice, but you need a few hundred to a few thousand good examples and it's overkill before you've exhausted the pipeline approach.

So: not a fundamental limit, but you'll hit a ceiling fast with single-prompt usage. The interesting engineering problem here is building the scaffolding around the model — state management, multi-pass generation, consistency verification — which plays directly to your background.
Happy to go deeper on any of these (the pipeline design is probably the most useful to flesh out concretely if you want).You said: Could you dive deeper into the pipeline?Could you dive deeper into the pipeline?Also if known, explain how the tools you have listed actually work?30 avr.Claude responded: The pipeline, concretelyThe pipeline, concretely
Think of it as a small system with persistent state, not a single prompt. Four pieces:
1. The story bible (persistent state)
A structured store, not free text. Roughly:

characters: per character — physical traits, voice/speech patterns, backstory facts, relationships, current emotional state, knowledge (what they know vs. what the reader knows)
world: locations, rules (magic system, tech level, social structures), recurring objects
timeline: ordered list of events with timestamps, POV, location, characters present
plot: outline at multiple resolutions — act level, chapter level, scene level
style guide: target voice, tense, POV conventions, things to avoid

JSON or YAML works well. The key move is that this is the source of truth, not the chapters themselves. Chapters get regenerated; the bible persists and grows.
2. Retrieval, not stuffing
You can't fit the whole bible in every prompt, and you shouldn't want to — irrelevant context degrades output. For each generation step, assemble a focused context: the relevant characters, the previous scene's summary, the next outline beat, the style guide, plus 1–2 chunks retrieved by semantic similarity from prior chapters (for callbacks and continuity). Embedding-based retrieval over chapter chunks is enough; you don't need a vector DB, a flat file with cosine similarity is fine at novel scale.
3. Multi-pass generation
Each pass is a separate LLM call with a narrow job and its own prompt:

Planner: given the outline beat and bible, produce a scene plan — goal, conflict, POV, beats, what changes by the end, sensory anchor, opening and closing images. Output is structured.
Drafter: given the scene plan, relevant bible slices, prior scene summary, and style examples, write the prose. This is the pass where you'd use a less-aligned or fiction-tuned model and higher temperature.
Continuity checker: given the draft + bible + timeline, return a list of contradictions ("character X is described as having a scar, but chapter 3 said no scar"; "scene takes place at dusk but previous scene ended at dawn 20 minutes earlier"). This is best as a structured-output call — ask for JSON with {issue, severity, location, suggested_fix}.
Line editor: given the draft + style guide + a list of prose tics to avoid, rewrite for voice. Often most effective as targeted rewrites of flagged sentences rather than a full rewrite, which tends to flatten things back toward the mean.
Bible updater: given the accepted final draft, propose updates to the bible — new facts established, character state changes, timeline entries. Human-in-the-loop approval before committing.

You don't need all five every time. A minimum useful loop is planner → drafter → continuity checker → human edit → bible updater.
4. Human-in-the-loop checkpoints
The system proposes, you dispose. Approve outlines before drafting, approve bible updates before they persist, treat the line editor's suggestions as diffs you accept or reject. This is what keeps the story actually yours and prevents drift.
A few engineering details that matter more than they seem:

Summaries are lossy and compound errors. Keep both the full prior chapter and a summary; retrieve from the full text, condition the planner on the summary.
Character voice drifts fastest. Maintain 3–5 example lines of dialogue per character and inject them whenever the character speaks in a scene.
Don't let the model write the bible in prose. Force structured output. Prose bibles get re-interpreted differently each call.
Log everything. Every prompt, every output, every accepted/rejected edit. You'll want this for debugging and eventually for fine-tuning data.
