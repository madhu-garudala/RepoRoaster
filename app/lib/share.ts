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

/**
 * Splits text into words. A word wider than `maxWidth` (a long path or URL) is broken
 * after "/", "_", "-" or ".", and only by character when a single part is still too wide.
 */
function measuredTokens(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const fits = (value: string) => context.measureText(value).width <= maxWidth;
  const tokens: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (fits(word)) {
      tokens.push(word);
      continue;
    }
    let chunk = "";
    for (const part of word.split(/(?<=[/_\-.])/)) {
      if (fits(chunk + part)) {
        chunk += part;
        continue;
      }
      if (chunk) tokens.push(chunk);
      chunk = "";
      for (const char of part) {
        if (chunk && !fits(chunk + char)) {
          tokens.push(chunk);
          chunk = "";
        }
        chunk += char;
      }
    }
    if (chunk) tokens.push(chunk);
  }
  return tokens;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  let value = text;
  while (value && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value.trimEnd()}…`;
}

/** Wraps text to at most `maxLines`, adding an ellipsis only if it still does not fit. */
function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const tokens = measuredTokens(context, text, maxWidth);
  const lines: string[] = [];
  let line = "";
  let consumed = 0;
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = token;
    } else {
      line = candidate;
    }
    consumed += 1;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const truncated = consumed < tokens.length;
  if (truncated) lines[maxLines - 1] = ellipsize(context, lines[maxLines - 1] ?? "", maxWidth);
  return { lines, truncated };
}

/**
 * Picks the largest font size (stepping down to `minSize`) at which the text fits in
 * `maxLines`, then wraps it. Long names and verdicts shrink instead of overflowing.
 */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  options: { font: (size: number) => string; maxSize: number; minSize: number; maxWidth: number; maxLines: number },
) {
  for (let size = options.maxSize; size > options.minSize; size -= 2) {
    context.font = options.font(size);
    const { lines, truncated } = wrapLines(context, text, options.maxWidth, options.maxLines);
    if (!truncated) return { size, lines };
  }
  context.font = options.font(options.minSize);
  return { size: options.minSize, lines: wrapLines(context, text, options.maxWidth, options.maxLines).lines };
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
  await document.fonts?.ready;

  const ink = "#f1ede4";
  const muted = "#c9c3b8";
  const accent = "#ff6042";
  const acid = "#cbfa38";
  const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
  const left = 72;
  const textWidth = 740;

  context.fillStyle = "#11110f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = ink;
  context.lineWidth = 3;
  context.strokeRect(36, 36, width - 72, height - 72);
  context.textBaseline = "alphabetic";

  context.fillStyle = accent;
  context.fillRect(left, 82, 34, 5);
  context.fillStyle = ink;
  context.font = `700 20px ${mono}`;
  context.fillText("REPO ROAST · THE DAMAGE REPORT", left + 50, 92);

  // Lay out the text column first, then draw it vertically centred between the
  // header and footer. The verdict always shows in full (it shrinks to fit); the
  // strongest burn is dropped rather than squeezed when space runs out.
  type Block = { lines: string[]; font: string; color: string; lineHeight: number; gapBefore: number };
  const blocks: Block[] = [];
  const add = (
    text: string,
    style: { weight: number; family: string; maxSize: number; minSize: number; maxLines: number; color: string; leading: number; gapBefore: number },
  ) => {
    const font = (size: number) => `${style.weight} ${size}px ${style.family}`;
    const fitted = fitText(context, text, { font, maxSize: style.maxSize, minSize: style.minSize, maxWidth: textWidth, maxLines: style.maxLines });
    const block = { lines: fitted.lines, font: font(fitted.size), color: style.color, lineHeight: fitted.size * style.leading, gapBefore: style.gapBefore };
    blocks.push(block);
  };
  const blocksHeight = (list: Block[]) => list.reduce((sum, block) => sum + block.gapBefore + block.lines.length * block.lineHeight, 0);

  add(result.repo.name, { weight: 800, family: sans, maxSize: 52, minSize: 30, maxLines: 2, color: ink, leading: 1.08, gapBefore: 0 });
  add(`“${result.roast.verdict}”`, { weight: 500, family: sans, maxSize: 32, minSize: 20, maxLines: 5, color: muted, leading: 1.32, gapBefore: 18 });

  const regionTop = 118;
  const regionBottom = height - 104;
  const topHit = result.roast.hits[result.roast.hits.length - 1];
  if (topHit) {
    const label = { lines: ["STRONGEST BURN"], font: `700 18px ${mono}`, color: accent, lineHeight: 24, gapBefore: 34 };
    blocks.push(label);
    add(topHit.title, { weight: 650, family: sans, maxSize: 26, minSize: 20, maxLines: 2, color: ink, leading: 1.3, gapBefore: 6 });
    if (blocksHeight(blocks) > regionBottom - regionTop) blocks.splice(blocks.indexOf(label), 2);
  }

  let y = regionTop + Math.max(0, (regionBottom - regionTop - blocksHeight(blocks)) / 2);
  for (const block of blocks) {
    y += block.gapBefore;
    context.font = block.font;
    context.fillStyle = block.color;
    for (const line of block.lines) {
      y += block.lineHeight;
      context.fillText(line, left, y - block.lineHeight * 0.22);
    }
  }

  // Score ring, kept clear of the text column.
  const centerX = 1010;
  const centerY = 270;
  const radius = 100;
  context.lineWidth = 18;
  context.strokeStyle = "#34312c";
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
  if (result.roast.score > 0) {
    context.strokeStyle = acid;
    context.lineCap = "round";
    context.beginPath();
    context.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * result.roast.score) / 100);
    context.stroke();
    context.lineCap = "butt";
  }
  context.fillStyle = ink;
  context.textAlign = "center";
  context.font = `800 72px ${sans}`;
  context.fillText(String(result.roast.score), centerX, centerY + 20);
  context.fillStyle = muted;
  context.font = `600 18px ${mono}`;
  context.fillText("/100 VIBES", centerX, centerY + 54);

  context.textAlign = "right";
  context.fillStyle = accent;
  context.font = `700 20px ${mono}`;
  context.fillText(`ROAST YOURS → ${siteHost.toUpperCase()}`, width - 72, height - 66);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the card."))), "image/png");
  });
}

/**
 * Saves the card: the native share sheet on phones that support sharing files
 * (where a plain download is unreliable), otherwise a regular download.
 */
export async function saveRoastCard(blob: Blob, fileName: string, title: string) {
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  const isTouch = window.matchMedia?.("(pointer: coarse)").matches;
  if (isTouch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared" as const;
    } catch (error) {
      if ((error as Error).name === "AbortError") return "cancelled" as const;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded" as const;
}
