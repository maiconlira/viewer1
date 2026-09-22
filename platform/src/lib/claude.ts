// Integração com Claude: loop de agente com ferramentas + geração estruturada (JSON).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

// Recusas de segurança são reexecutadas automaticamente no modelo de fallback recomendado.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
export function claude() {
  if (!client) client = new Anthropic();
  return client;
}

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Ferramenta tipada: o schema Zod gera o JSON Schema enviado ao Claude e valida a entrada antes de executar. */
export type AgentTool = {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (input: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export function tool<S extends z.ZodObject<z.ZodRawShape>>(def: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<unknown>;
}): AgentTool {
  return def as AgentTool;
}

function toInputSchema(schema: z.ZodObject<z.ZodRawShape>): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Beta.BetaTool.InputSchema;
}

export type ToolStep = { tool: string; input: unknown; output: unknown; error?: boolean };

export type AgentRunResult = {
  text: string;
  steps: ToolStep[];
  refused: boolean;
};

/**
 * Executa um agente com ferramentas até ele terminar (loop manual).
 * Retorna o texto final e o registro de cada ferramenta executada.
 */
export async function runAgent(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: AgentTool[];
  effort?: Effort;
  maxIterations?: number;
}): Promise<AgentRunResult> {
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const toolDefs: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toInputSchema(t.schema),
  }));

  const messages = [...opts.messages];
  const steps: ToolStep[] = [];
  const maxIterations = opts.maxIterations ?? 15;

  for (let i = 0; i < maxIterations; i++) {
    const response = await claude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "high" },
      cache_control: { type: "ephemeral" },
      system: opts.system,
      tools: toolDefs,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { text: "", steps, refused: true };
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, steps, refused: false };
    }

    // Executa todas as chamadas desta rodada e devolve todos os resultados numa única mensagem.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const def = toolMap.get(use.name);
        if (!def) {
          steps.push({ tool: use.name, input: use.input, output: "ferramenta desconhecida", error: true });
          return { type: "tool_result", tool_use_id: use.id, content: `Ferramenta desconhecida: ${use.name}`, is_error: true };
        }
        const parsed = def.schema.safeParse(use.input);
        if (!parsed.success) {
          const msg = `Entrada inválida: ${parsed.error.message}`;
          steps.push({ tool: use.name, input: use.input, output: msg, error: true });
          return { type: "tool_result", tool_use_id: use.id, content: msg, is_error: true };
        }
        try {
          const output = await def.run(parsed.data);
          steps.push({ tool: use.name, input: parsed.data, output });
          return {
            type: "tool_result",
            tool_use_id: use.id,
            content: typeof output === "string" ? output : JSON.stringify(output ?? { ok: true }),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          steps.push({ tool: use.name, input: parsed.data, output: msg, error: true });
          return { type: "tool_result", tool_use_id: use.id, content: `Erro: ${msg}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return { text: "Limite de passos atingido antes de concluir a tarefa.", steps, refused: false };
}

/** Gera uma resposta JSON validada pelo schema Zod (structured outputs). */
export async function generateJSON<S extends z.ZodTypeAny>(opts: {
  system: string;
  prompt: string;
  schema: S;
  effort?: Effort;
}): Promise<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const response = await claude().beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: jsonSchema } },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("A IA recusou esta solicitação.");
  if (response.stop_reason === "max_tokens") throw new Error("Resposta da IA truncada (max_tokens).");

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return opts.schema.parse(JSON.parse(text));
}

/** Gera texto livre (ex.: corpo de contrato). */
export async function generateText(opts: { system: string; prompt: string; effort?: Effort }) {
  const stream = claude().beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium" },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("A IA recusou esta solicitação.");
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
