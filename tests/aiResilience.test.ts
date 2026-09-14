/**
 * Resilience tests for the AI request path.
 *
 * They stub `globalThis.fetch` to reproduce the failure modes seen in the
 * wild — empty `content` in JSON mode, reasoning-only responses, truncated
 * output, transient 5xx and connection errors — and assert that the composer
 * either recovers or fails with an actionable message.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIProvider } from "../src/ai/OpenAIProvider";
import { buildUserPrompt } from "../src/ai/prompts";

/** Fast retry settings so tests never wait for real backoff. */
const FAST_RETRY = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, timeoutMs: 2000 };

/** JSON body of a chat completion with the given content. */
function completion(content: string | null, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content }, ...extra }]
  });
}

/** Install a fetch stub and return the recorded request bodies. */
function stubFetch(
  handler: (body: Record<string, unknown>, call: number) => { status?: number; body: string }
): { calls: Array<Record<string, unknown>>; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    const result = handler(body, calls.length);
    return new Response(result.body, { status: result.status ?? 200 });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    }
  };
}

/** Run a body and always restore fetch afterwards. */
async function withStub(
  handler: Parameters<typeof stubFetch>[0],
  run: (stub: { calls: Array<Record<string, unknown>> }) => Promise<void>
): Promise<void> {
  const stub = stubFetch(handler);
  try {
    await run(stub);
  } finally {
    stub.restore();
  }
}

const ONE_FILE_DIFF = "FILE: a.ts [modified +1 -0 hunks=1]\nHUNK 0 @@ -1,1 +1,2 @@\n line\n+added";

test("uses the response content when the provider answers normally", async () => {
  await withStub(
    () => ({ body: completion('{"commits":[]}') }),
    async (stub) => {
      const provider = new OpenAIProvider(
        "deepseek-chat",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });

      assert.deepEqual(plan.commits, []);
      assert.equal(stub.calls.length, 1);
      assert.deepEqual(stub.calls[0].response_format, { type: "json_object" });
    }
  );
});

test("retries without JSON mode when the endpoint returns empty content", async () => {
  await withStub(
    (body) =>
      body.response_format
        ? { body: completion("") }
        : { body: completion('{"commits":[]}') },
    async (stub) => {
      const provider = new OpenAIProvider(
        "deepseek-chat",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });

test("accepts reasoning_content when message content is empty", async () => {
  await withStub(
    () => ({
      body: JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: "", reasoning_content: '{"commits":[]}' } }
        ]
      })
    }),
    async () => {
      const provider = new OpenAIProvider(
        "deepseek-reasoner",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });
      assert.deepEqual(plan.commits, []);
    }
  );
});

test("exposes an actionable error when the output limit truncates the answer", async () => {
  await withStub(
    () => ({ body: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }] }) }),
    async () => {
      const provider = new OpenAIProvider(
        "deepseek-chat",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      await assert.rejects(
        () => provider.generateCommitPlan({ diff: ONE_FILE_DIFF }),
        (error: Error) => {
          assert.match(error.message, /output token limit/);
          assert.match(error.message, /deepseek-chat/);
          return true;
        }
      );
    }
  );
});

test("surfaces provider error bodies on HTTP failures", async () => {
  await withStub(
    () => ({ status: 400, body: JSON.stringify({ error: { message: "bad model" } }) }),
    async () => {
      const provider = new OpenAIProvider(
        "nope",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      await assert.rejects(
        () => provider.generateCommitPlan({ diff: ONE_FILE_DIFF }),
        /DeepSeek request failed \(400\)/
      );
    }
  );
});

test("retries transient server errors before giving up", async () => {
  await withStub(
    (_body, call) =>
      call === 1 ? { status: 503, body: "upstream unavailable" } : { body: completion('{"commits":[]}') },
    async (stub) => {
      const provider = new OpenAIProvider(
        "deepseek-chat",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });
      assert.deepEqual(plan.commits, []);
      assert.equal(stub.calls.length, 2);
    }
  );
});

