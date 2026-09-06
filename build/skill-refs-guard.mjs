// Guard: paths `references/` citados em SKILL.md existem no canônico e nos
// espelhos empacotados (hosts/**, plugins/**). Sem isso o bundle instala a
// skill e o mandato/baseline fica fora do cache (gitignore `references/` +
// copy só de SKILL.md no Plugin V1).
import fs from 'node:fs';
import path from 'node:path';

const CITATION_RE =
  /`((?:packages\/[\w./-]+|(?:\.\.\/)+_shared\/)?references\/[\w./-]+\.[A-Za-z0-9]+)`/g;

const ORCHESTRATOR_BARE = new Set([
  'host-adapters.md',
  'subagent_dispatch.md',
]);

export function extractSkillReferencePaths(text) {
  return [...new Set([...text.matchAll(CITATION_RE)].map((m) => m[1]))];
}

export function collectSkillTrees(root) {
  const trees = [];
  const stack = [
    path.join(root, 'packages'),
    path.join(root, 'hosts'),
    path.join(root, 'plugins'),
  ];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = path.join(cur, entry.name);
      if (entry.name === 'skills') trees.push(p);
      else stack.push(p);
    }
  }
  return trees;
}

function candidateBundleRoots(treeDir) {
  const parent = path.dirname(treeDir);
  const roots = [];
  if (path.basename(parent) === 'packages') {
    roots.push(path.dirname(parent));
  }
  roots.push(parent);
  for (const extra of ['talos', path.join('.vscode', 'talos'), path.join('.opencode', 'talos')]) {
    roots.push(path.join(parent, extra));
  }
  return roots;
}

function pathsForCited(bundleRoot, cited) {
  const out = [path.join(bundleRoot, cited)];
  if (cited.startsWith('packages/')) {
    out.push(path.join(bundleRoot, cited.slice('packages/'.length)));
  }
  return out;
}

export function resolveCitedPath(cited, { skillDir, treeDir }) {
  if (cited.startsWith('../') || cited.startsWith('_shared/')) {
    return path.normalize(path.join(skillDir, cited));
  }
  if (cited.startsWith('packages/')) {
    const roots = candidateBundleRoots(treeDir);
    for (const r of roots) {
      for (const p of pathsForCited(r, cited)) {
        if (fs.existsSync(p)) return p;
      }
    }
    return pathsForCited(roots[0], cited)[0];
  }
  if (cited.startsWith('references/')) {
    const local = path.join(skillDir, cited);
    if (fs.existsSync(local)) return local;
    const rest = cited.slice('references/'.length);
    const fromTreeParent = path.join(path.dirname(treeDir), 'references', rest);
    if (fs.existsSync(fromTreeParent)) return fromTreeParent;
    if (ORCHESTRATOR_BARE.has(path.basename(cited))) {
      for (const r of candidateBundleRoots(treeDir)) {
        for (const mid of ['packages/orchestrator/references', 'orchestrator/references']) {
          const p = path.join(r, mid, rest);
          if (fs.existsSync(p)) return p;
        }
      }
    }
    return local;
  }
  return path.join(skillDir, cited);
}

export function scanSkillReferenceGaps(root) {
  const gaps = [];
  for (const treeDir of collectSkillTrees(root)) {
    let names;
    try {
      names = fs.readdirSync(treeDir);
    } catch {
      continue;
    }
    for (const name of names) {
      const skillDir = path.join(treeDir, name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const text = fs.readFileSync(skillMd, 'utf8');
      for (const cited of extractSkillReferencePaths(text)) {
        const resolved = resolveCitedPath(cited, { skillDir, treeDir });
        if (!fs.existsSync(resolved)) {
          gaps.push({
            rel: path.relative(root, skillMd).replaceAll('\\', '/'),
            cited,
            missing: path.relative(root, resolved).replaceAll('\\', '/'),
          });
        }
      }
    }
  }
  return gaps;
}
