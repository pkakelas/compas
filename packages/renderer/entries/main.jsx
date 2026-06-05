// Entry for the live player app.
// Order matches the original script order; app-shell.jsx renders into #root
// when it evaluates (last import), after every dependency is on window.
import "./globals.js";
import "./api.js";
import "../js/tweaks-panel.jsx";
import "../js/shared.jsx";
import "../js/chrome.jsx";
import "../js/app-player.jsx";
import "../js/tandas-data.jsx";
import "../js/tandas-import.jsx";
import "../js/tandas-tags.jsx";
import "../js/tandas-parts.jsx";
import "../js/library-view.jsx";
import "../js/tandas-view.jsx";
import "../js/playlists-view.jsx";
import "../js/settings-view.jsx";
import "../js/app-shell.jsx";
