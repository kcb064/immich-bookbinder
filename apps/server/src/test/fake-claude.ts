import Fastify from 'fastify';

/**
 * A stand-in for the Anthropic Messages API (M7 tests and local development): answers
 * `POST /v1/messages` with deterministic JSON that matches the requested `output_config.format`
 * schema, counts tokens roughly, and records what was sent so tests can check that only small
 * thumbnails leave the server. Keys: anything but `bad-key` (401).
 *
 *   corepack pnpm --filter @bookbinder/server exec tsx src/test/fake-claude.ts --port 2490
 *   then AI_BASE_URL=http://127.0.0.1:2490 in apps/server/.env
 */

export interface FakeClaudeRequest {
  model: string;
  /** Text of every user text block, joined. */
  text: string;
  /** Base64 lengths of the images sent. */
  imageBytes: number[];
  /** Name of the top-level schema property that identified the task. */
  task: 'captions' | 'bursts' | 'foreword' | 'text';
}

export interface FakeClaude {
  url: string;
  requests: FakeClaudeRequest[];
  /** Answer the next N requests with this HTTP status (e.g. 429, 529). */
  failNext: { status: number; count: number };
  close(): Promise<void>;
}

interface Block {
  type: string;
  text?: string;
  source?: { type: string; media_type?: string; data?: string };
}

interface MessagesBody {
  model: string;
  max_tokens?: number;
  system?: string | Array<{ type: string; text: string }>;
  messages: Array<{ role: string; content: string | Block[] }>;
  output_config?: { format?: { type: string; schema?: { properties?: Record<string, unknown> } } };
}

function tokensOf(s: string): number {
  return Math.ceil(s.length / 4);
}

function answerFor(task: FakeClaudeRequest['task'], text: string): unknown {
  switch (task) {
    case 'captions': {
      const pages = [...text.matchAll(/^Page (\d+)\b/gm)].map((m) => Number(m[1]));
      const chapters = [...text.matchAll(/^Chapter ([^\s:]+):/gm)].map((m) => m[1]!);
      return {
        captions: pages.map((page) => ({ page, caption: `A moment on page ${page + 1}` })),
        chapters: chapters.map((id) => ({ id, title: `Days in ${id}` })),
      };
    }
    case 'bursts':
      // The second frame is "best" whenever there is one, so a change is observable.
      return { best: text.includes('Frame 2') ? 1 : 0, reason: 'Sharper eyes and a more natural smile.' };
    case 'foreword': {
      const title = /^Title: (.+)$/m.exec(text)?.[1] ?? 'this book';
      return { foreword: `${title} gathers the days we spent away: the places, the light and the people who made them.` };
    }
    default:
      return 'ok';
  }
}

export async function startFakeClaude(opts: { port?: number; host?: string } = {}): Promise<FakeClaude> {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  const requests: FakeClaudeRequest[] = [];
  const failNext = { status: 0, count: 0 };

  app.post<{ Body: MessagesBody }>('/v1/messages', async (req, reply) => {
    if (req.headers['x-api-key'] === 'bad-key') return reply.code(401).send({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (failNext.count > 0) {
      failNext.count--;
      return reply.code(failNext.status).send({ type: 'error', error: { type: 'api_error', message: `fake failure ${failNext.status}` } });
    }
    const body = req.body;
    const texts: string[] = [];
    const imageBytes: number[] = [];
    for (const m of body.messages) {
      if (typeof m.content === 'string') texts.push(m.content);
      else
        for (const b of m.content) {
          if (b.type === 'text' && b.text) texts.push(b.text);
          if (b.type === 'image' && b.source?.data) imageBytes.push(Math.floor((b.source.data.length * 3) / 4));
        }
    }
    const props = body.output_config?.format?.schema?.properties ?? {};
    const task: FakeClaudeRequest['task'] = 'captions' in props ? 'captions' : 'best' in props ? 'bursts' : 'foreword' in props ? 'foreword' : 'text';
    const text = texts.join('\n');
    requests.push({ model: body.model, text, imageBytes, task });
    const answer = answerFor(task, text);
    const out = typeof answer === 'string' ? answer : JSON.stringify(answer);
    const system = typeof body.system === 'string' ? body.system : (body.system ?? []).map((s) => s.text).join('\n');
    const inputTokens = tokensOf(system) + tokensOf(text) + imageBytes.length * 1200;
    return {
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: out }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: tokensOf(out), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  });

  const host = opts.host ?? '127.0.0.1';
  await app.listen({ port: opts.port ?? 0, host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);
  return { url: `http://${host}:${port}`, requests, failNext, close: () => app.close() };
}

// CLI: --port 2490
if (process.argv[1] && /fake-claude\.(ts|js)$/.test(process.argv[1])) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 2490;
  startFakeClaude({ port })
    .then((f) => console.log(`fake Claude listening on ${f.url} (any key except bad-key)`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
