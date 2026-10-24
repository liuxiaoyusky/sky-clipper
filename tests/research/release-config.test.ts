import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

interface WorkflowStep {
  env?: Record<string, unknown>;
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  needs?: string | string[];
  outputs?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs: Record<string, WorkflowJob>;
  on: unknown;
  permissions?: Record<string, unknown>;
}

const releasePath = '.github/workflows/release.yml';
const expectedActions = [
  'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
];

function parseWorkflow(source: string): Workflow {
  return parse(source) as Workflow;
}

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const matches = (job.steps || []).filter((step) => step.name === name);
  if (matches.length !== 1) throw new Error('Expected exactly one ' + name + ' step');
  return matches[0];
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function blockLines(value: string | undefined): string[] {
  return value?.trim().split(/\r?\n/).map((line) => line.trim()) || [];
}

function shellArray(run: string | undefined, name: string): string[] {
  const lines = run?.split(/\r?\n/) || [];
  const start = lines.findIndex((line) => line.trim() === name + '=(');
  const end = lines.findIndex((line, index) => index > start && line.trim() === ')');
  if (start < 0 || end < 0) return [];
  return lines
    .slice(start + 1, end)
    .map((line) => line.trim())
    .map((line) => line.replace(/^"|"$/g, ''));
}

function shellCopies(run: string | undefined): string[][] {
  return [...(run || '').matchAll(/cp "([^"]+)" \\\n+\s+"([^"]+)"/g)].map((match) =>
    match.slice(1),
  );
}

function releaseContract(source: string) {
  const workflow = parseWorkflow(source);
  const build = workflow.jobs.build;
  const publish = workflow.jobs.release;
  if (!build || !publish) throw new Error('Missing build or release job');
  const checkout = namedStep(build, 'Checkout');
  const version = namedStep(build, 'Verify tag matches package version');
  const stage = namedStep(build, 'Stage Chrome release assets');
  const upload = namedStep(build, 'Upload verified Chrome release assets');
  const download = namedStep(publish, 'Download verified Chrome release assets');
  const create = namedStep(publish, 'Create GitHub Release');
  const actions = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps || []).flatMap((step) => (step.uses ? [step.uses] : [])),
  );

  return {
    trigger: workflow.on,
    topPermissions: workflow.permissions,
    jobIds: Object.keys(workflow.jobs),
    buildPermissions: build.permissions,
    buildOutputs: build.outputs,
    publishNeeds: publish.needs,
    publishPermissions: publish.permissions,
    actions,
    checkoutPersistCredentials: checkout.with?.['persist-credentials'],
    versionId: version.id,
    versionPublishesOutput: version.run?.includes(
      'echo "version=$PACKAGE_VERSION" >> "$GITHUB_OUTPUT"',
    ),
    stageEnv: stage.env,
    stageCopies: shellCopies(stage.run),
    upload: {
      name: stringField(upload.with, 'name'),
      paths: blockLines(stringField(upload.with, 'path')),
      ifNoFilesFound: stringField(upload.with, 'if-no-files-found'),
    },
    download: {
      name: stringField(download.with, 'name'),
      path: stringField(download.with, 'path'),
    },
    publishStepNames: (publish.steps || []).map((step) => step.name),
    publishEnv: create.env,
    publishAssets: shellArray(create.run, 'ASSETS'),
    generatedNotes: create.run?.includes('--generate-notes'),
  };
}

const expectedReleaseContract = {
  trigger: { push: { tags: ['v*.*.*'] } },
  topPermissions: { contents: 'read' },
  jobIds: ['build', 'release'],
  buildPermissions: { contents: 'read' },
  buildOutputs: { version: '${{ steps.version.outputs.version }}' },
  publishNeeds: 'build',
  publishPermissions: { contents: 'write' },
  actions: expectedActions,
  checkoutPersistCredentials: false,
  versionId: 'version',
  versionPublishesOutput: true,
  stageEnv: { PACKAGE_VERSION: '${{ steps.version.outputs.version }}' },
  stageCopies: [
    [
      '.output/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
      'release-assets/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
    ],
    [
      'release-assets/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
      'release-assets/fin-report-clipper-chrome.zip',
    ],
  ],
  upload: {
    name: 'fin-report-clipper-chrome-release',
    paths: [
      'release-assets/fin-report-clipper-${{ steps.version.outputs.version }}-chrome.zip',
      'release-assets/fin-report-clipper-chrome.zip',
    ],
    ifNoFilesFound: 'error',
  },
  download: {
    name: 'fin-report-clipper-chrome-release',
    path: 'release-assets',
  },
  publishStepNames: [
    'Download verified Chrome release assets',
    'Create GitHub Release',
  ],
  publishEnv: {
    GH_TOKEN: '${{ github.token }}',
    GH_REPO: '${{ github.repository }}',
    RELEASE_VERSION: '${{ needs.build.outputs.version }}',
  },
  publishAssets: [
    'release-assets/fin-report-clipper-${RELEASE_VERSION}-chrome.zip',
    'release-assets/fin-report-clipper-chrome.zip',
  ],
  generatedNotes: true,
};

const fixtureRoots: string[] = [];

