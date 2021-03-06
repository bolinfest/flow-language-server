/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 * @format
 */

import type {Reporter, VersionInfo} from './types';

import fetch from 'node-fetch';
import path from 'path';
import semver from 'semver';
import mkdirp from 'mkdirp';
import Zip from 'adm-zip';
import URL from 'url';

const FLOW_RELEASES_ENDPOINT =
  'https://api.github.com/repos/facebook/flow/releases';

export async function downloadSemverFromGitHub(
  semversion: ?string,
  binsDir: string,
  reporter: Reporter,
): Promise<?VersionInfo> {
  let versionsResponse;
  try {
    versionsResponse = await fetch(FLOW_RELEASES_ENDPOINT);
  } catch (e) {
    reporter.error('There was a problem reaching GitHub to download Flow.');
    return null;
  }

  if (!versionsResponse.ok) {
    reporter.error(
      'There was a problem downloading the list of flow versions from GitHub.',
    );
    return null;
  }

  const versions = await versionsResponse.json();
  let bestMatch;
  if (semversion != null) {
    bestMatch = versions.find(v => semver.satisfies(v.tag_name, semversion));
  } else {
    bestMatch = versions[0];
  }

  if (!bestMatch) {
    reporter.error(
      'The version of flow you requested does not exist on GitHub',
    );
    return null;
  }

  // flow release names include 'win32' and 'linux' in their names;
  const platformString =
    process.platform === 'darwin' ? 'osx' : process.platform;
  const bestAsset = bestMatch.assets.find(a => a.name.includes(platformString));
  if (!bestAsset) {
    reporter.error('Unable to find a download for the desired version of flow');
    return null;
  }

  const url = bestAsset.browser_download_url;
  if (!url) {
    reporter.error('unable to find a flow download for this platform');
    return null;
  }
  if (URL.parse(url).protocol !== 'https:') {
    // should "never" happen
    reporter.error(
      `Flow must be downloaded over a secure connection, but was told to download ${url}`,
    );
    return null;
  }

  reporter.info(
    `Found a match with version ${bestMatch.tag_name} on GitHub. Downloading...`,
  );

  const archiveResponse = await fetch(url);
  if (archiveResponse.ok) {
    const zipBuffer = await archiveResponse.buffer();
    // $FlowFixMe https://github.com/flowtype/flow-typed/pull/1049
    const version = (semver.clean(bestMatch.tag_name): string);
    const destDir = path.join(binsDir, version);

    try {
      await mkdirp(destDir);
      new Zip(zipBuffer).extractEntryTo(
        path.join('flow', 'flow'),
        destDir,
        false /* don't recreate the entry 'flow' dir */,
        true /* overwrite */,
      );
    } catch (e) {
      reporter.error(
        'Failed to write flow binary to disk. Please ensure write access ' +
          `to ${destDir}.`,
      );
      return null;
    }

    reporter.info(
      `Successfully downloaded and installed flow version ${bestMatch.tag_name} from GitHub`,
    );

    return {
      pathToFlow: path.join(destDir, 'flow'),
      flowVersion: version,
    };
  }

  reporter.error('There was a problem downloading from GitHub');
}
