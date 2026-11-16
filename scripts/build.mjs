import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function build() {
  const publicFiles = [
    ["improvement-policy.js", "/improvement-policy.js", "text/javascript; charset=utf-8"],
    ["analysis-en.js", "/analysis-en.js", "text/javascript; charset=utf-8"],
    ["i18n.js", "/i18n.js", "text/javascript; charset=utf-8"],
    ["image-progress.js", "/image-progress.js", "text/javascript; charset=utf-8"],
    ["knowledge-workflow.js", "/knowledge-workflow.js", "text/javascript; charset=utf-8"],
    ["resource-settings.js", "/resource-settings.js", "text/javascript; charset=utf-8"],
    ["review-export.js", "/review-export.js", "text/javascript; charset=utf-8"],
    ["image-evidence.js", "/image-evidence.js", "text/javascript; charset=utf-8"],
    ["markdown.js", "/markdown.js", "text/javascript; charset=utf-8"],
    ["purchase-answers.js", "/purchase-answers.js", "text/javascript; charset=utf-8"],
    ["retrieval-evidence.js", "/retrieval-evidence.js", "text/javascript; charset=utf-8"],
    ["retrieval-baseline.js", "/retrieval-baseline.js", "text/javascript; charset=utf-8"],
    ["index.html", "/", "text/html; charset=utf-8"],
    ["styles.css", "/styles.css", "text/css; charset=utf-8"],
    ["app.js", "/app.js", "text/javascript; charset=utf-8"],
    ["theme.js", "/theme.js", "text/javascript; charset=utf-8"],
    ["engine.js", "/engine.js", "text/javascript; charset=utf-8"],
    ["research.js", "/research.js", "text/javascript; charset=utf-8"],
    ["models.js", "/models.js", "text/javascript; charset=utf-8"],
    ["agent.js", "/agent.js", "text/javascript; charset=utf-8"],
    ["analysis.js", "/analysis.js", "text/javascript; charset=utf-8"],
    ["brand-knowledge.js", "/brand-knowledge.js", "text/javascript; charset=utf-8"],
    ["observations.js", "/observations.js", "text/javascript; charset=utf-8"],
    ["content-workflow.js", "/content-workflow.js", "text/javascript; charset=utf-8"],
    ["web-data.js", "/web-data.js", "text/javascript; charset=utf-8"],
    ["keyword-insights.js", "/keyword-insights.js", "text/javascript; charset=utf-8"],
    ["workspace.js", "/workspace.js", "text/javascript; charset=utf-8"],
    ["advice-cards.js", "/advice-cards.js", "text/javascript; charset=utf-8"],
    ["readiness.js", "/readiness.js", "text/javascript; charset=utf-8"],
    ["exploration.js", "/exploration.js", "text/javascript; charset=utf-8"],
    ["source-baseline.js", "/source-baseline.js", "text/javascript; charset=utf-8"],
    ["connections.js", "/connections.js", "text/javascript; charset=utf-8"],
  ];
  const assets = {};
  const contents = await Promise.all(publicFiles.map(async ([file, path, mime]) => ({ path, mime, content: await readFile(resolve(projectRoot, "src", file), "utf8") })));
  for (const { path, mime, content } of contents) assets[path] = { mime, content };
  const workerSource = await readFile(resolve(projectRoot, "worker", "index.js"), "utf8");
  const crawlSource = (await readFile(resolve(projectRoot, "worker", "crawl.js"), "utf8")).replace(/^export /gm, "");
  let source = workerSource.replace(/^import \{\s*crawlBrand\s*\} from ["\']\.\/crawl\.js["\'];?\r?\n/m, () => crawlSource + "\n");
  if(source.includes('from "./public-fetch.js"')){const publicSource=(await readFile(resolve(projectRoot,'worker','public-fetch.js'),'utf8')).replace(/^export /gm,'');source=source.replace(/^import \{\s*crawlPublicSite\s*\} from ["']\.\/public-fetch\.js["'];?\r?\n/m,()=>publicSource+'\n')}
  if (source.includes('from "./web-search.js"')) {
    const searchSource = (await readFile(resolve(projectRoot, 'worker', 'web-search.js'), 'utf8')).replace(/^import .*? from ["']\.\/.*?["'];?\r?\n/gm, '').replace(/^export /gm, '');
    source = source.replace(/^import \{[^}]+\} from ["']\.\/web-search\.js["'];?\r?\n/m, () => searchSource + '\n');
  }
  if (source.includes('from "./exploration-plan.js"')) {
    const planSource = (await readFile(resolve(projectRoot, 'worker', 'exploration-plan.js'), 'utf8')).replace(/^export /gm, '');
    source = source.replace(/^import \{[^}]+\} from ["']\.\/exploration-plan\.js["'];?\r?\n/m, () => planSource + '\n');
  }
  if(source===workerSource)throw new Error("Worker is missing the crawl module import.");
  const marker = "/*__ASSETS__*/ {}";
  if (!source.includes(marker)) throw new Error("Worker is missing its public asset marker.");
  const manifestPath = resolve(projectRoot, ".openai", "hosting.json");
  JSON.parse(await readFile(manifestPath, "utf8"));
  await Promise.all([
    mkdir(resolve(projectRoot, "dist", "server"), { recursive: true }),
    mkdir(resolve(projectRoot, "dist", ".openai"), { recursive: true }),
  ]);
  await writeFile(resolve(projectRoot, "dist", "server", "index.js"), source.replace(marker, () => JSON.stringify(assets)), "utf8");
  await copyFile(manifestPath, resolve(projectRoot, "dist", ".openai", "hosting.json"));
  return resolve(projectRoot, "dist");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Built ${await build()}`);
