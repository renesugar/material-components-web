/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Jimp = require('jimp');
const compareImages = require('resemblejs/compareImages');
const fs = require('mz/fs');
const mkdirp = require('mkdirp');
const path = require('path');

const mdcProto = require('../proto/types.pb').mdc.proto;
const {DiffImageResult, Screenshot, ScreenshotList, TestFile} = mdcProto;
const {CaptureState} = Screenshot;

/**
 * Computes the difference between two screenshot images and generates an image that highlights the pixels that changed.
 */
class ImageDiffer {
  /**
   * @param {!mdc.proto.ReportData} reportData
   * @return {!Promise<void>}
   */
  async compareAllScreenshots(reportData) {
    const screenshots = reportData.screenshots.comparable_screenshot_list;

    console.log(`Diffing ${screenshots.length} screenshots...`);

    await Promise.all(screenshots.map((screenshot) => {
      return this.compareOneScreenshot_({reportData, screenshot});
    }));

    reportData.screenshots.changed_screenshot_browser_map =
      this.groupByBrowser_(reportData.screenshots.changed_screenshot_list);
    reportData.screenshots.changed_screenshot_page_map =
      this.groupByPage_(reportData.screenshots.changed_screenshot_list);

    reportData.screenshots.unchanged_screenshot_browser_map =
      this.groupByBrowser_(reportData.screenshots.unchanged_screenshot_list);
    reportData.screenshots.unchanged_screenshot_page_map =
      this.groupByPage_(reportData.screenshots.unchanged_screenshot_list);

    this.logComparisonResults_(reportData);
  }

  /**
   * @param {!mdc.proto.ReportData} reportData
   * @param {!mdc.proto.Screenshot} screenshot
   * @return {!Promise<void>}
   * @private
   */
  async compareOneScreenshot_({reportData, screenshot}) {
    /** @type {!mdc.proto.DiffImageResult} */
    const diffImageResult = await this.compareOneImage({
      reportData,
      actualImageFile: screenshot.actual_image_file,
      expectedImageFile: screenshot.expected_image_file,
    });

    screenshot.diff_image_result = diffImageResult;
    screenshot.diff_image_file = diffImageResult.diff_image_file;
    screenshot.capture_state = CaptureState.DIFFED;

    if (diffImageResult.has_changed) {
      reportData.screenshots.changed_screenshot_list.push(screenshot);
    } else {
      reportData.screenshots.unchanged_screenshot_list.push(screenshot);
    }
  }

  /**
   * TODO(acdvorak): De-dupe this method with ReportBuilder
   * @param {!Array<!mdc.proto.Screenshot>} screenshotArray
   * @return {!Object<string, !mdc.proto.ScreenshotList>}
   * @private
   */
  groupByBrowser_(screenshotArray) {
    const browserMap = {};
    screenshotArray.forEach((screenshot) => {
      const userAgentAlias = screenshot.user_agent.alias;
      browserMap[userAgentAlias] = browserMap[userAgentAlias] || ScreenshotList.create({screenshots: []});
      browserMap[userAgentAlias].screenshots.push(screenshot);
    });
    return browserMap;
  }

  /**
   * TODO(acdvorak): De-dupe this method with ReportBuilder
   * @param {!Array<!mdc.proto.Screenshot>} screenshotArray
   * @return {!Object<string, !mdc.proto.ScreenshotList>}
   * @private
   */
  groupByPage_(screenshotArray) {
    const pageMap = {};
    screenshotArray.forEach((screenshot) => {
      const htmlFilePath = screenshot.html_file_path;
      pageMap[htmlFilePath] = pageMap[htmlFilePath] || ScreenshotList.create({screenshots: []});
      pageMap[htmlFilePath].screenshots.push(screenshot);
    });
    return pageMap;
  }

  /**
   * @param {!mdc.proto.ReportData} reportData
   * @private
   */
  logComparisonResults_(reportData) {
    console.log('');
    this.logComparisonResultSet_('Skipped', reportData.screenshots.skipped_screenshot_list);
    this.logComparisonResultSet_('Unchanged', reportData.screenshots.unchanged_screenshot_list);
    this.logComparisonResultSet_('Removed', reportData.screenshots.removed_screenshot_list);
    this.logComparisonResultSet_('Added', reportData.screenshots.added_screenshot_list);
    this.logComparisonResultSet_('Changed', reportData.screenshots.changed_screenshot_list);
  }