function fixtureRoot(
  manifest: Record<string, unknown>,
  scripts: Record<string, string | Buffer> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'fin-report-config-'));
  fixtureRoots.push(root);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(scripts)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: 3,
    name: '自动保存版本',
    minimum_chrome_version: '116',
    permissions: ['alarms', 'downloads', 'offscreen', 'storage'],
    host_permissions: ['https://rsch.baml.com/*', 'https://markets.ml.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://pbs.twimg.com/*', 'https://mp.weixin.qq.com/*', 'https://mmbiz.qpic.cn/*', 'https://mmbiz.qlogo.cn/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*', 'https://i0.hdslb.com/*', 'https://i1.hdslb.com/*', 'https://i2.hdslb.com/*'],
    content_scripts: [
      {
        matches: ['https://rsch.baml.com/*'],
        js: ['content-scripts/content.js'],
      },
      {
        matches: ['https://markets.ml.com/researchlibrary/advancedsearch*'],
        js: ['content-scripts/markets-today.js'],
      },
      { matches: ['https://x.com/*', 'https://twitter.com/*'], js: ['content-scripts/x.js'] },
      { matches: ['https://mp.weixin.qq.com/s*'], js: ['content-scripts/wechat.js'] },
      { matches: ['https://www.bilibili.com/video/*'], js: ['content-scripts/bilibili.js'] },
    ],
    ...overrides,
  };
}

function runCheck(script: string, root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Chrome-only automation', () => {
  it('runs the full verification command in CI without Edge or Firefox', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run verify');
    expect(ci).not.toMatch(/build:edge|build:firefox|edge-mv3|firefox/);
  });

  it('matches the exact parsed release contract', () => {
    const release = readFileSync(releasePath, 'utf8');
    const contract = releaseContract(release);

    expect(contract).toEqual(expectedReleaseContract);
    expect(contract.actions).toHaveLength(4);
    expect(contract.actions.every((action) => /@[a-f0-9]{40}$/.test(action))).toBe(true);
  });

  it('accepts legal whitespace before a YAML key colon without losing an action', () => {
    const release = readFileSync(releasePath, 'utf8');
    const mutated = release.replace('uses:', 'uses :');

    expect(releaseContract(mutated)).toEqual(expectedReleaseContract);
  });

  it('rejects a legal underscore-prefixed extra job', () => {
    const release = readFileSync(releasePath, 'utf8');
    const mutated = release.replace(
      '  release:\n',
      '  _extra:\n    runs-on: ubuntu-latest\n    steps: []\n\n  release:\n',
    );

    expect(releaseContract(mutated)).not.toEqual(expectedReleaseContract);
    expect(Object.keys(parseWorkflow(mutated).jobs)).toEqual(['build', '_extra', 'release']);
  });

  it('rejects broken artifact names and paths', () => {
    const release = readFileSync(releasePath, 'utf8');
    const brokenName = release.replace(
      'name: fin-report-clipper-chrome-release',
      'name: fin-report-clipper-chrome-release-broken',
    );
    const brokenPath = release.replace(
      'path: release-assets\n\n      - name: Create GitHub Release',
      'path: release-assets-broken\n\n      - name: Create GitHub Release',
    );

    expect(releaseContract(brokenName)).not.toEqual(expectedReleaseContract);
    expect(releaseContract(brokenPath)).not.toEqual(expectedReleaseContract);
  });

  it.each([
    ['MV2', { manifest_version: 2 }, 'Unexpected manifest version'],
    ['optional permissions', { optional_permissions: ['tabs'] }, 'optional_permissions'],
    [
      'optional hosts',
      { optional_host_permissions: ['https://example.com/*'] },
      'optional_host_permissions',
    ],
    [
      'extra content JavaScript',
      {
        content_scripts: [
          {
            matches: ['https://rsch.baml.com/*'],
            js: ['content-scripts/content.js', 'content-scripts/extra.js'],
          },
          {
            matches: ['https://markets.ml.com/researchlibrary/advancedsearch*'],
            js: ['content-scripts/markets-today.js'],
          },
          { matches: ['https://x.com/*', 'https://twitter.com/*'], js: ['content-scripts/x.js'] },
      { matches: ['https://mp.weixin.qq.com/s*'], js: ['content-scripts/wechat.js'] },
      { matches: ['https://www.bilibili.com/video/*'], js: ['content-scripts/bilibili.js'] },
        ],
      },
      'Unexpected content-script JavaScript',
    ],
    ['icons', { icons: { 16: 'icon.png' } }, 'Forbidden manifest capability: icons'],
    ['options', { options_ui: { page: 'options.html' } }, 'Forbidden manifest capability: options_ui'],
  ])('fails the manifest fixture closed for %s', (_label, overrides, error) => {
    const root = fixtureRoot(validManifest(overrides));
    const result = runCheck('scripts/check-manifest.mjs', root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  });

  it('checks a second declared content script for non-ASCII bytes', () => {
    const manifest = validManifest({
      content_scripts: [
        {
          matches: ['https://rsch.baml.com/*'],
          js: ['content-scripts/content.js', 'content-scripts/second.js'],
        },
      ],
    });
    const root = fixtureRoot(manifest, {
      'content-scripts/content.js': 'console.log("ascii");',
      'content-scripts/second.js': Buffer.from([0x61, 0x80]),
    });

    const result = runCheck('scripts/check-content-ascii.mjs', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('content-scripts/second.js contains a non-ASCII byte');
  });
});