test("retries connection failures before giving up", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
      throw new TypeError("fetch failed");
    }
    return new Response(completion('{"commits":[]}'), { status: 200 });
  }) as typeof fetch;

  try {
    const provider = new OpenAIProvider("deepseek-chat", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
    const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });
    assert.deepEqual(plan.commits, []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("degrades to a reduced diff when the first attempt cannot produce a plan", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ content: string }> };
    calls.push(body as unknown as Record<string, unknown>);

    const prompt = body.messages.map((message) => message.content).join("\n");
    const reduced = prompt.includes("context window");

    // First (full) attempt: the provider hits its output limit.
    if (!reduced) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }] }), {
        status: 200
      });
    }
    return new Response(completion('{"commits":[{"type":"chore","subject":"x","hunks":[]}]}'), {
      status: 200
    });
  }) as typeof fetch;

  try {
    const longDiff = `FILE: a.ts [modified +9 -0 hunks=9]\n${Array.from(
      { length: 4000 },
      (_, i) => `+line ${i}`
    ).join("\n")}`;
    const provider = new OpenAIProvider("deepseek-chat", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
    const plan = await provider.generateCommitPlan({ diff: longDiff });

    assert.equal(plan.commits.length, 1);
    assert.ok(calls.length >= 2, "expected a retry with a reduced diff");
    // Later attempts must announce that hunk bodies were dropped.
    assert.ok(
      calls.some((call) => JSON.stringify(call).includes("context window")),
      "expected a reduced-diff attempt"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("recovers with the JSON-lines attempt after prose-only replies", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages: Array<{ role: string; content: string }>;
      response_format?: unknown;
    };
    calls.push(body as unknown as Record<string, unknown>);

    const prompt = body.messages.map((message) => message.content).join("\n");
    // The first two attempts (JSON mode) answer with chain-of-thought prose.
    if (prompt.includes("one compact JSON object per line")) {
      const jsonl = JSON.stringify({
        type: "refactor",
        subject: "extract controller",
        body: ["Extracts the controller.", "- keeps hosts thin"],
        changes: [{ file: "src/a.ts", hunks: [] }]
      });
      return new Response(completion(jsonl), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "We need answer only JSON. Let me think about the grouping." }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const provider = new OpenAIProvider("deepseek-v4-flash", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
    const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });

    assert.equal(plan.commits.length, 1);
    assert.equal(plan.commits[0].subject, "extract controller");
    assert.equal(calls.length, 3);
    // The JSON-lines attempt must not request JSON mode, and must carry the
    // strict output contract in the system message.
    assert.equal(calls[2].response_format, undefined);
    assert.match(JSON.stringify(calls[2]), /OUTPUT CONTRACT/);
  } finally {
    globalThis.fetch = original;
  }
});

test("never requests JSON mode for reasoning models", async () => {
  await withStub(
    () => ({
      body: JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"commits":[]}' } }]
      })
    }),
    async (stub) => {
      const provider = new OpenAIProvider(
        "deepseek-reasoner",
        "key",
        "https://api.test/v1",
        "DeepSeek",
        FAST_RETRY
      );
      const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });

      assert.deepEqual(plan.commits, []);
      assert.equal(stub.calls.length, 1);
      assert.equal(stub.calls[0].response_format, undefined);
    }
  );
});

test("ignores Gemini thinking parts and keeps the JSON answer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "We need to split these changes into atomic commits. ", thought: true },
                { text: '{"commits":[{"type":"feat","subject":"add toggle","changes":[]}]}' }
              ]
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const { GeminiProvider } = await import("../src/ai/GeminiProvider");
    const provider = new GeminiProvider("gemini-test", "key", "https://api.test/v1beta", "Gemini");
    const plan = await provider.generateCommitPlan({ diff: ONE_FILE_DIFF });

    assert.equal(plan.commits.length, 1);
    assert.equal(plan.commits[0].subject, "add toggle");
  } finally {
    globalThis.fetch = original;
  }
});

test("parses prose-wrapped PR JSON and decodes percent entities", async () => {
  await withStub(
    () => ({
      body: completion(
        'Sure! Here is the pull request:\n```json\n{"title":"feat: %23 sync","description":"%23%23 Summary\\nFixes the retry loop."}\n```'
      )
    }),
    async () => {
      const provider = new OpenAIProvider("deepseek-chat", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
      const content = await provider.generatePrContent("FILE: a.ts", []);

      assert.equal(content.title, "feat: # sync");
      assert.match(content.description, /^## Summary/);
    }
  );
});

test("parses a bare commit-message object returned for regeneration", async () => {
  await withStub(
    () => ({
      body: completion(
        'Here you go: {"type":"fix","subject":"handle empty bodies","body":["Guards empty responses.","- adds a check"]}'
      )
    }),
    async () => {
      const provider = new OpenAIProvider("deepseek-chat", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
      const draft = await provider.generateCommitMessage({
        diff: ONE_FILE_DIFF,
        files: ["a.ts"],
        type: "chore",
        subject: "update"
      });

      assert.equal(draft.type, "fix");
      assert.equal(draft.subject, "handle empty bodies");
      assert.equal(draft.body.length, 2);
    }
  );
});

test("reports an actionable error when every attempt returns prose", async () => {
  await withStub(
    () => ({
      body: completion(
        "We need answer only JSON. Need create commit plan. Need infer from annotated diff."
      )
    }),
    async (stub) => {
      const provider = new OpenAIProvider("deepseek-v4-flash", "key", "https://api.test/v1", "DeepSeek", FAST_RETRY);
      await assert.rejects(
        () => provider.generateCommitPlan({ diff: ONE_FILE_DIFF }),
        (error: Error) => {
          assert.match(error.message, /no usable commit plan/);
          assert.match(error.message, /Try a different model/);
          return true;
        }
      );
      assert.equal(stub.calls.length, 3, "expected all three attempts to run");
    }
  );
});

test("buildUserPrompt never caps the number of commits", () => {
  const prompt = buildUserPrompt("FILE: a.ts [modified +1 -0 hunks=1]");
  assert.doesNotMatch(prompt, /maximum commits/i);
  assert.match(prompt, /no maximum/i);
});


      assert.deepEqual(plan.commits, []);
      assert.equal(stub.calls.length, 2);
      assert.ok(stub.calls[0].response_format);
      assert.equal(stub.calls[1].response_format, undefined);
    }
  );
});
