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

const STORAGE_KEY = "wme-switzerland-helper-layer-state";

interface LayerState {
  [layerName: string]: boolean;
}

function getLayerStates(): LayerState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveLayerState(layerName: string, checked: boolean): void {
  try {
    const states = getLayerStates();
    states[layerName] = checked;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    console.warn("Failed to save layer state to localStorage");
  }
}

function isLayerEnabled(layerName: string): boolean | null {
  const states = getLayerStates();
  return layerName in states ? states[layerName] : null;
}

export { getLayerStates, saveLayerState, isLayerEnabled };
