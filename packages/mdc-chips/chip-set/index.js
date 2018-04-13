/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
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

import MDCComponent from '@material/base/component';

import MDCChipSetAdapter from './adapter';
import MDCChipSetFoundation from './foundation';
import {MDCChip, MDCChipFoundation} from '../chip/index';

/**
 * @extends {MDCComponent<!MDCChipSetFoundation>}
 * @final
 */
class MDCChipSet extends MDCComponent {
  /**
   * @param {...?} args
   */
  constructor(...args) {
    super(...args);

    /** @type {!Array<!MDCChip>} */
    this.chips;
    /** @type {(function(!Element): !MDCChip)} */
    this.chipFactory_;

    /** @private {?Element} */
    this.input_;
    /** @type {(function(): !Element)} */
    this.leadingIconFactory_;
    /** @type {(function(): !Element)} */
    this.trailingIconFactory_;
    /** @type {(function(): !Element)} */
    this.chipTextFactory_;
  }

  /**
   * @param {!Element} root
   * @return {!MDCChipSet}
   */
  static attachTo(root) {
    return new MDCChipSet(root);
  }

  /**
   * @param {(function(!Element): !MDCChip)=} chipFactory A function which
   * creates a new MDCChip.
   */
  initialize(
    chipFactory = (el) => new MDCChip(el),
    leadingIconFactory = () => null,
    trailingIconFactory = () => null,
    chipTextFactory = () => this.input_ ? this.input_.value : '') {
    this.chipFactory_ = chipFactory;
    this.chips = this.instantiateChips_(this.chipFactory_);

    this.input_ = this.root_.querySelector(MDCChipSetFoundation.strings.INPUT_SELECTOR);
    this.setLeadingIconFactory(leadingIconFactory);
    this.setTrailingIconFactory(trailingIconFactory);
    this.setChipTextFactory(chipTextFactory);
  }

  destroy() {
    this.chips.forEach((chip) => {
      chip.destroy();
    });
  }

  initialSyncWithDOM() {
    this.chips.forEach((chip) => {
      if (chip.isSelected()) {
        this.foundation_.select(chip.foundation);
      }
    });
  }

  /**
   * Creates a new chip in the chip set with the given text, leading icon, and trailing icon.
   * @param {string} text
   * @param {?Element} leadingIcon
   * @param {?Element} trailingIcon
   */
  addChip(text, leadingIcon, trailingIcon) {
    const chipEl = this.foundation_.addChip(text, leadingIcon, trailingIcon);
    this.chips.push(this.chipFactory_(chipEl));
  }

  setLeadingIconFactory(leadingIconFactory) {
    this.leadingIconFactory_ = leadingIconFactory;
  }

  setTrailingIconFactory(trailingIconFactory) {
    this.trailingIconFactory_ = trailingIconFactory;
  }

  setChipTextFactory(chipTextFactory) {
    this.chipTextFactory_ = chipTextFactory;
  }

  /**
   * @return {!MDCChipSetFoundation}
   */
  getDefaultFoundation() {
    return new MDCChipSetFoundation(/** @type {!MDCChipSetAdapter} */ (Object.assign({
      hasClass: (className) => this.root_.classList.contains(className),
      registerInteractionHandler: (evtType, handler) => this.root_.addEventListener(evtType, handler),
      deregisterInteractionHandler: (evtType, handler) => this.root_.removeEventListener(evtType, handler),
      createChipElement: (text, leadingIcon, trailingIcon) => {
        const chipTextEl = document.createElement('div');
        chipTextEl.classList.add(MDCChipFoundation.cssClasses.TEXT);
        chipTextEl.appendChild(document.createTextNode(text));

        const chipEl = document.createElement('div');
        chipEl.classList.add(MDCChipFoundation.cssClasses.CHIP);
        if (leadingIcon) {
          chipEl.appendChild(leadingIcon);
        }
        chipEl.appendChild(chipTextEl);
        if (trailingIcon) {
          chipEl.appendChild(trailingIcon);
        }
        return chipEl;
      },
      appendChip: (chipEl) => {
        if (this.input_) {
          this.root_.insertBefore(chipEl, this.input_);
        } else {
          this.root_.appendChild(chipEl);
        }
      },
      registerInputInteractionHandler: (evtType, handler) => {
        if (this.input_) {
          this.input_.addEventListener(evtType, handler)
        }
      },
      deregisterInputInteractionHandler: (evtType, handler) => {
        if (this.input_) {
          this.input_.removeEventListener(evtType, handler)
        }
      },
      createLeadingIcon: () => this.leadingIconFactory_(),
      createTrailingIcon: () => this.trailingIconFactory_(),
      createChipText: () => this.chipTextFactory_(),
      getInputValue: () => this.input_ ? this.input_.value : '',
      clearInput: () => this.input_ ? this.input_.value = '' : '',
      pushChip: (chipEl) => this.chips.push(this.chipFactory_(chipEl)),
    })));
  }

  /**
   * Instantiates chip components on all of the chip set's child chip elements.
   * @param {(function(!Element): !MDCChip)} chipFactory
   * @return {!Array<!MDCChip>}
   */
  instantiateChips_(chipFactory) {
    const chipElements = [].slice.call(this.root_.querySelectorAll(MDCChipSetFoundation.strings.CHIP_SELECTOR));
    return chipElements.map((el) => chipFactory(el));
  }
}

export {MDCChipSet, MDCChipSetFoundation};
