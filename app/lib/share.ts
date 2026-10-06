import type { Roast } from "./types";

type ShareableResult = {
  repo: { name: string };
  roast: Roast;
};

export function roastShareText(result: ShareableResult, siteUrl: string) {
  return `${result.repo.name} scored ${result.roast.score}/100 on Repo Roast: "${result.roast.verdict}" 🔥 Get your repo roasted: ${siteUrl}`;
}

export function roastShareUrl(result: ShareableResult, siteUrl: string) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(roastShareText(result, siteUrl))}`;
}

/** The whole roast as plain text, for pasting into chats and PR descriptions. */
export function roastAsText(result: ShareableResult, siteUrl: string) {
  const { roast } = result;
  const hits = roast.hits
    .map((hit, index) => `${index + 1}. ${hit.title} [${hit.severity}]\n${hit.body}\n> ${hit.evidence}`)
    .join("\n\n");
  const firstAid = roast.firstAid.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return [
    `🔥 REPO ROAST: ${result.repo.name} (${roast.score}/100)`,
    roast.verdict,
    roast.summary,
    hits,
    `Redeeming quality: ${roast.redeemingQuality}`,
    `First aid:\n${firstAid}`,
    `🎤 ${roast.micDrop}`,
    `Roasted at ${siteUrl}`,
  ].join("\n\n");
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Renders a 1200×630 social card for the roast and returns it as a PNG blob. */
export async function renderRoastCard(result: ShareableResult, siteHost: string): Promise<Blob> {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not supported in this browser.");

  const ink = "#f1ede4";
  const muted = "#aaa49a";
  const accent = "#ff6042";
  const acid = "#cbfa38";
  const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

  context.fillStyle = "#11110f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = ink;
  context.lineWidth = 3;
  context.strokeRect(36, 36, width - 72, height - 72);

  context.fillStyle = accent;
  context.fillRect(72, 82, 34, 5);
  context.fillStyle = ink;
  context.font = `700 22px ${mono}`;
  context.fillText("REPO ROAST · THE DAMAGE REPORT", 122, 92);

  context.font = `800 54px ${sans}`;
  const nameLines = wrapLines(context, result.repo.name, 760, 1);
  context.fillText(nameLines[0] ?? result.repo.name, 72, 178);

  context.fillStyle = muted;
  context.font = `500 34px ${sans}`;
  wrapLines(context, `“${result.roast.verdict}”`, 760, 3).forEach((line, index) => {
    context.fillText(line, 72, 250 + index * 46);
  });

  const topHit = result.roast.hits[result.roast.hits.length - 1];
  if (topHit) {
    context.fillStyle = accent;
    context.font = `700 20px ${mono}`;
    context.fillText("STRONGEST BURN", 72, 432);
    context.fillStyle = ink;
    context.font = `650 28px ${sans}`;
    wrapLines(context, topHit.title, 760, 2).forEach((line, index) => {
      context.fillText(line, 72, 474 + index * 38);
    });
  }

  const centerX = 1000;
  const centerY = 250;
  context.lineWidth = 18;
  context.strokeStyle = "#34312c";
  context.beginPath();
  context.arc(centerX, centerY, 110, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = acid;
  context.beginPath();
  context.arc(centerX, centerY, 110, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * result.roast.score) / 100);
  context.stroke();
  context.fillStyle = ink;
  context.textAlign = "center";
  context.font = `800 76px ${sans}`;
  context.fillText(String(result.roast.score), centerX, centerY + 22);
  context.fillStyle = muted;
  context.font = `600 22px ${mono}`;
  context.fillText("/100 VIBES", centerX, centerY + 60);

  context.textAlign = "right";
  context.fillStyle = accent;
  context.font = `700 22px ${mono}`;
  context.fillText(`ROAST YOURS → ${siteHost.toUpperCase()}`, width - 72, height - 72);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the card."))), "image/png");
  });
}
