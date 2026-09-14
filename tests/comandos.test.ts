import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { descobrirComandos, expandirComandoChat } from "../lib/comandos.ts";

async function ambiente() {
  const raiz = await mkdtemp(join(tmpdir(), "anotador-comandos-"));
  const fonte = join(raiz, "projeto");
  const opcoes = { casa: join(raiz, "casa"), claudeHome: join(raiz, "claude-config"), codexHome: join(raiz, "codex-config") };
  const gravar = async (arquivo: string, texto: string) => { await mkdir(dirname(arquivo), { recursive: true }); await writeFile(arquivo, texto); };
  return { raiz, fonte, opcoes, gravar, fechar: () => rm(raiz, { recursive: true, force: true }) };
}

test("Codex lista todas as skills do usuário, projeto, sistema e plugins ligados", async () => {
  const a = await ambiente();
  try {
    await a.gravar(join(a.opcoes.codexHome, "config.toml"), '[plugins."ativo@local"]\nenabled = true\n[plugins."desligado@local"]\nenabled = false\n');
    for (let i = 0; i < 14; i++) await a.gravar(join(a.opcoes.codexHome, "skills", "skill-" + i, "SKILL.md"), `---\nname: skill-${i}\ndescription: Skill ${i}\n---\nExecutar ${i}.`);
    await a.gravar(join(a.opcoes.codexHome, "skills/.system/ferramenta/SKILL.md"), "Ferramenta de sistema.");
    await a.gravar(join(a.fonte, ".agents/skills/skill-0/SKILL.md"), "---\nname: skill-0\ndescription: Projeto ganha\n---\nDo projeto.");
    await a.gravar(join(a.opcoes.casa, ".agents/skills/compartilhada/SKILL.md"), "Compartilhada.");
    await a.gravar(join(a.opcoes.codexHome, "prompts/testar.md"), "Teste $ARGUMENTS");
    for (const plugin of ["ativo", "desligado"]) {
      await a.gravar(join(a.opcoes.codexHome, "plugins/cache/local", plugin, "v1/.codex-plugin/plugin.json"), '{"skills":"./minhas-skills"}');
      await a.gravar(join(a.opcoes.codexHome, "plugins/cache/local", plugin, "v1/minhas-skills/exemplo/SKILL.md"), "---\nname: exemplo\n---\nDo plugin.");
    }
    const lista = await descobrirComandos("codex", a.fonte, a.opcoes);
    assert.equal(lista.length, 18, "não trunca a lista em oito comandos");
    assert.equal(lista.find((c) => c.nome === "skill-0")?.descricao, "Projeto ganha");
    assert.equal(lista.find((c) => c.nome === "ativo:exemplo")?.origem, "plugin");
    assert.equal(lista.some((c) => c.nome.includes("desligado")), false);
    assert.ok(lista.every((c) => c.suporte === "chat"));
  } finally { await a.fechar(); }
});

