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

/**
 * Calculate the distance between two GPS coordinates using the Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in meters
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // radius of Earth in meters
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in meters
}

interface DialogButton {
  label: string;
  value: string;
}

interface DialogOptions {
  message: string;
  buttons: DialogButton[];
}

/**
 * Show a modal dialog to the user with custom buttons
 * @param options Dialog options including message and buttons
 * @returns Promise that resolves with the value of the clicked button
 */
function showWmeDialog(options: DialogOptions): Promise<string> {
  const { message, buttons } = options;
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.background = "#fff";
    modal.style.padding = "20px";
    modal.style.boxShadow = "0 2px 10px rgba(0,0,0,0.5)";
    modal.style.zIndex = "10000";
    modal.style.borderRadius = "6px";
    modal.style.textAlign = "center";
    modal.style.minWidth = "200px";

    // Build HTML
    const msg = document.createElement("p");
    msg.innerHTML = message;
    modal.appendChild(msg);

    buttons.forEach(({ label, value }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "btn btn-default";
      btn.style.margin = "5px";
      btn.onclick = () => {
        modal.remove();
        resolve(value);
      };
      modal.appendChild(btn);
    });

    // Add modal to page
    document.body.appendChild(modal);
  });
}

export { haversineDistance, showWmeDialog };