  /**
   * @param {!Array<!mdc.proto.Screenshot>} screenshots
   * @private
   */
  logComparisonResultSet_(title, screenshots) {
    console.log(`${title} ${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'}:`);
    for (const screenshot of screenshots) {
      console.log(`  - ${screenshot.html_file_path} > ${screenshot.user_agent.alias}`);
    }
    console.log('');
  }

  /**
   * @param {!mdc.proto.ReportData} reportData
   * @param {!mdc.proto.TestFile} actualImageFile
   * @param {!mdc.proto.TestFile} expectedImageFile
   * @return {!Promise<!mdc.proto.DiffImageResult>}
   */
  async compareOneImage({reportData, actualImageFile, expectedImageFile}) {
    const reportMeta = reportData.meta;

    // TODO(acdvorak): Fix bug here
    // TODO(acdvorak): Which bug? Offline comparison? What else? Maybe the paths don't always get set correctly?
    const actualImageBuffer = await fs.readFile(actualImageFile.absolute_path);
    const expectedImageBuffer = await fs.readFile(expectedImageFile.absolute_path);

    /** @type {!ResembleApiComparisonResult} */
    const resembleComparisonResult = await this.computeDiff_({actualImageBuffer, expectedImageBuffer});

    const diffImageFile = this.createDiffImageFile_({reportMeta, actualImageFile});
    const {diffImageBuffer, diffPixelFraction, diffPixelCount} =
      await this.analyzeComparisonResult_(resembleComparisonResult);

    mkdirp.sync(path.dirname(diffImageFile.absolute_path));
    await fs.writeFile(diffImageFile.absolute_path, diffImageBuffer, {encoding: null});

    return DiffImageResult.create({
      diff_image_file: diffImageFile,
      diff_pixel_count: diffPixelCount,
      diff_pixel_fraction: diffPixelFraction,
      has_changed: diffPixelCount >= require('../resemble.json').mdc_screenshot_test.min_diff_pixel_count,
    });
  }

  /**
   * @param {!ResembleApiComparisonResult} resembleComparisonResult
   * @return {!Promise<{diffImageBuffer: !Buffer, diffPixelFraction: number, diffPixelCount: number}>}
   * @private
   */
  async analyzeComparisonResult_(resembleComparisonResult) {
    /** @type {!Buffer} */
    const diffImageBuffer = resembleComparisonResult.getBuffer();

    /** @type {!Jimp.Jimp} */
    const jimpImage = await Jimp.read(diffImageBuffer);

    const {width, height} = jimpImage.bitmap;
    const diffPixelFraction = resembleComparisonResult.rawMisMatchPercentage;
    const diffPixelCount = diffPixelFraction * width * height;

    return {diffImageBuffer, diffPixelFraction, diffPixelCount};
  }

  /**
   * @param {!mdc.proto.ReportMeta} reportMeta
   * @param {!mdc.proto.TestFile} actualImageFile
   * @return {!mdc.proto.TestFile}
   * @private
   */
  createDiffImageFile_({reportMeta, actualImageFile}) {
    const diffImageRelativePath = actualImageFile.relative_path.replace(/\.png$/, '.diff.png');
    const diffImageAbsolutePath = path.join(
      reportMeta.local_diff_image_base_dir,
      diffImageRelativePath
    );
    const diffImagePublicUrl =
      reportMeta.remote_upload_base_url +
      reportMeta.remote_upload_base_dir +
      diffImageRelativePath;

    return TestFile.create({
      public_url: diffImagePublicUrl,
      relative_path: diffImageRelativePath,
      absolute_path: diffImageAbsolutePath,
    });
  }

  /**
   * @param {!Buffer} actualImageBuffer
   * @param {!Buffer} expectedImageBuffer
   * @return {!Promise<!ResembleApiComparisonResult>}
   * @private
   */
  async computeDiff_({actualImageBuffer, expectedImageBuffer}) {
    const options = require('../resemble.json');
    return await compareImages(
      actualImageBuffer,
      expectedImageBuffer,
      options
    );
  }
}

module.exports = ImageDiffer;
