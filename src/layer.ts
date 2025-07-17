/*
 * Copyright (c) 2025 Maël Pedretti
 *
 * This file is part of WME Switzerland Helper.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { WmeSDK } from "wme-sdk-typings";

abstract class Layer {
  name: string;
  constructor(args: { name: string }) {
    this.name = args.name;
  }
  addCheckBox(args: { wmeSDK: WmeSDK }) {
    args.wmeSDK.LayerSwitcher.addLayerCheckbox({ name: this.name });
  }
  abstract addToMap(args: { wmeSDK: WmeSDK }): void;
  removeFromMap(args: { wmeSDK: WmeSDK }) {
    args.wmeSDK.Map.removeLayer({ layerName: this.name });
  }
}

export { Layer };
