import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the Repo Roast product surface", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Repo Roast/);
  assert.match(html, /Your repo has been/);
  assert.match(html, /PUBLIC GITHUB REPOSITORY/);
  assert.match(html, /NSFW/);
  assert.match(html, /Funny/);
  assert.match(html, /GPT-5\.6 LUNA/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("rejects non-GitHub URLs before starting a stream", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/api/roast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://example.com/not-a-repo", mode: "funny" }),
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 400);
  assert.ok(response.headers.get("x-request-id"));
  assert.deepEqual(await response.json(), {
    error: "Only public github.com repository URLs are supported.",
  });
});

test("rejects unsupported roast modes", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/api/roast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/vercel/ms", mode: "chaos" }),
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid roast mode/i);
});