test("Claude usa config alternativa, versão registrada, escopo do projeto e comandos aninhados", async () => {
  const a = await ambiente();
  try {
    await a.gravar(join(a.opcoes.claudeHome, "settings.json"), JSON.stringify({ enabledPlugins: { "ativo@local": true, "desligavel@local": true } }));
    await a.gravar(join(a.fonte, ".claude/settings.local.json"), JSON.stringify({ enabledPlugins: { "desligavel@local": false } }));
    const plugin = join(a.opcoes.claudeHome, "plugins/cache/local/ativo/instalado");
    await a.gravar(join(a.opcoes.claudeHome, "plugins/installed_plugins.json"), JSON.stringify({ plugins: { "ativo@local": [{ scope: "user", installPath: plugin }] } }));
    await a.gravar(join(plugin, "skills/minha/SKILL.md"), "---\nname: minha\n---\nMinha habilidade.");
    await a.gravar(join(a.opcoes.claudeHome, "plugins/cache/local/ativo/mais-recente/skills/errada/SKILL.md"), "Outra versão.");
    await a.gravar(join(a.opcoes.claudeHome, "plugins/cache/local/desligavel/v1/commands/nao.md"), "Não aparecer.");
    await a.gravar(join(a.fonte, ".claude/commands/equipe/testar.md"), "---\ndescription: Teste da equipe\n---\nRodar testes $ARGUMENTS.");
    await a.gravar(join(a.opcoes.claudeHome, "skills/interna/SKILL.md"), "---\nuser-invocable: false\n---\nInterna.");
    const lista = await descobrirComandos("claude", a.fonte, a.opcoes);
    assert.deepEqual(lista.map((c) => c.nome), ["ativo:minha", "equipe:testar"]);
    assert.equal(lista[1]?.origem, "projeto");
    assert.match(await expandirComandoChat("/equipe:testar src/", "claude", a.fonte, a.opcoes) ?? "", /Rodar testes src\//);
  } finally { await a.fechar(); }
});

test("Antigravity descobre workflows legados, skills e plugins habilitados", async () => {
  const a = await ambiente();
  try {
    await a.gravar(join(a.fonte, ".agents/workflows/publicar.md"), "---\ndescription: Publicar ambiente\n---\nPrimeiro validar.");
    await a.gravar(join(a.fonte, ".agent/skills/testar/SKILL.md"), "Rodar testes.");
    await a.gravar(join(a.opcoes.casa, ".gemini/config/workflows/global.md"), "Workflow global.");
    await a.gravar(join(a.opcoes.casa, ".gemini/antigravity/global_workflows/legado.md"), "Workflow legado.");
    await a.gravar(join(a.opcoes.casa, ".gemini/antigravity-cli/builtin/skills/guia/SKILL.md"), "Skill distribuída com o CLI.");
    await a.gravar(join(a.fonte, ".agents/config.json"), JSON.stringify({ plugins: { bloqueado: { enabled: false } } }));
    for (const plugin of ["ativo", "bloqueado"]) {
      await a.gravar(join(a.fonte, ".agents/plugins", plugin, "plugin.json"), JSON.stringify({ name: plugin }));
      await a.gravar(join(a.fonte, ".agents/plugins", plugin, "skills/revisar/SKILL.md"), "Revisar.");
    }
    const lista = await descobrirComandos("antigravity", a.fonte, a.opcoes);
    assert.deepEqual(lista.map((c) => c.nome), ["ativo:revisar", "global", "guia", "legado", "publicar", "testar"]);
    assert.equal(lista.find((c) => c.nome === "guia")?.origem, "nativo");
    assert.equal(lista.find((c) => c.nome === "publicar")?.tipo, "workflow");
    assert.match(await expandirComandoChat("/publicar", "antigravity", a.fonte, a.opcoes) ?? "", /Primeiro validar/);
  } finally { await a.fechar(); }
});

test("expansão resolve arquivo canônico, argumentos literais e rejeita caminhos arbitrários", async () => {
  const a = await ambiente();
  try {
    const skill = join(a.raiz, "compartilhada/SKILL.md");
    await a.gravar(skill, "---\nname: testar\n---\nAlvo $1; todos $ARGUMENTS; recurso ./references/guia.md.");
    await mkdir(join(a.fonte, ".claude/skills"), { recursive: true });
    await symlink(dirname(skill), join(a.fonte, ".claude/skills/testar"));
    const texto = await expandirComandoChat('/testar "duas palavras" $(nao-executar)', "claude", a.fonte, a.opcoes);
    assert.ok(texto?.includes(await realpath(skill)));
    assert.match(texto ?? "", /Alvo duas palavras; todos "duas palavras" \$\(nao-executar\)/);
    assert.ok(texto?.includes(dirname(skill)));
    assert.equal(await expandirComandoChat("/../../segredo", "claude", a.fonte, a.opcoes), null);
    assert.equal(await expandirComandoChat("/inexistente", "claude", a.fonte, a.opcoes), null);
    assert.equal(await expandirComandoChat("/testar", "codex", a.fonte, a.opcoes), null);
    await rm(skill);
    assert.equal(await expandirComandoChat("/testar", "claude", a.fonte, a.opcoes), null);
  } finally { await a.fechar(); }
});

test("Gemini expande o prompt TOML e mantém argumentos como texto", async () => {
  const a = await ambiente();
  try {
    await a.gravar(join(a.fonte, ".gemini/commands/equipe/revisar.toml"), 'description = "Revisão"\nprompt = """\nRevisar {{args}} com cuidado.\n"""\n');
    const lista = await descobrirComandos("gemini", a.fonte, a.opcoes);
    assert.equal(lista[0]?.nome, "equipe:revisar");
    const expandido = await expandirComandoChat("/equipe:revisar arquivo.ts", "gemini", a.fonte, a.opcoes);
    assert.match(expandido ?? "", /Revisar arquivo\.ts com cuidado/);
    assert.doesNotMatch(expandido ?? "", /prompt =/);
  } finally { await a.fechar(); }
});

test("descoberta recusa nomes malformados, arquivos excessivos e ciclos de diretório", async () => {
  const a = await ambiente();
  try {
    await a.gravar(join(a.fonte, ".claude/skills/ruim/SKILL.md"), "---\nname: ../../segredo\n---\nNão é um nome de comando.");
    await a.gravar(join(a.fonte, ".claude/commands/grande.md"), "x".repeat(513 * 1024));
    await a.gravar(join(a.fonte, ".claude/commands/ok.md"), "Funciona.");
    await symlink(join(a.fonte, ".claude/commands"), join(a.fonte, ".claude/commands/ciclo"));
    assert.deepEqual((await descobrirComandos("claude", a.fonte, a.opcoes)).map((c) => c.nome), ["ok"]);
  } finally { await a.fechar(); }
});
