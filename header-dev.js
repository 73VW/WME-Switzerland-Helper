// ==UserScript==
// @name        WME Switzerland Helper Dev
// @namespace   wme-sdk-scripts
// @version     1.0.0
// @description WME Switzerland Helper is a userscript that provides various tools and enhancements for Waze Map Editor (WME) users in Switzerland.
// @updateURL	https://TODO/myscript.user.js
// @downloadURL https://TODO/myscript.user.js
// @author      Maël Pedretti (Marelitaw)
// @match       https://www.waze.com/editor*
// @match       https://beta.waze.com/editor*
// @match       https://www.waze.com/*/editor*
// @match       https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/editor*
// @exclude     https://beta.waze.com/user/editor*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api3.geo.admin.ch
// @connect      data.sbb.ch
// @require		file://wsl.localhost/Debian/home/mael/opensource/WME-Switzerland-Helper/.out/main.user.js
// ==/UserScript==

// make sure that inside Tampermonkey's extension settings (on the browser, not from TM) and allow "Local file access", as shown here: https://www.tampermonkey.net/faq.php?locale=en#Q204
// make sure that the snippts inside header.js and header-dev.js are the same, except for the one @require field
// adjust the require field to the location of the .out/main.user.js file inside this directory
// copy the above snippet (up to ==/Userscript==) inside Tampermonkey's editor and save it
