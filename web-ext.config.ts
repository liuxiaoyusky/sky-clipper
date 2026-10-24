import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineRunnerConfig } from 'wxt';

const chromiumProfile = join(
  homedir(),
  'Library',
  'Application Support',
  'Fin-report-clipper',
  'WXT Chrome Profile',
);
const marketsTodayEntryUrl =
  'https://markets.ml.com/researchlibrary/advancedsearch';

if (process.env.NODE_ENV === 'development') {
  // WXT 0.19's Chrome launcher opens log files before creating Default/.
  mkdirSync(chromiumProfile, { recursive: true, mode: 0o700 });

  const chromiumProfileStats = lstatSync(chromiumProfile);
  if (
    !chromiumProfileStats.isDirectory() ||
    chromiumProfileStats.isSymbolicLink()
  ) {
    throw new Error(
      `Chromium profile path must be a directory and not a symbolic link: ${chromiumProfile}`,
    );
  }

  chmodSync(chromiumProfile, 0o700);
}

export default defineRunnerConfig({
  chromiumProfile,
  chromiumPref: {
    extensions: {
      ui: {
        developer_mode: true,
      },
    },
  },
  keepProfileChanges: true,
  startUrls: [marketsTodayEntryUrl],
});
