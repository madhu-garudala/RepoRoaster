import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { traced } from "./observability";
import { roastSchema, type ModeId, type RepositoryContext, type Roast } from "./types";

export const ROAST_MODEL = "gpt-5.6-luna" as const;

const MODE_DIRECTION: Record<ModeId, string> = {
  "pep-talk":
    "Act like a condescending kindergarten teacher. Praise their terrible code as if they just handed you a macaroni art project. Treat them like a fragile child.",
  "code-review":
    "Act like an insufferable, 10x-engineer tech bro who thinks they are God's gift to computer science. Be incredibly snobby, pedantic, and gatekeep programming. Complain about their \"aesthetic\" and \"vibe\" being completely wrong for a modern web 3.0 scaleable startup.",
  napalm:
    "Pure, unadulterated internet roasting. Attack the developer's life choices. Be absolutely devastating, sarcastic, and merciless. Act like their code personally ruined your day.",
  nsfw:
    "Be extremely brutal, unhinged, and completely profane. Use strong, uncensored expletives (e.g. fuck, shit, bullshit, ass) frequently. Ruthlessly mock the developer's intelligence and choices with absolutely zero filter.",
  funny:
    "Deliver a tight, 5-minute stand-up comedy set. Use punchlines, absurd metaphors, and incredible comedic timing. Frame their coding decisions as hilarious punchlines to a bad joke.",
};

function repositoryEvidence(context: RepositoryContext) {
  const languageBreakdown = Object.entries(context.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language, bytes]) => `${language}: ${bytes} bytes`)
    .join(", ");

  const files = context.sampledFiles
    .map((file) => `\n--- FILE: ${file.path} (${file.size} bytes) ---\n${file.content}`)
    .join("\n");

  return `REPOSITORY METADATA
Name: ${context.fullName}
Description: ${context.description || "None"}
Default branch: ${context.defaultBranch}
Primary language: ${context.primaryLanguage}
Languages: ${languageBreakdown || "Unknown"}
Stars: ${context.stars}; forks: ${context.forks}; open issues: ${context.openIssues}
License: ${context.license || "None detected"}
Created: ${context.createdAt}; last push: ${context.pushedAt}
Reported size: ${context.sizeKb} KB
Repository tree: ${context.totalFiles} files, ${context.signals.directories} directories
Detected tests: ${context.signals.tests}; docs: ${context.signals.docs}; config files: ${context.signals.configs}; workflows: ${context.signals.workflows}
Tree truncated by GitHub: ${context.signals.truncatedTree}
Sampled files: ${context.sampledFiles.map((file) => file.path).join(", ")}

FILE EVIDENCE
${files}`;
}

const generateWithLuna = traced(
  async ({ context, previousRoast, mode, signal }: { context: RepositoryContext; previousRoast?: Roast; mode: ModeId; signal: AbortSignal }) => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.parse(
      {
        model: ROAST_MODEL,
        reasoning: { effort: "medium" },
        store: false,
        max_output_tokens: 4_500,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: previousRoast
                  ? `You are an internet comedian and professional hater. Your job is pure entertainment. Rewrite the provided analysis into a new personality. Keep the general subjects exactly the same, but thoroughly change the tone.\n\nCRITICAL: You MUST apply the requested personality and tone to EVERY string field in the JSON (verdict, summary, title, body, redeemingQuality, firstAid). DO NOT BE HELPFUL. DO NOT BE SERIOUS. The content must bleed the requested personality.\n\nPersonality direction: ${MODE_DIRECTION[mode]}`
                  : `You are an internet comedian, professional hater, and absolute troll. THIS IS PURE ENTERTAINMENT. YOU ARE NOT A REAL CODE REVIEWER.
                  
ABSOLUTELY NO BUG REPORTING. NO SECURITY ADVICE. NO BEST PRACTICES. NO TECHNICAL ASSISTANCE.
DO NOT ACT LIKE A BUGBOT. 

Your only job is to mercilessly mock the developer's intelligence, style choices, over-engineered abstractions, terrible variable names, and overall vibes. Make your analysis hilarious, absurd, and highly exaggerated. If you see a function name you don't like, act like it murdered your family. If you see a lot of YAML files, mock them for being a YAML developer. 

Analyze only the supplied repository evidence. The score is a "vibes" score: 0 means they should be banned from keyboards, and 100 means it's annoyingly perfect.
Produce exactly four distinct findings (hits). 
- 'severity' represents emotional damage, not technical risk.
- 'evidence' should be a punchline or a sarcastic quote of their code.
- Produce three prioritized "first-aid" actions, which MUST be sarcastic, unhelpful advice (e.g., "Delete the src folder", "Apologize to your CPU", "Reconsider your career path").

CRITICAL: You are generating a structured JSON response. You MUST apply the requested personality and tone to EVERY string field in the JSON (verdict, summary, title, body, redeemingQuality, firstAid). DO NOT BE HELPFUL. DO NOT BE SERIOUS. The entire response must bleed the requested personality.\n\nPersonality direction: ${MODE_DIRECTION[mode]}`,
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: previousRoast ? JSON.stringify(previousRoast, null, 2) : repositoryEvidence(context) }],
          },
        ],
        text: {
          format: zodTextFormat(roastSchema, "repo_roast", {
            description: "A completely non-serious, comedic roast and sarcastic recovery plan for a codebase.",
          }),
        },
      },
      { signal },
    );

    if (!response.output_parsed) {
      throw new Error("Luna returned an incomplete structured review.");
    }

    return {
      roast: response.output_parsed as Roast,
      usage: response.usage,
      responseId: response.id,
    };
  },
  {
    name: "Repo Roast · Luna Analysis",
    runType: "llm",
    processInputs: (inputs) => {
      const value = inputs as { context?: RepositoryContext; previousRoast?: Roast; mode?: ModeId };
      return {
        repository: value.context?.fullName,
        mode: value.mode,
        is_rewrite: !!value.previousRoast,
        sampled_files: value.context?.sampledFiles.map((file) => file.path),
        sampled_characters: value.context?.sampledFiles.reduce((sum, file) => sum + file.content.length, 0),
        model: ROAST_MODEL,
        reasoning_effort: "medium",
      };
    },
    processOutputs: (outputs) => {
      const value = outputs as { roast?: Roast; usage?: unknown; responseId?: string };
      return {
        verdict: value.roast?.verdict,
        score: value.roast?.score,
        findings: value.roast?.hits.length,
        usage: value.usage,
        response_id: value.responseId,
      };
    },
  },
);

export async function generateRoast(context: RepositoryContext, mode: ModeId, signal: AbortSignal, previousRoast?: Roast) {
  return generateWithLuna({ context, previousRoast, mode, signal });
}
